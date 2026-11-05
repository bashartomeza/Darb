import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../data/driver_repository.dart';

/// Trip statuses during which the driver's phone shares its position: from
/// acceptance until drop-off. The server refuses posts outside them.
const liveTrackingTripStatuses = {
  'accepted',
  'pickup_started',
  'picked_up',
  'in_transit',
};

/// One reading of the phone's position.
class DeviceFix {
  const DeviceFix({
    required this.lat,
    required this.lng,
    required this.accuracyMeters,
    required this.timestamp,
  });

  final double lat;
  final double lng;
  final double accuracyMeters;
  final DateTime timestamp;
}

/// Whether the app may read the position, in the terms the driver acts on.
enum LocationAccess {
  granted,

  /// Never asked, or Android may still ask again.
  notAsked,
  denied,
  permanentlyDenied,
  serviceDisabled,
}

/// The phone's location, behind an interface so tests run without a device.
abstract interface class DriverPositionSource {
  Future<LocationAccess> access();
  Future<LocationAccess> requestAccess();
  Future<DeviceFix> currentFix();
  Future<void> openAppSettings();
  Future<void> openLocationSettings();
}

class GeolocatorPositionSource implements DriverPositionSource {
  const GeolocatorPositionSource();

  @override
  Future<LocationAccess> access() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return LocationAccess.serviceDisabled;
    }
    return switch (await Geolocator.checkPermission()) {
      LocationPermission.always ||
      LocationPermission.whileInUse => LocationAccess.granted,
      LocationPermission.deniedForever => LocationAccess.permanentlyDenied,
      LocationPermission.denied ||
      LocationPermission.unableToDetermine => LocationAccess.notAsked,
    };
  }

  @override
  Future<LocationAccess> requestAccess() async {
    return switch (await Geolocator.requestPermission()) {
      LocationPermission.always ||
      LocationPermission.whileInUse => LocationAccess.granted,
      LocationPermission.deniedForever => LocationAccess.permanentlyDenied,
      LocationPermission.denied ||
      LocationPermission.unableToDetermine => LocationAccess.denied,
    };
  }

  @override
  Future<DeviceFix> currentFix() async {
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        // A rider waiting at the roadside needs the driver's street, not just
        // the town; the server refuses fixes coarser than 150 m.
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 12),
      ),
    );
    return DeviceFix(
      lat: position.latitude,
      lng: position.longitude,
      accuracyMeters: position.accuracy,
      timestamp: position.timestamp,
    );
  }

  @override
  Future<void> openAppSettings() => Geolocator.openAppSettings();

  @override
  Future<void> openLocationSettings() => Geolocator.openLocationSettings();
}

final driverPositionSourceProvider = Provider<DriverPositionSource>(
  (ref) => const GeolocatorPositionSource(),
);

typedef DriverFixUpload = Future<void> Function(String tripId, DeviceFix fix);

final driverFixUploadProvider = Provider<DriverFixUpload>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return (tripId, fix) => repository.postLocation(
    tripId,
    lat: fix.lat,
    lng: fix.lng,
    accuracyMeters: fix.accuracyMeters,
    recordedAt: fix.timestamp,
  );
});

enum LocationSharingStatus {
  /// Not sharing because the trip, screen or app does not call for it.
  off,
  sharing,

  /// The driver chose "Not now" in Darb's own explanation.
  declined,
  denied,
  permanentlyDenied,
  serviceDisabled,

  /// Permission is fine but no fix came back; retried on the next tick.
  unavailable,
}

/// Sends the phone's position for one trip while [setActive] says so.
///
/// Foreground only: the owner turns it off when the trip ends, the screen is
/// left or the app is backgrounded, and nothing here runs without it. Before
/// the system prompt the driver sees Darb's own reason ([askConsent]); a
/// "Not now" is remembered for this sender so resuming does not nag again.
class DriverLocationSender extends ValueNotifier<LocationSharingStatus> {
  DriverLocationSender({
    required this.source,
    required this.upload,
    required this.askConsent,
    this.interval = const Duration(seconds: 15),
  }) : super(LocationSharingStatus.off);

  final DriverPositionSource source;
  final Future<void> Function(DeviceFix fix) upload;
  final Future<bool> Function() askConsent;

  /// The server keeps at most one point per 10 s; 15 s stays clear of it.
  final Duration interval;

