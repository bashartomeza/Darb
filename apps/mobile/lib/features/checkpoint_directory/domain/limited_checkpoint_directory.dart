import 'checkpoint_directory.dart';

/// Presentation data only. Provider identity is never a research-row identity
/// or a coordinate-bearing Checkpoint. The research parser remains unchanged.
class DirectoryDisplayRow {
  const DirectoryDisplayRow(
    this.key,
    this.nameAr,
    this.cityAr, [
    this.entering,
    this.leaving,
  ]);
  final String key, nameAr, cityAr;
  final DirectoryTimestamp? entering, leaving;
  bool matches(String query) =>
      nameAr.contains(query.trim()) || cityAr.contains(query.trim());
}

class DirectoryDisplayCatalog {
  const DirectoryDisplayCatalog(this.rows, {this.generated});
  final List<DirectoryDisplayRow> rows;
  final DirectoryTimestamp? generated;
  bool get limited => generated != null;
  factory DirectoryDisplayCatalog.research(CheckpointDirectory value) =>
      DirectoryDisplayCatalog([
        for (final row in value.records)
          DirectoryDisplayRow(row.researchKey, row.nameAr, row.cityAr),
      ]);
}

class DirectoryTimestamp {
  const DirectoryTimestamp(this.raw, this.timezoneSpecified);
  final String raw;
  final bool timezoneSpecified;
  factory DirectoryTimestamp.fromJson(dynamic json) {
    if (json is! Map<String, dynamic> ||
        json['raw'] is! String ||
        json['timezone_specified'] is! bool) {
      throw const FormatException('Invalid directory timestamp');
    }
    final raw = json['raw'] as String;
    final shape = RegExp(
      r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$',
    ).firstMatch(raw);
    if (shape == null ||
        json['timezone_specified'] != (shape.group(1) != null)) {
      throw const FormatException('Invalid directory timestamp');
    }
    return DirectoryTimestamp(raw, json['timezone_specified'] as bool);
  }
}

class LimitedCheckpointDirectory {
  const LimitedCheckpointDirectory(this.catalog);
  final DirectoryDisplayCatalog catalog;
  factory LimitedCheckpointDirectory.fromJson(Map<String, dynamic> json) {
    if (json['schema_version'] != 1 ||
        json['dataset_role'] != 'LIMITED_PROVIDER_DIRECTORY' ||
        json['limited_dataset'] != true ||
        json['max_records_per_city'] != 7 ||
        json['permission_state'] != 'USER_REPORTED' ||
        json['checkpoints'] is! List) {
      throw const FormatException('Invalid limited directory');
    }
    final ids = <String>{}, cities = <String, int>{};
    final rows = <DirectoryDisplayRow>[];
    for (final value in json['checkpoints'] as List) {
      if (value is! Map<String, dynamic> ||
          value['latitude'] != null ||
          value['longitude'] != null ||
          value['coordinate_verified'] != false ||
          value['ready_for_map'] != false ||
          value['traffic_status'] != 'unavailable') {
        throw const FormatException('Invalid limited record');
      }
      String text(String field) {
        final v = value[field];
        if (v is! String || v.trim().isEmpty) {
          throw FormatException('Invalid $field');
        }
        return v;
      }

      final id = text('provider_checkpoint_id'), city = text('city_ar');
      cities[city] = (cities[city] ?? 0) + 1;
      if (!ids.add(id) || cities[city]! > 7) {
        throw const FormatException('Invalid limited inventory');
      }
      rows.add(
        DirectoryDisplayRow(
          id,
          text('checkpoint_name_ar'),
          city,
          DirectoryTimestamp.fromJson(value['entering_status_last_updated']),
          DirectoryTimestamp.fromJson(value['leaving_status_last_updated']),
        ),
      );
    }
    if (json['count'] != rows.length || json['city_count'] != cities.length) {
      throw const FormatException('Invalid limited inventory');
    }
    return LimitedCheckpointDirectory(
      DirectoryDisplayCatalog(
        List.unmodifiable(rows),
        generated: DirectoryTimestamp.fromJson(json['generated_at']),
      ),
    );
  }
}
