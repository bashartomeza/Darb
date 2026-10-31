import 'dart:convert';
import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// A selected route belongs to one saved request, independently of pending creates.
class PassengerRequestSelectionStorage {
  const PassengerRequestSelectionStorage(this.storage);

  final FlutterSecureStorage storage;
  static final _writes = <String, Future<void>>{};

  String _key(String actorId, String requestId) =>
      'masari_request_selection_v1_${base64Url.encode(utf8.encode(actorId))}_${base64Url.encode(utf8.encode(requestId))}';

  Future<String?> read(String actorId, String requestId) async {
    final encoded = await storage.read(key: _key(actorId, requestId));
    if (encoded == null) return null;
    final value = jsonDecode(encoded);
    if (value is! Map ||
        value['actor_id'] != actorId ||
        value['request_id'] != requestId ||
        value['driver_route_id'] is! String ||
        (value['driver_route_id'] as String).trim().isEmpty) {
      throw const FormatException('Invalid saved request selection');
    }
    return value['driver_route_id'] as String;
  }

  Future<void> save(String actorId, String requestId, String routeId) async {
    final key = _key(actorId, requestId);
    final previous = _writes[key] ?? Future<void>.value();
    final completed = Completer<void>();
    _writes[key] = completed.future;
    try {
      await previous;
      final existing = await read(actorId, requestId);
      if (existing != null) {
        if (existing != routeId) {
          throw const FormatException('Saved request selection conflict');
        }
        return;
      }
      await storage.write(
        key: key,
        value: jsonEncode({
          'actor_id': actorId,
          'request_id': requestId,
          'driver_route_id': routeId,
        }),
      );
    } finally {
      completed.complete();
      if (identical(_writes[key], completed.future)) _writes.remove(key);
    }
  }
}
