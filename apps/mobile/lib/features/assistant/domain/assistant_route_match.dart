import 'dart:math' as math;

import '../../operating_routes/data/operating_route_models.dart';
import 'passenger_assistant_models.dart';

/// The predefined route the assistant's extracted trip most likely means, or
/// null when either end cannot be tied to a route city (the passenger then
/// chooses the route themselves).
///
/// Each end is matched by name first — the place label and key against the
/// cities' Arabic and English names, tolerant of the Arabic article, hamza and
/// ta marbuta spellings, diacritics and case — then, for a place that names no
/// city (e.g. a university gate), by the nearest city centre within
/// [nearbyKm] of its coordinates.
OperatingRoute? routeForAssistantDraft(
  List<OperatingRoute> routes,
  PassengerAssistantTripDraft draft, {
  double nearbyKm = 15,
}) {
  final cities = <String, RouteCity>{
    for (final route in routes) ...{
      route.origin.id: route.origin,
      route.destination.id: route.destination,
    },
  }.values.toList(growable: false);

  final origin = _cityFor(
    cities,
    texts: [draft.pickupLabel, draft.pickupKey],
    lat: draft.pickupLat,
    lng: draft.pickupLng,
    nearbyKm: nearbyKm,
  );
  final destination = _cityFor(
    cities,
    texts: [draft.destinationLabel, draft.destinationKey],
    lat: draft.destinationLat,
    lng: draft.destinationLng,
    nearbyKm: nearbyKm,
  );
  if (origin == null || destination == null || origin.id == destination.id) {
    return null;
  }
  for (final route in routes) {
    if (route.origin.id == origin.id &&
        route.destination.id == destination.id) {
      return route;
    }
  }
  return null;
}

RouteCity? _cityFor(
  List<RouteCity> cities, {
  required List<String> texts,
  required double? lat,
  required double? lng,
  required double nearbyKm,
}) {
  final words = {for (final text in texts) ..._words(text)};
  final phrase = ' ${texts.map((text) => _words(text).join(' ')).join(' | ')} ';
  final named = [
    for (final city in cities)
      if (_names(city).any(
        (name) => name.contains(' ')
            ? phrase.contains(' $name ')
            : words.contains(name),
      ))
        city,
  ];
  // A place naming two cities ("Hebron road, Bethlehem") is not a guess to
  // make for the passenger.
  if (named.length == 1) return named.single;
  if (named.length > 1) return null;

  if (lat == null || lng == null) return null;
  RouteCity? nearest;
  var best = double.infinity;
  for (final city in cities) {
    final distance = _distanceKm(lat, lng, city.lat, city.lng);
    if (distance < best) {
      best = distance;
      nearest = city;
    }
  }
  return best <= nearbyKm ? nearest : null;
}

Iterable<String> _names(RouteCity city) => {
  _words(city.nameAr).join(' '),
  _words(city.nameEn).join(' '),
}.where((name) => name.isNotEmpty);

/// Lower-cased words with Arabic spelling variants folded together and the
/// definite article dropped, so "الخليل", "خليل" and "Hebron" compare cleanly.
List<String> _words(String text) {
  final folded = text
      .toLowerCase()
      .replaceAll(RegExp('[\u064B-\u065F\u0670\u0640]'), '')
      .replaceAll(RegExp('[\u0622\u0623\u0625\u0671]'), '\u0627')
      .replaceAll('\u0629', '\u0647')
      .replaceAll('\u0649', '\u064A')
      .replaceAll(RegExp('[^a-z0-9\u0621-\u064A]+'), ' ')
      .trim();
  if (folded.isEmpty) return const [];
  return [
    for (final word in folded.split(' '))
      word.startsWith('\u0627\u0644') && word.length > 3
          ? word.substring(2)
          : word,
  ];
}

double _distanceKm(double lat1, double lng1, double lat2, double lng2) {
  const earthKm = 6371.0;
  double rad(double degrees) => degrees * math.pi / 180;
  final dLat = rad(lat2 - lat1);
  final dLng = rad(lng2 - lng1);
  final a =
      math.pow(math.sin(dLat / 2), 2) +
      math.cos(rad(lat1)) *
          math.cos(rad(lat2)) *
          math.pow(math.sin(dLng / 2), 2);
  return earthKm * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
}
