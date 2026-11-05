import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:darb_mobile/core/theme/app_theme.dart';
import 'package:darb_mobile/features/assistant/data/passenger_assistant_repository.dart';
import 'package:darb_mobile/features/assistant/data/speech_service.dart';
import 'package:darb_mobile/features/assistant/data/tts_service.dart';
import 'package:darb_mobile/features/assistant/data/voice_preferences.dart';
import 'package:darb_mobile/features/assistant/domain/passenger_assistant_models.dart';
import 'package:darb_mobile/features/assistant/presentation/passenger_assistant_screen.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

class _FakeSpeech implements SpeechService {
  SpeechAvailability availability = SpeechAvailability.available;
  List<String> localeIds = ['en_US', 'ar_SA', 'ar_PS'];
  String? startedLocale;
  void Function(String, bool)? onResult;
  void Function(SpeechFailure)? onFailure;
  var settingsOpened = 0;
  var stopped = 0;

  @override
  Future<SpeechAvailability> initialize() async => availability;
  @override
  Future<List<String>> locales() async => localeIds;
  @override
  Future<void> start({
    required String? localeId,
    required void Function(String text, bool isFinal) onResult,
    required void Function(SpeechFailure failure) onFailure,
    required void Function() onDone,
  }) async {
    startedLocale = localeId;
    this.onResult = onResult;
    this.onFailure = onFailure;
  }

  @override
  Future<void> stop() async => stopped++;
  @override
  Future<void> cancel() async {}
  @override
  Future<void> openSettings() async => settingsOpened++;
}

class _FakeTts implements TtsService {
  final spoken = <String>[];
  final rates = <double>[];
  var stops = 0;
  var prepared = 0;
  @override
  final ValueNotifier<bool> speaking = ValueNotifier(false);
  @override
  Future<void> prepare(String languageCode) async => prepared++;
  @override
  Future<void> speak(
    String text, {
    required String languageCode,
    required double rate,
  }) async {
    spoken.add(text);
    rates.add(rate);
  }

  @override
  Future<void> stop() async => stops++;
}

class _Repo implements PassengerAssistantRepository {
  final asked = <String>[];
  @override
  Future<PassengerAssistantState> loadConversation() async =>
      const PassengerAssistantState();
  @override
  Future<void> clearConversation() async {}
  @override
  Future<void> linkSavedRequest({
    required String conversationId,
    required String requestId,
  }) async {}
  @override
  Future<PassengerAssistantReply> ask({
    required String message,
    required String locale,
    required List<PassengerAssistantMessage> history,
    String? conversationId,
  }) async {
    asked.add(message);
    return const PassengerAssistantReply(
      type: PassengerAssistantReplyType.clarification,
      message: 'أي يوم تقصد؟',
      conversationId: 'c1',
    );
  }

  @override
  Future<List<PassengerAssistantTripOption>> searchTrips(
    PassengerAssistantTripDraft draft,
  ) async => const [];
  @override
  Future<String> selectTrip({
    required PassengerAssistantTripDraft draft,
    required PassengerAssistantTripOption option,
  }) async => 'm';
}

Widget _app(
  _FakeSpeech speech,
  _Repo repo, {
  String lang = 'ar',
  _FakeTts? tts,
}) => ProviderScope(
  overrides: [
    speechServiceProvider.overrideWithValue(speech),
    ttsServiceProvider.overrideWithValue(tts ?? _FakeTts()),
    passengerAssistantRepositoryProvider.overrideWithValue(repo),
  ],
  child: MaterialApp(
    locale: Locale(lang),
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    theme: AppTheme.light,
    home: const PassengerAssistantScreen(),
  ),
);

String _text(WidgetTester t) => t
    .widget<TextField>(find.byKey(const ValueKey('assistantTextInput')))
    .controller!
    .text;

