import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../auth/data/token_storage.dart';
import '../domain/passenger_assistant_models.dart';

final assistantConversationStorageProvider = Provider(
  (ref) => AssistantConversationStorage(ref.watch(secureStorageProvider)),
);

class AssistantConversationStorage {
  const AssistantConversationStorage(this.storage);
  final FlutterSecureStorage storage;
  String _key(String userId) => 'masari_assistant_conversation_v1_$userId';

  Future<PassengerAssistantState> read(String userId) async {
    final encoded = await storage.read(key: _key(userId));
    if (encoded == null) return const PassengerAssistantState();
    try {
      final json = jsonDecode(encoded) as Map<String, dynamic>;
      if (json['version'] != 1) {
        throw const FormatException('Unsupported history');
      }
      final messages = (json['messages'] as List).map((item) {
        final role = PassengerAssistantMessageRole.values.byName(
          item['role'] as String,
        );
        return PassengerAssistantMessage(
          role: role,
          text: item['text'] as String,
        );
      }).toList();
      return PassengerAssistantState(
        messages: messages,
        conversationId: json['conversation_id'] as String?,
        lastLocale: json['locale'] as String? ?? 'ar',
        savedRequestId: json['saved_request_id'] as String?,
      );
    } catch (_) {
      await storage.delete(key: _key(userId));
      return const PassengerAssistantState();
    }
  }

  Future<void> save(
    String userId,
    PassengerAssistantState state,
  ) => storage.write(
    key: _key(userId),
    value: jsonEncode({
      'version': 1,
      'conversation_id': state.conversationId,
      'locale': state.lastLocale,
      'saved_request_id': state.savedRequestId,
      'messages': state.messages
          .skip(state.messages.length > 100 ? state.messages.length - 100 : 0)
          .map((message) => {'role': message.role.name, 'text': message.text})
          .toList(),
    }),
  );
}
