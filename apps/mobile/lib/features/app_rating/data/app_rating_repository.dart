import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';

final appRatingRepositoryProvider = Provider<AppRatingRepository>((ref) {
  return AppRatingRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
  );
});

/// The signed-in user's rating of the app: 1–5 stars and an optional note.
class AppRating {
  const AppRating({required this.stars, this.feedback});

  final int stars;
  final String? feedback;

  /// Null when the server has no rating for this account yet.
  static AppRating? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final stars = json['stars'];
    if (stars is! int || stars < 1 || stars > 5) return null;
    final feedback = json['feedback'];
    return AppRating(
      stars: stars,
      feedback: feedback is String ? feedback : null,
    );
  }
}

/// Reads and saves the rating in the database (one per account, replaced on
/// each save), so it follows the user to any device and the team can read it.
class AppRatingRepository {
  const AppRatingRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<AppRating?> fetch() async =>
      AppRating.fromJson((await apiClient.getJson('/me/app-rating'))['rating']);

  Future<AppRating?> save({
    required int stars,
    required String feedback,
  }) async {
    final json = await apiClient.putJson(
      '/me/app-rating',
      body: {'stars': stars, 'feedback': feedback.isEmpty ? null : feedback},
    );
    return AppRating.fromJson(json['rating']);
  }
}
