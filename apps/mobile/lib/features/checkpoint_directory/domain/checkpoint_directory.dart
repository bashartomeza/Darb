/// A names-only research record. It is deliberately not a map Checkpoint.
class DirectoryRecord {
  const DirectoryRecord({
    required this.researchKey,
    required this.nameAr,
    required this.cityAr,
  });
  final String researchKey;
  final String nameAr;
  final String cityAr;
  bool get readyForMap => false;
  String get trafficStatus => 'unavailable';

  factory DirectoryRecord.fromJson(Map<String, dynamic> json) {
    if (json['latitude'] != null ||
        json['longitude'] != null ||
        json['provider_checkpoint_id'] != null ||
        json['coordinate_verified'] != false ||
        json['provider_id_verified'] != false ||
        json['ready_for_map'] != false ||
        json['traffic_status'] != 'unavailable') {
      throw const FormatException('Invalid names-only directory record');
    }
    return DirectoryRecord(
      researchKey: _text(json, 'research_row_key'),
      nameAr: _text(json, 'checkpoint_name_ar'),
      cityAr: _text(json, 'city_ar'),
    );
  }
  bool matches(String query) {
    final search = query.trim();
    return nameAr.contains(search) || cityAr.contains(search);
  }
}

class CheckpointDirectory {
  const CheckpointDirectory({required this.version, required this.records});
  final String version;
  final List<DirectoryRecord> records;
  factory CheckpointDirectory.fromJson(Map<String, dynamic> json) {
    if (json['schema_version'] != 1 ||
        json['dataset_role'] != 'RESEARCH_DIRECTORY_ONLY' ||
        json['checkpoints'] is! List) {
      throw const FormatException('Invalid checkpoint directory');
    }
    final records = (json['checkpoints'] as List)
        .map((value) {
          if (value is! Map<String, dynamic>) {
            throw const FormatException('Invalid directory record');
          }
          return DirectoryRecord.fromJson(value);
        })
        .toList(growable: false);
    if (json['count'] != records.length ||
        json['city_count'] != records.map((row) => row.cityAr).toSet().length ||
        records.map((row) => row.researchKey).toSet().length !=
            records.length) {
      throw const FormatException('Invalid directory inventory');
    }
    return CheckpointDirectory(
      version: _text(json, 'version'),
      records: List.unmodifiable(records),
    );
  }
}

String _text(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid $key');
  }
  return value;
}
