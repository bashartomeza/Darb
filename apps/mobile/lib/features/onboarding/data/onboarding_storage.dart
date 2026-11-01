import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../auth/data/token_storage.dart';
import '../domain/onboarding_models.dart';

final onboardingStorageProvider = Provider<OnboardingStorage>((ref) {
  return OnboardingStorage(ref.watch(secureStorageProvider));
});

class OnboardingStorage {
  const OnboardingStorage(this._storage, {DateTime Function()? now})
    : _now = now ?? DateTime.now;

  static const bundleKey = 'darb_onboarding_bundle_v1';

  final FlutterSecureStorage _storage;
  final DateTime Function() _now;

  Future<OnboardingBundle?> readBundle() async {
    final encoded = await _storage.read(key: bundleKey);
    if (encoded == null || encoded.isEmpty) return null;
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! Map<String, dynamic>) {
        throw const FormatException('Invalid onboarding bundle');
      }
      final bundle = OnboardingBundle.fromJson(decoded);
      if (bundle.isExpired(_now())) {
        await clear();
        return null;
      }
      return bundle;
    } on FormatException {
      await clear();
      return null;
    }
  }

  Future<void> saveBundle(OnboardingBundle bundle) async {
    if (bundle.isExpired(_now())) {
      throw StateError('Refusing to persist expired onboarding bundle');
    }
    await _storage.write(key: bundleKey, value: jsonEncode(bundle.toJson()));
  }

  Future<void> clear() => _storage.delete(key: bundleKey);
}