const _mic = ValueKey('assistantMicButton');
const _listening = ValueKey('assistantVoiceListening');

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('pickSpeechLocale prefers ar-PS, then ar, and en-US', () {
    expect(pickSpeechLocale('ar', ['ar_SA', 'ar-PS', 'en_US']), 'ar-PS');
    expect(pickSpeechLocale('ar', ['ar', 'ar_SA']), 'ar');
    expect(pickSpeechLocale('ar', ['ar_SA']), 'ar_SA');
    expect(pickSpeechLocale('en', ['en_GB', 'en_US']), 'en_US');
    expect(pickSpeechLocale('en', ['ar_SA']), isNull);
  });

  testWidgets('with auto-send off, the final text waits for the send button', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({
      VoicePreferences.autoSendKey: false,
    });
    final speech = _FakeSpeech();
    final repo = _Repo();
    await tester.pumpWidget(_app(speech, repo));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(_mic));
    await tester.pumpAndSettle();
    expect(find.byKey(_listening), findsOneWidget);
    expect(speech.startedLocale, 'ar_PS');

    speech.onResult!('بدي أروح من بيت لحم', false);
    await tester.pump();
    expect(_text(tester), 'بدي أروح من بيت لحم');
    speech.onResult!('بدي أروح من بيت لحم لرام الله بكرا', true);
    await tester.pump();
    expect(_text(tester), 'بدي أروح من بيت لحم لرام الله بكرا');
    expect(repo.asked, isEmpty, reason: 'auto-send is off');

    await tester.tap(find.byKey(const ValueKey('assistantSendButton')));
    await tester.pumpAndSettle();
    expect(repo.asked, ['بدي أروح من بيت لحم لرام الله بكرا']);
    expect(_text(tester), isEmpty);
  });

  testWidgets('a spoken request is sent at once and its reply is read aloud', (
    tester,
  ) async {
    final speech = _FakeSpeech();
    final repo = _Repo();
    final tts = _FakeTts();
    await tester.pumpWidget(_app(speech, repo, tts: tts));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_mic));
    await tester.pumpAndSettle();
    expect(
      tts.stops,
      greaterThan(0),
      reason: 'barge-in silences the assistant',
    );
    expect(tts.prepared, greaterThan(0));

    speech.onResult!('بدي أروح من الخليل', true);
    await tester.pumpAndSettle();
    expect(repo.asked, ['بدي أروح من الخليل']);
    expect(tts.spoken, ['أي يوم تقصد؟']);
    expect(tts.rates.single, VoicePreferences.defaultSpeechRate);
    expect(tts.rates.single, greaterThan(0.5), reason: 'natural-fast default');
  });

  testWidgets('a typed request is never read aloud', (tester) async {
    final speech = _FakeSpeech();
    final repo = _Repo();
    final tts = _FakeTts();
    await tester.pumpWidget(_app(speech, repo, tts: tts));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('assistantTextInput')),
      'مرحبا',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('assistantSendButton')));
    await tester.pumpAndSettle();
    expect(repo.asked, ['مرحبا']);
    expect(tts.spoken, isEmpty);
  });

  testWidgets('replies stay silent when reading aloud is switched off', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({
      VoicePreferences.speakRepliesKey: false,
    });
    final speech = _FakeSpeech();
    final tts = _FakeTts();
    await tester.pumpWidget(_app(speech, _Repo(), tts: tts));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_mic));
    await tester.pumpAndSettle();
    speech.onResult!('بدي أروح من الخليل', true);
    await tester.pumpAndSettle();
    expect(tts.spoken, isEmpty);
  });

  testWidgets('voice settings change the saved switches', (tester) async {
    final tts = _FakeTts();
    await tester.pumpWidget(_app(_FakeSpeech(), _Repo(), tts: tts));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('assistantVoiceTune')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('assistantVoiceSpeakSwitch')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('assistantVoiceAutoSendSwitch')),
    );
    await tester.pumpAndSettle();
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool(VoicePreferences.speakRepliesKey), isFalse);
    expect(prefs.getBool(VoicePreferences.autoSendKey), isFalse);
  });

  testWidgets('the stop button appears while speaking and silences it', (
    tester,
  ) async {
    final tts = _FakeTts();
    await tester.pumpWidget(_app(_FakeSpeech(), _Repo(), tts: tts));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('assistantStopSpeaking')), findsNothing);
    tts.speaking.value = true;
    await tester.pump();
    final before = tts.stops;
    await tester.tap(find.byKey(const ValueKey('assistantStopSpeaking')));
    await tester.pump();
    expect(tts.stops, before + 1);
  });

  test('preferences clamp the rate and spokenVersion keeps replies short', () {
    expect(VoicePreferences.clampRate(5), VoicePreferences.maxSpeechRate);
    expect(VoicePreferences.clampRate(0), VoicePreferences.minSpeechRate);
    expect(speechPauseFor, lessThan(const Duration(seconds: 2)));
    final long = 'راجع المعلومات ثم أكّد لبدء البحث. ${'جملة طويلة. ' * 20}';
    final spoken = spokenVersion(long);
    expect(spoken.startsWith('راجع المعلومات ثم أكّد لبدء البحث.'), isTrue);
    expect(spoken.length, lessThanOrEqualTo(220));
    expect(spokenVersion('**ok** `x` «hi»'), 'ok x hi');
    expect(spokenVersion('   '), isEmpty);
  });

  testWidgets('tapping the mic while listening stops it', (tester) async {
    final speech = _FakeSpeech();
    await tester.pumpWidget(_app(speech, _Repo(), lang: 'en'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_mic));
    await tester.pumpAndSettle();
    expect(speech.startedLocale, 'en_US');
    await tester.tap(find.byKey(_mic));
    await tester.pumpAndSettle();
    expect(speech.stopped, 1);
    expect(find.byKey(_listening), findsNothing);
  });

  testWidgets('permission denied shows guidance and text input still works', (
    tester,
  ) async {
    final speech = _FakeSpeech()
      ..availability = SpeechAvailability.permissionDenied;
    final repo = _Repo();
    await tester.pumpWidget(_app(speech, repo));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_mic));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('assistantVoiceError')), findsOneWidget);
    expect(find.byKey(const ValueKey('assistantVoiceSettings')), findsNothing);

    await tester.enterText(
      find.byKey(const ValueKey('assistantTextInput')),
      'مرحبا',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('assistantSendButton')));
    await tester.pumpAndSettle();
    expect(repo.asked, ['مرحبا']);
  });

  testWidgets('permanently denied offers to open settings', (tester) async {
    final speech = _FakeSpeech()
      ..availability = SpeechAvailability.permanentlyDenied;
    await tester.pumpWidget(_app(speech, _Repo()));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_mic));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('assistantVoiceSettings')));
    expect(speech.settingsOpened, 1);
  });

  testWidgets('unavailable recogniser and no-speech failures are explained', (
    tester,
  ) async {
    final speech = _FakeSpeech()..availability = SpeechAvailability.unavailable;
    await tester.pumpWidget(_app(speech, _Repo(), lang: 'en'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_mic));
    await tester.pumpAndSettle();
    expect(find.textContaining('isn’t available'), findsOneWidget);

    speech.availability = SpeechAvailability.available;
    await tester.tap(find.byKey(_mic));
    await tester.pumpAndSettle();
    speech.onFailure!(SpeechFailure.noSpeech);
    await tester.pump();
    expect(find.textContaining('didn’t catch'), findsOneWidget);
    expect(find.byKey(_listening), findsNothing);
  });
}
