import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_tts/flutter_tts.dart';

/// Thin seam over the platform text-to-speech engine so UI tests can fake it.
abstract class TtsService {
  /// True while a reply is being read aloud (drives the stop button).
  ValueListenable<bool> get speaking;

  /// Warms the engine up (binds the service, sets the language) before the
  /// first reply, so speaking starts without the engine's cold-start delay.
  Future<void> prepare(String languageCode);

  /// Starts speaking at once, replacing anything still being spoken.
  Future<void> speak(
    String text, {
    required String languageCode,
    required double rate,
  });

  /// Stops speaking now (barge-in, new question, leaving the screen).
  Future<void> stop();
}

const _maxSpokenCharacters = 220;
const _maxSpokenSentences = 2;

/// What is read aloud for a written reply: markup and symbols dropped, only
/// the first sentences, so speech starts fast and ends quickly. The full text
/// stays on screen.
String spokenVersion(String text) {
  var clean = text
      .replaceAll(RegExp(r'[*_`#>]+'), ' ')
      .replaceAll(RegExp(r'[«»"“”]'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  if (clean.isEmpty) return '';
  final sentences = RegExp(r'[^.!?؟۔\n]+[.!?؟۔]?')
      .allMatches(clean)
      .map((m) => m.group(0)!.trim())
      .where((s) => s.isNotEmpty)
      .toList();
  final buffer = StringBuffer();
  var count = 0;
  for (final sentence in sentences) {
    if (count >= _maxSpokenSentences) break;
    if (buffer.isNotEmpty &&
        buffer.length + sentence.length + 1 > _maxSpokenCharacters) {
      break;
    }
    if (buffer.isNotEmpty) buffer.write(' ');
    buffer.write(sentence);
    count++;
  }
  clean = buffer.toString();
  if (clean.length > _maxSpokenCharacters) {
    final cut = clean.lastIndexOf(' ', _maxSpokenCharacters);
    clean = clean.substring(0, cut > 40 ? cut : _maxSpokenCharacters);
  }
  return clean.trim();
}

class PlatformTtsService implements TtsService {
  PlatformTtsService([FlutterTts? engine]) : _engine = engine ?? FlutterTts();

  final FlutterTts _engine;
  final _speaking = ValueNotifier<bool>(false);
  String? _language;
  double? _rate;
  bool _configured = false;

  @override
  ValueListenable<bool> get speaking => _speaking;

  Future<void> _configure(String languageCode, double? rate) async {
    try {
      if (!_configured) {
        _configured = true;
        // Return only when the engine is bound, so the first reply is not lost.
        await _engine.awaitSpeakCompletion(false);
        _engine.setStartHandler(() => _speaking.value = true);
        _engine.setCompletionHandler(() => _speaking.value = false);
        _engine.setCancelHandler(() => _speaking.value = false);
        _engine.setErrorHandler((_) => _speaking.value = false);
        await _engine.setVolume(1.0);
        await _engine.setPitch(1.0);
      }
      final language = languageCode == 'ar' ? 'ar' : 'en-US';
      if (_language != language) {
        _language = language;
        await _engine.setLanguage(language);
      }
      if (rate != null && _rate != rate) {
        _rate = rate;
        await _engine.setSpeechRate(rate);
      }
    } catch (_) {
      // Missing voice data must never break the chat; speaking just no-ops.
    }
  }

  @override
  Future<void> prepare(String languageCode) => _configure(languageCode, null);

  @override
  Future<void> speak(
    String text, {
    required String languageCode,
    required double rate,
  }) async {
    final spoken = spokenVersion(text);
    if (spoken.isEmpty) return;
    await _configure(languageCode, rate);
    try {
      await _engine.stop();
      await _engine.speak(spoken);
    } catch (_) {}
  }

  @override
  Future<void> stop() async {
    _speaking.value = false;
    try {
      await _engine.stop();
    } catch (_) {}
  }
}

final ttsServiceProvider = Provider<TtsService>((ref) {
  final service = PlatformTtsService();
  ref.onDispose(service.stop);
  return service;
});
