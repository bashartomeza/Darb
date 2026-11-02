/// DTOs for the merchant bulk order upload (CSV preview and submit).
library;

import '../../operating_routes/data/operating_route_models.dart';

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

  /// This preview with the app's own route-key errors added. A server error
  /// about the same row's route is replaced by the app's, which names the
  /// routes that are running.
  BulkPreview withRouteErrors(List<BulkRowError> local) {
    if (local.isEmpty) return this;
    final rows = {for (final error in local) error.row};
    bool sameRoute(BulkRowError error) =>
        rows.contains(error.row) &&
        (error.field == 'route_key' || error.code.contains('route'));
    return BulkPreview(
      totalRows: totalRows,
      validOrderCount: validOrderCount,
      batchCount: batchCount,
      maxRows: maxRows,
      errors: [...local, ...errors.where((error) => !sameRoute(error))]
        ..sort((a, b) => a.row.compareTo(b.row)),
    );
  }
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

/// The bulk CSV columns, in template order. The last two are optional.
const bulkCsvColumns = [
  'route_key',
  'pickup_details',
  'dropoff_details',
  'size',
  'priority',
  'receiver_name',
  'receiver_phone',
];

const _requiredBulkColumns = [
  'route_key',
  'pickup_details',
  'dropoff_details',
  'size',
  'priority',
];

/// Header and two example rows for the CSV a merchant pastes or edits, on
/// [routeKey]. Rows sharing a route and pickup become one order.
String bulkCsvTemplateFor(String routeKey) =>
    '${bulkCsvColumns.join(',')}\n'
    '$routeKey,"Al-Amal store, Ein Sarah street",Near Bethlehem University main gate,S,normal,Sara Khalil,+970599123456\n'
    '$routeKey,"Al-Amal store, Ein Sarah street",Manger Street next to the pharmacy,M,high,,\n';

/// [bulkCsvTemplateFor] on the first predefined route.
final bulkCsvTemplate = bulkCsvTemplateFor('hebron-to-bethlehem');

/// What the app can check in a bulk CSV before the server sees it: the
/// columns, and that every `route_key` names a route that is running.
class BulkRouteCheck {
  const BulkRouteCheck({
    required this.totalRows,
    required this.errors,
    required this.rowsByRoute,
  });

  final int totalRows;
  final List<BulkRowError> errors;

  /// Data rows per known route key, in first-seen order.
  final Map<String, int> rowsByRoute;

  /// The header itself is wrong, so no row can be read.
  bool get hasFileError => errors.any((error) => error.row <= 1);
}

/// Checks [csv]'s header and route keys against the running [routes].
/// Rows are numbered like a spreadsheet: the header is row 1.
BulkRouteCheck checkBulkCsvRoutes(String csv, List<OperatingRoute> routes) {
  final records = parseCsvRecords(csv);
  if (records.isEmpty) {
    return const BulkRouteCheck(totalRows: 0, errors: [], rowsByRoute: {});
  }
  final header = [for (final cell in records.first) cell.trim().toLowerCase()];
  final missing = _requiredBulkColumns.where((c) => !header.contains(c));
  final rows = records.length - 1;
  if (missing.isNotEmpty) {
    final list = missing.join(', ');
    final expected = bulkCsvColumns.join(',');
    return BulkRouteCheck(
      totalRows: rows,
      rowsByRoute: const {},
      errors: [
        BulkRowError(
          row: 0,
          field: null,
          code: 'missing_columns',
          messageEn: 'Missing columns: $list. The first row must be: $expected',
          messageAr: 'أعمدة ناقصة: $list. يجب أن يكون الصف الأول: $expected',
        ),
      ],
    );
  }
  final keyColumn = header.indexOf('route_key');
  final known = {for (final route in routes) route.key: route};
  final keys = known.keys.join(', ');
  final keysAr = known.keys.join('، ');
  final errors = <BulkRowError>[];
  final counts = <String, int>{};
  for (final (index, record) in records.skip(1).indexed) {
    final key = keyColumn < record.length ? record[keyColumn].trim() : '';
    if (known.containsKey(key)) {
      counts[key] = (counts[key] ?? 0) + 1;
      continue;
    }
    errors.add(
      BulkRowError(
        row: index + 2,
        field: 'route_key',
        code: 'unknown_route_key',
        messageEn: key.isEmpty
            ? 'route_key is empty. Use one of: $keys.'
            : 'Unknown route_key "$key". Use one of: $keys.',
        messageAr: key.isEmpty
            ? 'عمود route_key فارغ. استخدم أحد المسارات: $keysAr.'
            : 'المسار "$key" غير معروف. استخدم أحد المسارات: $keysAr.',
      ),
    );
  }
  return BulkRouteCheck(totalRows: rows, errors: errors, rowsByRoute: counts);
}

/// Splits CSV text into records of cells. Handles quoted cells (commas,
/// doubled quotes and line breaks inside quotes), CRLF line ends, and skips
/// blank lines.
List<List<String>> parseCsvRecords(String text) {
  final records = <List<String>>[];
  var record = <String>[];
  final cell = StringBuffer();
  var quoted = false;
  var index = 0;

  void endRecord() {
    record.add(cell.toString());
    cell.clear();
    if (!(record.length == 1 && record.single.trim().isEmpty)) {
      records.add(record);
    }
    record = <String>[];
  }

  while (index < text.length) {
    final char = text[index];
    if (quoted) {
      if (char == '"') {
        if (index + 1 < text.length && text[index + 1] == '"') {
          cell.write('"');
          index++;
        } else {
          quoted = false;
        }
      } else {
        cell.write(char);
      }
    } else if (char == '"') {
      quoted = true;
    } else if (char == ',') {
      record.add(cell.toString());
      cell.clear();
    } else if (char == '\n' || char == '\r') {
      if (char == '\r' && index + 1 < text.length && text[index + 1] == '\n') {
        index++;
      }
      endRecord();
    } else {
      cell.write(char);
    }
    index++;
  }
  if (cell.isNotEmpty || record.isNotEmpty) endRecord();
  return records;
}
