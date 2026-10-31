import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';
import '../../onboarding/domain/onboarding_models.dart';

/// Where an active driver's document renewal stands, as the API reports it.
class DriverRenewalState {
  const DriverRenewalState({
    required this.status,
    required this.canUpload,
    required this.submitted,
    required this.documents,
    required this.maxDocuments,
    required this.maxBytes,
    this.kinds = const [],
    this.documentsExpiredAt,
    this.renewalSubmittedAt,
  });

  factory DriverRenewalState.fromJson(Map<String, dynamic> json) {
    final documents = json['documents'];
    final limits = json['limits'];
    final status = json['status'];
    if (status is! String ||
        json['can_upload'] is! bool ||
        json['submitted'] is! bool ||
        documents is! List ||
        limits is! Map<String, dynamic> ||
        limits['max_documents'] is! int ||
        limits['max_bytes'] is! int) {
      throw const FormatException('Invalid renewal state');
    }
    DateTime? date(Object? value) =>
        value is String ? DateTime.tryParse(value) : null;
    final kinds = limits['kinds'];
    return DriverRenewalState(
      status: status,
      canUpload: json['can_upload'] as bool,
      submitted: json['submitted'] as bool,
      documents: documents
          .whereType<Map<String, dynamic>>()
          .map(DriverDocument.fromJson)
          .toList(),
      maxDocuments: limits['max_documents'] as int,
      maxBytes: limits['max_bytes'] as int,
      kinds: kinds is List ? kinds.whereType<String>().toList() : const [],
      documentsExpiredAt: date(json['documents_expired_at']),
      renewalSubmittedAt: date(json['renewal_submitted_at']),
    );
  }

  /// The driver's verification status (`documents_expired`, `pending`, ...).
  final String status;

  /// True while the driver may still add or remove renewal documents.
  final bool canUpload;

  /// True once the documents were sent and wait for the review team.
  final bool submitted;
  final List<DriverDocument> documents;
  final int maxDocuments;
  final int maxBytes;

  /// Kinds the server accepts; empty when it did not say.
  final List<String> kinds;
  final DateTime? documentsExpiredAt;
  final DateTime? renewalSubmittedAt;

  /// Whether the driver has something to do or is waiting on a review.
  bool get needsAttention => canUpload || submitted;
}

final driverRenewalRepositoryProvider = Provider<DriverRenewalRepository>((
  ref,
) {
  return DriverRenewalRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
  );
});

class DriverRenewalRepository {
  const DriverRenewalRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  static const _base = '/driver/document-renewal';

  Future<DriverRenewalState> state() async {
    final json = await apiClient.getJson(_base);
    return DriverRenewalState.fromJson(json);
  }

  Future<DriverDocument> upload({
    required String kind,
    required List<int> bytes,
  }) async {
    final json = await apiClient.postBytes(
      '$_base/documents?kind=${Uri.encodeQueryComponent(kind)}',
      bytes: bytes,
    );
    final document = json['document'];
    if (document is! Map<String, dynamic>) {
      throw const FormatException('Missing document');
    }
    return DriverDocument.fromJson(document);
  }

  Future<void> delete(String id) async {
    await apiClient.deleteJson('$_base/documents/${Uri.encodeComponent(id)}');
  }

  /// Sends the uploaded documents to the review queue. The server answers 409
  /// `renewal_documents_required` when none were uploaded.
  Future<void> submit() async {
    await apiClient.postJson('$_base/submit', body: const {});
  }
}
