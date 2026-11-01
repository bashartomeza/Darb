import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/passenger_theme.dart';
import '../theme/app_tokens.dart';
import '../theme/semantic_colors.dart';

/// The emphasis levels defined by the Masari design system's §G.1 button
/// hierarchy.
enum MasariButtonVariant {
  /// Warm orange, white text. High emphasis — the one action for this
  /// screen or sheet.
  primary,

  /// Same orange fill as [primary]. Reserved for movement: "Start Trip",
  /// "Accept", "Confirm Delivery". The design system's ratio rule treats
  /// this and [primary] as the same "one orange element" budget, so the two
  /// render identically — kept as separate variants only so call sites can
  /// name their intent.
  action,

  /// Orange-tinted container background with orange-tinted text. Medium
  /// emphasis — `.ms-btn-secondary`.
  secondary,

  /// Transparent background, navy text, no border. Low emphasis —
  /// `.ms-btn-tertiary`. The design system defines no separate outlined
  /// variant, so this collapses into Tertiary.
  outline,

  /// Solid error red, white text. Destructive, e.g. "Cancel Trip" —
  /// `.ms-btn-destructive`.
  destructive,
}

/// A button that applies the design system's emphasis levels consistently.
///
/// Handles the states screens keep needing: a busy spinner that preserves the
/// button's height (so layouts don't jump mid-request), an optional leading
/// icon, and full-width by default since most Masari buttons anchor a section.
///
/// Labels come from the caller so localisation stays at the screen level.
class MasariButton extends StatelessWidget {
  const MasariButton({
    required this.label,
    required this.onPressed,
    this.variant = MasariButtonVariant.primary,
    this.icon,
    this.busy = false,
    this.expand = true,
    super.key,
  });

  const MasariButton.action({
    required this.label,
    required this.onPressed,
    this.icon,
    this.busy = false,
    this.expand = true,
    super.key,
  }) : variant = MasariButtonVariant.action;

  const MasariButton.secondary({
    required this.label,
    required this.onPressed,
    this.icon,
    this.busy = false,
    this.expand = true,
    super.key,
  }) : variant = MasariButtonVariant.secondary;

  const MasariButton.outline({
    required this.label,
    required this.onPressed,
    this.icon,
    this.busy = false,
    this.expand = true,
    super.key,
  }) : variant = MasariButtonVariant.outline;

  const MasariButton.destructive({
    required this.label,
    required this.onPressed,
    this.icon,
    this.busy = false,
    this.expand = true,
    super.key,
  }) : variant = MasariButtonVariant.destructive;

  final String label;

  /// `null` disables the button. While [busy] the press handler is suppressed
  /// regardless, so a slow request cannot be submitted twice.
  final VoidCallback? onPressed;

  final MasariButtonVariant variant;
  final IconData? icon;
  final bool busy;

  /// Whether the button stretches to the full width of its parent.
  final bool expand;

  ({Color background, Color foreground, BorderSide? border}) get _palette =>
      switch (variant) {
        MasariButtonVariant.primary => (
          background: SemanticColors.action,
          foreground: SemanticColors.onAction,
          border: null,
        ),
        MasariButtonVariant.action => (
          background: SemanticColors.action,
          foreground: SemanticColors.onAction,
          border: null,
        ),
        MasariButtonVariant.secondary => (
          background: AppTheme.primaryContainer,
          foreground: AppTheme.onPrimaryContainer,
          border: null,
        ),
        MasariButtonVariant.outline => (
          background: Colors.transparent,
          foreground: AppTheme.secondary,
          border: null,
        ),
        MasariButtonVariant.destructive => (
          background: SemanticColors.error,
          foreground: SemanticColors.onError,
          border: null,
        ),
      };

  /// The passenger design's palette: one orange accent on white.
  ({Color background, Color foreground, BorderSide? border})
  get _passengerPalette => switch (variant) {
    MasariButtonVariant.primary || MasariButtonVariant.action => (
      background: PassengerStyle.orange,
      foreground: Colors.white,
      border: null,
    ),
    MasariButtonVariant.secondary => (
      background: PassengerStyle.orangeContainer,
      foreground: PassengerStyle.onOrangeContainer,
      border: null,
    ),
    MasariButtonVariant.outline => (
      background: Colors.transparent,
      foreground: PassengerStyle.orange,
      border: const BorderSide(color: PassengerStyle.orange),
    ),
    MasariButtonVariant.destructive => _palette,
  };

  @override
  Widget build(BuildContext context) {
    final passenger = PassengerTheme.isActive(context);
    final palette = passenger ? _passengerPalette : _palette;
    final enabled = onPressed != null && !busy;

    final child = busy
        ? SizedBox(
            height: AppTokens.spaceLarge - AppTokens.spaceExtraSmall,
            width: AppTokens.spaceLarge - AppTokens.spaceExtraSmall,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              valueColor: AlwaysStoppedAnimation(palette.foreground),
            ),
          )
        : Row(
            mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 20),
                const SizedBox(width: AppTokens.spaceSmall),
              ],
              // Flexible so long Arabic labels ellipsize instead of overflowing
              // on small screens.
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          );

    final button = FilledButton(
      onPressed: enabled ? onPressed : null,
      style: FilledButton.styleFrom(
        backgroundColor: palette.background,
        foregroundColor: palette.foreground,
        disabledBackgroundColor: variant == MasariButtonVariant.outline
            ? Colors.transparent
            : AppTheme.surfaceContainerHigh,
        disabledForegroundColor: AppTheme.outline,
        side: palette.border,
        elevation: 0,
        minimumSize: Size(expand ? double.infinity : 0, AppTokens.buttonHeight),
        padding: const EdgeInsets.symmetric(horizontal: AppTokens.spaceMedium),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(
            passenger ? PassengerStyle.radiusButton : AppTokens.radiusAction,
          ),
        ),
        textStyle: passenger
            ? PassengerStyle.inter(size: 16, height: 20, weight: 600)
            : const TextStyle(
                fontFamily: AppTheme.fontFamily,
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
      ),
      child: child,
    );

    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}
