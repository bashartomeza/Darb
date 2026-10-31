enum OnboardingRole { passenger, driver, merchant }

enum OnboardingStage {
  checkingAvailability,
  unavailable,
  choosingRole,
  enteringInvitation,
  enteringPhone,
  starting,
  otpSent,
  resending,
  verifyingOtp,
  phoneVerified,
  loadingConsents,
  enteringAccountDetails,
  reviewingConsents,
  completingRegistration,
  passengerCreated,
  approvedSignIn,
  pendingReview,
  retryableFailure,
  terminalFailure,
}

enum OnboardingBundleType { continuation, pendingStatus }

class OnboardingConfig {
  const OnboardingConfig({
    required this.enabled,
    required this.registrationRoles,
    required this.supportedLocales,
    required this.minimumPasswordCharacters,
    required this.maximumPasswordCharacters,
    required this.maximumPasswordUtf8Bytes,
    required this.otpDigits,
    required this.resendCooldownSeconds,
    this.openRegistrationRoles = const [],
    this.requestId,
  });

  final bool enabled;
  final List<OnboardingRole> registrationRoles;

  /// Roles that may register without an invitation code (the server switch is on).
  final List<OnboardingRole> openRegistrationRoles;
  final List<String> supportedLocales;
  final int minimumPasswordCharacters;
  final int maximumPasswordCharacters;
  final int maximumPasswordUtf8Bytes;
  final int otpDigits;
  final int resendCooldownSeconds;
  final String? requestId;

  factory OnboardingConfig.fromJson(Map<String, dynamic> json) {
    final enabled = json['enabled'] == true;
    if (!enabled) {
      return OnboardingConfig(
        enabled: false,
        registrationRoles: const [],
        supportedLocales: const [],
        minimumPasswordCharacters: 15,
        maximumPasswordCharacters: 64,
        maximumPasswordUtf8Bytes: 72,
        otpDigits: 6,
        resendCooldownSeconds: 60,
        requestId: _optionalString(json, 'request_id'),
      );
    }

    final rawRoles = _requiredStringList(json, 'registration_roles');
    final roles = rawRoles.map(_roleFromApi).toList(growable: false);
    final rawLocales = _requiredStringList(json, 'supported_locales');
    final phonePolicy = json['phone_policy'];
    final policy = json['password_policy'];
    if (phonePolicy is! Map<String, dynamic> ||
        phonePolicy['canonical_format'] != 'E.164' ||
        phonePolicy['international_prefix_required_without_region'] != true ||
        phonePolicy['local_numbers_require_region'] != true ||
        roles.isEmpty ||
        roles.any((role) => role == null) ||
        roles.toSet().length != roles.length ||
        rawLocales.toSet().length != rawLocales.length ||
        rawLocales.any((locale) => locale != 'ar' && locale != 'en') ||
        !rawLocales.contains('ar') ||
        !rawLocales.contains('en') ||
        policy is! Map<String, dynamic>) {
      throw const FormatException('Invalid onboarding configuration');
    }
    final minimum = _requiredInt(policy, 'minimum_characters');
    final maximum = _requiredInt(policy, 'maximum_characters');
    final maximumBytes = _requiredInt(policy, 'maximum_utf8_bytes');
    final otpDigits = _requiredInt(json, 'otp_digits');
    final cooldown = _requiredInt(json, 'resend_cooldown_seconds');
    if (minimum < 1 ||
        maximum < minimum ||
        maximumBytes < minimum ||
        otpDigits != 6 ||
        cooldown < 1) {
      throw const FormatException('Invalid onboarding policy');
    }
    final rawOpen = json['open_registration_roles'];
    final openRoles = rawOpen is List
        ? rawOpen
              .whereType<String>()
              .map(_roleFromApi)
              .whereType<OnboardingRole>()
              .where(
                (role) =>
                    role == OnboardingRole.driver ||
                    role == OnboardingRole.merchant,
              )
              .toSet()
              .toList(growable: false)
        : const <OnboardingRole>[];
    return OnboardingConfig(
      enabled: true,
      registrationRoles: roles.cast<OnboardingRole>(),
      openRegistrationRoles: openRoles,
      supportedLocales: rawLocales,
      minimumPasswordCharacters: minimum,
      maximumPasswordCharacters: maximum,
      maximumPasswordUtf8Bytes: maximumBytes,
      otpDigits: otpDigits,
      resendCooldownSeconds: cooldown,
      requestId: _optionalString(json, 'request_id'),
    );
  }
}

