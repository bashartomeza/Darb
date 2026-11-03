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
      return decodeApiResponse(response);
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw const ApiException(ApiErrorType.timeout, 'request_timeout');
    } on SocketException {
      throw const ApiException(ApiErrorType.network, 'network_unavailable');
    } on http.ClientException {
      throw const ApiException(ApiErrorType.network, 'network_unavailable');
    }
  }
}

/// Turns an HTTP response into the JSON object the API contract promises.
///
/// The status code is classified before the body is read, so an error page
/// from a proxy or load balancer (an HTML 502, an empty 503) stays a server
/// failure instead of looking like a malformed answer. Only a successful
/// status with an unreadable body is `invalid_response`; an empty successful
/// body (204 No Content) is an empty object.
Map<String, dynamic> decodeApiResponse(http.Response response) {
  final statusCode = response.statusCode;
  if (statusCode >= 200 && statusCode < 300) {
    if (response.body.trim().isEmpty) return <String, dynamic>{};
    final decoded = _tryDecodeObject(response.body);
    if (decoded == null) {
      throw const ApiException(ApiErrorType.validation, 'invalid_response');
    }
    return decoded;
  }
  throw apiExceptionForStatus(statusCode, _tryDecodeObject(response.body));
}

/// Maps a non-success status to an [ApiException], using the server's `error`
/// code when the body carried one.
ApiException apiExceptionForStatus(int statusCode, Map<String, dynamic>? body) {
  final code = body?['error'];
  final type = switch (statusCode) {
    401 => ApiErrorType.unauthorized,
    403 => ApiErrorType.forbidden,
    408 => ApiErrorType.timeout,
    // Rate limiting is transient, so it joins the retryable server failures.
    429 => ApiErrorType.server,
    >= 500 => ApiErrorType.server,
    >= 400 => ApiErrorType.validation,
    _ => ApiErrorType.unknown,
  };
  final fallback = switch (statusCode) {
    408 => 'request_timeout',
    429 => 'rate_limited',
    _ => 'request_failed',
  };
  return ApiException(
    type,
    code is String && code.isNotEmpty ? code : fallback,
    statusCode: statusCode,
  );
}

Map<String, dynamic>? _tryDecodeObject(String body) {
  if (body.trim().isEmpty) return null;
  try {
    final decoded = jsonDecode(body);
    return decoded is Map<String, dynamic> ? decoded : null;
  } on FormatException {
    return null;
  }
}
