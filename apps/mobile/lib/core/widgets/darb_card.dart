import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';

/// The elevation levels the design system defines, used functionally to signal
/// how content stacks in the user's workflow.
enum DarbCardLevel {
  /// Level 1 — the default. A hairline stroke instead of a shadow, so cards
  /// stay legible in bright outdoor light.
  card,

  /// Level 2 — floating and interactive: role-selection cards, map callouts.
  floating,

  /// Level 3 — overlays that must pull focus from the map behind them.
  overlay,
}

/// The standard Darb surface: a light-grey rounded card with a thin border.
///
/// [child] and [onTap] keep their original signature: this widget is used in
/// 80 places, and those call sites continue to work untouched.
class DarbCard extends StatelessWidget {
  const DarbCard({
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(AppTokens.spaceMedium),
    this.level = DarbCardLevel.card,
    this.background,
    this.border,
    super.key,
  });

  final Widget child;
  final VoidCallback? onTap;

  /// Defaults to the design system's `md` step. This was 24 before the
  /// redesign; 16 matches the reference layouts and leaves long Arabic strings
  /// more horizontal room on small screens.
  final EdgeInsetsGeometry padding;

  final DarbCardLevel level;

  /// Overrides the surface colour, e.g. for a highlighted summary card.
  final Color? background;

  /// Overrides the default hairline stroke.
  final BorderSide? border;

  double get _elevation => switch (level) {
    DarbCardLevel.card => AppTokens.elevationBase,
    DarbCardLevel.floating => AppTokens.elevationFloating,
    DarbCardLevel.overlay => AppTokens.elevationOverlay,
  };

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
      side: border ?? const BorderSide(color: AppTheme.outlineVariant),
    );

    return Card(
      elevation: _elevation,
      color: background ?? AppTheme.surfaceContainerLow,
      shadowColor: AppTheme.primary.withValues(alpha: 0.2),
      surfaceTintColor: Colors.transparent,
      margin: EdgeInsets.zero,
      shape: shape,
      clipBehavior: onTap == null ? Clip.none : Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}