class ConsentDocument {
  const ConsentDocument({
    required this.id,
    required this.type,
    required this.version,
    required this.locale,
    required this.content,
    required this.contentHash,
    required this.effectiveAt,
  });

  final String id;
  final String type;
  final String version;
  final String locale;
  final String content;
  final String contentHash;
  final DateTime effectiveAt;

  factory ConsentDocument.fromJson(Map<String, dynamic> json) {
    final id = _requiredString(json, 'id');
    final type = _requiredString(json, 'type');
    final version = _requiredString(json, 'version');
    final locale = _requiredString(json, 'locale');
    final content = _requiredString(json, 'content');
    final hash = _requiredString(json, 'content_hash');
    final effectiveAt = DateTime.tryParse(
      _requiredString(json, 'effective_at'),
    );
    if (!requiredConsentTypes.contains(type) ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(hash) ||
        effectiveAt == null) {
      throw const FormatException('Invalid consent document');
    }
    return ConsentDocument(
      id: id,
      type: type,
      version: version,
      locale: locale,
      content: content,
      contentHash: hash,
      effectiveAt: effectiveAt.toUtc(),
    );
  }
}

class StartAttemptResult {
  const StartAttemptResult({
    required this.attemptId,
    required this.status,
    required this.maskedPhone,
    required this.expiresAt,
    required this.resendAvailableAt,
    required this.onboardingToken,
    required this.onboardingTokenExpiresAt,
    required this.nextAction,
    this.requestId,
  });

  final String attemptId;
  final String status;
  final String maskedPhone;
  final DateTime expiresAt;
  final DateTime resendAvailableAt;
  final String onboardingToken;
  final DateTime onboardingTokenExpiresAt;
  final String nextAction;
  final String? requestId;

  factory StartAttemptResult.fromJson(Map<String, dynamic> json) {
    final attempt = json['attempt'];
    if (attempt is! Map<String, dynamic>) {
      throw const FormatException('Missing attempt');
    }
    return StartAttemptResult(
      attemptId: _requiredString(attempt, 'id'),
      status: _requiredString(attempt, 'status'),
      maskedPhone: _requiredString(attempt, 'phone'),
      expiresAt: _requiredDate(attempt, 'expires_at'),
      resendAvailableAt: _requiredDate(attempt, 'resend_available_at'),
      onboardingToken: _requiredString(json, 'onboarding_token'),
      onboardingTokenExpiresAt: _requiredDate(
        json,
        'onboarding_token_expires_at',
      ),
      nextAction: _requiredString(json, 'next_action'),
      requestId: json['request_id'] is String
          ? json['request_id'] as String
          : null,
    );
  }
}

class VerifyOtpResult {
  const VerifyOtpResult({
    required this.registrationGrant,
    required this.registrationGrantExpiresAt,
    required this.nextAction,
    this.requestId,
  });

  final String registrationGrant;
  final DateTime registrationGrantExpiresAt;
  final String nextAction;
  final String? requestId;

  factory VerifyOtpResult.fromJson(Map<String, dynamic> json) {
    if (json['status'] != 'phone_verified') {
      throw const FormatException('Unexpected OTP status');
    }
    return VerifyOtpResult(
      registrationGrant: _requiredString(json, 'registration_grant'),
      registrationGrantExpiresAt: _requiredDate(
        json,
        'registration_grant_expires_at',
      ),
      nextAction: _requiredString(json, 'next_action'),
      requestId: json['request_id'] is String
          ? json['request_id'] as String
          : null,
    );
  }
}

class CompleteRegistrationResult {
  const CompleteRegistrationResult({
    required this.role,
    required this.accountStatus,
    required this.nextAction,
    this.pendingStatusToken,
    this.pendingStatusExpiresAt,
    this.requestId,
  });

  final OnboardingRole role;
  final String accountStatus;
  final String nextAction;
  final String? pendingStatusToken;
  final DateTime? pendingStatusExpiresAt;
  final String? requestId;

