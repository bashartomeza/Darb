import '../../canonical_routes/domain/canonical_route_models.dart';

enum CheckpointStatus { open, congested, closed, unknown }

CheckpointStatus parseCheckpointStatus(String? value) {
  switch (value?.trim().toLowerCase()) {
    case 'open':
    case 'clear':
    case 'flowing':
    case 'مفتوح':
    case 'مفتوحة':
    case 'سالك':
      return CheckpointStatus.open;
    case 'congested':
    case 'busy':
    case 'slow':
    case 'delay':
    case 'crowded':
    case 'ازدحام':
    case 'مزدحم':
    case 'أزمة':
    case 'ازمة':
    case 'أزمة متوسطة':
      return CheckpointStatus.congested;
    case 'closed':
    case 'blocked':
    case 'shut':
    case 'مغلق':
    case 'مغلقة':
      return CheckpointStatus.closed;
    default:
      return CheckpointStatus.unknown;
  }
}

String checkpointStatusLabel(CheckpointStatus status) => switch (status) {
  CheckpointStatus.open => 'سالك',
  CheckpointStatus.congested => 'أزمة متوسطة',
  CheckpointStatus.closed => 'مغلق',
  CheckpointStatus.unknown => 'غير معروف',
};

/// Canonical API data. Optional directional fields are never inferred from an
/// overall status. Coordinates must be supplied by the API, never fabricated.
class Checkpoint {
  const Checkpoint({
    required this.id,
    required this.position,
    required this.nameAr,
    this.nameEn = '',
    this.city = '',
    this.status = CheckpointStatus.unknown,
    this.updatedAt,
    this.enteringStatus,
    this.leavingStatus,
    this.enteringStatusLastUpdated,
    this.leavingStatusLastUpdated,
    this.enteringLastChangedText,
    this.leavingLastChangedText,
    this.positionFromOpenStreetMap = false,
  });

  final String id;
  final GeoPoint position;
  final String nameAr;
  final String nameEn;
  final String city;
  final CheckpointStatus status;
  final DateTime? updatedAt;
  final String? enteringStatus;
  final String? leavingStatus;
  final DateTime? enteringStatusLastUpdated;
  final DateTime? leavingStatusLastUpdated;

  /// The provider's "last changed" times exactly as published. The partner feed
  /// does not always say which timezone they are in, so they are shown as
  /// given and never converted or read as a traffic state.
  final String? enteringLastChangedText;
  final String? leavingLastChangedText;

  /// The pin comes from an OpenStreetMap name match, not from the provider.
  final bool positionFromOpenStreetMap;

  String get displayName => nameAr.trim().isNotEmpty
      ? nameAr.trim()
      : nameEn.trim().isNotEmpty
      ? nameEn.trim()
      : 'حاجز';

  factory Checkpoint.fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    if (id is! String || id.trim().isEmpty) {
      throw const FormatException('Invalid checkpoint id');
    }
    final lat = _coordinate(json['latitude'], 90);
    final lng = _coordinate(json['longitude'], 180);
    if (lat == null || lng == null) {
      throw const FormatException('Missing checkpoint position');
    }
    final entering = _text(json['entering_status']);
    final leaving = _text(json['leaving_status']);
    var status = parseCheckpointStatus(_text(json['status']));
    if (!json.containsKey('status')) {
      final directions = [
        parseCheckpointStatus(entering),
        parseCheckpointStatus(leaving),
      ];
      status = directions.contains(CheckpointStatus.closed)
          ? CheckpointStatus.closed
          : directions.contains(CheckpointStatus.congested)
          ? CheckpointStatus.congested
          : directions.every((value) => value == CheckpointStatus.open)
          ? CheckpointStatus.open
          : CheckpointStatus.unknown;
    }
    return Checkpoint(
      id: id,
      position: GeoPoint(lat, lng),
      nameAr: _text(json['name_ar']) ?? _text(json['checkpoint']) ?? '',
      nameEn: _text(json['name_en']) ?? '',
      city: _text(json['city']) ?? '',
      status: status,
      updatedAt: _date(json['updated_at']),
      enteringStatus: entering,
      leavingStatus: leaving,
      enteringStatusLastUpdated: _date(json['entering_status_last_updated']),
      leavingStatusLastUpdated: _date(json['leaving_status_last_updated']),
      enteringLastChangedText: _text(json['entering_status_last_updated']),
      leavingLastChangedText: _text(json['leaving_status_last_updated']),
      positionFromOpenStreetMap: json['position_source'] == 'openstreetmap',
    );
  }
}

