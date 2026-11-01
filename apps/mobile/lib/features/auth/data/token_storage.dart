import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../domain/auth_models.dart';

final secureStorageProvider = Provider<FlutterSecureStorage>((ref) {
  return const FlutterSecureStorage();
});

final tokenStorageProvider = Provider<TokenStorage>((ref) {
  return TokenStorage(ref.watch(secureStorageProvider));
});

class TokenStorage {
  const TokenStorage(this._storage);

  static const tokenKey = 'darb_jwt';
  static const bundleKey = 'darb_auth_bundle_v1';
  static const _bundleVersion = 1;

  final FlutterSecureStorage _storage;

  Future<AuthTokenBundle?> readBundle() async {
    final encoded = await _storage.read(key: bundleKey);
    if (encoded != null) {
      try {
        final decoded = jsonDecode(encoded);
        if (decoded is! Map<String, dynamic>) {
          throw const FormatException('Invalid authentication bundle');
        }
        return _decodeBundle(decoded);
      } on FormatException {
        await clearAuth();
        return null;
      }
    }

    final legacy = await _storage.read(key: tokenKey);
    if (legacy == null || legacy.isEmpty) return null;
    return AuthTokenBundle(accessToken: legacy, legacyAccessOnly: true);
  }

  Future<void> saveBundle(AuthTokenBundle bundle) async {
    final encoded = jsonEncode({
      'version': _bundleVersion,
      'access_token': bundle.accessToken,
      'refresh_token': bundle.refreshToken,
      'access_token_expires_at': bundle.accessTokenExpiresAt
          ?.toUtc()
          .toIso8601String(),
      'refresh_token_expires_at': bundle.refreshTokenExpiresAt
          ?.toUtc()
          .toIso8601String(),
      'session_id': bundle.sessionId,
      'legacy_access_only': bundle.legacyAccessOnly,
    });
    await _storage.write(key: bundleKey, value: encoded);
    await _storage.delete(key: tokenKey);
  }

  Future<void> promoteLegacy(AuthTokenBundle bundle) async {
    if (!bundle.legacyAccessOnly) return;
    await saveBundle(bundle.asMigratedLegacy());
  }

  Future<void> clearAuth() async {
    Object? firstError;
    StackTrace? firstStackTrace;
    for (final key in [bundleKey, tokenKey]) {
      try {
        await _storage.delete(key: key);
      } catch (error, stackTrace) {
        firstError ??= error;
        firstStackTrace ??= stackTrace;
      }
    }
    if (firstError != null) {
      Error.throwWithStackTrace(firstError, firstStackTrace!);
    }
  }

  Future<String?> readToken() async => (await readBundle())?.accessToken;

  Future<void> saveToken(String token) async {
    await saveBundle(AuthTokenBundle(accessToken: token));
  }

  Future<void> clearToken() => clearAuth();

  AuthTokenBundle _decodeBundle(Map<String, dynamic> json) {
    if (json['version'] != _bundleVersion) {
      throw const FormatException('Unsupported authentication bundle');
    }
    final accessToken = _requiredString(json, 'access_token');
    final refreshToken = _optionalString(json, 'refresh_token');
    final accessExpiresAt = _optionalTimestamp(json, 'access_token_expires_at');
    final refreshExpiresAt = _optionalTimestamp(
      json,
      'refresh_token_expires_at',
    );
    final sessionId = _optionalString(json, 'session_id');
    final legacyAccessOnly = json['legacy_access_only'] == true;

    if (refreshExpiresAt != null && refreshToken == null) {
      throw const FormatException('Incomplete authentication bundle');
    }
    if (legacyAccessOnly && refreshToken != null) {
      throw const FormatException('Invalid legacy authentication bundle');
    }

    return AuthTokenBundle(
      accessToken: accessToken,
      refreshToken: refreshToken,
      accessTokenExpiresAt: accessExpiresAt,
      refreshTokenExpiresAt: refreshExpiresAt,
      sessionId: sessionId,
      legacyAccessOnly: legacyAccessOnly,
    );
  }
}

String _requiredString(Map<String, dynamic> json, String key) {
  final value = _optionalString(json, key);
  if (value != null) return value;
  throw FormatException('Missing $key');
}

String? _optionalString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('Invalid $key');
}

DateTime? _optionalTimestamp(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is! String) throw FormatException('Invalid $key');
  final parsed = DateTime.tryParse(value);
  if (parsed == null) throw FormatException('Invalid $key');
  return parsed.toUtc();
}
