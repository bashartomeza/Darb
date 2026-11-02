import 'dart:ui' show Color;

/// Dynamic UI directives produced by the AI service (contract v1).
///
/// Mirrors apps/api/ai_services/contracts/ui_directives.v1.json and the zod
/// schema in apps/api/src/services/aiServicesClient.ts. Parsing is strict: any
/// violation returns `null` so the screen silently falls back to its normal
/// look instead of rendering untrusted values (colours, dial URIs...).
class AiUiDirectives {
  const AiUiDirectives({
    required this.mode,
    required this.theme,
    required this.haptics,
    required this.emergencyActions,
    required this.logisticsProgress,
    required this.requiresHumanConfirmation,
  });

  final AiUiMode mode;
  final AiThemeDirectives theme;
  final AiHapticsDirectives haptics;
  final List<AiEmergencyAction> emergencyActions;
  final AiLogisticsProgress? logisticsProgress;
  final bool requiresHumanConfirmation;

  bool get isEmergency => mode == AiUiMode.emergency;

  static const int supportedSchemaVersion = 1;

  /// Returns null when [raw] is absent or does not satisfy contract v1.
  static AiUiDirectives? tryParse(Object? raw) {
    if (raw is! Map) return null;
    try {
      return _parse(raw.map((key, value) => MapEntry(key.toString(), value)));
    } on FormatException {
      return null;
    }
  }

  static AiUiDirectives _parse(Map<String, Object?> json) {
    if (json['schema_version'] != supportedSchemaVersion) {
      throw const FormatException('Unsupported directives schema version');
    }
    final mode = switch (json['mode']) {
      'emergency' => AiUiMode.emergency,
      'logistics' => AiUiMode.logistics,
      'standard' => AiUiMode.standard,
      _ => throw const FormatException('Unknown directives mode'),
    };
    final theme = _map(json['theme']);
    final hex = theme['primary_color_hex'];
    if (hex is! String || !_hexColor.hasMatch(hex)) {
      throw const FormatException('Invalid colour');
    }
    final flashInterval = _intInRange(theme['flash_interval_ms'], 0, 5000);
    final haptics = _map(json['haptics']);
    final pattern = haptics['pattern_ms'];
    if (pattern is! List || pattern.length > 12) {
      throw const FormatException('Invalid haptic pattern');
    }
    final actionsRaw = json['emergency_actions'];
    if (actionsRaw is! List || actionsRaw.length > 5) {
      throw const FormatException('Invalid emergency actions');
    }
    final progressRaw = json['logistics_progress'];

    return AiUiDirectives(
      mode: mode,
      theme: AiThemeDirectives(
        primaryColorHex: hex,
        primaryColor: Color(0xFF000000 | int.parse(hex.substring(1), radix: 16)),
        flashing: _bool(theme['flashing']),
        flashIntervalMs: flashInterval,
        respectReduceMotion: _bool(theme['respect_reduce_motion']),
      ),
      haptics: AiHapticsDirectives(
        vibrate: _bool(haptics['vibrate']),
        patternMs: pattern
            .map((value) => _intInRange(value, 0, 3000))
            .toList(growable: false),
      ),
      emergencyActions: actionsRaw
          .map((value) => AiEmergencyAction._parse(_map(value)))
          .toList(growable: false),
      logisticsProgress: progressRaw == null
          ? null
          : AiLogisticsProgress._parse(_map(progressRaw)),
      requiresHumanConfirmation: _bool(json['requires_human_confirmation']),
    );
  }
}

enum AiUiMode { emergency, logistics, standard }

class AiThemeDirectives {
  const AiThemeDirectives({
    required this.primaryColorHex,
    required this.primaryColor,
    required this.flashing,
    required this.flashIntervalMs,
    required this.respectReduceMotion,
  });

  final String primaryColorHex;
  final Color primaryColor;
  final bool flashing;
  final int flashIntervalMs;

  /// When true the UI must not flash if the OS "reduce motion" setting is on.
  final bool respectReduceMotion;

  /// Whether the flashing effect may actually run on this device.
  bool shouldFlash({required bool platformReduceMotion}) =>
      flashing && !(respectReduceMotion && platformReduceMotion);
}

