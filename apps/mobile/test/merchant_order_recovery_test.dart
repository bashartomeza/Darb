import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:darb_mobile/core/api/api_error.dart';
import 'package:darb_mobile/core/api/saved_request_outcome.dart';
import 'package:darb_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:darb_mobile/features/merchant/application/merchant_order_submission.dart';
import 'package:darb_mobile/features/merchant/data/merchant_models.dart';
import 'package:darb_mobile/features/merchant/data/merchant_order_operation_storage.dart';
import 'package:darb_mobile/features/merchant/data/merchant_repository.dart';

import 'support/auth_test_support.dart';

const _routeId = 'route-heb-bth';
const _pickup = 'Al-Amal store, Ein Sarah street';
const _drafts = [
  ParcelDraft(
    dropoffDetails: 'Near Bethlehem University main gate',
    receiverName: 'Sara',
    receiverPhone: '+970599123456',
  ),
];

extension on MerchantOrderSubmission {
  Future<MerchantOrder> send([List<ParcelDraft> parcels = _drafts]) => submit(
    serviceRouteId: _routeId,
    pickupDetails: _pickup,
    parcels: parcels,
  );
}

/// An order saved by a build before routes existed: corridor places with
/// their coordinates, in the version-1 envelope.
Map<String, dynamic> _corridorPayload() => {
  'pickup_label': 'Bab Al-Zawiya',
  'pickup_lat': 31.5326,
  'pickup_lng': 35.0998,
  'parcels': [
    {
      'destination_label': 'Bethlehem Center',
      'destination_lat': 31.7054,
      'destination_lng': 35.2024,
      'size': 'S',
      'priority': 'normal',
    },
  ],
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late AuthenticatedActorBinding binding;
  late MerchantOrderOperationStorage storage;
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    binding = AuthenticatedActorBinding()..bind('merchant_A');
    storage = const MerchantOrderOperationStorage(FlutterSecureStorage());
  });
  MerchantOrderSubmission runner(
    Future<http.Response> Function(http.Request) handler, {
    MerchantOrderOperationStorage? store,
    DateTime Function()? now,
  }) => MerchantOrderSubmission(
    storage: store ?? storage,
    binding: binding,
    now: now,
    repository: MerchantRepository(
      apiClient: TestAuthenticatedClient(handler: handler).client,
    ),
  );
  final body = MerchantRepository.createOrderBody(
    serviceRouteId: _routeId,
    pickupDetails: _pickup,
    parcels: _drafts,
  );
  // The server fills the city labels and echoes the typed details.
  http.Response saved([int status = 200]) => http.Response(
    jsonEncode({
      'order': {
        'id': 'saved_order',
        'pickup_label': 'Hebron',
        'service_route_id': _routeId,
        'route_name_ar': 'الخليل ← بيت لحم',
        'route_name_en': 'Hebron → Bethlehem',
        'pickup_details': _pickup,
        'status': 'submitted',
        'created_at': '2026-10-21T00:00:00Z',
        'parcels': [
          {
            'id': 'saved_parcel',
            'destination_label': 'Bethlehem',
            ..._drafts.single.toJson(),
            'status': 'pending',
          },
        ],
      },
    }),
    status,
    headers: const {'content-type': 'application/json; charset=utf-8'},
  );
  final missing = http.Response(
    '{"error":"merchant_order_operation_not_found"}',
    404,
  );

  test(
    'persist exact operation before sending; restart recovers committed response loss by GET only',
    () async {
      String? key;
      var posts = 0;
      final first = runner((request) async {
        posts++;
        key = request.headers['idempotency-key'];
        final pending = await storage.read('merchant_A');
        expect(pending?.idempotencyKey, key);
        expect(pending?.payload, body);
        throw http.ClientException('response lost after commit');
      });
      await expectLater(first.send(), throwsA(isA<ApiException>()));
      final before = await storage.read('merchant_A');
      expect(before, isNotNull);
      final restarted = runner((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/v1/merchant/order-operation');
        expect(request.headers['idempotency-key'], key);
        return saved();
      }, store: const MerchantOrderOperationStorage(FlutterSecureStorage()));
      expect((await restarted.recover())?.id, 'saved_order');
      expect(posts, 1);
      expect(await storage.read('merchant_A'), isNull);
    },
  );

  test(
    'uncommitted response loss retries exact stored payload and key only on explicit resume',
    () async {
      final requests = <http.Request>[];
      var first = true;
      final service = runner((request) async {
        requests.add(request);
        if (request.method == 'GET') return missing;
        if (first) {
          first = false;
          throw http.ClientException('connection lost');
        }
        return saved(201);
      });
      await expectLater(service.send(), throwsA(isA<ApiException>()));
      expect((await service.resume()).id, 'saved_order');
      expect(requests.map((r) => r.method), ['POST', 'GET', 'POST']);
      expect(
        requests.first.headers['idempotency-key'],
        requests.last.headers['idempotency-key'],
      );
      expect(requests.first.body, requests.last.body);
    },
  );

  test('different payload cannot replace an uncertain operation', () async {
    var calls = 0;
    final service = runner((_) async {
      calls++;
      throw http.ClientException('lost');
    });
    await expectLater(service.send(), throwsA(isA<ApiException>()));
    final original = await storage.read('merchant_A');
    await expectLater(
      service.send([
        ParcelDraft(dropoffDetails: _drafts.single.dropoffDetails, size: 'L'),
      ]),
      throwsA(isA<MerchantOrderRecoveryException>()),
    );
    expect(calls, 1);
    expect(
      (await storage.read('merchant_A'))?.idempotencyKey,
      original?.idempotencyKey,
    );
  });

  test(
    'server errors and malformed successful replies remain uncertain',
    () async {
      for (final response in [
        http.Response('{"error":"internal_error"}', 500),
        http.Response('{}', 201),
        http.Response('{"order":{"id":"bad"}}', 201),
      ]) {
        final service = runner((_) async => response);
        await expectLater(service.send(), throwsA(anything));
        expect(await storage.read('merchant_A'), isNotNull);
        FlutterSecureStorage.setMockInitialValues({});
      }
    },
  );

  test(
    'a confirmed first-attempt validation rejection clears pending',
    () async {
      final invalid = http.Response('{"error":"validation_error"}', 400);
      await expectLater(
        runner((_) async => invalid).send(),
        throwsA(
          isA<ApiException>().having(
            (error) => error is SavedRequestRejected,
            'resend',
            isFalse,
          ),
        ),
      );
      expect(await storage.read('merchant_A'), isNull);
    },
  );

  test(
    'a resend refused for good clears the saved order and unlocks a new one',
    () async {
      for (final refusal in [
        http.Response('{"error":"validation_error"}', 400),
        http.Response('{"error":"forbidden"}', 403),
        http.Response('{"error":"not_found"}', 404),
        http.Response('{"error":"route_unavailable"}', 409),
        http.Response('{"error":"idempotency_conflict"}', 409),
        http.Response('{"error":"route_retired"}', 410),
        http.Response('{"error":"validation_error"}', 422),
      ]) {
        FlutterSecureStorage.setMockInitialValues({});
        await storage.save(
          MerchantPendingOrder.create(actorId: 'merchant_A', payload: body),
        );
        final service = runner(
          (request) async => request.method == 'GET' ? missing : refusal,
        );
        await expectLater(
          service.resume(),
          throwsA(isA<SavedRequestRejected>()),
        );
        expect(await storage.read('merchant_A'), isNull, reason: refusal.body);
        expect(await service.pending(), isNull);
        expect(
          (await runner((request) async => saved(201)).send()).id,
          'saved_order',
        );
      }
    },
  );

  test(
    'a resend lost again or failing on the server keeps the order',
    () async {
      for (final failure in <Future<http.Response> Function()>[
        () async => throw http.ClientException('lost again'),
        () async => http.Response('{"error":"internal_error"}', 500),
        () async => http.Response('{"error":"rate_limited"}', 429),
        () async => http.Response('{"error":"idempotency_in_progress"}', 409),
      ]) {
        FlutterSecureStorage.setMockInitialValues({});
        final pending = MerchantPendingOrder.create(
          actorId: 'merchant_A',
          payload: body,
        );
        await storage.save(pending);
        final service = runner(
          (request) async => request.method == 'GET' ? missing : failure(),
        );
        await expectLater(service.resume(), throwsA(anything));
        expect(
          (await storage.read('merchant_A'))?.idempotencyKey,
          pending.idempotencyKey,
        );
      }
    },
  );

  test('discard removes even an unreadable saved order', () async {
    FlutterSecureStorage.setMockInitialValues({
      'darb_merchant_order_v1:merchant_A': '{"not":"an order"}',
    });
    final service = runner((_) async => saved(201));
    await expectLater(
      service.pending(),
      throwsA(isA<MerchantOrderRecoveryException>()),
    );
    await service.discard();
    expect(await service.pending(), isNull);
    expect((await service.send()).id, 'saved_order');
  });

  test(
    'double submission is single flight even during secure persistence',
    () async {
      final gate = Completer<http.Response>();
      final started = Completer<void>();
      var posts = 0;
      final service = runner((_) {
        posts++;
        started.complete();
        return gate.future;
      });
      final first = service.send();
      await started.future;
      await expectLater(
        service.send(),
        throwsA(isA<MerchantOrderRecoveryException>()),
      );
      gate.complete(saved(201));
      expect((await first).id, 'saved_order');
      expect(posts, 1);
    },
  );

  test(
    'logout and return to same account fences late success; retains exact recovery identity',
    () async {
      final gate = Completer<http.Response>();
      final started = Completer<void>();
      final service = runner((_) {
        started.complete();
        return gate.future;
      });
      final future = service.send();
      await started.future;
      final pending = await storage.read('merchant_A');
      binding.clear();
      binding.bind('merchant_A');
      gate.complete(saved(201));
      await expectLater(future, throwsA(isA<MerchantOrderRecoveryException>()));
      expect(
        (await storage.read('merchant_A'))?.idempotencyKey,
        pending?.idempotencyKey,
      );
    },
  );

  test(
    'account switch cannot send persisted work with another account credentials',
    () async {
      var sends = 0;
      final switching = _SwitchingStorage(() => binding.bind('merchant_B'));
      await expectLater(
        runner((_) async {
          sends++;
          return saved();
        }, store: switching).send(),
        throwsA(isA<MerchantOrderRecoveryException>()),
      );
      expect(sends, 0);
      expect(await storage.read('merchant_A'), isNotNull);
      expect(
        await runner((_) async {
          sends++;
          return missing;
        }).recover(),
        isNull,
      );
      expect(sends, 0);
    },
  );

  test('separate merchants preserve their own pending operations', () async {
    final a = MerchantPendingOrder.create(actorId: 'merchant_A', payload: body);
    final b = MerchantPendingOrder.create(actorId: 'merchant_B', payload: body);
    await storage.save(a);
    await storage.save(b);
    binding.bind('merchant_B');
    expect((await runner((_) async => saved()).recover())?.id, 'saved_order');
    expect(
      (await storage.read('merchant_A'))?.idempotencyKey,
      a.idempotencyKey,
    );
    expect(await storage.read('merchant_B'), isNull);
  });

  test(
    'an expired order unknown to the server is looked up only, then cleared',
    () async {
      final now = DateTime.utc(2026, 10, 21);
      final pending = MerchantPendingOrder.create(
        actorId: 'merchant_A',
        payload: body,
        now: now.subtract(const Duration(days: 7)),
      );
      await storage.save(pending);
      final methods = <String>[];
      final service = runner((request) async {
        methods.add(request.method);
        return missing;
      }, now: () => now);
      await expectLater(service.resume(), throwsA(isA<SavedRequestExpired>()));
      expect(methods, ['GET']);
      expect(await storage.read('merchant_A'), isNull);
    },
  );

  test(
    'an expired order the server did save is still recovered by lookup',
    () async {
      final now = DateTime.utc(2026, 10, 21);
      await storage.save(
        MerchantPendingOrder.create(
          actorId: 'merchant_A',
          payload: body,
          now: now.subtract(const Duration(days: 7)),
        ),
      );
      expect(
        (await runner((_) async => saved(), now: () => now).recover())?.id,
        'saved_order',
      );
      expect(await storage.read('merchant_A'), isNull);
    },
  );

  test(
    'future-dated recovery does only a lookup, never a POST or key replacement',
    () async {
      final now = DateTime.utc(2026, 10, 21);
      for (final created in [now.add(const Duration(minutes: 6))]) {
        FlutterSecureStorage.setMockInitialValues({});
        final pending = MerchantPendingOrder.create(
          actorId: 'merchant_A',
          payload: body,
          now: created,
        );
        await storage.save(pending);
        var calls = 0;
        final service = runner((request) async {
          calls++;
          expect(request.method, 'GET');
          return missing;
        }, now: () => now);
        await expectLater(
          service.resume(),
          throwsA(isA<MerchantOrderRecoveryException>()),
        );
        expect(calls, 1);
        expect(
          (await storage.read('merchant_A'))?.idempotencyKey,
          pending.idempotencyKey,
        );
        expect(
          (await runner((_) async => saved(), now: () => now).recover())?.id,
          'saved_order',
        );
      }
    },
  );

  test(
    'storage write failure sends nothing; delete failure preserves a recoverable operation',
    () async {
      var sends = 0;
      await expectLater(
        runner((_) async {
          sends++;
          return saved();
        }, store: _FailingStorage(saveFailure: true)).send(),
        throwsA(anything),
      );
      expect(sends, 0);
      await expectLater(
        runner((_) async => saved(201), store: _FailingStorage()).send(),
        throwsA(anything),
      );
      expect(await storage.read('merchant_A'), isNotNull);
      expect((await runner((_) async => saved()).recover())?.id, 'saved_order');
      expect(await storage.read('merchant_A'), isNull);
    },
  );

  test(
    'logout during secure deletion restores the original key before another submission can start',
    () async {
      final secure = _GatedDeleteStorage();
      final service = runner(
        (_) async => saved(201),
        store: MerchantOrderOperationStorage(secure),
      );
      final future = service.send();
      await secure.started.future;
      final original = await storage.read('merchant_A');
      binding.clear();
      binding.bind('merchant_A');
      secure.release.complete();
      await expectLater(future, throwsA(isA<MerchantOrderRecoveryException>()));
      expect(
        (await storage.read('merchant_A'))?.idempotencyKey,
        original!.idempotencyKey,
      );
      expect(
        (await runner((request) async {
          expect(request.method, 'GET');
          return saved();
        }).recover())?.id,
        'saved_order',
      );
    },
  );
  test(
    'failed secure restoration blocks replacement submissions after confirmed-response cleanup failure',
    () async {
      final secure = _GatedDeleteStorage();
      var sends = 0;
      final service = runner((_) async {
        sends++;
        return saved(201);
      }, store: MerchantOrderOperationStorage(secure));
      final future = service.send();
      await secure.started.future;
      binding.clear();
      binding.bind('merchant_A');
      secure.failWrites = true;
      secure.release.complete();
      await expectLater(future, throwsA(isA<MerchantOrderRecoveryException>()));
      await expectLater(
        service.send(),
        throwsA(isA<MerchantOrderRecoveryException>()),
      );
      expect(sends, 1);
    },
  );
  test(
    'auth change at clear completion restores the pending key before final acknowledgment',
    () async {
      final store = _SwitchAfterClear(() {
        binding.clear();
        binding.bind('merchant_A');
      });
      final service = runner((_) async => saved(201), store: store);
      await expectLater(
        service.send(),
        throwsA(isA<MerchantOrderRecoveryException>()),
      );
      expect(await storage.read('merchant_A'), isNotNull);
    },
  );
  test(
    'corrupt durable recovery fails closed and is not deleted or overwritten',
    () async {
      const key = 'darb_merchant_order_v1:merchant_A';
      FlutterSecureStorage.setMockInitialValues({key: '{broken'});
      var calls = 0;
      await expectLater(
        runner((_) async {
          calls++;
          return saved();
        }).send(),
        throwsA(anything),
      );
      expect(calls, 0);
      expect(await const FlutterSecureStorage().read(key: key), '{broken');
    },
  );

  test(
    'a route order sends the route, the typed details and optional receiver',
    () async {
      Map<String, dynamic>? sent;
      final service = runner((request) async {
        final value = sent = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({
            'order': {
              'id': 'saved_order',
              'pickup_label': 'Hebron',
              'service_route_id': value['service_route_id'],
              'pickup_details': value['pickup_details'],
              'status': 'submitted',
              'created_at': '2026-10-21T00:00:00Z',
              'parcels': [
                for (final (index, parcel)
                    in (value['parcels'] as List).indexed)
                  {
                    'id': 'parcel_$index',
                    'destination_label': 'Bethlehem',
                    ...parcel as Map<String, dynamic>,
                    'status': 'pending',
                  },
              ],
            },
          }),
          201,
        );
      });
      await service.submit(
        serviceRouteId: _routeId,
        pickupDetails: '  $_pickup  ',
        parcels: [
          ..._drafts,
          const ParcelDraft(
            dropoffDetails: ' Manger Street ',
            size: 'M',
            priority: 'high',
            receiverName: '  ',
          ),
        ],
      );
      expect(sent, {
        'service_route_id': _routeId,
        'pickup_details': _pickup,
        'parcels': [
          {
            'dropoff_details': 'Near Bethlehem University main gate',
            'size': 'S',
            'priority': 'normal',
            'receiver_name': 'Sara',
            'receiver_phone': '+970599123456',
          },
          // Blank receiver fields are left out.
          {'dropoff_details': 'Manger Street', 'size': 'M', 'priority': 'high'},
        ],
      });
    },
  );

  test(
    'an order saved before routes existed is resent exactly as saved',
    () async {
      final old = MerchantPendingOrder.create(
        actorId: 'merchant_A',
        payload: _corridorPayload(),
      );
      await storage.save(old);
      // Still readable for display, as corridor places.
      final preview = PendingOrderPreview.fromPayload(
        (await storage.read('merchant_A'))!.payload,
      );
      expect(preview.legacy, isTrue);
      expect(preview.pickup, 'Bab Al-Zawiya');
      expect(preview.parcels.single.dropoff, 'Bethlehem Center');

      final posts = <http.Request>[];
      final service = runner((request) async {
        if (request.method == 'GET') return missing;
        posts.add(request);
        return http.Response(
          jsonEncode({
            'order': {
              'id': 'old_order',
              'pickup_label': 'Bab Al-Zawiya',
              'status': 'submitted',
              'created_at': '2026-10-21T00:00:00Z',
              'parcels': [
                {
                  'id': 'old_parcel',
                  ...(_corridorPayload()['parcels'] as List).single
                      as Map<String, dynamic>,
                  'status': 'pending',
                },
              ],
            },
          }),
          201,
        );
      });
      expect((await service.resume()).id, 'old_order');
      expect(posts, hasLength(1));
      expect(jsonDecode(posts.single.body), _corridorPayload());
      expect(posts.single.headers['idempotency-key'], old.idempotencyKey);
      expect(await storage.read('merchant_A'), isNull);
    },
  );

  test('a saved route order is resent as saved and shown as saved', () async {
    final pending = MerchantPendingOrder.create(
      actorId: 'merchant_A',
      payload: body,
    );
    await storage.save(pending);
    final preview = PendingOrderPreview.fromPayload(
      (await storage.read('merchant_A'))!.payload,
    );
    expect(preview.legacy, isFalse);
    expect(preview.serviceRouteId, _routeId);
    expect(preview.pickup, _pickup);
    expect(preview.parcels.single.receiverName, 'Sara');

    final posts = <http.Request>[];
    final service = runner((request) async {
      if (request.method == 'GET') return missing;
      posts.add(request);
      return saved(201);
    });
    expect((await service.resume()).id, 'saved_order');
    expect(jsonDecode(posts.single.body), body);
    expect(posts.single.headers['idempotency-key'], pending.idempotencyKey);
    expect(await storage.read('merchant_A'), isNull);
  });

  test(
    'a reply with different typed details is not taken as this order',
    () async {
      final service = runner((_) async {
        final reply = jsonDecode(saved(201).body) as Map<String, dynamic>;
        (reply['order'] as Map<String, dynamic>)['pickup_details'] = 'Other';
        return http.Response(
          jsonEncode(reply),
          201,
          headers: const {'content-type': 'application/json; charset=utf-8'},
        );
      });
      await expectLater(
        service.send(),
        throwsA(isA<MerchantOrderRecoveryException>()),
      );
      expect(await storage.read('merchant_A'), isNotNull);
    },
  );

  test('a route turned off before the first send clears the order', () async {
    final service = runner(
      (_) async => http.Response('{"error":"route_unavailable"}', 409),
    );
    await expectLater(
      service.send(),
      throwsA(
        isA<ApiException>().having(
          (error) => error.message,
          'message',
          'route_unavailable',
        ),
      ),
    );
    expect(await storage.read('merchant_A'), isNull);
  });

  test('a saved route order with unexpected fields is unreadable', () async {
    final bad = {
      ...body,
      'parcels': [
        {...(_drafts.single.toJson()), 'destination_lat': 31.7},
      ],
    };
    const key = 'darb_merchant_order_v1:merchant_A';
    FlutterSecureStorage.setMockInitialValues({
      key: jsonEncode({
        'version': 1,
        'actor_id': 'merchant_A',
        'idempotency_key': 'pending-key-0001',
        'payload': bad,
        'created_at': '2026-10-21T00:00:00Z',
      }),
    });
    await expectLater(
      storage.read('merchant_A'),
      throwsA(isA<MerchantOrderRecoveryException>()),
    );
  });
}

