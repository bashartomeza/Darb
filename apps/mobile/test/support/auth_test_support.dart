import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:darb_mobile/core/api/api_client.dart';
import 'package:darb_mobile/features/auth/data/authenticated_api_client.dart';
import 'package:darb_mobile/features/auth/data/session_coordinator.dart';
import 'package:darb_mobile/features/auth/data/token_storage.dart';
import 'package:darb_mobile/features/auth/domain/auth_models.dart';

class MemoryTokenStorage implements TokenStorage {
  MemoryTokenStorage({
    this.storedBundle,
    this.legacyToken,
    this.clearError,
    this.saveError,
  });

  AuthTokenBundle? storedBundle;
  String? legacyToken;
  Object? clearError;
  Object? saveError;
  int saveCount = 0;
  int clearCount = 0;

  AuthTokenBundle? get bundle => storedBundle;

  @override
  Future<void> clearAuth() async {
    clearCount += 1;
    final error = clearError;
    if (error != null) throw error;
    storedBundle = null;
    legacyToken = null;
  }

  @override
  Future<void> clearToken() => clearAuth();

  @override
  Future<void> promoteLegacy(AuthTokenBundle bundle) async {
    await saveBundle(bundle.asMigratedLegacy());
  }

  @override
  Future<AuthTokenBundle?> readBundle() async {
    if (storedBundle != null) return storedBundle;
    final legacy = legacyToken;
    return legacy == null
        ? null
        : AuthTokenBundle(accessToken: legacy, legacyAccessOnly: true);
  }

  @override
  Future<String?> readToken() async => (await readBundle())?.accessToken;

  @override
  Future<void> saveBundle(AuthTokenBundle bundle) async {
    saveCount += 1;
    final error = saveError;
    if (error != null) throw error;
    storedBundle = bundle;
    legacyToken = null;
  }

  @override
  Future<void> saveToken(String token) async {
    await saveBundle(AuthTokenBundle(accessToken: token));
  }
}

class TestAuthenticatedClient {
  TestAuthenticatedClient._({
    required this.client,
    required this.coordinator,
    required this.storage,
  });

  final AuthenticatedApiClient client;
  final AuthSessionCoordinator coordinator;
  final MemoryTokenStorage storage;

  factory TestAuthenticatedClient({
    required Future<http.Response> Function(http.Request request) handler,
    AuthTokenBundle? bundle,
    DateTime Function()? now,
    Duration refreshThreshold = const Duration(seconds: 60),
  }) {
    final storage = MemoryTokenStorage(
      storedBundle:
          bundle ??
          AuthTokenBundle(
            accessToken: 'test-access-token',
            accessTokenExpiresAt: DateTime.now().toUtc().add(
              const Duration(hours: 1),
            ),
          ),
    );
    final apiClient = ApiClient(
      baseUrl: 'http://api.test',
      client: MockClient(handler),
    );
    final coordinator = AuthSessionCoordinator(
      apiClient: apiClient,
      tokenStorage: storage,
      refreshThreshold: refreshThreshold,
      now: now,
    );
    return TestAuthenticatedClient._(
      client: AuthenticatedApiClient(
        apiClient: apiClient,
        sessionCoordinator: coordinator,
      ),
      coordinator: coordinator,
      storage: storage,
    );
  }
}
