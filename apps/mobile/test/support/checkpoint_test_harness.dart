import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:masari_mobile/core/api/api_client.dart';
import 'package:masari_mobile/core/config/app_config.dart';
import 'package:masari_mobile/features/auth/application/auth_controller.dart';
import 'package:masari_mobile/features/auth/data/session_coordinator.dart';
import 'package:masari_mobile/features/auth/data/token_storage.dart';
import 'package:masari_mobile/features/checkpoints/application/checkpoint_controller.dart';
import 'package:masari_mobile/features/checkpoints/domain/checkpoint_models.dart';

import '../test_app_config.dart';
import 'auth_test_support.dart';

/// Real authentication, coordinator, repository and notifier; only HTTP and
/// credential storage are synthetic. This never contacts a provider or GPS.
class CheckpointTestHarness {
  CheckpointTestHarness({
    ProviderContainer Function(CheckpointTestHarness)? containerFactory,
    MemoryTokenStorage? tokenStorage,
  }) : storage = tokenStorage ?? MemoryTokenStorage() {
    FlutterSecureStorage.setMockInitialValues({});
    transport = MockClient(_handle);
    container =
        containerFactory?.call(this) ?? ProviderContainer(overrides: overrides);
  }

  final MemoryTokenStorage storage;
  late final MockClient transport;
  late final ProviderContainer container;
  DateTime now = DateTime.now().toUtc();
  String role = 'passenger';
  String actor = 'actor-a';
  int signIns = 0;
  int reads = 0;
  final requests = <http.Request>[];
  final values = <AsyncValue<CheckpointSnapshot>>[];
  final _delays = <Completer<http.Response>>[];
  ProviderSubscription<AsyncValue<CheckpointSnapshot>>? _subscription;
  Future<http.Response> Function(http.Request)? checkpointHandler;
  Future<http.Response> Function(http.Request)? refreshHandler;
  Future<http.Response> Function(http.Request)? extraHandler;

  List<Override> get overrides => [
    appConfigProvider.overrideWithValue(demoTestAppConfig),
    httpClientProvider.overrideWithValue(transport),
    tokenStorageProvider.overrideWithValue(storage),
    authSessionCoordinatorProvider.overrideWith(
      (ref) => AuthSessionCoordinator(
        apiClient: ref.watch(apiClientProvider),
        tokenStorage: ref.watch(tokenStorageProvider),
        now: () => now,
      ),
    ),
  ];

  Future<http.Response> _handle(http.Request request) async {
    requests.add(request);
    if (request.url.path.endsWith('/auth/mobile/login')) {
      final json = jsonDecode(request.body) as Map<String, dynamic>;
      actor = (json['email'] as String).split('@').first;
      signIns++;
      return response(authBody());
    }
    if (request.url.path.endsWith('/me')) return response({'user': user});
    if (request.url.path.endsWith('/auth/refresh')) {
      return refreshHandler?.call(request) ?? response(authBody());
    }
    if (request.url.path.endsWith('/checkpoints')) {
      reads++;
      return checkpointHandler?.call(request) ?? snapshot(actor);
    }
    if (request.url.path.endsWith('/auth/logout') ||
        request.url.path.endsWith('/auth/logout-all')) {
      return response({'ok': true});
    }
    return extraHandler?.call(request) ??
        response({'error': 'unexpected_synthetic_endpoint'}, 404);
  }

  Map<String, dynamic> get user => {
    'id': actor,
    'name': actor,
    'role': role,
    'demo_account': false,
    'phone': '+970590000001',
    'profile_state': 'complete',
  };
  Map<String, dynamic> authBody() => {
    'access_token': 'synthetic-access-$actor-$signIns',
    'access_token_expires_in': 3600,
    'refresh_token': 'synthetic-refresh-$actor-$signIns',
    'refresh_token_expires_in': 7200,
    'session': {
      'id': 'synthetic-session-$actor-$signIns',
      'client_type': 'mobile',
      'created_at': '2026-10-23T00:00:00Z',
      'last_used_at': '2026-10-23T00:00:00Z',
      'expires_at': '2099-10-23T00:00:00Z',
      'is_current': true,
      'revoked': false,
    },
    'user': user,
  };

  static http.Response response(Object body, [int status = 200]) =>
      http.Response(
        jsonEncode(body),
        status,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
  static http.Response snapshot(
    String id, {
    String? nameAr,
    String? nameEn,
    bool stale = false,
  }) => response({
    'checkpoints': [
      {
        'id': id,
        'name_ar': nameAr,
        'name_en': nameEn ?? id,
        'latitude': 31.7,
        'longitude': 35.2,
        'status': 'closed',
        'city': 'Synthetic city',
        'updated_at': '2026-10-23T00:00:00Z',
      },
    ],
    'fetched_at': '2026-10-23T00:01:00Z',
    'stale': stale,
  });

  Future<void> login([String id = 'actor-a']) async {
    await container.read(authControllerProvider.future);
    await container
        .read(authControllerProvider.notifier)
        .login(email: '$id@example.test', password: 'synthetic-password-only');
    await flush();
  }

  void watch() {
    _subscription ??= container.listen(
      checkpointsProvider,
      (_, next) => values.add(next),
      fireImmediately: true,
    );
  }

  void stopWatching() {
    _subscription?.close();
    _subscription = null;
  }

  Future<CheckpointSnapshot> load() {
    watch();
    return container.read(checkpointsProvider.future);
  }

  Future<void> refresh() =>
      container.read(checkpointsProvider.notifier).refresh();
  AsyncValue<CheckpointSnapshot> get state =>
      container.read(checkpointsProvider);
  List<String> get ids =>
      state.value?.checkpoints.map((row) => row.id).toList() ?? [];
  Completer<http.Response> delay() {
    final value = Completer<http.Response>();
    _delays.add(value);
    return value;
  }

  static Future<void> flush() async {
    for (var i = 0; i < 5; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  void dispose() {
    _subscription?.close();
    container.dispose();
    for (final delay in _delays) {
      if (!delay.isCompleted) {
        delay.complete(response({'error': 'synthetic_cleanup'}, 503));
      }
    }
    transport.close();
  }
}
