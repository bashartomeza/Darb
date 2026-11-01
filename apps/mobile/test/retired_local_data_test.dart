import 'package:darb_mobile/core/storage/retired_local_data.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('removes retired device copies and keeps live entries', () async {
    FlutterSecureStorage.setMockInitialValues({
      'darb_assistant_conversation_v1_user_1': '{"messages":[]}',
      'darb_request_selection_v1_dXNlcg==_cmVx': '{"route":"r1"}',
      'masari_jwt': 'old',
      'masari_locale': 'ar',
      'darb_auth_bundle_v1': '{"version":1}',
      'darb_legacy_passenger_create_v1': '{"key":"k"}',
    });
    const storage = FlutterSecureStorage();

    await purgeRetiredLocalData(storage);

    expect((await storage.readAll()).keys.toSet(), {
      'darb_auth_bundle_v1',
      'darb_legacy_passenger_create_v1',
    });
  });
}
