import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/core/theme/app_theme.dart';
import 'package:darb_mobile/features/assistant/data/passenger_assistant_repository.dart';
import 'package:darb_mobile/features/assistant/data/speech_service.dart';
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

class _Repo implements PassengerAssistantRepository {
  final asked = <String>[];
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

Widget _app(_FakeSpeech speech, _Repo repo, {String lang = 'ar'}) =>
    ProviderScope(
      overrides: [
        speechServiceProvider.overrideWithValue(speech),
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
  test('pickSpeechLocale prefers ar-PS, then ar, and en-US', () {
    expect(pickSpeechLocale('ar', ['ar_SA', 'ar-PS', 'en_US']), 'ar-PS');
    expect(pickSpeechLocale('ar', ['ar', 'ar_SA']), 'ar');
    expect(pickSpeechLocale('ar', ['ar_SA']), 'ar_SA');
    expect(pickSpeechLocale('en', ['en_GB', 'en_US']), 'en_US');
    expect(pickSpeechLocale('en', ['ar_SA']), isNull);
  });

  testWidgets('listening fills the field with live text, then sends normally', (
    tester,
  ) async {
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
    expect(repo.asked, isEmpty, reason: 'voice must never auto-send');

    await tester.tap(find.byKey(const ValueKey('assistantSendButton')));
    await tester.pumpAndSettle();
    expect(repo.asked, ['بدي أروح من بيت لحم لرام الله بكرا']);
    expect(_text(tester), isEmpty);
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
