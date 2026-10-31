import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/core/api/api_error.dart';
import 'package:masari_mobile/features/auth/application/auth_actor_binding.dart';
import 'package:masari_mobile/features/merchant/application/merchant_order_submission.dart';
import 'package:masari_mobile/features/merchant/data/merchant_models.dart';
import 'package:masari_mobile/features/merchant/data/merchant_order_operation_storage.dart';
import 'package:masari_mobile/features/merchant/data/merchant_repository.dart';

import 'support/auth_test_support.dart';

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
  const drafts = [ParcelDraft()];
  final body = MerchantRepository.createOrderBody(drafts);
  http.Response saved([int status = 200]) => http.Response(
    jsonEncode({
      'order': {
        'id': 'saved_order',
        'pickup_label': 'Hebron Merchant Pickup',
        'status': 'submitted',
        'created_at': '2026-10-21T00:00:00Z',
        'parcels': [
          {
            'id': 'saved_parcel',
            ...drafts.single.toJson(),
            'status': 'pending',
          },
        ],
      },
    }),
    status,
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
      await expectLater(first.submit(drafts), throwsA(isA<ApiException>()));
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
      await expectLater(service.submit(drafts), throwsA(isA<ApiException>()));
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
    await expectLater(service.submit(drafts), throwsA(isA<ApiException>()));
    final original = await storage.read('merchant_A');
    await expectLater(
      service.submit(const [ParcelDraft(size: 'L')]),
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
        await expectLater(service.submit(drafts), throwsA(anything));
        expect(await storage.read('merchant_A'), isNotNull);
        FlutterSecureStorage.setMockInitialValues({});
      }
    },
  );

  test(
    'a confirmed first-attempt validation rejection clears pending but a reconciliation rejection does not',
    () async {
      final invalid = http.Response('{"error":"validation_error"}', 400);
      await expectLater(
        runner((_) async => invalid).submit(drafts),
        throwsA(isA<ApiException>()),
      );
      expect(await storage.read('merchant_A'), isNull);
      final service = runner(
        (request) async => request.method == 'GET' ? missing : invalid,
      );
      await storage.save(
        MerchantPendingOrder.create(actorId: 'merchant_A', payload: body),
      );
      await expectLater(service.resume(), throwsA(isA<ApiException>()));
      expect(await storage.read('merchant_A'), isNotNull);
    },
  );

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
      final first = service.submit(drafts);
      await started.future;
      await expectLater(
        service.submit(drafts),
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
      final future = service.submit(drafts);
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
        }, store: switching).submit(drafts),
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
    'expired or future-dated recovery does only a lookup, never a POST or key replacement',
    () async {
      final now = DateTime.utc(2026, 10, 21);
      for (final created in [
        now.subtract(const Duration(days: 7)),
        now.add(const Duration(minutes: 6)),
      ]) {
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
        }, store: _FailingStorage(saveFailure: true)).submit(drafts),
        throwsA(anything),
      );
      expect(sends, 0);
      await expectLater(
        runner(
          (_) async => saved(201),
          store: _FailingStorage(),
        ).submit(drafts),
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
      final future = service.submit(drafts);
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
      final future = service.submit(drafts);
      await secure.started.future;
      binding.clear();
      binding.bind('merchant_A');
      secure.failWrites = true;
      secure.release.complete();
      await expectLater(future, throwsA(isA<MerchantOrderRecoveryException>()));
      await expectLater(
        service.submit(drafts),
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
        service.submit(drafts),
        throwsA(isA<MerchantOrderRecoveryException>()),
      );
      expect(await storage.read('merchant_A'), isNotNull);
    },
  );
  test(
    'corrupt durable recovery fails closed and is not deleted or overwritten',
    () async {
      const key = 'masari_merchant_order_v1:merchant_A';
      FlutterSecureStorage.setMockInitialValues({key: '{broken'});
      var calls = 0;
      await expectLater(
        runner((_) async {
          calls++;
          return saved();
        }).submit(drafts),
        throwsA(anything),
      );
      expect(calls, 0);
      expect(await const FlutterSecureStorage().read(key: key), '{broken');
    },
  );
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