  Timer? _timer;
  bool _active = false;

  /// The driver's answer to Darb's explanation, kept for this sender.
  bool? _consented;

  /// The system prompt was shown once already. Asking again on every resume
  /// would loop when the driver refuses it, so only the note's button does.
  bool _requested = false;
  bool _sending = false;
  bool _disposed = false;
  int _generation = 0;
  Future<bool>? _consent;

  bool get active => _active;

  /// Starts or stops sharing. Repeated calls with the same value do nothing.
  void setActive(bool active) {
    if (_disposed || active == _active) return;
    _active = active;
    _restart();
  }

  /// The note's action: ask again, or open the settings that block sharing.
  Future<void> retry() async {
    if (_disposed) return;
    switch (value) {
      case LocationSharingStatus.permanentlyDenied:
        await source.openAppSettings();
      case LocationSharingStatus.serviceDisabled:
        await source.openLocationSettings();
      default:
        _consented = null;
        _requested = false;
    }
    // Coming back from the settings app resumes the screen, which restarts
    // sharing anyway; restarting here covers the in-app cases.
    if (_active) _restart();
  }

  void _restart() {
    _generation++;
    _timer?.cancel();
    _timer = null;
    if (_active) {
      unawaited(_start(_generation));
    } else {
      _set(LocationSharingStatus.off);
    }
  }

  bool _current(int generation) =>
      !_disposed && _active && generation == _generation;

  Future<void> _start(int generation) async {
    var access = await _access();
    if (!_current(generation)) return;
    if (access == null) {
      _set(LocationSharingStatus.unavailable);
      return;
    }
    if (access == LocationAccess.notAsked) {
      if (_consented == null) {
        // One explanation at a time, even if sharing restarts meanwhile.
        final consent = _consent ??= askConsent().whenComplete(
          () => _consent = null,
        );
        _consented = await consent.catchError((Object _) => false);
        if (!_current(generation)) return;
      }
      if (_consented != true) {
        _set(LocationSharingStatus.declined);
        return;
      }
      if (_requested) {
        _set(LocationSharingStatus.denied);
        return;
      }
      _requested = true;
      try {
        access = await source.requestAccess();
      } catch (_) {
        access = LocationAccess.denied;
      }
      // The system prompt pauses the app; its return restarts sharing and
      // reads the new permission then.
      if (!_current(generation)) return;
    }
    final blocked = _blockedStatus(access);
    if (blocked != null) {
      _set(blocked);
      return;
    }
    _set(LocationSharingStatus.sharing);
    _timer = Timer.periodic(interval, (_) => unawaited(_tick(generation)));
    await _tick(generation);
  }

  Future<void> _tick(int generation) async {
    if (_sending || !_current(generation)) return;
    _sending = true;
    try {
      final DeviceFix fix;
      try {
        fix = await source.currentFix();
      } catch (_) {
        // Permission or the location service may have been switched off
        // mid-trip; otherwise the fix just timed out. Keep ticking either way
        // so turning them back on resumes sharing.
        final access = await _access();
        if (_current(generation)) {
          _set(
            access == null
                ? LocationSharingStatus.unavailable
                : _blockedStatus(access) ?? LocationSharingStatus.unavailable,
          );
        }
        return;
      }
      if (!_current(generation)) return;
      try {
        await upload(fix);
      } catch (_) {
        // Offline or refused: the next tick sends a newer fix.
      }
      if (_current(generation)) _set(LocationSharingStatus.sharing);
    } finally {
      _sending = false;
    }
  }

  /// Null when the platform could not tell (no location plugin, say).
  Future<LocationAccess?> _access() async {
    try {
      return await source.access();
    } catch (_) {
      return null;
    }
  }

  static LocationSharingStatus? _blockedStatus(LocationAccess access) {
    return switch (access) {
      LocationAccess.granted => null,
      LocationAccess.notAsked ||
      LocationAccess.denied => LocationSharingStatus.denied,
      LocationAccess.permanentlyDenied =>
        LocationSharingStatus.permanentlyDenied,
      LocationAccess.serviceDisabled => LocationSharingStatus.serviceDisabled,
    };
  }

  void _set(LocationSharingStatus next) {
    if (!_disposed) value = next;
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _timer?.cancel();
    _timer = null;
    super.dispose();
  }
}
