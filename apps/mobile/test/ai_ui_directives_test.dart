import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/features/ai_directives/ai_ui_directives.dart';
import 'package:masari_mobile/features/ai_directives/edge_geofence.dart';
import 'package:masari_mobile/features/assistant/domain/passenger_assistant_models.dart';

/// The same JSON file is validated by Python (pytest) and Node (vitest).
Map<String, dynamic> _fixture() {
  final file = File('../api/ai_services/contracts/ui_directives.v1.json');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

void main() {
  group('AiUiDirectives contract v1', () {
    test('emergency fixture drives red theme, haptics and tel: buttons', () {
      final directives = AiUiDirectives.tryParse(_fixture()['emergency'])!;
      expect(directives.isEmergency, isTrue);
      expect(directives.theme.primaryColorHex, '#DC2626');
      expect(directives.theme.primaryColor.toARGB32(), 0xFFDC2626);
      expect(directives.theme.flashing, isTrue);
      expect(directives.haptics.vibrate, isTrue);
      expect(directives.haptics.patternMs, isNotEmpty);
      expect(directives.emergencyActions, hasLength(3));
      expect(
        directives.emergencyActions.every((a) => a.dialUri.scheme == 'tel'),
        isTrue,
      );
      expect(directives.requiresHumanConfirmation, isTrue);
    });

    test('flashing respects the OS reduce-motion setting', () {
      final theme = AiUiDirectives.tryParse(_fixture()['emergency'])!.theme;
      expect(theme.shouldFlash(platformReduceMotion: false), isTrue);
      expect(theme.shouldFlash(platformReduceMotion: true), isFalse);
    });

    test('logistics fixture maps the progress graph', () {
      final progress = AiUiDirectives.tryParse(
        _fixture()['logistics'],
      )!.logisticsProgress!;
      expect(progress.parcelsTotal, 4);
      expect(progress.series, hasLength(4));
      expect(progress.fuelSavingsIndex, inInclusiveRange(0.2, 0.4));
      expect(progress.isSimulation, isTrue);
    });

    test('standard fixture has no emergency or logistics extras', () {
      final directives = AiUiDirectives.tryParse(_fixture()['standard'])!;
      expect(directives.mode, AiUiMode.standard);
      expect(directives.emergencyActions, isEmpty);
      expect(directives.logisticsProgress, isNull);
      expect(directives.haptics.vibrate, isFalse);
    });

    test('hostile or malformed payloads degrade to null (normal UI)', () {
      Map<String, dynamic> emergency() =>
          jsonDecode(jsonEncode(_fixture()['emergency']))
              as Map<String, dynamic>;
      expect(AiUiDirectives.tryParse(null), isNull);
      expect(AiUiDirectives.tryParse('nope'), isNull);

      final badUri = emergency();
      (badUri['emergency_actions'] as List).first['dial_uri'] =
          'https://evil.example';
      expect(AiUiDirectives.tryParse(badUri), isNull);

      final badColour = emergency();
      badColour['theme']['primary_color_hex'] = 'red';
      expect(AiUiDirectives.tryParse(badColour), isNull);

      final badVersion = emergency()..['schema_version'] = 2;
      expect(AiUiDirectives.tryParse(badVersion), isNull);

      final badInterval = emergency();
      badInterval['theme']['flash_interval_ms'] = 999999;
      expect(AiUiDirectives.tryParse(badInterval), isNull);
    });
  });

  group('PassengerAssistantReply integration', () {
    test('voice reply carries transcript and directives; text reply does not', () {
      final voice = PassengerAssistantReply.fromJson({
        'status': 'clarification',
        'question': 'من وين بدك تطلع؟',
        'suggestions': <String>[],
        'conversation_id': 'c1',
        'transcript': 'بدي سيرفيس',
        'frontend_ai_ui_directives': _fixture()['emergency'],
      });
      expect(voice.transcript, 'بدي سيرفيس');
      expect(voice.uiDirectives?.isEmergency, isTrue);

      final text = PassengerAssistantReply.fromJson({
        'status': 'result',
        'answer': 'جواب',
        'suggestions': <String>[],
      });
      expect(text.uiDirectives, isNull);
      expect(text.transcript, isNull);
    });

    test('malformed directives never break the assistant reply', () {
      final reply = PassengerAssistantReply.fromJson({
        'status': 'result',
        'answer': 'جواب',
        'frontend_ai_ui_directives': {'schema_version': 1, 'mode': 'weird'},
      });
      expect(reply.message, 'جواب');
      expect(reply.uiDirectives, isNull);
    });
  });

  group('edge geofence (parity with logistics_math.py)', () {
    const centerLat = 31.9038;
    const centerLon = 35.2034;

    test('inside radius triggers pickup and destination signals', () {
      final pickup = evaluateEdgeGeofence(
        driverLat: 31.90385,
        driverLon: 35.20345,
        centerLat: centerLat,
        centerLon: centerLon,
        milestone: EdgeMilestone.pickup,
      );
      expect(pickup.signal, EdgeSignal.pickupGeofenceTriggered);
      expect(pickup.cloudUpdateAllowed, isTrue);
    });

    test('outside radius holds silently; dispatch/transit ignore the fence', () {
      final hold = evaluateEdgeGeofence(
        driverLat: 31.92,
        driverLon: 35.22,
        centerLat: centerLat,
        centerLon: centerLon,
        milestone: EdgeMilestone.destination,
      );
      expect(hold.signal, EdgeSignal.silentHold);
      expect(hold.cloudUpdateAllowed, isFalse);
      final transit = evaluateEdgeGeofence(
        driverLat: 31.92,
        driverLon: 35.22,
        centerLat: centerLat,
        centerLon: centerLon,
        milestone: EdgeMilestone.transit,
      );
      expect(transit.signal, EdgeSignal.transitInProgress);
      expect(transit.cloudUpdateAllowed, isTrue);
    });

    test('negative, corrupted or out-of-region coordinates are tampering', () {
      for (final bad in [
        [-31.9, 35.2],
        [999.0, 35.2],
        [double.nan, 35.2],
        [0.0, 0.0],
      ]) {
        final result = evaluateEdgeGeofence(
          driverLat: bad[0],
          driverLon: bad[1],
          centerLat: centerLat,
          centerLon: centerLon,
          milestone: EdgeMilestone.pickup,
        );
        expect(result.signal, EdgeSignal.securityTamperingBlocked);
        expect(result.cloudUpdateAllowed, isFalse);
        expect(result.localDistanceMeters, isNull);
      }
    });

    test('haversine matches the Python reference to the metre', () {
      // Python: haversine_meters((31.9038, 35.2034), (31.92, 35.22)) = 2387.5 m
      final metres = haversineMeters(31.9038, 35.2034, 31.92, 35.22);
      expect(metres, closeTo(2387.5, 1));
    });
  });
}
