import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/api_error.dart';
import '../domain/auth_models.dart';
import 'authenticated_api_client.dart';

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    apiClient: ref.watch(apiClientProvider),
    authenticatedApiClient: ref.watch(authenticatedApiClientProvider),
  );
});

class AuthRepository {
  const AuthRepository({
    required this.apiClient,
    required this.authenticatedApiClient,
  });

  final ApiClient apiClient;
  final AuthenticatedApiClient authenticatedApiClient;

  static const _deviceName = 'Darb App';

  Future<LoginResult> login({
    required String email,
    required String password,
    String deviceName = _deviceName,
  }) async {
    // The first argument is an email address, or an international phone number
    // for driver and shop-owner accounts registered with a phone.
    final byEmail = email.contains('@');
    return _authRequest(
      '/auth/mobile/login',
      body: {
        if (byEmail) 'email': email else 'phone': email,
        'password': password,
        'device_name': deviceName,
      },
    );
  }

  Future<Map<String, dynamic>> register({
    required String name,
    required String email,
    required String password,
    required String phone,
    String deviceName = _deviceName,
    String locale = 'ar',
  }) async {
    return apiClient.postJson(
      '/auth/mobile/register/start',
      body: {
        'name': name,
        'email': email,
        'phone': phone,
        'password': password,
        'locale': locale,
      },
    );
  }

  Future<Map<String, dynamic>> loginWithGoogle({
    required String idToken,
    String deviceName = _deviceName,
  }) async {
    return apiClient.postJson(
      '/auth/mobile/google',
      body: {'id_token': idToken, 'device_name': deviceName},
    );
  }

  Future<Map<String, dynamic>> capabilities() =>
      apiClient.getJson('/auth/capabilities');

  Future<List<Map<String, dynamic>>> consents(String locale) async {
    final response = await apiClient.getJson('/auth/consents?locale=$locale');
    final documents = response['documents'];
    if (documents is! List || documents.length != 3) {
      throw const ApiException(ApiErrorType.validation, 'invalid_response');
    }
    final result = documents.whereType<Map<String, dynamic>>().toList();
    if (result.length != 3 ||
        result.map((d) => d['type']).toSet().length != 3 ||
        !result.every(
          (d) =>
              [
                'terms',
                'privacy',
                'adult_self_attestation',
              ].contains(d['type']) &&
              d['locale'] == locale &&
              d['id'] is String &&
              d['content'] is String &&
              d['content_hash'] is String &&
              RegExp(r'^[a-f0-9]{64}$').hasMatch(d['content_hash'] as String),
        )) {
      throw const ApiException(ApiErrorType.validation, 'invalid_response');
    }
    return result;
  }

  Future<LoginResult> completeRegistration({
    required Map<String, dynamic> grant,
    required String locale,
    required List<Map<String, dynamic>> documents,
    required String emailToken,
    required String name,
  }) => _authRequest(
    _isEmailGrant(grant)
        ? '/auth/mobile/register/complete'
        : '/auth/mobile/google/complete-registration',
    body: {
      'registration_token': grant['registration_token'],
      'locale': locale,
      'consents': documents
          .map(
            (d) => {
              'id': d['id'],
              'type': d['type'],
              'content_hash': d['content_hash'],
            },
          )
          .toList(),
      'adult_self_attestation': true,
      'device_name': _deviceName,
      // `accept_consents` is the local-development grant issued while the API
      // has EMAIL_VERIFICATION_DISABLED: no emailed code exists to send.
      if (grant['next_action'] == 'verify_email')
        'email_verification_code': emailToken
      else if (!_isEmailGrant(grant))
        'name': name,
    },
  );

  static bool _isEmailGrant(Map<String, dynamic> grant) =>
      grant['next_action'] == 'verify_email' ||
      grant['next_action'] == 'accept_consents';

  /// Creates the account for a Google sign-up with its chosen role. Returns a
  /// session for passengers and shop owners, or the pending-status token for a
  /// driver, whose account waits for Admin approval.
  Future<Map<String, dynamic>> completeGoogleOnboarding({
    required Map<String, dynamic> grant,
    required String locale,
    required List<Map<String, dynamic>> documents,
    required String name,
    required String role,
    required Map<String, dynamic> profile,
  }) => apiClient.postJson(
    '/auth/mobile/google/complete-registration',
    body: {
      'registration_token': grant['registration_token'],
      'locale': locale,
      'consents': documents
          .map(
            (d) => {
              'id': d['id'],
              'type': d['type'],
              'content_hash': d['content_hash'],
            },
          )
          .toList(),
      'adult_self_attestation': true,
      'device_name': _deviceName,
      'name': name,
      'role': role,
      'profile': profile,
    },
  );

