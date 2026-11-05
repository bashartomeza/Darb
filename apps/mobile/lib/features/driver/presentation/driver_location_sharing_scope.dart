import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../canonical_routes/application/canonical_route_controller.dart';
import '../application/driver_location_sharing.dart';

/// Shares the driver's position for [tripId] while it runs and this screen is
/// visible with the app in the foreground.
///
/// Sharing needs the server's `live_tracking_available`, a trip between
/// acceptance and drop-off, this screen shown (not a hidden tab or covered by
/// another page) and the app resumed; losing any of them stops it at once. There is no background service. Widgets below
/// read the sharing state through [DriverLocationSharingNote].
class DriverLocationSharing extends ConsumerStatefulWidget {
  const DriverLocationSharing({
    required this.tripId,
    required this.tripStatus,
    required this.child,
    super.key,
  });

  final String tripId;
  final String tripStatus;
  final Widget child;

  @override
  ConsumerState<DriverLocationSharing> createState() =>
      _DriverLocationSharingState();
}

class _DriverLocationSharingState extends ConsumerState<DriverLocationSharing>
    with WidgetsBindingObserver {
  late final DriverLocationSender _sender;
  bool _foreground = true;
  bool _visible = false;
  bool _available = false;

  @override
  void initState() {
    super.initState();
    _foreground =
        WidgetsBinding.instance.lifecycleState == null ||
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    WidgetsBinding.instance.addObserver(this);
    _sender = DriverLocationSender(
      source: ref.read(driverPositionSourceProvider),
      upload: (fix) => ref.read(driverFixUploadProvider)(widget.tripId, fix),
      askConsent: _askConsent,
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Off in a hidden tab or under another full screen. A dialog or sheet on
    // top keeps sharing: the driver is still on the trip.
    _visible = TickerMode.valuesOf(context).enabled;
    _scheduleSync();
  }

  @override
  void didUpdateWidget(covariant DriverLocationSharing oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.tripStatus != widget.tripStatus) _scheduleSync();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _sync();
  }

  // Changing the sender notifies the note below, so build-time changes wait
  // for the end of the frame.
  void _scheduleSync() {
    WidgetsBinding.instance.addPostFrameCallback((_) => _sync());
  }

  void _sync() {
    if (!mounted) return;
    _sender.setActive(
      _available &&
          _visible &&
          _foreground &&
          liveTrackingTripStatuses.contains(widget.tripStatus),
    );
  }

  Future<bool> _askConsent() async {
    if (!mounted) return false;
    final l10n = AppLocalizations.of(context);
    final allowed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        key: const ValueKey('locationSharingConsent'),
        icon: const Icon(Icons.share_location_rounded),
        title: Text(l10n.locationSharingConsentTitle),
        content: Text(l10n.locationSharingConsentBody),
        actions: [
          TextButton(
            key: const ValueKey('locationSharingNotNow'),
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.locationSharingNotNow),
          ),
          FilledButton(
            key: const ValueKey('locationSharingAllow'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.locationSharingAllow),
          ),
        ],
      ),
    );
    return allowed ?? false;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sender.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final available =
        ref.watch(mobileCapabilitiesProvider).value?.liveTrackingAvailable ==
        true;
    if (available != _available) {
      _available = available;
      _scheduleSync();
    }
    return _SharingScope(sender: _sender, child: widget.child);
  }
}

class _SharingScope extends InheritedNotifier<DriverLocationSender> {
  const _SharingScope({
    required DriverLocationSender sender,
    required super.child,
  }) : super(notifier: sender);
}

/// What the driver should know about sharing: that it is on, or why it is
/// not and how to fix it. Renders nothing outside [DriverLocationSharing] or
/// when sharing is not called for.
class DriverLocationSharingNote extends StatelessWidget {
  const DriverLocationSharingNote({super.key});

  @override
  Widget build(BuildContext context) {
    final sender = context
        .dependOnInheritedWidgetOfExactType<_SharingScope>()
        ?.notifier;
    if (sender == null) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final status = sender.value;
    final (String? message, String? action) = switch (status) {
      LocationSharingStatus.off => (null, null),
      LocationSharingStatus.sharing => (l10n.locationSharingActive, null),
      LocationSharingStatus.declined => (
        l10n.locationSharingDeclined,
        l10n.locationSharingTurnOn,
      ),
      LocationSharingStatus.denied => (
        l10n.locationSharingDenied,
        l10n.locationSharingTurnOn,
      ),
      LocationSharingStatus.permanentlyDenied => (
        l10n.locationSharingPermanentlyDenied,
        l10n.locationSharingOpenSettings,
      ),
      LocationSharingStatus.serviceDisabled => (
        l10n.locationSharingServiceDisabled,
        l10n.locationSharingOpenSettings,
      ),
      LocationSharingStatus.unavailable => (
        l10n.locationSharingUnavailable,
        null,
      ),
    };
    if (message == null) return const SizedBox.shrink();
    final sharing = status == LocationSharingStatus.sharing;
    final scheme = Theme.of(context).colorScheme;
    final color = sharing ? const Color(0xFF3A7C07) : const Color(0xFFA36B22);
    return Padding(
      padding: const EdgeInsets.only(top: 9),
      child: Container(
        key: ValueKey('locationSharingNote-${status.name}'),
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(15),
          border: Border.all(color: color.withValues(alpha: 0.25)),
        ),
        child: Row(
          children: [
            Icon(
              sharing
                  ? Icons.share_location_rounded
                  : Icons.location_disabled_rounded,
              color: color,
              size: 18,
            ),
            const SizedBox(width: 9),
            Expanded(
              child: Text(
                message,
                style: TextStyle(
                  color: scheme.onSurface,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            if (action != null)
              TextButton(
                key: const ValueKey('locationSharingRetry'),
                onPressed: sender.retry,
                child: Text(action),
              ),
          ],
        ),
      ),
    );
  }
}
