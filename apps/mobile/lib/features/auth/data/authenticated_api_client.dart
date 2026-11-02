import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import 'session_coordinator.dart';

final authenticatedApiClientProvider = Provider<AuthenticatedApiClient>((ref) {
  return AuthenticatedApiClient(
    apiClient: ref.watch(apiClientProvider),
    sessionCoordinator: ref.watch(authSessionCoordinatorProvider),
  );
});

class AuthenticatedApiClient {
  const AuthenticatedApiClient({
    required this.apiClient,
    required this.sessionCoordinator,
  });

  final ApiClient apiClient;
  final AuthSessionCoordinator sessionCoordinator;

  Future<Map<String, dynamic>> getJson(
    String path, {
    Map<String, String> headers = const {},
    void Function()? beforeSend,
  }) {
    return sessionCoordinator.sendAuthenticated((token) {
      beforeSend?.call();
      return apiClient.getJson(path, token: token, headers: headers);
    });
  }

  Future<Map<String, dynamic>> postJson(
    String path, {
    required Map<String, dynamic> body,
    Map<String, String> headers = const {},
    Future<void> Function()? beforeRetry,
    void Function()? beforeSend,
  }) {
    return sessionCoordinator.sendAuthenticated((token) {
      beforeSend?.call();
      return apiClient.postJson(
        path,
        body: body,
        token: token,
        headers: headers,
      );
    }, beforeRetry: beforeRetry);
  }

  Future<Map<String, dynamic>> postBytes(
    String path, {
    required List<int> bytes,
    String contentType = 'application/octet-stream',
  }) {
    return sessionCoordinator.sendAuthenticated(
      (token) => apiClient.postBytes(
        path,
        bytes: bytes,
        token: token,
        contentType: contentType,
      ),
    );
  }

  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic> body = const {},
    Map<String, String> headers = const {},
    void Function()? beforeSend,
  }) {
    return sessionCoordinator.sendAuthenticated((token) {
      beforeSend?.call();
      return apiClient.patchJson(
        path,
        body: body,
        token: token,
        headers: headers,
      );
    });
  }

  Future<Map<String, dynamic>> putJson(
    String path, {
    required Map<String, dynamic> body,
    Map<String, String> headers = const {},
    Future<void> Function()? beforeRetry,
  }) {
    return sessionCoordinator.sendAuthenticated(
      (token) =>
          apiClient.putJson(path, body: body, token: token, headers: headers),
      beforeRetry: beforeRetry,
    );
  }

  Future<Map<String, dynamic>> deleteJson(String path) {
    return sessionCoordinator.sendAuthenticated(
      (token) => apiClient.deleteJson(path, token: token),
    );
  }
}
