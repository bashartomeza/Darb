import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/data/authenticated_api_client.dart';
import '../domain/limited_checkpoint_directory.dart';

final limitedCheckpointDirectoryRepositoryProvider = Provider(
  (ref) => LimitedCheckpointDirectoryRepository(
    ref.watch(authenticatedApiClientProvider),
  ),
);

class LimitedCheckpointDirectoryRepository {
  const LimitedCheckpointDirectoryRepository(this.client);
  final AuthenticatedApiClient client;
  Future<bool> available(void Function() current) async {
    final json = await client.getJson(
      '/capabilities?include=limited-checkpoint-directory',
      beforeSend: current,
    );
    current();
    final value = json['limited_checkpoint_directory_available'];
    if (value != null && value is! bool) {
      throw const FormatException('Invalid limited capability');
    }
    return value == true;
  }

  Future<LimitedCheckpointDirectory> read(void Function() current) async {
    final json = await client.getJson(
      '/limited-checkpoint-directory',
      beforeSend: current,
    );
    current();
    return LimitedCheckpointDirectory.fromJson(json);
  }
}
