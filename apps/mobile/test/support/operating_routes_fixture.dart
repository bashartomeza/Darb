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

/// Prices for Hebron → Bethlehem as `GET /operating-routes` sends them: a
/// seat at ₪15.00 that drivers may set between ₪12.00 and ₪20.00, a small
/// parcel fixed at ₪8.00 and a medium parcel at ₪10.00 (₪9.00 to ₪14.00).
Map<String, dynamic> hebronBethlehemFaresJson() => {
  'currency': 'ILS',
  'estimated': true,
  'paid_directly_to_driver': true,
  'passenger_seat_minor': 1500,
  'parcel_minor': {'S': 800, 'M': 1000, 'L': null},
  'driver_price_range': {
    'passenger_seat': {'min_minor': 1200, 'max_minor': 2000},
    'parcel': {
      'S': null,
      'M': {'min_minor': 900, 'max_minor': 1400},
      'L': null,
    },
  },
};

/// [operatingRoutesJson] with prices on Hebron → Bethlehem only.
Map<String, dynamic> operatingRoutesWithFaresJson() => {
  'routes': [
    for (final route in operatingRoutesJson()['routes'] as List)
      {
        ...(route as Map<String, dynamic>),
        if (route['id'] == 'route-heb-bth') 'fares': hebronBethlehemFaresJson(),
      },
  ],
};

List<OperatingRoute> testOperatingRoutesWithFares() =>
    parseOperatingRoutes(operatingRoutesWithFaresJson());
