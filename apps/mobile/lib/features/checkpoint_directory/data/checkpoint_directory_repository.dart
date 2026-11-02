import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/data/authenticated_api_client.dart';
import '../domain/checkpoint_directory.dart';

final checkpointDirectoryRepositoryProvider = Provider(
  (ref) =>
      CheckpointDirectoryRepository(ref.watch(authenticatedApiClientProvider)),
);

class CheckpointDirectoryRepository {
  const CheckpointDirectoryRepository(this.client);
  final AuthenticatedApiClient client;
  Future<bool> available(void Function() requireCurrent) async {
    final json = await client.getJson(
      '/capabilities?include=checkpoint-directory',
      beforeSend: requireCurrent,
    );
    requireCurrent();
    final value = json['checkpoint_directory_available'];
    if (value != null && value is! bool) {
      throw const FormatException('Invalid directory capability');
    }
    return value == true;
  }

  Future<CheckpointDirectory> read(void Function() requireCurrent) async {
    final json = await client.getJson(
      '/checkpoint-directory',
      beforeSend: requireCurrent,
    );
    requireCurrent();
    return CheckpointDirectory.fromJson(json);
  }
}