  factory CompleteRegistrationResult.fromJson(Map<String, dynamic> json) {
    if (json['result'] != 'account_created') {
      throw const FormatException('Unexpected registration result');
    }
    if (json.containsKey('access_token') ||
        json.containsKey('refresh_token') ||
        json.containsKey('token') ||
        json.containsKey('session') ||
        json.containsKey('session_id')) {
      throw const FormatException('Registration returned operational token');
    }
    final role = _roleFromApi(_requiredString(json, 'role'));
    if (role == null) throw const FormatException('Unexpected role');
    return CompleteRegistrationResult(
      role: role,
      accountStatus: _requiredString(json, 'account_status'),
      nextAction: _requiredString(json, 'next_action'),
      pendingStatusToken: json['onboarding_status_token'] is String
          ? json['onboarding_status_token'] as String
          : null,
      pendingStatusExpiresAt: _optionalDate(
        json,
        'onboarding_status_expires_at',
      ),
      requestId: json['request_id'] is String
          ? json['request_id'] as String
          : null,
    );
  }
}

const driverDocumentKinds = <String>[
  'driver_licence',
  'vehicle_registration',
  'national_id',
  'insurance',
  'other',
];

const merchantDocumentKinds = <String>[
  'commercial_register',
  'national_id',
  'shop_photo',
  'other',
];

class DriverDocument {
  const DriverDocument({
    required this.id,
    required this.kind,
    required this.sizeBytes,
  });

  final String id;
  final String kind;
  final int sizeBytes;

  factory DriverDocument.fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    final kind = json['kind'];
    final size = json['size_bytes'];
    if (id is! String || kind is! String || size is! int) {
      throw const FormatException('Invalid document');
    }
    return DriverDocument(id: id, kind: kind, sizeBytes: size);
  }
}

class DriverDocumentList {
  const DriverDocumentList({
    required this.documents,
    required this.maxDocuments,
    required this.maxBytes,
  });

  final List<DriverDocument> documents;
  final int maxDocuments;
  final int maxBytes;

  factory DriverDocumentList.fromJson(Map<String, dynamic> json) {
    final documents = json['documents'];
    final limits = json['limits'];
    if (documents is! List || limits is! Map<String, dynamic>) {
      throw const FormatException('Invalid document list');
    }
    final maxDocuments = limits['max_documents'];
    final maxBytes = limits['max_bytes'];
    if (maxDocuments is! int || maxBytes is! int) {
      throw const FormatException('Invalid document limits');
    }
    return DriverDocumentList(
      documents: documents
          .whereType<Map<String, dynamic>>()
          .map(DriverDocument.fromJson)
          .toList(growable: false),
      maxDocuments: maxDocuments,
      maxBytes: maxBytes,
    );
  }
}

/// Documents an applicant must upload before the application can be sent for review.
const driverRequiredDocumentKinds = <String>[
  'driver_licence',
  'vehicle_registration',
  'national_id',
];

const merchantRequiredDocumentKinds = <String>[
  'commercial_register',
  'national_id',
  'shop_photo',
];

class PendingStatusResult {
  const PendingStatusResult({
    required this.role,
    required this.status,
    required this.nextAction,
    this.missingDocuments = const [],
    this.pendingStatusToken,
    this.pendingStatusExpiresAt,
    this.requestId,
  });

  final OnboardingRole? role;

  /// `pending_review`, `documents_required` (not yet submitted) or `approved_sign_in`.
  final String status;
  final String nextAction;
  final List<String> missingDocuments;
  final String? pendingStatusToken;
  final DateTime? pendingStatusExpiresAt;
  final String? requestId;

  factory PendingStatusResult.fromJson(Map<String, dynamic> json) {
    final rawRole = json['role'];
    final role = rawRole is String ? _roleFromApi(rawRole) : null;
    if (rawRole != null && role == null) {
      throw const FormatException('Unexpected role');
    }
    return PendingStatusResult(
      role: role,
      status: _requiredString(json, 'onboarding_status'),
      nextAction: _requiredString(json, 'next_action'),
      missingDocuments: json['missing_documents'] is List
          ? (json['missing_documents'] as List).whereType<String>().toList(
              growable: false,
            )
          : const [],
      pendingStatusToken: json['onboarding_status_token'] is String
          ? json['onboarding_status_token'] as String
          : null,
      pendingStatusExpiresAt: _optionalDate(
        json,
        'onboarding_status_expires_at',
      ),
      requestId: json['request_id'] is String
          ? json['request_id'] as String
          : null,
    );
  }
}

