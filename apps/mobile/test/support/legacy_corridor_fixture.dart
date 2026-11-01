import 'dart:convert';

import 'package:darb_mobile/features/legacy_corridor/data/legacy_corridor_models.dart';
import 'package:http/http.dart' as http;

/// Server data for the locked corridor, shaped like `GET /legacy-corridor`.
const corridorKey = 'hebron-ppu-bab-al-zawiya-to-bethlehem';
const corridorOriginLabel = 'Hebron / PPU / Bab Al-Zawiya';
const corridorOriginLat = 31.5326;
const corridorOriginLng = 35.0998;
const corridorDestinationLabel = 'Bethlehem';
const corridorDestinationLat = 31.7054;
const corridorDestinationLng = 35.2024;
const corridorNameAr = 'الخليل / جامعة بوليتكنك فلسطين / باب الزاوية ← بيت لحم';
const corridorNameEn = 'Hebron / PPU / Bab Al-Zawiya -> Bethlehem';

/// [corridorJson] parsed, for overriding `legacyCorridorProvider`.
LegacyCorridor testCorridor() => LegacyCorridor.fromJson(
  (jsonDecode(corridorJson) as Map<String, dynamic>)['corridor']
      as Map<String, dynamic>,
);

/// [corridorJson] as a response; the body has Arabic, so it is sent as UTF-8.
http.Response corridorResponse() => http.Response(
  corridorJson,
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

const testPickup = CorridorPlace(
  key: 'demo-bab-al-zawiya',
  nameAr: 'باب الزاوية',
  nameEn: 'Bab Al-Zawiya',
  lat: 31.5326,
  lng: 35.0998,
  passengerPickup: true,
  parcelPickup: true,
);

const testDropoff = CorridorPlace(
  key: 'demo-bethlehem-center',
  nameAr: 'وسط بيت لحم',
  nameEn: 'Bethlehem Center',
  lat: 31.7054,
  lng: 35.2024,
  passengerDropoff: true,
  parcelDropoff: true,
);

const corridorJson =
    '{"corridor":{"key":"$corridorKey","route_version_id":"version_1",'
    '"name_ar":"$corridorNameAr","name_en":"$corridorNameEn",'
    '"driver_route":{"origin_label":"$corridorOriginLabel",'
    '"origin_lat":$corridorOriginLat,"origin_lng":$corridorOriginLng,'
    '"destination_label":"$corridorDestinationLabel",'
    '"destination_lat":$corridorDestinationLat,'
    '"destination_lng":$corridorDestinationLng},'
    '"stops":['
    '{"id":"stop_1","stop_key":"demo-bab-al-zawiya","name_ar":"باب الزاوية",'
    '"name_en":"Bab Al-Zawiya","latitude":31.5326,"longitude":35.0998,'
    '"sequence":1,"passenger_pickup":true,"passenger_dropoff":false,'
    '"parcel_pickup":true,"parcel_dropoff":false},'
    '{"id":"stop_2","stop_key":"demo-ppu-main-gate",'
    '"name_ar":"بوابة جامعة بوليتكنك فلسطين","name_en":"PPU Main Gate",'
    '"latitude":31.55,"longitude":35.1,"sequence":2,'
    '"passenger_pickup":true,"passenger_dropoff":false,'
    '"parcel_pickup":false,"parcel_dropoff":false},'
    '{"id":"stop_3","stop_key":"demo-bethlehem-center","name_ar":"وسط بيت لحم",'
    '"name_en":"Bethlehem Center","latitude":31.7054,"longitude":35.2024,'
    '"sequence":3,"passenger_pickup":false,"passenger_dropoff":true,'
    '"parcel_pickup":false,"parcel_dropoff":true}]}}';
