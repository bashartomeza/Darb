import type { AssistantPlace, AssistantRoute } from "../services/assistantParser.js";

/** Synthetic stops/route shaped like real route data; no network or database. */
export const fixturePlaces: AssistantPlace[] = [
  { key: "hebron-center", name_ar: "وسط الخليل", name_en: "Hebron Center", lat: 31.53, lng: 35.1 },
  { key: "bab-al-zawiya", name_ar: "باب الزاوية", name_en: "Bab Al-Zawiya", lat: 31.5326, lng: 35.0998 },
  { key: "ppu-main-gate", name_ar: "بوابة جامعة البوليتكنك", name_en: "PPU Main Gate", lat: 31.55, lng: 35.1 },
  { key: "bethlehem-center", name_ar: "وسط بيت لحم", name_en: "Bethlehem Center", lat: 31.7054, lng: 35.2024 }
];

export const fixtureRoutes: AssistantRoute[] = [
  {
    route_key: "hebron-bethlehem",
    stops: [
      { stop_key: "hebron-center", sequence: 1, passenger_pickup: true, passenger_dropoff: false },
      { stop_key: "bab-al-zawiya", sequence: 2, passenger_pickup: true, passenger_dropoff: true },
      { stop_key: "ppu-main-gate", sequence: 3, passenger_pickup: true, passenger_dropoff: true },
      { stop_key: "bethlehem-center", sequence: 4, passenger_pickup: false, passenger_dropoff: true }
    ]
  }
];

export const fixturePlaceData = { places: fixturePlaces, routes: fixtureRoutes };