class OnboardingBundle {
  const OnboardingBundle({
    required this.type,
    required this.safeStage,
    required this.locale,
    required this.selectedRole,
    this.attemptId,
    this.continuationToken,
    this.continuationExpiresAt,
    this.registrationGrant,
    this.registrationGrantExpiresAt,
    this.pendingStatusToken,
    this.pendingStatusExpiresAt,
    this.maskedPhone,
    this.resendAvailableAt,
    this.idempotency,
  });

  final OnboardingBundleType type;
  final OnboardingStage safeStage;
  final String locale;
  final OnboardingRole? selectedRole;
  final String? attemptId;
  final String? continuationToken;
  final DateTime? continuationExpiresAt;
  final String? registrationGrant;
  final DateTime? registrationGrantExpiresAt;
  final String? pendingStatusToken;
  final DateTime? pendingStatusExpiresAt;
  final String? maskedPhone;
  final DateTime? resendAvailableAt;
  final Map<String, String>? idempotency;

  bool isExpired(DateTime now) {
    final utc = now.toUtc();
    return switch (type) {
      OnboardingBundleType.continuation =>
        continuationExpiresAt == null ||
            !continuationExpiresAt!.isAfter(utc) ||
            (registrationGrant != null &&
                (registrationGrantExpiresAt == null ||
                    !registrationGrantExpiresAt!.isAfter(utc))),
      OnboardingBundleType.pendingStatus =>
        pendingStatusExpiresAt == null || !pendingStatusExpiresAt!.isAfter(utc),
    };
  }

  OnboardingBundle copyWith({
    OnboardingStage? safeStage,
    String? registrationGrant,
    DateTime? registrationGrantExpiresAt,
    String? pendingStatusToken,
    DateTime? pendingStatusExpiresAt,
    DateTime? resendAvailableAt,
    String? maskedPhone,
    Map<String, String>? idempotency,
    bool clearGrant = false,
    bool clearIdempotency = false,
  }) {
    return OnboardingBundle(
      type: type,
      safeStage: safeStage ?? this.safeStage,
      locale: locale,
      selectedRole: selectedRole,
      attemptId: attemptId,
      continuationToken: continuationToken,
      continuationExpiresAt: continuationExpiresAt,
      registrationGrant: clearGrant
          ? null
          : registrationGrant ?? this.registrationGrant,
      registrationGrantExpiresAt: clearGrant
          ? null
          : registrationGrantExpiresAt ?? this.registrationGrantExpiresAt,
      pendingStatusToken: pendingStatusToken ?? this.pendingStatusToken,
      pendingStatusExpiresAt:
          pendingStatusExpiresAt ?? this.pendingStatusExpiresAt,
      maskedPhone: maskedPhone ?? this.maskedPhone,
      resendAvailableAt: resendAvailableAt ?? this.resendAvailableAt,
      idempotency: clearIdempotency ? null : idempotency ?? this.idempotency,
    );
  }

  Map<String, dynamic> toJson() => {
    'version': 1,
    'type': type.name,
    'safe_stage': safeStage.name,
    'locale': locale,
    'selected_role': selectedRole?.apiValue,
    'attempt_id': attemptId,
    'continuation_token': continuationToken,
    'continuation_expires_at': continuationExpiresAt?.toUtc().toIso8601String(),
    'registration_grant': registrationGrant,
    'registration_grant_expires_at': registrationGrantExpiresAt
        ?.toUtc()
        .toIso8601String(),
    'pending_status_token': pendingStatusToken,
    'pending_status_expires_at': pendingStatusExpiresAt
        ?.toUtc()
        .toIso8601String(),
    'masked_phone': maskedPhone,
    'resend_available_at': resendAvailableAt?.toUtc().toIso8601String(),
    'idempotency': idempotency,
  };

