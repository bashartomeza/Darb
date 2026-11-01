import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:darb_mobile/features/assistant/data/assistant_conversation_storage.dart';
import 'package:darb_mobile/features/assistant/domain/passenger_assistant_models.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test(
    'restores messages after reopening storage and isolates accounts',
    () async {
      const storage = AssistantConversationStorage(FlutterSecureStorage());
      await storage.save(
        'passenger_1',
        const PassengerAssistantState(
          phase: PassengerAssistantPhase.processing,
          conversationId: 'conversation_1',
          lastLocale: 'ar',
          messages: [
            PassengerAssistantMessage.passenger('رحلة إلى بيت لحم'),
            PassengerAssistantMessage.assistant('ما موعد الرحلة؟'),
          ],
        ),
      );
      const reopened = AssistantConversationStorage(FlutterSecureStorage());
      final restored = await reopened.read('passenger_1');
      expect(restored.messages.map((message) => message.text), [
        'رحلة إلى بيت لحم',
        'ما موعد الرحلة؟',
      ]);
      expect(restored.conversationId, 'conversation_1');
      expect(restored.phase, PassengerAssistantPhase.ready);
      expect((await reopened.read('passenger_2')).messages, isEmpty);
    },
  );

  test(
    'a corrupted saved conversation does not prevent opening the assistant',
    () async {
      const secure = FlutterSecureStorage();
      await secure.write(
        key: 'masari_assistant_conversation_v1_passenger_1',
        value: 'invalid',
      );
      expect(
        (await const AssistantConversationStorage(
          secure,
        ).read('passenger_1')).messages,
        isEmpty,
      );
    },
  );
}