class AiHapticsDirectives {
  const AiHapticsDirectives({required this.vibrate, required this.patternMs});

  final bool vibrate;

  /// Alternating wait/vibrate durations in milliseconds.
  final List<int> patternMs;
}

class AiEmergencyAction {
  const AiEmergencyAction({
    required this.id,
    required this.labelAr,
    required this.labelEn,
    required this.dialUri,
  });

  static AiEmergencyAction _parse(Map<String, Object?> json) {
    final uri = json['dial_uri'];
    if (uri is! String || !_telUri.hasMatch(uri)) {
      throw const FormatException('Invalid dial URI');
    }
    return AiEmergencyAction(
      id: _string(json['id']),
      labelAr: _string(json['label_ar']),
      labelEn: _string(json['label_en']),
      dialUri: Uri.parse(uri),
    );
  }

  final String id;
  final String labelAr;
  final String labelEn;

  /// Always a `tel:` URI (validated).
  final Uri dialUri;
}

class AiLogisticsProgress {
  const AiLogisticsProgress({
    required this.parcelsTotal,
    required this.tripsSaved,
    required this.fuelSavingsIndex,
    required this.fuelSavingsPercentage,
    required this.series,
    required this.isSimulation,
  });

  static AiLogisticsProgress _parse(Map<String, Object?> json) {
    final seriesRaw = json['series'];
    if (seriesRaw is! List || seriesRaw.length > 20) {
      throw const FormatException('Invalid series');
    }
    return AiLogisticsProgress(
      parcelsTotal: _intInRange(json['parcels_total'], 1, 10000),
      tripsSaved: _intInRange(json['trips_saved'], 0, 10000),
      fuelSavingsIndex: _doubleInRange(json['fuel_savings_index'], 0, 1),
      fuelSavingsPercentage: _doubleInRange(
        json['fuel_savings_percentage'],
        0,
        100,
      ),
      series: seriesRaw
          .map((value) {
            final point = _map(value);
            return AiLogisticsPoint(
              step: _intInRange(point['step'], 0, 100000),
              tripsWithoutBatching: _intInRange(
                point['trips_without_batching'],
                0,
                100000,
              ),
              tripsWithBatching: _intInRange(
                point['trips_with_batching'],
                0,
                100000,
              ),
            );
          })
          .toList(growable: false),
      isSimulation: _bool(json['is_simulation']),
    );
  }

  final int parcelsTotal;
  final int tripsSaved;

  /// 0..1 simulated fuel-savings index (drives the progress graph).
  final double fuelSavingsIndex;
  final double fuelSavingsPercentage;
  final List<AiLogisticsPoint> series;

  /// Always show a "simulation estimate" label while this is true.
  final bool isSimulation;
}

class AiLogisticsPoint {
  const AiLogisticsPoint({
    required this.step,
    required this.tripsWithoutBatching,
    required this.tripsWithBatching,
  });

  final int step;
  final int tripsWithoutBatching;
  final int tripsWithBatching;
}

final RegExp _hexColor = RegExp(r'^#[0-9A-Fa-f]{6}$');
final RegExp _telUri = RegExp(r'^tel:\+?\d{2,15}$');

Map<String, Object?> _map(Object? value) {
  if (value is! Map) throw const FormatException('Expected an object');
  return value.map((key, inner) => MapEntry(key.toString(), inner));
}

bool _bool(Object? value) {
  if (value is! bool) throw const FormatException('Expected a boolean');
  return value;
}

String _string(Object? value) {
  if (value is! String || value.trim().isEmpty || value.length > 60) {
    throw const FormatException('Expected a short string');
  }
  return value;
}

int _intInRange(Object? value, int min, int max) {
  if (value is! num || value != value.toInt()) {
    throw const FormatException('Expected an integer');
  }
  final result = value.toInt();
  if (result < min || result > max) {
    throw const FormatException('Integer out of range');
  }
  return result;
}

double _doubleInRange(Object? value, double min, double max) {
  if (value is! num || !value.isFinite) {
    throw const FormatException('Expected a finite number');
  }
  final result = value.toDouble();
  if (result < min || result > max) {
    throw const FormatException('Number out of range');
  }
  return result;
}
