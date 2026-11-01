import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Resolves a human-readable place name for a map point.
///
/// Implementations return null when no name is known. They may throw; callers
/// must treat any failure as "no name" and keep the coordinates.
abstract class ReverseGeocoder {
  Future<String?> lookup(double latitude, double longitude);
}

/// No reverse-geocoding provider is approved for the app yet (see ADR-020 and
/// ADR-021), so the default never names a point. Pickers then keep the
/// coordinates with a neutral fallback label that the user can edit.
class UnavailableReverseGeocoder implements ReverseGeocoder {
  const UnavailableReverseGeocoder();

  @override
  Future<String?> lookup(double latitude, double longitude) async => null;
}

/// Wraps a [ReverseGeocoder] so the same point is never looked up twice, and
/// concurrent lookups for one point share a single request. Failures and empty
/// results are cached too, so a failing provider is not hammered by re-taps.
class CachingReverseGeocoder implements ReverseGeocoder {
  CachingReverseGeocoder(this._delegate);

  final ReverseGeocoder _delegate;
  final Map<String, Future<String?>> _cache = {};

  static String _key(double latitude, double longitude) =>
      '${latitude.toStringAsFixed(5)},${longitude.toStringAsFixed(5)}';

  @override
  Future<String?> lookup(double latitude, double longitude) {
    return _cache.putIfAbsent(_key(latitude, longitude), () async {
      try {
        final name = (await _delegate.lookup(latitude, longitude))?.trim();
        return name == null || name.isEmpty ? null : name;
      } catch (_) {
        return null;
      }
    });
  }
}

final reverseGeocoderProvider = Provider<ReverseGeocoder>(
  (ref) => CachingReverseGeocoder(const UnavailableReverseGeocoder()),
);
