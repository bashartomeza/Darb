import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/data/authenticated_api_client.dart';

/// Server-side category values; the UI words each one per locale.
enum IncidentCategory {
  safety('safety'),
  delay('delay'),
  parcelDamage('parcel_damage'),
  behavior('behavior'),
  other('other');

  const IncidentCategory(this.apiValue);

  final String apiValue;
}

const incidentDescriptionMinLength = 3;
const incidentDescriptionMaxLength = 1000;

/// Admin triage states, in the order a report moves through them.
enum IncidentStatus {
  open('open'),
  reviewing('reviewing'),
  resolved('resolved');

  const IncidentStatus(this.apiValue);

  final String apiValue;
}

/// One of the caller's own reports, as saved on the server. Admin notes are
/// never sent to the reporter, so they are not modelled here.
class IncidentReport {
  const IncidentReport({
    required this.id,
    required this.category,
    required this.description,
    required this.status,
    required this.createdAt,
    this.tripId,
  });

  final String id;
  final IncidentCategory category;
  final String description;
  final IncidentStatus status;
  final DateTime createdAt;
  final String? tripId;

  factory IncidentReport.fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    final description = json['description'];
    final createdAt = DateTime.tryParse(json['created_at'] as String? ?? '');
    final status = IncidentStatus.values
        .where((value) => value.apiValue == json['status'])
        .firstOrNull;
    if (id is! String ||
        description is! String ||
        createdAt == null ||
        status == null) {
      throw const FormatException('Invalid incident report');
    }
    return IncidentReport(
      id: id,
      // A category added server-side later still lists, worded as "Other".
      category: IncidentCategory.values.firstWhere(
        (value) => value.apiValue == json['category'],
        orElse: () => IncidentCategory.other,
      ),
      description: description,
      status: status,
      createdAt: createdAt.toLocal(),
      tripId: json['trip_id'] as String?,
    );
  }
}

final incidentRepositoryProvider = Provider<IncidentRepository>((ref) {
  return IncidentRepository(
    apiClient: ref.watch(authenticatedApiClientProvider),
  );
});

/// The signed-in user's own reports, newest first. Re-read every time the
/// list is opened, so a report's triage status is never a stale copy.
final myIncidentReportsProvider =
    FutureProvider.autoDispose<List<IncidentReport>>(
      (ref) => ref.watch(incidentRepositoryProvider).mine(),
    );

class IncidentRepository {
  const IncidentRepository({required this.apiClient});

  final AuthenticatedApiClient apiClient;

  Future<void> report({
    required IncidentCategory category,
    required String description,
    String? tripId,
  }) async {
    await apiClient.postJson(
      '/incidents',
      body: {
        'category': category.apiValue,
        'description': description.trim(),
        'trip_id': ?tripId,
      },
    );
  }

  /// `GET /incidents` is scoped to the caller: it only returns their reports.
  Future<List<IncidentReport>> mine() async {
    final json = await apiClient.getJson('/incidents');
    final list = json['incidents'];
    if (list is! List) throw const FormatException('Missing incidents');
    return list
        .map((value) {
          if (value is! Map) {
            throw const FormatException('Invalid incident report');
          }
          return IncidentReport.fromJson(Map<String, dynamic>.from(value));
        })
        .toList(growable: false);
  }
}
