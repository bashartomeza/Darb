import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:masari_mobile/features/matching/data/matching_models.dart';
import 'package:masari_mobile/features/merchant/application/merchant_controller.dart';
import 'package:masari_mobile/features/merchant/data/merchant_models.dart';
import 'package:masari_mobile/features/merchant/data/merchant_repository.dart';
import 'package:masari_mobile/features/trips/data/trip_models.dart';

import 'support/auth_test_support.dart';

void main() {
  test(
    'dashboard exposes latest order, batch, waiting match, and trip',
    () async {
      final fake = _FakeMerchantRepository(
        orders: [_order()],
        matches: [_match()],
        trips: [_trip()],
      );
      final container = _container(fake);
      addTearDown(container.dispose);

      final state = await container.read(merchantDashboardProvider.future);
      expect(state.latestOrder?.id, 'order_1');
      expect(state.latestBatch?.id, 'batch_1');
      expect(state.waitingMatchCount, 1);
      expect(state.activeTrip?.id, 'trip_1');
    },
  );

  test('dashboard supports empty and error states', () async {
    final fake = _FakeMerchantRepository();
    final container = _container(fake);
    addTearDown(container.dispose);

    final state = await container.read(merchantDashboardProvider.future);
    expect(state.latestOrder, isNull);
    expect(state.latestBatch, isNull);
    expect(state.activeTrip, isNull);

    fake.failLists = true;
    await expectLater(
      container.read(merchantDashboardProvider.notifier).refresh(),
      throwsStateError,
    );
    expect(container.read(merchantDashboardProvider).hasError, isTrue);
  });

  test('parcel draft enforces one minimum and ten maximum', () {
    final container = _container(_FakeMerchantRepository());
    addTearDown(container.dispose);
    final controller = container.read(merchantOrderDraftProvider.notifier);

    controller.removeParcel(0);
    expect(container.read(merchantOrderDraftProvider), hasLength(1));
    for (var index = 0; index < 12; index += 1) {
      controller.addParcel();
    }
    expect(container.read(merchantOrderDraftProvider), hasLength(10));
    expect(controller.canAdd, isFalse);
    controller.updateParcel(1, size: 'L', priority: 'high');
    expect(container.read(merchantOrderDraftProvider)[1].size, 'L');
    controller.removeParcel(1);
    expect(container.read(merchantOrderDraftProvider), hasLength(9));
  });

  test(
    'order controller batches, then matches, without driver actions',
    () async {
      final fake = _FakeMerchantRepository(
        orders: [_order(status: 'submitted', batches: const [])],
      );
      final container = _container(fake);
      addTearDown(container.dispose);
      const orderId = 'order_1';

      var state = await container.read(merchantOrderProvider(orderId).future);
      expect(state.order.canBatch, isTrue);
      expect(state.canRunMatch, isFalse);

      await container
          .read(merchantOrderProvider(orderId).notifier)
          .createBatch();
      state = container.read(merchantOrderProvider(orderId)).value!;
      expect(fake.batchCalls, 1);
      expect(state.order.latestBatch?.id, 'batch_1');
      expect(state.canRunMatch, isTrue);

      await container.read(merchantOrderProvider(orderId).notifier).runMatch();
      state = container.read(merchantOrderProvider(orderId)).value!;
      expect(fake.matchCalls, 1);
      expect(state.latestMatch?.status, 'proposed');
      expect(state.canRunMatch, isFalse);
    },
  );

  test('trip polling has one trip, order, and location timer only', () async {
    final fake = _FakeMerchantRepository(
      orders: [_order(status: 'assigned')],
      trips: [_trip()],
    );
    final container = _container(fake);
    addTearDown(container.dispose);

    await container.read(merchantTripProvider('trip_1').future);
    final controller = container.read(merchantTripProvider('trip_1').notifier);
    expect(controller.activeTimerCount, 3);
    controller.resumePolling();
    expect(controller.activeTimerCount, 3);
    controller.pausePolling();
    expect(controller.isPolling, isFalse);
    controller.resumePolling();
    expect(controller.activeTimerCount, 3);
  });
  test(
    'queued refresh cannot publish an older merchant order snapshot',
    () async {
      final fake = _FakeMerchantRepository(orders: [_order()]);
      final container = _container(fake);
      addTearDown(container.dispose);
      final subscription = container.listen(
        merchantOrderProvider('order_1'),
        (_, _) {},
      );
      addTearDown(subscription.close);
      await container.read(merchantOrderProvider('order_1').future);
      final old = Completer<MerchantOrder>();
      final fresh = Completer<MerchantOrder>();
      fake.pendingOrders.addAll([old.future, fresh.future]);
      final controller = container.read(
        merchantOrderProvider('order_1').notifier,
      );
      final first = controller.refresh();
      final second = controller.refresh();
      old.complete(_order(status: 'matched'));
      await Future<void>.delayed(Duration.zero);
      expect(
        container.read(merchantOrderProvider('order_1')).value!.order.status,
        'batched',
      );
      fresh.complete(_order(status: 'assigned'));
      await Future.wait([first, second]);
      expect(
        container.read(merchantOrderProvider('order_1')).value!.order.status,
        'assigned',
      );
    },
  );

  test(
    'refresh failure retains authoritative merchant dashboard records',
    () async {
      final fake = _FakeMerchantRepository(orders: [_order()]);
      final container = _container(fake);
      addTearDown(container.dispose);
      await container.read(merchantDashboardProvider.future);
      fake.failLists = true;
      await expectLater(
        container.read(merchantDashboardProvider.notifier).refresh(),
        throwsStateError,
      );
      expect(
        container.read(merchantDashboardProvider).value?.orders.single.id,
        'order_1',
      );
    },
  );
  test('terminal merchant orders never expose manual matching', () {
    for (final status in ['cancelled', 'expired', 'completed', 'assigned']) {
      final state = MerchantOrderViewState(
        order: _order(status: status),
        matches: const [],
        trip: null,
      );
      expect(state.canRunMatch, isFalse, reason: status);
    }
  });
  test(
    'secondary batch order retains the root match and assigned trip',
    () async {
      final batch = _batch();
      final order = MerchantOrder(
        id: 'secondary',
        pickupLabel: merchantPickupLabel,
        status: 'assigned',
        createdAt: _time,
        parcels: const [],
        batches: [batch],
      );
      final fake = _FakeMerchantRepository(
        orders: [order],
        matches: [_match(batch: batch)],
        trips: [_trip(batch: batch)],
      );
      final container = _container(fake);
      addTearDown(container.dispose);
      final state = await container.read(
        merchantOrderProvider('secondary').future,
      );
      expect(state.latestMatch?.id, 'match_1');
      expect(state.trip?.id, 'trip_1');
      expect(state.canRunMatch, isFalse);
    },
  );
}

