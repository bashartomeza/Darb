import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/core/maps/checkpoint_map_markers.dart';
import 'package:masari_mobile/core/widgets/masari_map.dart';
import 'package:masari_mobile/features/canonical_routes/domain/canonical_route_models.dart';
import 'package:masari_mobile/features/checkpoints/domain/checkpoint_models.dart';

void main() {
  for (final entry in [
    ('باب الزاوية — حاجز', 'Bab Al-Zawiya -> Gate-B', 'باب الزاوية — حاجز'),
    (null, 'Bab Al-Zawiya -> Gate-B', 'Bab Al-Zawiya -> Gate-B'),
    ('', 'Custom-name / Gate-B', 'Custom-name / Gate-B'),
    (' \t ', '  Bab Al-Zawiya  ', 'Bab Al-Zawiya'),
    (null, null, 'حاجز'),
    ('', '', 'حاجز'),
    (' \n ', ' \t ', 'حاجز'),
  ]) {
    test('canonical model and shared marker preserve ${entry.$3}', () {
      final checkpoint = Checkpoint.fromJson({
        'id': 'synthetic',
        'name_ar': entry.$1,
        'name_en': entry.$2,
        'latitude': 31.7,
        'longitude': 35.2,
        'status': 'closed',
      });
      expect(checkpoint.nameAr, entry.$1?.trim() ?? '');
      expect(checkpoint.nameEn, entry.$2?.trim() ?? '');
      expect(checkpoint.displayName, entry.$3);
      final marker = checkpointTrafficMarker(checkpoint);
      expect(marker.label.split('\n').first, entry.$3);
      expect(marker.position, const GeoPoint(31.7, 35.2));
      expect(marker.color, const Color(0xFFDC2626));
      expect(marker.icon, Icons.car_crash_rounded);
      expect(marker.size, 40);
      expect(marker.foreground, Colors.white);
      expect(marker.type, MasariMapMarkerType.checkpoint);
      expect(marker.label.split('\n').skip(1), [
        'مغلق',
        'دخول: غير معروف',
        'خروج: غير معروف',
      ]);
    });
  }
}
