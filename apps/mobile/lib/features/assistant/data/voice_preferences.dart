import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/i18n/locale_controller.dart';

/// Passenger-adjustable voice settings for the assistant.
class VoicePreferences {
  const VoicePreferences({
    this.speakReplies = defaultSpeakReplies,
    this.speechRate = defaultSpeechRate,
    this.autoSend = defaultAutoSend,
  });

  /// Send the request as soon as the recogniser delivers the final text. Safe
  /// because a ride is only ever prefilled; the passenger still confirms it.
  final bool autoSend;

  /// Read replies aloud when the passenger spoke (never when they typed).
  final bool speakReplies;

  /// Engine speech rate, 0.0 - 1.0 where about 0.5 is a normal speaking pace.
  final double speechRate;

  /// A natural-fast default: a little quicker than the engine's normal pace.
  static const defaultSpeechRate = 0.58;
  static const minSpeechRate = 0.35;
  static const maxSpeechRate = 0.85;
  static const defaultSpeakReplies = true;
  static const defaultAutoSend = true;

  static const speakRepliesKey = 'assistant_voice_speak_replies';
  static const speechRateKey = 'assistant_voice_speech_rate';
  static const autoSendKey = 'assistant_voice_auto_send';

  static double clampRate(double rate) =>
      rate.clamp(minSpeechRate, maxSpeechRate).toDouble();

  VoicePreferences copyWith({
    bool? speakReplies,
    double? speechRate,
    bool? autoSend,
  }) => VoicePreferences(
    speakReplies: speakReplies ?? this.speakReplies,
    speechRate: clampRate(speechRate ?? this.speechRate),
    autoSend: autoSend ?? this.autoSend,
  );

  @override
  bool operator ==(Object other) =>
      other is VoicePreferences &&
      other.speakReplies == speakReplies &&
      other.speechRate == speechRate &&
      other.autoSend == autoSend;

  @override
  int get hashCode => Object.hash(speakReplies, speechRate, autoSend);
}

final voicePreferencesProvider =
    AsyncNotifierProvider<VoicePreferencesController, VoicePreferences>(
      VoicePreferencesController.new,
    );

class VoicePreferencesController extends AsyncNotifier<VoicePreferences> {
  late SharedPreferences _prefs;

  @override
  Future<VoicePreferences> build() async {
    _prefs = await ref.watch(sharedPreferencesProvider.future);
    return VoicePreferences(
      autoSend:
          _prefs.getBool(VoicePreferences.autoSendKey) ??
          VoicePreferences.defaultAutoSend,
      speakReplies:
          _prefs.getBool(VoicePreferences.speakRepliesKey) ??
          VoicePreferences.defaultSpeakReplies,
      speechRate: VoicePreferences.clampRate(
        _prefs.getDouble(VoicePreferences.speechRateKey) ??
            VoicePreferences.defaultSpeechRate,
      ),
    );
  }

  Future<void> setSpeakReplies(bool value) async {
    final current = state.value ?? const VoicePreferences();
    state = AsyncData(current.copyWith(speakReplies: value));
    await _prefs.setBool(VoicePreferences.speakRepliesKey, value);
  }

  Future<void> setAutoSend(bool value) async {
    final current = state.value ?? const VoicePreferences();
    state = AsyncData(current.copyWith(autoSend: value));
    await _prefs.setBool(VoicePreferences.autoSendKey, value);
  }

  Future<void> setSpeechRate(double value) async {
    final current = state.value ?? const VoicePreferences();
    final next = current.copyWith(speechRate: value);
    state = AsyncData(next);
    await _prefs.setDouble(VoicePreferences.speechRateKey, next.speechRate);
  }
}
