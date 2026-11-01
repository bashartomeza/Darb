import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Secure-storage entries that older builds wrote and this build no longer
/// reads, because the data now lives in the database: assistant chats, the
/// driver route a passenger picked, and everything written under the old
/// "masari_" names before the rename.
const retiredSecureStoragePrefixes = <String>[
  'darb_assistant_conversation_v1_',
  'darb_request_selection_v1_',
  'masari_',
];

/// Deletes [retiredSecureStoragePrefixes] entries left on this device. Best
/// effort: a storage error never blocks start-up, and it runs again next time.
Future<void> purgeRetiredLocalData(FlutterSecureStorage storage) async {
  try {
    // A copy: some platforms hand back their live map.
    final keys = (await storage.readAll()).keys.toList();
    for (final key in keys) {
      if (retiredSecureStoragePrefixes.any(key.startsWith)) {
        await storage.delete(key: key);
      }
    }
  } catch (_) {
    // Nothing to clean, or storage unavailable; retried on the next start.
  }
}
