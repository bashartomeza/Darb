// Synthetic routes for tests, in the exact shape of `GET /operating-routes`.
import 'package:darb_mobile/features/operating_routes/data/operating_route_models.dart';

Map<String, dynamic> cityJson(
  String id,
  String ar,
  String en,
  double lat,
  double lng,
) => {
  'id': id,
  'name_ar': ar,
  'name_en': en,
  'latitude': lat,
  'longitude': lng,
};

Map<String, dynamic> operatingRoutesJson() => {
  'routes': [
    {
      'id': 'route-heb-bth',
      'route_key': 'hebron-to-bethlehem',
      'name_ar': 'الخليل ← بيت لحم',
      'name_en': 'Hebron → Bethlehem',
      'origin': cityJson('city-hebron', 'الخليل', 'Hebron', 31.5326, 35.0998),
      'destination': cityJson(
        'city-bethlehem',
        'بيت لحم',
        'Bethlehem',
        31.7054,
        35.2024,
      ),
    },
    {
      'id': 'route-bth-heb',
      'route_key': 'bethlehem-to-hebron',
      'name_ar': 'بيت لحم ← الخليل',
      'name_en': 'Bethlehem → Hebron',
      'origin': cityJson(
        'city-bethlehem',
        'بيت لحم',
        'Bethlehem',
        31.7054,
        35.2024,
      ),
      'destination': cityJson(
        'city-hebron',
        'الخليل',
        'Hebron',
        31.5326,
        35.0998,
      ),
    },
  ],
};

List<OperatingRoute> testOperatingRoutes() =>
    parseOperatingRoutes(operatingRoutesJson());
