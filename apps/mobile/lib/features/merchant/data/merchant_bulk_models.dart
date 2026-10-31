/// DTOs for the merchant bulk order upload (CSV preview and submit).
class BulkRowError {
  const BulkRowError({
    required this.row,
    required this.field,
    required this.code,
    required this.messageEn,
    required this.messageAr,
  });

  factory BulkRowError.fromJson(Map<String, dynamic> json) => BulkRowError(
    row: (json['row'] as num?)?.toInt() ?? 0,
    field: json['field'] as String?,
    code: json['code'] as String? ?? 'unknown',
    messageEn: json['message_en'] as String? ?? '',
    messageAr: json['message_ar'] as String? ?? '',
  );

  /// 1-based spreadsheet row; 0 means the whole file.
  final int row;
  final String? field;
  final String code;
  final String messageEn;
  final String messageAr;

  String message(bool arabic) {
    final text = arabic ? messageAr : messageEn;
    return text.isEmpty ? (arabic ? messageEn : messageAr) : text;
  }
}

class BulkPreview {
  const BulkPreview({
    required this.totalRows,
    required this.validOrderCount,
    required this.errors,
    required this.batchCount,
    required this.maxRows,
  });

  factory BulkPreview.fromJson(Map<String, dynamic> json) {
    final plan = json['batch_plan'];
    final batches = plan is Map<String, dynamic> ? plan['batches'] : null;
    final limits = json['limits'];
    return BulkPreview(
      totalRows: (json['total_rows'] as num?)?.toInt() ?? 0,
      validOrderCount: (json['valid_order_count'] as num?)?.toInt() ?? 0,
      errors: _errors(json['errors']),
      batchCount: batches is List ? batches.length : 0,
      maxRows: limits is Map<String, dynamic>
          ? (limits['max_rows'] as num?)?.toInt() ?? 50
          : 50,
    );
  }

  final int totalRows;
  final int validOrderCount;
  final List<BulkRowError> errors;
  final int batchCount;
  final int maxRows;

  bool get hasErrors => errors.isNotEmpty;
  bool get canSubmitAll => validOrderCount > 0 && !hasErrors;
}

class BulkResultEntry {
  const BulkResultEntry({
    required this.rows,
    required this.status,
    this.orderId,
    this.messageEn,
    this.messageAr,
  });

  factory BulkResultEntry.fromJson(Map<String, dynamic> json) =>
      BulkResultEntry(
        rows: (json['rows'] as List? ?? const [])
            .map((value) => (value as num).toInt())
            .toList(),
        status: json['status'] as String? ?? 'failed',
        orderId: json['order_id'] as String?,
        messageEn: json['message_en'] as String?,
        messageAr: json['message_ar'] as String?,
      );

  final List<int> rows;

  /// created, replayed, failed or invalid.
  final String status;
  final String? orderId;
  final String? messageEn;
  final String? messageAr;

  bool get isFailure => status == 'failed' || status == 'invalid';

  String message(bool arabic) => (arabic ? messageAr : messageEn) ?? '';
}

class BulkSubmitResult {
  const BulkSubmitResult({
    required this.totalRows,
    required this.created,
    required this.replayed,
    required this.failed,
    required this.results,
  });

  factory BulkSubmitResult.fromJson(Map<String, dynamic> json) {
    final summary = json['summary'] as Map<String, dynamic>? ?? const {};
    return BulkSubmitResult(
      totalRows: (summary['total_rows'] as num?)?.toInt() ?? 0,
      created: (summary['created'] as num?)?.toInt() ?? 0,
      replayed: (summary['replayed'] as num?)?.toInt() ?? 0,
      failed: (summary['failed'] as num?)?.toInt() ?? 0,
      results: (json['results'] as List? ?? const [])
          .cast<Map<String, dynamic>>()
          .map(BulkResultEntry.fromJson)
          .toList(),
    );
  }

  final int totalRows;
  final int created;
  final int replayed;
  final int failed;
  final List<BulkResultEntry> results;

  List<BulkResultEntry> get failures =>
      results.where((entry) => entry.isFailure).toList();
}

List<BulkRowError> _errors(Object? value) => value is List
    ? value.cast<Map<String, dynamic>>().map(BulkRowError.fromJson).toList()
    : const [];

/// Header and an example row for the CSV a merchant pastes or edits.
const bulkCsvTemplate =
    'pickup_label,pickup_lat,pickup_lng,destination_label,destination_lat,destination_lng,size,priority\n'
    'Hebron Depot,31.5326,35.0998,Bethlehem Center,31.7054,35.2024,S,normal\n';
