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

  static const _deviceName = 'Masari App';

  Future<LoginResult> login({
    required String email,
    required String password,
    String deviceName = _deviceName,
  }) async {
    // The first argument is an email address, or an international phone number
    // for accounts created through an invitation.
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
    String deviceName = _deviceName,
    String locale = 'ar',
  }) async {
    return apiClient.postJson(
      '/auth/mobile/register/start',
      body: {
        'name': name,
        'email': email,
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
    grant['next_action'] == 'verify_email'
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
      if (grant['next_action'] == 'verify_email')
        'email_verification_code': emailToken
      else
        'name': name,
    },
  );

  Future<Map<String, dynamic>> startPhone(String phone, String locale) =>
      authenticatedApiClient.postJson(
        '/profile/phone/start-verification',
        body: {'phone': phone, 'locale': locale},
      );
  Future<void> confirmPhone(String phone, String token, String code) async {
    await authenticatedApiClient.postJson(
      '/profile/phone/confirm-verification',
      body: {'phone': phone, 'action_token': token, 'code': code},
    );
  }

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