  factory OnboardingBundle.fromJson(Map<String, dynamic> json) {
    if (json['version'] != 1) throw const FormatException('Unsupported bundle');
    final type = _enumByName(
      OnboardingBundleType.values,
      _requiredString(json, 'type'),
    );
    final stage = _enumByName(
      OnboardingStage.values,
      _requiredString(json, 'safe_stage'),
    );
    final roleValue = json['selected_role'];
    final role = roleValue is String ? _roleFromApi(roleValue) : null;
    if (roleValue != null && role == null) {
      throw const FormatException('Invalid onboarding role');
    }
    final idempotencyJson = json['idempotency'];
    final idempotency = idempotencyJson is Map
        ? idempotencyJson.map((key, value) {
            if (key is! String || value is! String) {
              throw const FormatException('Invalid idempotency');
            }
            return MapEntry(key, value);
          })
        : null;
    final bundle = OnboardingBundle(
      type: type,
      safeStage: stage,
      locale: _requiredString(json, 'locale'),
      selectedRole: role,
      attemptId: _optionalString(json, 'attempt_id'),
      continuationToken: _optionalString(json, 'continuation_token'),
      continuationExpiresAt: _optionalDate(json, 'continuation_expires_at'),
      registrationGrant: _optionalString(json, 'registration_grant'),
      registrationGrantExpiresAt: _optionalDate(
        json,
        'registration_grant_expires_at',
      ),
      pendingStatusToken: _optionalString(json, 'pending_status_token'),
      pendingStatusExpiresAt: _optionalDate(json, 'pending_status_expires_at'),
      maskedPhone: _optionalString(json, 'masked_phone'),
      resendAvailableAt: _optionalDate(json, 'resend_available_at'),
      idempotency: idempotency,
    );
    final allowedIdempotency = bundle.idempotency;
    if (allowedIdempotency != null &&
        (allowedIdempotency.keys.any((key) => key != 'resend_key') ||
            allowedIdempotency.values.any(
              (value) => !RegExp(r'^[A-Za-z0-9._:-]{8,128}$').hasMatch(value),
            ))) {
      throw const FormatException('Invalid idempotency metadata');
    }
    if (type == OnboardingBundleType.continuation) {
      const allowedStages = {
        OnboardingStage.otpSent,
        OnboardingStage.phoneVerified,
        OnboardingStage.enteringAccountDetails,
      };
      if (bundle.attemptId == null ||
          bundle.continuationToken == null ||
          bundle.continuationExpiresAt == null ||
          bundle.selectedRole == null ||
          !allowedStages.contains(bundle.safeStage) ||
          bundle.pendingStatusToken != null ||
          bundle.pendingStatusExpiresAt != null ||
          ((bundle.registrationGrant == null) !=
              (bundle.registrationGrantExpiresAt == null)) ||
          (bundle.registrationGrant != null &&
              bundle.safeStage == OnboardingStage.otpSent)) {
        throw const FormatException('Invalid continuation bundle');
      }
    } else {
      if (bundle.pendingStatusToken == null ||
          bundle.pendingStatusExpiresAt == null ||
          bundle.safeStage != OnboardingStage.pendingReview ||
          (bundle.selectedRole != OnboardingRole.driver &&
              bundle.selectedRole != OnboardingRole.merchant) ||
          bundle.attemptId != null ||
          bundle.continuationToken != null ||
          bundle.continuationExpiresAt != null ||
          bundle.registrationGrant != null ||
          bundle.registrationGrantExpiresAt != null ||
          bundle.idempotency != null) {
        throw const FormatException('Invalid pending bundle');
      }
    }
    return bundle;
  }
}

const requiredConsentTypes = {'terms', 'privacy', 'adult_self_attestation'};

extension OnboardingRoleApi on OnboardingRole {
  String get apiValue => switch (this) {
    OnboardingRole.passenger => 'passenger',
    OnboardingRole.driver => 'driver',
    OnboardingRole.merchant => 'merchant',
  };
}

OnboardingRole? _roleFromApi(String value) => switch (value) {
  'passenger' => OnboardingRole.passenger,
  'driver' => OnboardingRole.driver,
  'merchant' => OnboardingRole.merchant,
  _ => null,
};

List<String> _requiredStringList(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! List || value.isEmpty || value.any((item) => item is! String)) {
    throw FormatException('Invalid $key');
  }
  return value.cast<String>().toList(growable: false);
}

int _requiredInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is int) return value;
  throw FormatException('Invalid $key');
}

T _enumByName<T extends Enum>(List<T> values, String name) {
  for (final value in values) {
    if (value.name == name) return value;
  }
  throw FormatException('Invalid enum value: $name');
}

String _requiredString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('Missing $key');
}

String? _optionalString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('Invalid $key');
}

DateTime _requiredDate(Map<String, dynamic> json, String key) {
  final parsed = _optionalDate(json, key);
  if (parsed == null) throw FormatException('Missing $key');
  return parsed;
}

DateTime? _optionalDate(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is! String) throw FormatException('Invalid $key');
  final parsed = DateTime.tryParse(value);
  if (parsed == null) throw FormatException('Invalid $key');
  return parsed.toUtc();
}
