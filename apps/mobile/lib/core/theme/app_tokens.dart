/// Darb design tokens.
///
/// Shared mobile layout tokens used by the Darb reference flows:
/// spacing, radii, elevation, and touch targets.
///
/// [spaceSmall], [spaceMedium] and [spaceLarge] predate the design system but
/// already match its `sm`/`md`/`lg` steps, so they are kept as-is — the wider
/// codebase refers to them in hundreds of places.
class AppTokens {
  const AppTokens._();

  // ---------------------------------------------------------------------------
  // Spacing — 8pt grid, §D "Spacing".
  // ---------------------------------------------------------------------------

  /// 4px — `space.4`. Tight pairings (icon to its label).
  static const spaceExtraSmall = 4.0;

  /// 8px — `space.8`. Chip padding.
  static const spaceSmall = 8.0;

  /// 12px — `space.12`. Mobile gutter between grid columns, inline related
  /// elements.
  static const gutterMobile = 12.0;

  /// 16px — `space.16`. Card padding, standard spacing between components,
  /// and the mobile side margin.
  static const spaceMedium = 16.0;

  /// 16px — screen side margin on mobile.
  static const marginMobile = 16.0;

  /// 24px — `space.24`. Separates major content sections.
  static const spaceLarge = 24.0;

  /// 32px — `space.32`. Above a sheet's primary action.
  static const spaceExtraLarge = 32.0;

  /// 48px — `space.48`. Empty-state top padding.
  static const spaceHuge = 48.0;

  // ---------------------------------------------------------------------------
  // Radii — §D "Radius". Four named steps; nothing else is allowed at a call
  // site.
  // ---------------------------------------------------------------------------

  /// 4px — the tail corner of a chat bubble (`.bubble-assistant` /
  /// `.bubble-user`); not part of the named scale but given explicitly by the
  /// chat component's CSS.
  static const radiusSmall = 4.0;

  /// 16px. Buttons, fields, banners, skeletons, OTP boxes.
  static const radiusDefault = 16.0;

  /// 20px. Cards and dialogs.
  static const radiusMedium = 20.0;

  /// 16px — chat bubble corners (`.ms-bubble`), given directly by the chat
  /// component's CSS rather than the named sm/md/lg/full scale.
  static const radiusBubble = 16.0;

  /// 20px — `lg`. Buttons and the top corners of sheets.
  static const radiusLarge = 20.0;

  /// 8px — action controls in the supplied reference.
  static const radiusAction = 8.0;

  /// Fully round — status chips and badges, which must stay visually distinct
  /// from actionable buttons.
  static const radiusFull = 9999.0;

  // ---------------------------------------------------------------------------
  // Touch targets & controls.
  // ---------------------------------------------------------------------------

  /// Minimum height for anything interactive, per the design system.
  static const minTouchTarget = 48.0;

  /// Standard full-width button height.
  static const buttonHeight = 54.0;

  /// Edge of a bottom navigation bar icon.
  static const navIconSize = 24.0;

  // ---------------------------------------------------------------------------
  // Elevation — used functionally, to signal stacking in the user's workflow.
  // ---------------------------------------------------------------------------

  /// Level 0 — page background.
  static const elevationBase = 0.0;

  /// Level 1 — cards.
  static const elevationCard = 1.0;

  /// Level 2 — floating and interactive surfaces (role cards, map markers).
  static const elevationFloating = 3.0;

  /// Level 3/4 — overlays that must pull focus from the map: sheets, dialogs.
  static const elevationOverlay = 8.0;
}
