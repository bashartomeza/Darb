import 'package:flutter/material.dart';

import 'app_theme.dart';

/// Design tokens for the passenger experience, taken from the Figma
/// "Home-Passenger" frame (390 × 844).
///
/// The passenger screens follow a different visual language from the driver
/// and merchant apps: white surfaces, a single orange accent, soft grey panels
/// and generous 30px corners. Every value here is lifted from the design rather
/// than approximated, so screens built from these tokens line up with it.
abstract final class PassengerStyle {
  // Colours. Every value comes from the shared Darb palette in [AppTheme], so
  // passenger screens and the driver/merchant screens cannot drift apart.
  static const orange = AppTheme.primary;
  static const orangeLight = Color(0xFFFEA97F);
  static const orangeContainer = AppTheme.primaryContainer;
  static const onOrangeContainer = AppTheme.onPrimaryContainer;
  static const ink = AppTheme.onSurface;
  static const muted = AppTheme.onSurfaceVariant;
  static const subtle = AppTheme.onSurfaceVariant;
  static const iconMuted = AppTheme.hint;
  static const panel = AppTheme.surfaceContainerLow;
  static const border = AppTheme.outlineVariant;
  static const indicator = AppTheme.hint;
  static const surface = AppTheme.surface;

  // Radii.
  static const radiusCard = 30.0;
  static const radiusTile = 20.0;
  static const radiusButton = 30.0;

  // Typography. Inter and Roboto are bundled variable fonts so the design's
  // non-standard weights (546, 568) render exactly. Arabic has no glyphs in
  // either, so it falls back to the app's bundled IBM Plex Sans Arabic.
  static const fontFallback = [AppTheme.fontFamily];

  static TextStyle inter({
    required double size,
    required double height,
    double weight = 500,
    Color color = ink,
  }) => TextStyle(
    fontFamily: 'Inter',
    fontFamilyFallback: fontFallback,
    fontSize: size,
    height: height / size,
    fontWeight: _nearest(weight),
    fontVariations: [FontVariation('wght', weight)],
    color: color,
    letterSpacing: 0,
  );

  static TextStyle roboto({
    required double size,
    required double height,
    double weight = 400,
    Color color = ink,
  }) => TextStyle(
    fontFamily: 'Roboto',
    fontFamilyFallback: fontFallback,
    fontSize: size,
    height: height / size,
    fontWeight: _nearest(weight),
    fontVariations: [FontVariation('wght', weight)],
    color: color,
    letterSpacing: 0,
  );

  /// The closest named weight, so the Arabic fallback font (which is not
  /// variable) still picks a sensible face.
  static FontWeight _nearest(double weight) =>
      FontWeight.values[((weight / 100).round() - 1).clamp(0, 8)];

  // Named text styles from the design.
  static final sectionTitle = inter(size: 18, height: 22, weight: 546);
  static final cardTitle = roboto(size: 16, height: 19, weight: 568);
  static final cardBody = inter(size: 14, height: 17, color: muted);
  static final buttonLabel = inter(
    size: 18,
    height: 22,
    weight: 600,
    color: surface,
  );
  static final caption = roboto(size: 12, height: 14);
}

/// Wraps passenger screens in the passenger design language.
///
/// Applied at the router to the passenger shell and to the passenger's
/// full-screen flows, so screens that read their colours and shapes from the
/// theme pick up the design without each one being restyled by hand.
class PassengerTheme extends StatelessWidget {
  const PassengerTheme({required this.child, super.key});

  final Widget child;