class _SwitchingStorage extends MerchantOrderOperationStorage {
  _SwitchingStorage(this.switchAccount) : super(const FlutterSecureStorage());
  final void Function() switchAccount;
  @override
  Future<void> save(MerchantPendingOrder operation) async {
    await super.save(operation);
    switchAccount();
  }
}

class _FailingStorage extends MerchantOrderOperationStorage {
  _FailingStorage({this.saveFailure = false})
    : super(const FlutterSecureStorage());
  final bool saveFailure;
  @override
  Future<void> save(MerchantPendingOrder operation) async {
    if (saveFailure) throw StateError('secure write failed');
    await super.save(operation);
  }

  @override
  Future<void> clear(
    MerchantPendingOrder operation, {
    void Function()? guard,
  }) async => throw StateError('secure deletion failed');
}

class _GatedDeleteStorage extends FlutterSecureStorage {
  final started = Completer<void>();
  final release = Completer<void>();
  bool failWrites = false;
  @override
  Future<void> delete({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (!started.isCompleted) started.complete();
    await release.future;
    await super.delete(
      key: key,
      iOptions: iOptions,
      aOptions: aOptions,
      lOptions: lOptions,
      webOptions: webOptions,
      mOptions: mOptions,
      wOptions: wOptions,
    );
  }

  @override
  Future<void> write({
    required String key,
    required String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (failWrites) throw StateError('secure restoration failed');
    await super.write(
      key: key,
      value: value,
      iOptions: iOptions,
      aOptions: aOptions,
      lOptions: lOptions,
      webOptions: webOptions,
      mOptions: mOptions,
      wOptions: wOptions,
    );
  }
}

class _SwitchAfterClear extends MerchantOrderOperationStorage {
  _SwitchAfterClear(this.switchAccount) : super(const FlutterSecureStorage());
  final void Function() switchAccount;
  @override
  Future<void> clear(
    MerchantPendingOrder operation, {
    void Function()? guard,
  }) async {
    await super.clear(operation, guard: guard);
    switchAccount();
  }
}