ProviderContainer _container(_FakeMerchantRepository fake) => ProviderContainer(
  overrides: [merchantRepositoryProvider.overrideWithValue(fake)],
);

class _FakeMerchantRepository extends MerchantRepository {
  _FakeMerchantRepository({
    List<MerchantOrder>? orders,
    List<MerchantMatch>? matches,
    List<MerchantTrip>? trips,
  }) : orders = orders ?? [],
       matches = matches ?? [],
       trips = trips ?? [],
       super(
         apiClient: TestAuthenticatedClient(
           handler: (_) async => http.Response('{}', 200),
         ).client,
       );

  List<MerchantOrder> orders;
  List<MerchantMatch> matches;
  List<MerchantTrip> trips;
  bool failLists = false;
  final pendingOrders = <Future<MerchantOrder>>[];
  int batchCalls = 0;
  int matchCalls = 0;

  @override
  Future<List<MerchantOrder>> listOrders() async {
    if (failLists) throw StateError('orders failed');
    return orders;
  }

  @override
  Future<MerchantOrder> orderDetail(String id) async =>
      pendingOrders.isEmpty ? orders.first : await pendingOrders.removeAt(0);

  @override
  Future<List<MerchantMatch>> listMatches({String? status}) async {
    if (failLists) throw StateError('matches failed');
    return matches;
  }

  @override
  Future<List<MerchantTrip>> listTrips() async {
    if (failLists) throw StateError('trips failed');
    return trips;
  }

  @override
  Future<MerchantBatch> createBatch(String orderId) async {
    batchCalls += 1;
    final batch = _batch();
    orders = [
      _order(batches: [batch]),
    ];
    return batch;
  }

  @override
  Future<MerchantMatch> runMatch(String orderId) async {
    matchCalls += 1;
    final value = _match();
    matches = [value];
    return value;
  }

  @override
  Future<MerchantTrip> tripDetail(String id) async => trips.first;

  @override
  Future<TripLocation?> latestLocation(String id) async => TripLocation(
    lat: 31.65,
    lng: 35.15,
    source: 'simulated',
    sequence: 2,
    recordedAt: _time,
  );
}

final _time = DateTime.utc(2026, 7, 13, 8);

MerchantRouteSummary _route() => const MerchantRouteSummary(
  id: 'route_1',
  originLabel: 'Hebron / PPU / Bab Al-Zawiya',
  destinationLabel: 'Bethlehem',
  status: 'active',
  parcelCapacity: 5,
);

MerchantBatch _batch() => MerchantBatch(
  id: 'batch_1',
  status: 'created',
  estimatedDistanceSaved: 43.06,
  explanation: 'Three parcels share one route.',
  createdAt: _time,
  route: _route(),
);

MerchantOrder _order({
  String status = 'batched',
  List<MerchantBatch>? batches,
}) => MerchantOrder(
  id: 'order_1',
  pickupLabel: merchantPickupLabel,
  status: status,
  createdAt: _time,
  parcels: const [
    MerchantParcel(
      id: 'parcel_1',
      destinationLabel: 'Bethlehem Market',
      size: 'S',
      priority: 'normal',
      status: 'pending',
    ),
  ],
  batches: batches ?? [_batch()],
);

MerchantMatch _match({MerchantBatch? batch}) => MerchantMatch(
  id: 'match_1',
  status: 'proposed',
  score: 0.93,
  method: 'masari_route_score',
  explanation: 'Safe explanation',
  breakdown: const ScoringBreakdown(
    corridorOverlap: 0.95,
    pickupDistanceScore: 0.82,
    timingFit: 0.9,
    trustScore: 0.86,
    capacityFit: 1,
    finalScore: 0.93,
  ),
  createdAt: _time,
  route: _route(),
  order: const MerchantOrderSummary(
    id: 'order_1',
    pickupLabel: merchantPickupLabel,
    status: 'batched',
    parcelCount: 1,
  ),
  batch: batch,
);

MerchantTrip _trip({MerchantBatch? batch}) => MerchantTrip(
  id: 'trip_1',
  status: 'accepted',
  createdAt: _time,
  route: _route(),
  order: _order(status: 'assigned'),
  batch: batch,
);
