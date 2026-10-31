import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import 'api_error.dart';

final httpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    baseUrl: ref.watch(appConfigProvider).apiBaseUrl,
    client: ref.watch(httpClientProvider),
  );
});

class ApiClient {
  const ApiClient({
    required this.baseUrl,
    required this.client,
    this.timeout = const Duration(seconds: 12),
  });

  final String baseUrl;
  final http.Client client;
  final Duration timeout;

  Future<Map<String, dynamic>> getJson(
    String path, {
    String? token,
    Map<String, String> headers = const {},
  }) async {
    return _sendJson(() {
      return client.get(_uri(path), headers: _headers(token, headers));
    });
  }

  Future<Map<String, dynamic>> postJson(
    String path, {
    required Map<String, dynamic> body,
    String? token,
    Map<String, String> headers = const {},
  }) async {
    return _sendJson(() {
      return client.post(
        _uri(path),
        headers: _headers(token, headers),
        body: jsonEncode(body),
      );
    });
  }

  /// Uploads raw bytes (for example a document) with an explicit content type.
  Future<Map<String, dynamic>> postBytes(
    String path, {
    required List<int> bytes,
    String? token,
    String contentType = 'application/octet-stream',
  }) async {
    return _sendJson(() {
      return client.post(
        _uri(path),
        headers: _headers(token, {HttpHeaders.contentTypeHeader: contentType}),
        body: bytes,
      );
    });
  }

  Future<Map<String, dynamic>> patchJson(
    String path, {
    Map<String, dynamic> body = const {},
    String? token,
    Map<String, String> headers = const {},
  }) async {
    return _sendJson(() {
      return client.patch(
        _uri(path),
        headers: _headers(token, headers),
        body: jsonEncode(body),
      );
    });
  }

  Future<Map<String, dynamic>> putJson(
    String path, {
    required Map<String, dynamic> body,
    String? token,
    Map<String, String> headers = const {},
  }) async {
    return _sendJson(() {
      return client.put(
        _uri(path),
        headers: _headers(token, headers),
        body: jsonEncode(body),
      );
    });
  }

  Future<Map<String, dynamic>> deleteJson(
    String path, {
    String? token,
    Map<String, String> headers = const {},
  }) async {
    return _sendJson(() {
      return client.delete(_uri(path), headers: _headers(token, headers));
    });
  }

  Uri _uri(String path) => Uri.parse('$baseUrl/api/v1$path');

  Map<String, String> _headers(String? token, Map<String, String> additional) {
    if (additional.keys.any(
      (key) => key.toLowerCase() == HttpHeaders.authorizationHeader,
    )) {
      throw ArgumentError('Authorization is managed by the session boundary');
    }
    final headers = <String, String>{
      HttpHeaders.acceptHeader: 'application/json',
      HttpHeaders.contentTypeHeader: 'application/json',
      ...additional,
    };
    if (token != null && token.isNotEmpty) {
      headers[HttpHeaders.authorizationHeader] = 'Bearer $token';
    }
    return headers;
  }

  Future<Map<String, dynamic>> _sendJson(
    Future<http.Response> Function() send,
  ) async {
    try {
      final response = await send().timeout(timeout);
      final decoded = _decodeObject(response.body);
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return decoded;
      }
      throw _mapStatus(response.statusCode, decoded);
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw const ApiException(ApiErrorType.timeout, 'request_timeout');
    } on SocketException {
      throw const ApiException(ApiErrorType.network, 'network_unavailable');
    } on http.ClientException {
      throw const ApiException(ApiErrorType.network, 'network_unavailable');
    } on FormatException {
      throw const ApiException(ApiErrorType.validation, 'invalid_response');
    }
  }

  Map<String, dynamic> _decodeObject(String body) {
    final decoded = jsonDecode(body);
    if (decoded is Map<String, dynamic>) {
      return decoded;
    }
    throw const FormatException('Expected JSON object');
  }

  ApiException _mapStatus(int statusCode, Map<String, dynamic> body) {
    final message = body['error'] is String
        ? body['error'] as String
        : 'request_failed';
    final type = switch (statusCode) {
      400 || 422 => ApiErrorType.validation,
      401 => ApiErrorType.unauthorized,
      403 => ApiErrorType.forbidden,
      >= 500 => ApiErrorType.server,
      _ => ApiErrorType.unknown,
    };
    return ApiException(type, message, statusCode: statusCode);
  }
}