  static ThemeData of(ThemeData base) {
    final scheme = base.colorScheme.copyWith(
      primary: PassengerStyle.orange,
      onPrimary: Colors.white,
      primaryContainer: PassengerStyle.orangeContainer,
      onPrimaryContainer: PassengerStyle.onOrangeContainer,
      secondary: PassengerStyle.orange,
      onSecondary: Colors.white,
      secondaryContainer: PassengerStyle.orangeContainer,
      onSecondaryContainer: PassengerStyle.onOrangeContainer,
      tertiary: PassengerStyle.orange,
      onTertiary: Colors.white,
      tertiaryContainer: PassengerStyle.orangeContainer,
      onTertiaryContainer: PassengerStyle.onOrangeContainer,
      surface: PassengerStyle.surface,
      onSurface: PassengerStyle.ink,
      onSurfaceVariant: PassengerStyle.muted,
      surfaceContainerLowest: PassengerStyle.surface,
      surfaceContainerLow: PassengerStyle.panel,
      surfaceContainer: PassengerStyle.panel,
      surfaceContainerHigh: AppTheme.surfaceContainerHigh,
      surfaceContainerHighest: PassengerStyle.border,
      outline: PassengerStyle.iconMuted,
      outlineVariant: PassengerStyle.border,
    );
    final pill = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(PassengerStyle.radiusButton),
    );
    final buttonText = PassengerStyle.inter(size: 16, height: 20, weight: 600);
    final field = OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: PassengerStyle.border),
    );

    return base.copyWith(
      colorScheme: scheme,
      scaffoldBackgroundColor: PassengerStyle.surface,
      canvasColor: PassengerStyle.surface,
      textTheme: base.textTheme.apply(
        fontFamily: 'Inter',
        fontFamilyFallback: PassengerStyle.fontFallback,
        bodyColor: PassengerStyle.ink,
        displayColor: PassengerStyle.ink,
      ),
      appBarTheme: base.appBarTheme.copyWith(
        backgroundColor: PassengerStyle.surface,
        foregroundColor: PassengerStyle.ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: PassengerStyle.sectionTitle,
      ),
      cardTheme: base.cardTheme.copyWith(
        color: PassengerStyle.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PassengerStyle.radiusCard),
          side: const BorderSide(color: PassengerStyle.border),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: PassengerStyle.orange,
          foregroundColor: Colors.white,
          disabledBackgroundColor: PassengerStyle.orange.withValues(alpha: 0.4),
          disabledForegroundColor: Colors.white,
          minimumSize: const Size.fromHeight(52),
          shape: pill,
          elevation: 0,
          textStyle: buttonText,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: PassengerStyle.orange,
          minimumSize: const Size(0, 48),
          side: const BorderSide(color: PassengerStyle.orange),
          shape: pill,
          textStyle: buttonText,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: PassengerStyle.orange,
          minimumSize: const Size(0, 48),
          shape: pill,
          textStyle: buttonText,
        ),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: PassengerStyle.orange,
        foregroundColor: Colors.white,
        shape: CircleBorder(),
      ),
      inputDecorationTheme: base.inputDecorationTheme.copyWith(
        fillColor: PassengerStyle.surface,
        border: field,
        enabledBorder: field,
        focusedBorder: field.copyWith(
          borderSide: const BorderSide(color: PassengerStyle.orange),
        ),
        hintStyle: const TextStyle(color: PassengerStyle.indicator),
      ),
      chipTheme: base.chipTheme.copyWith(
        backgroundColor: PassengerStyle.panel,
        selectedColor: PassengerStyle.orange,
        labelStyle: PassengerStyle.inter(
          size: 13,
          height: 16,
          color: PassengerStyle.muted,
        ),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: PassengerStyle.orange,
      ),
      dividerTheme: const DividerThemeData(color: PassengerStyle.border),
      bottomSheetTheme: base.bottomSheetTheme.copyWith(
        backgroundColor: PassengerStyle.surface,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(PassengerStyle.radiusCard),
          ),
        ),
      ),
      dialogTheme: base.dialogTheme.copyWith(
        backgroundColor: PassengerStyle.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PassengerStyle.radiusTile),
        ),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) =>
              states.contains(WidgetState.selected) ? Colors.white : null,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? PassengerStyle.orange
              : null,
        ),
      ),
    );
  }

  /// Whether [context] sits inside passenger screens. Shared widgets that
  /// paint with fixed palette constants use this to switch to the passenger
  /// palette without changing how they look for the other roles.
  static bool isActive(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_PassengerScope>() != null;

  @override
  Widget build(BuildContext context) => _PassengerScope(
    child: Theme(data: of(Theme.of(context)), child: child),
  );
}

class _PassengerScope extends InheritedWidget {
  const _PassengerScope({required super.child});

  @override
  bool updateShouldNotify(_PassengerScope oldWidget) => false;
}