  Future<void> emailActionStart(
    String email,
    String locale, {
    required bool reset,
  }) async {
    await apiClient.postJson(
      reset ? '/auth/password/reset/start' : '/auth/email/verify/start',
      body: {'email': email, 'locale': locale},
    );
  }

  /// Confirms the six-digit code from the email for the account with [email].
  Future<void> emailActionConfirm(
    String email,
    String code,
    String password, {
    required bool reset,
  }) async {
    await apiClient.postJson(
      reset ? '/auth/password/reset/confirm' : '/auth/email/verify/confirm',
      body: {'email': email, 'code': code, if (reset) 'password': password},
    );
  }

  Future<void> passwordSetStart(String locale) async {
    await authenticatedApiClient.postJson(
      '/auth/password/set/start',
      body: {'locale': locale},
    );
  }

  Future<void> setPassword(
    String password,
    String currentPassword,
    String code,
  ) async {
    await authenticatedApiClient.postJson(
      '/auth/password/set',
      body: {
        'password': password,
        if (currentPassword.isNotEmpty) 'current_password': currentPassword,
        if (code.isNotEmpty) 'reauthentication_code': code,
      },
    );
  }

  Future<void> googleLinkStart(String locale) async {
    await authenticatedApiClient.postJson(
      '/auth/identities/google/link/start',
      body: {'locale': locale},
    );
  }

  Future<void> linkGoogle(
    String idToken,
    String currentPassword,
    String proof,
  ) async {
    await authenticatedApiClient.postJson(
      '/auth/identities/google/link',
      body: {
        'id_token': idToken,
        if (currentPassword.isNotEmpty) 'current_password': currentPassword,
        if (proof.isNotEmpty) 'reauthentication_token': proof,
      },
    );
  }

  LoginResult loginResultFrom(Map<String, dynamic> json) {
    try {
      return LoginResult.fromJson(json);
    } on FormatException {
      throw const ApiException(ApiErrorType.validation, 'invalid_response');
    }
  }

  Future<LoginResult> _authRequest(
    String path, {
    required Map<String, dynamic> body,
  }) async {
    final json = await apiClient.postJson(path, body: body);
    try {
      return LoginResult.fromJson(json);
    } on FormatException {
      throw const ApiException(ApiErrorType.validation, 'invalid_response');
    }
  }

  /// Saves the editable parts of the signed-in user's profile. An empty [city]
  /// or [contactPhone] clears it; a null [contactPhone] leaves it unchanged
  /// (accounts with a verified phone have nothing to edit there).
  Future<AuthUser> updateProfile({
    required String name,
    required String city,
    String? contactPhone,
  }) async {
    final json = await authenticatedApiClient.patchJson(
      '/me',
      body: {
        'name': name,
        'city': city.isEmpty ? null : city,
        if (contactPhone != null)
          'contact_phone': contactPhone.isEmpty ? null : contactPhone,
      },
    );
    final userJson = json['user'];
    if (userJson is! Map<String, dynamic>) {
      throw const ApiException(ApiErrorType.validation, 'invalid_response');
    }
    try {
      return AuthUser.fromJson(userJson);
    } on FormatException {
      throw const ApiException(ApiErrorType.validation, 'invalid_response');
    }
  }

  Future<AuthUser> me() async {
    final json = await authenticatedApiClient.getJson('/me');
    final userJson = json['user'];
    if (userJson is! Map<String, dynamic>) {
      throw const ApiException(ApiErrorType.validation, 'invalid_response');
    }
    try {
      return AuthUser.fromJson(userJson);
    } on FormatException {
      throw const ApiException(ApiErrorType.validation, 'invalid_response');
    }
  }
}

final authCapabilitiesProvider = FutureProvider<Map<String, dynamic>>(
  (ref) => ref.watch(authRepositoryProvider).capabilities(),
);