/// A provider checkpoint with no trustworthy map position: listed by name,
/// never pinned at a guessed place.
class UnplacedCheckpoint {
  const UnplacedCheckpoint({
    required this.id,
    required this.nameAr,
    this.city = '',
    this.enteringLastChangedText,
    this.leavingLastChangedText,
  });

  final String id;
  final String nameAr;
  final String city;
  final String? enteringLastChangedText;
  final String? leavingLastChangedText;

  static UnplacedCheckpoint? tryParse(Object? value) {
    if (value is! Map<String, dynamic>) return null;
    final id = _text(value['id']);
    final name = _text(value['name_ar']);
    if (id == null || name == null) return null;
    return UnplacedCheckpoint(
      id: id,
      nameAr: name,
      city: _text(value['city']) ?? '',
      enteringLastChangedText: _text(value['entering_status_last_updated']),
      leavingLastChangedText: _text(value['leaving_status_last_updated']),
    );
  }
}

/// "2026-11-01T09:30:00" -> "2026-11-01 09:30", without any timezone change.
String formatProviderTime(String raw) {
  final match = RegExp(r'^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})').firstMatch(raw);
  return match == null ? raw : '${match.group(1)} ${match.group(2)}';
}

double? _coordinate(dynamic value, double limit) {
  if (value is! num && value is! String) return null;
  final number = value is num
      ? value.toDouble()
      : double.tryParse(value.trim());
  return number != null && number.isFinite && number.abs() <= limit
      ? number
      : null;
}

String? _text(dynamic value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;
DateTime? _date(dynamic value) =>
    value is String ? DateTime.tryParse(value) : null;

class CheckpointSnapshot {
  const CheckpointSnapshot({
    required this.checkpoints,
    this.fetchedAt,
    this.stale = false,
    this.unplaced = const [],
    this.source,
    this.positionAttribution,
  });
  final List<Checkpoint> checkpoints;
  final DateTime? fetchedAt;
  final bool stale;

  /// Provider checkpoints the server could not place on the map.
  final List<UnplacedCheckpoint> unplaced;

  /// `feed` (coordinate feed) or `aweenrayeh_partner`.
  final String? source;

  /// Credit for positions taken from OpenStreetMap, when any are.
  final String? positionAttribution;
  static const empty = CheckpointSnapshot(checkpoints: <Checkpoint>[]);

  factory CheckpointSnapshot.fromJson(Map<String, dynamic> json) {
    final raw = json['checkpoints'];
    if (raw is! List) throw const FormatException('Invalid checkpoints');
    final checkpoints = <Checkpoint>[];
    for (final value in raw) {
      if (value is! Map<String, dynamic>) continue;
      try {
        checkpoints.add(Checkpoint.fromJson(value));
      } on FormatException {
        continue;
      }
    }
    final unplaced = json['unplaced'];
    return CheckpointSnapshot(
      checkpoints: List.unmodifiable(checkpoints),
      fetchedAt: _date(json['fetched_at'] ?? json['generatedAt']),
      stale: json['stale'] == true,
      unplaced: List.unmodifiable([
        if (unplaced is List)
          for (final value in unplaced) ?UnplacedCheckpoint.tryParse(value),
      ]),
      source: _text(json['source']),
      positionAttribution: _text(json['position_attribution']),
    );
  }
}
