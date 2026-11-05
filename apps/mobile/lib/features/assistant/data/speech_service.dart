import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;

/// Outcome of preparing the on-device recogniser.
enum SpeechAvailability {
  available,
  permissionDenied,
  permanentlyDenied,
  unavailable,
}

/// Failures reported while listening.
enum SpeechFailure { noSpeech, offline, permission, unavailable, other }

/// Thin seam over the platform speech recogniser so UI tests can fake it.
abstract class SpeechService {
  Future<SpeechAvailability> initialize();

  /// Locale ids the recogniser supports (e.g. `ar_PS`, `en_US`).
  Future<List<String>> locales();

  Future<void> start({
    required String? localeId,
    required void Function(String text, bool isFinal) onResult,
    required void Function(SpeechFailure failure) onFailure,
    required void Function() onDone,
  });

  Future<void> stop();
  Future<void> cancel();
  Future<void> openSettings();
}

/// Picks the best recogniser locale for the app language.
/// Arabic prefers ar-PS then any `ar`; English prefers en-US then any `en`.
String? pickSpeechLocale(String languageCode, List<String> available) {
  String norm(String v) => v.replaceAll('-', '_').toLowerCase();
  final byNorm = {for (final id in available) norm(id): id};
  final preferred = languageCode == 'ar' ? ['ar_ps', 'ar'] : ['en_us', 'en'];
  for (final p in preferred) {
    if (byNorm.containsKey(p)) return byNorm[p];
  }
  for (final entry in byNorm.entries) {
    if (entry.key.startsWith('${languageCode}_')) return entry.value;
  }
  return null;
}

/// How long silence ends an utterance. The platform default (and the old 3 s)
/// made every voice turn wait for a pause; 1.4 s still tolerates a breath
/// between a village name and the time.
const speechPauseFor = Duration(milliseconds: 1400);

class PlatformSpeechService implements SpeechService {
  PlatformSpeechService([stt.SpeechToText? engine])
    : _engine = engine ?? stt.SpeechToText();

  final stt.SpeechToText _engine;
  bool _ready = false;
  bool _permanent = false;
  List<String>? _localeCache;
  void Function(SpeechFailure)? _onFailure;
  void Function()? _onDone;

  @override
  Future<SpeechAvailability> initialize() async {
    // Initialising the recogniser costs a platform round trip; once it is
    // ready it stays ready, so the next mic tap starts listening at once.
    if (_ready) return SpeechAvailability.available;
    _permanent = false;
    try {
      _ready = await _engine.initialize(
        onError: (e) {
          final msg = e.errorMsg;
          if (msg == 'error_permission') _permanent = true;
          _onFailure?.call(_map(msg));
        },
        onStatus: (s) {
          if (s == 'done' || s == 'notListening') _onDone?.call();
        },
      );
    } catch (_) {
      _ready = false;
    }
    if (_ready) return SpeechAvailability.available;
    if (_permanent) return SpeechAvailability.permanentlyDenied;
    if (!await _engine.hasPermission) {
      return SpeechAvailability.permissionDenied;
    }
    return SpeechAvailability.unavailable;
  }

  SpeechFailure _map(String msg) {
    switch (msg) {
      case 'error_no_match':
      case 'error_speech_timeout':
        return SpeechFailure.noSpeech;
      case 'error_network':
      case 'error_network_timeout':
      case 'error_server':
        return SpeechFailure.offline;
      case 'error_permission':
        return SpeechFailure.permission;
      case 'error_language_not_supported':
      case 'error_language_unavailable':
      case 'error_recognizer_busy':
        return SpeechFailure.unavailable;
      default:
        return SpeechFailure.other;
    }
  }

  @override
  Future<List<String>> locales() async {
    if (!_ready) return const [];
    return _localeCache ??= [
      for (final l in await _engine.locales()) l.localeId,
    ];
  }

  @override
  Future<void> start({
    required String? localeId,
    required void Function(String text, bool isFinal) onResult,
    required void Function(SpeechFailure failure) onFailure,
    required void Function() onDone,
  }) async {
    _onFailure = onFailure;
    _onDone = onDone;
    await _engine.listen(
      listenOptions: stt.SpeechListenOptions(
        localeId: localeId,
        pauseFor: speechPauseFor,
        listenFor: const Duration(seconds: 30),
        partialResults: true,
        cancelOnError: true,
        listenMode: stt.ListenMode.dictation,
      ),
      onResult: (r) => onResult(r.recognizedWords, r.finalResult),
    );
  }

  @override
  Future<void> stop() => _engine.stop();

  @override
  Future<void> cancel() => _engine.cancel();

  @override
  Future<void> openSettings() => Geolocator.openAppSettings();
}

final speechServiceProvider = Provider<SpeechService>(
  (ref) => PlatformSpeechService(),
);
