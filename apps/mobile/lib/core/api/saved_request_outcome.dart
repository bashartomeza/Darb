import 'api_error.dart';

/// The server's final answer to a request: sending the same request again can
/// never succeed, so a saved copy kept for retry may be dropped.
///
/// Lost responses, timeouts, 5xx, 429, session changes and a request the
/// server is still working on are not final; their saved copy is kept.
bool isDefiniteRejection(Object error) {
  if (error is! ApiException) return false;
  final status = error.statusCode;
  if (status == null || status < 400 || status >= 500) return false;
  if (const {401, 408, 425, 429}.contains(status)) return false;
  return !const {
    'session_changed',
    'invalid_response',
    'transaction_retry_required',
    'idempotency_in_progress',
  }.contains(error.message);
}

/// A saved request the server refused when it was sent again. Its saved copy
/// was removed so the person can start again. Carries the server's answer, so
/// it is handled like any other [ApiException].
class SavedRequestRejected extends ApiException {
  SavedRequestRejected(ApiException cause)
    : super(cause.type, cause.message, statusCode: cause.statusCode);

  @override
  String toString() => 'SavedRequestRejected($type, statusCode: $statusCode)';
}

/// A saved request that could not be confirmed within its retry window. Its
/// saved copy was removed so the person can start again.
class SavedRequestExpired implements Exception {
  const SavedRequestExpired();

  @override
  String toString() => 'saved_request_expired';
}
