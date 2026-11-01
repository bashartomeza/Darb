import 'package:flutter/material.dart';

/// Semantic status colours for Darb.
///
/// Kept separate from [AppTheme]'s `ColorScheme` because Material's scheme has
/// no slot for "pending", "active route", or the per-role map indicators the
/// design system calls for.
///
/// Values are aligned to the Darb brand kit (brand/darb) and its state
/// vocabulary.
class SemanticColors {
  const SemanticColors._();

  // ---------------------------------------------------------------------------
  // Success.
  // ---------------------------------------------------------------------------
  static const success = Color(0xFF3A7C07);
  static const onSuccess = Color(0xFFFFFFFF);
  static const successContainer = Color(0xFFE8F2DF);
  static const onSuccessContainer = Color(0xFF2A5A05);

  // ---------------------------------------------------------------------------
  // Warning.
  // ---------------------------------------------------------------------------
  static const warning = Color(0xFFA36B22);
  static const onWarning = Color(0xFF271E02);
  static const warningContainer = Color(0xFFF5E9D3);
  static const onWarningContainer = Color(0xFF66431A);

  // ---------------------------------------------------------------------------
  // Error.
  // ---------------------------------------------------------------------------
  static const error = Color(0xFFD92D20);
  static const onError = Color(0xFFFFFFFF);
  static const errorContainer = Color(0xFFFDE8E6);
  static const onErrorContainer = Color(0xFF7A1A12);

  // ---------------------------------------------------------------------------
  // Info / confirmed — a calm blue distinct from the orange actions.
  // ---------------------------------------------------------------------------
  static const info = Color(0xFF2F6690);
  static const onInfo = Color(0xFFFFFFFF);
  static const infoContainer = Color(0xFFE6EFF7);
  static const onInfoContainer = Color(0xFF1B3F5C);

  // ---------------------------------------------------------------------------
  // Pending / inactive — the neutral ramp. Used for steps that have not
  // happened yet, so they recede rather than compete.
  // ---------------------------------------------------------------------------
  static const pending = Color(0xFF707070);
  static const onPending = Color(0xFFFFFFFF);
  static const pendingContainer = Color(0xFFF6F6F6);
  static const onPendingContainer = Color(0xFF4A4A4A);

  // ---------------------------------------------------------------------------
  // Action / kinetic — reserved for movement: "Start Trip", "Confirm
  // Delivery", the current step of a tracker, and the passenger map marker.
  // Kept under its own intent name so task screens can style movement and
  // transactional actions consistently.
  // ---------------------------------------------------------------------------
  static const action = Color(0xFFFA5F12);
  static const onAction = Color(0xFFFFFFFF);

  // ---------------------------------------------------------------------------
  // Route state — §G.8 Timeline.
  // ---------------------------------------------------------------------------

  /// A route currently being travelled.
  static const activeRoute = action;

  /// A completed leg.
  static const completedRoute = Color(0xFF3A7C07);

  /// A leg not yet started. The spec renders this as a hollow ring
  /// (`.ms-tl-node.pending`); [TimelineTracker] fills its node solidly, so
  /// this uses the spec's pending-border shade (neutral.400) as the closest
  /// solid equivalent rather than restructuring the widget to draw a ring.
  static const upcomingRoute = Color(0xFFAEAEAE);

  // ---------------------------------------------------------------------------
  // Checkpoint / roadblock status — the single source for map markers and
  // status chips. Green = open, red = closed, orange = moderate congestion.
  // ---------------------------------------------------------------------------
  static const checkpointOpen = Color(0xFF3A7C07);
  static const checkpointClosed = Color(0xFFEB3223);
  static const checkpointCongested = Color(0xFFFA5F12);

  // ---------------------------------------------------------------------------
  // Role & entity indicators — §B "Semantic & map colors". Used for map
  // markers, avatars and badges so a role reads the same way everywhere.
  // ---------------------------------------------------------------------------

  /// Passenger — brand orange.
  static const passenger = Color(0xFFFA5F12);

  /// Driver — price green.
  static const driver = Color(0xFF3A7C07);

  /// Merchant — blue.
  static const merchant = Color(0xFF2F6690);

  /// Parcel — dark orange, distinct from the passenger accent.
  static const parcel = Color(0xFFC2410C);

  /// Indicator colour for a role name as used by the API (`passenger`,
  /// `driver`, `merchant`). Falls back to [pending] for anything unmapped,
  /// including `admin`, which has no mobile surface.
  static Color forRole(String? role) => switch (role) {
    'passenger' => passenger,
    'driver' => driver,
    'merchant' => merchant,
    _ => pending,
  };
}
