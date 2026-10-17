enum UserRole { passenger, driver, merchant, admin, unsupported }

UserRole parseUserRole(String value) {
  return switch (value) {
    'passenger' => UserRole.passenger,
    'driver' => UserRole.driver,
    'merchant' => UserRole.merchant,
    'admin' => UserRole.admin,
    _ => UserRole.unsupported,
  };
}

enum SessionEndReason { expired, ended, accountUnavailable }

SessionEndReason sessionEndReasonForCode(String code) {
  return switch (code) {
    'access_token_expired' || 'session_expired' => SessionEndReason.expired,
    'account_unavailable' => SessionEndReason.accountUnavailable,
    _ => SessionEndReason.ended,
  };
}

class AuthUser {
  const AuthUser({
    required this.id,
    required this.name,
    required this.role,
    required this.demoAccount,
    this.phone,
    this.email,
  });

  final String id;
  final String name;
  final String? phone;
  final String? email;
  final UserRole role;
  final bool demoAccount;

  /// A human-facing account handle for UI that used to show the phone number.
  String get contact => email ?? phone ?? '';

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: _readString(json, 'id'),
      name: _readString(json, 'name'),
      phone: _optionalString(json, 'phone'),
      email: _optionalString(json, 'email'),
      role: parseUserRole(_readString(json, 'role')),
      demoAccount: json['demo_account'] == true,
    );
  }
}

class AuthSessionSummary {
  const AuthSessionSummary({
    required this.id,
    required this.clientType,
    required this.createdAt,
    required this.lastUsedAt,
    required this.expiresAt,
    required this.isCurrent,
    required this.revoked,
    this.deviceName,
  });

  final String id;
  final String clientType;
  final String? deviceName;
  final DateTime createdAt;
  final DateTime lastUsedAt;
  final DateTime expiresAt;
  final bool isCurrent;
  final bool revoked;

  factory AuthSessionSummary.fromJson(Map<String, dynamic> json) {
    final rawDeviceName = json['device_name'];
    if (rawDeviceName != null && rawDeviceName is! String) {
      throw const FormatException('Invalid session summary');
    }
    return AuthSessionSummary(
      id: _readString(json, 'id'),
      clientType: _readString(json, 'client_type'),
      deviceName: rawDeviceName as String?,
      createdAt: _readTimestamp(json, 'created_at'),
      lastUsedAt: _readTimestamp(json, 'last_used_at'),
      expiresAt: _readTimestamp(json, 'expires_at'),
      isCurrent: json['is_current'] == true,
      revoked: json['revoked'] == true,
    );
  }
}

class AuthTokenBundle {
  const AuthTokenBundle({
    required this.accessToken,
    this.refreshToken,
    this.accessTokenExpiresAt,
    this.refreshTokenExpiresAt,
    this.sessionId,
    this.legacyAccessOnly = false,
  });

  final String accessToken;
  final String? refreshToken;
  final DateTime? accessTokenExpiresAt;
  final DateTime? refreshTokenExpiresAt;
  final String? sessionId;
  final bool legacyAccessOnly;

  bool get canRefresh => refreshToken != null && refreshToken!.isNotEmpty;

  AuthTokenBundle asMigratedLegacy() => AuthTokenBundle(
    accessToken: accessToken,
    accessTokenExpiresAt: accessTokenExpiresAt,
    sessionId: sessionId,
    legacyAccessOnly: true,
  );
}

class LoginResult {
  const LoginResult({required this.bundle, required this.user, this.session});

  final AuthTokenBundle bundle;
  final AuthUser user;
  final AuthSessionSummary? session;

  String get token => bundle.accessToken;

  factory LoginResult.fromJson(
    Map<String, dynamic> json, {
    DateTime? receivedAt,
  }) {
    final userJson = json['user'];
    if (userJson is! Map<String, dynamic>) {
      throw const FormatException('Missing user');
    }

    final legacyToken = _optionalString(json, 'token');
    final explicitToken = _optionalString(json, 'access_token');
    if (legacyToken != null &&
        explicitToken != null &&
        legacyToken != explicitToken) {
      throw const FormatException('Conflicting access credentials');
    }
    final accessToken = explicitToken ?? legacyToken;
    if (accessToken == null) {
      throw const FormatException('Missing access credential');
    }

    final refreshToken = _optionalString(json, 'refresh_token');
    final accessExpiresIn = _optionalPositiveSeconds(
      json,
      'access_token_expires_in',
    );
    final refreshExpiresIn = _optionalPositiveSeconds(
      json,
      'refresh_token_expires_in',
    );
    if (refreshExpiresIn != null && refreshToken == null) {
      throw const FormatException('Incomplete refresh credential');
    }

    final sessionJson = json['session'];
    final session = sessionJson == null
        ? null
        : sessionJson is Map<String, dynamic>
        ? AuthSessionSummary.fromJson(sessionJson)
        : throw const FormatException('Invalid session summary');
    final now = (receivedAt ?? DateTime.now()).toUtc();

    return LoginResult(
      bundle: AuthTokenBundle(
        accessToken: accessToken,
        refreshToken: refreshToken,
        accessTokenExpiresAt: accessExpiresIn == null
            ? null
            : now.add(Duration(seconds: accessExpiresIn)),
        refreshTokenExpiresAt: refreshExpiresIn == null
            ? null
            : now.add(Duration(seconds: refreshExpiresIn)),
        sessionId: session?.id,
      ),
      user: AuthUser.fromJson(userJson),
      session: session,
    );
  }
}

String _readString(Map<String, dynamic> json, String key) {
  final value = _optionalString(json, key);
  if (value != null) return value;
  throw FormatException('Missing $key');
}

String? _optionalString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is String && value.trim().isNotEmpty) return value;
  throw FormatException('Invalid $key');
}

int? _optionalPositiveSeconds(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is int && value > 0) return value;
  throw FormatException('Invalid $key');
}

DateTime _readTimestamp(Map<String, dynamic> json, String key) {
  final value = _readString(json, key);
  final parsed = DateTime.tryParse(value);
  if (parsed == null) throw FormatException('Invalid $key');
  return parsed.toUtc();
}
