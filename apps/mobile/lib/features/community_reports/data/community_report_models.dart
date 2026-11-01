import 'package:flutter/material.dart';

/// Server-side category values; the UI words each one per locale.
enum CommunityReportCategory {
  roadClosure('road_closure', Icons.block_rounded, CommunityReportGroup.road),
  roadReopened(
    'road_reopened',
    Icons.alt_route_rounded,
    CommunityReportGroup.road,
  ),
  roadCongestion(
    'road_congestion',
    Icons.traffic_rounded,
    CommunityReportGroup.road,
  ),
  checkpointOpenMarkedClosed(
    'checkpoint_open_marked_closed',
    Icons.lock_open_rounded,
    CommunityReportGroup.checkpoint,
  ),
  checkpointClosedMarkedOpen(
    'checkpoint_closed_marked_open',
    Icons.lock_outline_rounded,
    CommunityReportGroup.checkpoint,
  ),
  checkpointOutdated(
    'checkpoint_outdated',
    Icons.update_rounded,
    CommunityReportGroup.checkpoint,
  ),
  safetyAlert(
    'safety_alert',
    Icons.warning_amber_rounded,
    CommunityReportGroup.safety,
  ),
  driverReport(
    'driver_report',
    Icons.person_outline_rounded,
    CommunityReportGroup.safety,
  ),
  incorrectMapInfo(
    'incorrect_map_info',
    Icons.wrong_location_outlined,
    CommunityReportGroup.other,
  ),
  other('other', Icons.more_horiz_rounded, CommunityReportGroup.other);

  const CommunityReportCategory(this.apiValue, this.icon, this.group);

  final String apiValue;
  final IconData icon;
  final CommunityReportGroup group;

  /// Allegation-style categories. The UI words them as unverified and never
  /// asks for, or shows, personal details about a driver.
  bool get sensitive => this == safetyAlert || this == driverReport;

  static CommunityReportCategory fromApi(String? value) =>
      CommunityReportCategory.values.firstWhere(
        (c) => c.apiValue == value,
        orElse: () => CommunityReportCategory.other,
      );
}

enum CommunityReportGroup { road, checkpoint, safety, other }

enum CommunityReportSort { recent, top, disputed }

/// Community standing of a report. It is feedback for readers only and never
/// changes a checkpoint or road status.
enum CommunityReportBadge { recent, disputed, wellSupported }

const communityReportDescriptionMaxLength = 500;
const communityReportDescriptionMinLength = 3;

const _recentWindow = Duration(hours: 2);
const _minVotesForBadge = 3;

class CommunityReport {
  const CommunityReport({
    required this.id,
    required this.category,
    required this.description,
    required this.locationName,
    required this.createdAt,
    this.latitude,
    this.longitude,
    this.upvotes = 0,
    this.downvotes = 0,
    this.myVote = 0,
    this.isMine = false,
    this.awaitingAdminReview = false,
    this.hasTrip = false,
  });

  factory CommunityReport.fromJson(Map<String, dynamic> json) {
    return CommunityReport(
      id: json['id'] as String,
      category: CommunityReportCategory.fromApi(json['category'] as String?),
      description: (json['description'] as String?) ?? '',
      locationName: (json['location_name'] as String?) ?? '',
      createdAt:
          DateTime.tryParse((json['created_at'] as String?) ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
      upvotes: (json['upvotes'] as num?)?.toInt() ?? 0,
      downvotes: (json['downvotes'] as num?)?.toInt() ?? 0,
      myVote: (json['my_vote'] as num?)?.toInt() ?? 0,
      isMine: json['is_mine'] == true,
      awaitingAdminReview: json['awaiting_admin_review'] == true,
      hasTrip: json['has_trip'] == true,
    );
  }

  final String id;
  final CommunityReportCategory category;
  final String description;
  final String locationName;
  final DateTime createdAt;
  final double? latitude;
  final double? longitude;
  final int upvotes;
  final int downvotes;

  /// 1, -1, or 0 when the viewer has not voted.
  final int myVote;
  final bool isMine;
  final bool awaitingAdminReview;
  final bool hasTrip;

  bool get hasLocation => latitude != null && longitude != null;
  int get score => upvotes - downvotes;

  CommunityReport copyWith({int? upvotes, int? downvotes, int? myVote}) {
    return CommunityReport(
      id: id,
      category: category,
      description: description,
      locationName: locationName,
      createdAt: createdAt,
      latitude: latitude,
      longitude: longitude,
      upvotes: upvotes ?? this.upvotes,
      downvotes: downvotes ?? this.downvotes,
      myVote: myVote ?? this.myVote,
      isMine: isMine,
      awaitingAdminReview: awaitingAdminReview,
      hasTrip: hasTrip,
    );
  }

  /// This report with the viewer's vote switched to [next] (1, -1 or 0),
  /// adjusting the counts the same way the server does.
  CommunityReport withVote(int next) {
    var up = upvotes - (myVote == 1 ? 1 : 0);
    var down = downvotes - (myVote == -1 ? 1 : 0);
    if (next == 1) up++;
    if (next == -1) down++;
    return copyWith(upvotes: up, downvotes: down, myVote: next);
  }

  /// A report can be both recent and disputed; the list shows each that applies.
  Set<CommunityReportBadge> badges(DateTime now) {
    final total = upvotes + downvotes;
    return {
      if (now.difference(createdAt) < _recentWindow)
        CommunityReportBadge.recent,
      if (downvotes >= _minVotesForBadge && downvotes > upvotes)
        CommunityReportBadge.disputed
      else if (total >= _minVotesForBadge && upvotes >= downvotes * 2)
        if (upvotes >= _minVotesForBadge) CommunityReportBadge.wellSupported,
    };
  }
}

/// Applies the category filter and sort chosen in the UI.
List<CommunityReport> arrangeReports(
  List<CommunityReport> reports, {
  CommunityReportGroup? group,
  CommunityReportSort sort = CommunityReportSort.recent,
}) {
  final filtered = [
    for (final report in reports)
      if (group == null || report.category.group == group) report,
  ];
  switch (sort) {
    case CommunityReportSort.recent:
      filtered.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    case CommunityReportSort.top:
      filtered.sort((a, b) => b.score.compareTo(a.score));
    case CommunityReportSort.disputed:
      filtered.sort((a, b) => a.score.compareTo(b.score));
  }
  return filtered;
}
