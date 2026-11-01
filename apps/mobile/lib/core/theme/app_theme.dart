import 'package:flutter/material.dart';

import 'app_tokens.dart';
import 'semantic_colors.dart';

/// Darb's Material 3 theme.
///
/// The visual source is the Darb brand kit in `brand/darb/` (README plus the
/// login, new-trip, available-rides and confirm-booking references): a white
/// page, near-black ink, light-grey rounded cards with a thin border, and one
/// orange accent for every primary action. The bundled IBM Plex Sans Arabic
/// font is kept so Arabic renders offline. Shared Material components stay in
/// one theme so feature screens do not need a second parallel styling system.
class AppTheme {
  const AppTheme._();

  /// Font family bundled in `assets/fonts/` and declared in `pubspec.yaml`.
  static const fontFamily = 'IBMPlexSansArabic';

  // ---------------------------------------------------------------------------
  // Darb palette (brand/darb/README.md).
  //
  // Contrast: white on the brand orange #FA5F12 is about 3.1:1, which passes
  // WCAG AA only for large text. Filled buttons therefore use a 19px bold
  // label. Orange *text* on white (links, selected labels) would fail, so it
  // uses [primaryText], a darker orange at about 5.2:1.
  // ---------------------------------------------------------------------------

  /// Brand orange: filled actions, selected navigation, focus ring.
  static const primary = Color(0xFFFA5F12);
  static const onPrimary = Color(0xFFFFFFFF);
  static const primaryContainer = Color(0xFFFFE8DC);
  static const onPrimaryContainer = Color(0xFF7A2A05);

  /// Orange safe for small text on white or on the grey card (AA, ~5.2:1).
  static const primaryText = Color(0xFFC2410C);

  /// Secondary controls (outlined/text buttons, progress) use the accessible
  /// orange so they read as part of the same family.
  static const secondary = primaryText;
  static const onSecondary = Color(0xFFFFFFFF);
  static const secondaryContainer = Color(0xFFFFEFE6);
  static const onSecondaryContainer = Color(0xFF7A2A05);

  /// Highlights share the brand orange.
  static const tertiary = primary;
  static const onTertiary = Color(0xFFFFFFFF);
  static const tertiaryContainer = Color(0xFFFFE8DC);
  static const onTertiaryContainer = Color(0xFF7A2A05);

  static const background = Color(0xFFFFFFFF);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceDim = Color(0xFFE0E0E0);
  static const surfaceContainerLowest = Color(0xFFFFFFFF);

  /// Light-grey card fill (#F6F6F6), used with a thin [outlineVariant] border.
  static const surfaceContainerLow = Color(0xFFF6F6F6);
  static const surfaceContainer = Color(0xFFF3F3F3);
  static const surfaceContainerHigh = Color(0xFFEDEDED);
  static const surfaceContainerHighest = Color(0xFFE0E0E0);

  /// Near-black ink (#1C1A1A).
  static const onSurface = Color(0xFF1C1A1A);

  /// Grey body text (#707070, about 5:1 on white).
  static const onSurfaceVariant = Color(0xFF707070);
  static const inverseSurface = Color(0xFF1C1A1A);
  static const inverseOnSurface = Color(0xFFFFFFFF);
  static const inversePrimary = Color(0xFFFFB590);

  /// Hint grey (#AEAEAE): placeholder icons and decoration. Not for text that
  /// must be read; use [onSurfaceVariant] for that.
  static const hint = Color(0xFFAEAEAE);
  static const outline = hint;
  static const outlineVariant = Color(0xFFE0E0E0);

  /// Price green (#3A7C07).
  static const price = Color(0xFF3A7C07);

  /// Route origin dot.
  static const routeOrigin = Color(0xFF5A6B3A);

  /// Route destination dot (#EB3223).
  static const routeDestination = Color(0xFFEB3223);

  /// Dark red used for destructive/failure emphasis.
  static const darkTerracotta = Color(0xFF9B2A1B);

  /// Legacy alias for headings that were set in the old brand colour. Uses the
  /// accessible orange because it is always applied to text.
  static const deepGreen = primaryText;

  static const colorScheme = ColorScheme(
    brightness: Brightness.light,
    primary: primary,
    onPrimary: onPrimary,
    primaryContainer: primaryContainer,
    onPrimaryContainer: onPrimaryContainer,
    secondary: secondary,
    onSecondary: onSecondary,
    secondaryContainer: secondaryContainer,
    onSecondaryContainer: onSecondaryContainer,
    tertiary: tertiary,
    onTertiary: onTertiary,
    tertiaryContainer: tertiaryContainer,
    onTertiaryContainer: onTertiaryContainer,
    error: SemanticColors.error,
    onError: SemanticColors.onError,
    errorContainer: SemanticColors.errorContainer,
    onErrorContainer: SemanticColors.onErrorContainer,
    surface: surface,
    onSurface: onSurface,
    surfaceDim: surfaceDim,
    surfaceBright: Color(0xFFFFFFFF),
    surfaceContainerLowest: surfaceContainerLowest,
    surfaceContainerLow: surfaceContainerLow,
    surfaceContainer: surfaceContainer,
    surfaceContainerHigh: surfaceContainerHigh,
    surfaceContainerHighest: surfaceContainerHighest,
    onSurfaceVariant: onSurfaceVariant,
    inverseSurface: inverseSurface,
    onInverseSurface: inverseOnSurface,
    inversePrimary: inversePrimary,
    outline: outline,
    outlineVariant: outlineVariant,
  );

  // ---------------------------------------------------------------------------
  // Type scale. Arabic text keeps the bundled IBM Plex Sans Arabic family so
  // the app still renders without downloading fonts at runtime.
  // ---------------------------------------------------------------------------

  static const textTheme = TextTheme(
    displayLarge: TextStyle(
      fontSize: 32,
      fontWeight: FontWeight.w700,
      height: 40 / 32,
    ),
    displayMedium: TextStyle(
      fontSize: 28,
      fontWeight: FontWeight.w700,
      height: 36 / 28,
    ),
    displaySmall: TextStyle(
      fontSize: 24,
      fontWeight: FontWeight.w700,
      height: 32 / 24,
    ),
    headlineLarge: TextStyle(
      fontSize: 22,
      fontWeight: FontWeight.w600,
      height: 30 / 22,
    ),
    headlineMedium: TextStyle(
      fontSize: 20,
      fontWeight: FontWeight.w600,
      height: 28 / 20,
    ),
    headlineSmall: TextStyle(
      fontSize: 18,
      fontWeight: FontWeight.w600,
      height: 28 / 18,
    ),
    titleLarge: TextStyle(
      fontSize: 17,
      fontWeight: FontWeight.w600,
      height: 26 / 17,
    ),
    titleMedium: TextStyle(
      fontSize: 15,
      fontWeight: FontWeight.w600,
      height: 24 / 15,
    ),
    titleSmall: TextStyle(
      fontSize: 14,
      fontWeight: FontWeight.w600,
      height: 22 / 14,
    ),
    bodyLarge: TextStyle(
      fontSize: 16,
      fontWeight: FontWeight.w400,
      height: 1.6,
    ),
    bodyMedium: TextStyle(
      fontSize: 14,
      fontWeight: FontWeight.w400,
      height: 1.6,
    ),
    bodySmall: TextStyle(
      fontSize: 12,
      fontWeight: FontWeight.w400,
      height: 18 / 12,
    ),
    labelLarge: TextStyle(
      fontSize: 14,
      fontWeight: FontWeight.w600,
      height: 20 / 14,
    ),
    labelMedium: TextStyle(
      fontSize: 13,
      fontWeight: FontWeight.w500,
      height: 20 / 13,
    ),
    labelSmall: TextStyle(
      fontSize: 11,
      fontWeight: FontWeight.w500,
      height: 16 / 11,
    ),
  );

  static ThemeData get light {
    final buttonShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(AppTokens.radiusDefault),
    );

    OutlineInputBorder fieldBorder(Color color, [double width = 1]) =>
        OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppTokens.radiusDefault),
          borderSide: BorderSide(color: color, width: width),
        );

    return ThemeData(
      useMaterial3: true,
      fontFamily: fontFamily,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: background,
      textTheme: textTheme.apply(bodyColor: onSurface, displayColor: onSurface),

      // Light-grey card with a thin border and no shadow, as in the Darb
      // references.
      cardTheme: CardThemeData(
        color: surfaceContainerLow,
        elevation: AppTokens.elevationBase,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
          side: const BorderSide(color: outlineVariant),
        ),
      ),

      // White app bar, ink title, no divider: the page content is the focus.
      appBarTheme: const AppBarTheme(
        backgroundColor: background,
        surfaceTintColor: Colors.transparent,
        foregroundColor: onSurface,
        elevation: AppTokens.elevationBase,
        scrolledUnderElevation: AppTokens.elevationBase,
        centerTitle: true,
        titleTextStyle: TextStyle(
          fontFamily: fontFamily,
          fontSize: 18,
          fontWeight: FontWeight.w700,
          color: onSurface,
        ),
      ),

      // Large orange filled buttons. White on #FA5F12 is ~3.1:1, so the label
      // is 19px bold (WCAG "large text", AA 3:1).
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: onPrimary,
          disabledBackgroundColor: surfaceContainerHighest,
          disabledForegroundColor: onSurfaceVariant,
          minimumSize: const Size.fromHeight(AppTokens.buttonHeight),
          shape: buttonShape,
          textStyle: const TextStyle(
            fontFamily: fontFamily,
            fontSize: 19,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),

      // Outlined buttons: white with a thin grey border and ink label (the
      // Google button in the reference).
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: onSurface,
          minimumSize: const Size(0, AppTokens.minTouchTarget),
          side: const BorderSide(color: outlineVariant),
          shape: buttonShape,
          textStyle: const TextStyle(
            fontFamily: fontFamily,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),

      // Low-emphasis text actions use the accessible orange.
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: primaryText,
          minimumSize: const Size(0, AppTokens.minTouchTarget),
          shape: buttonShape,
          textStyle: const TextStyle(
            fontFamily: fontFamily,
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),

      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: SemanticColors.action,
        foregroundColor: SemanticColors.onAction,
      ),

      // Rounded white fields with a thin outline; orange focus ring.
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surfaceContainerLowest,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppTokens.spaceMedium,
          vertical: AppTokens.spaceMedium,
        ),
        border: fieldBorder(outlineVariant),
        enabledBorder: fieldBorder(outlineVariant),
        focusedBorder: fieldBorder(primary, 2),
        errorBorder: fieldBorder(SemanticColors.error),
        focusedErrorBorder: fieldBorder(SemanticColors.error, 2),
        hintStyle: const TextStyle(color: onSurfaceVariant),
        prefixIconColor: hint,
        suffixIconColor: hint,
      ),

      // Pill shape keeps chips visually distinct from buttons.
      chipTheme: ChipThemeData(
        backgroundColor: surfaceContainerLow,
        labelStyle: const TextStyle(
          fontFamily: fontFamily,
          fontSize: 13,
          fontWeight: FontWeight.w500,
          color: onSurface,
        ),
        side: const BorderSide(color: outlineVariant),
        shape: const StadiumBorder(),
        padding: const EdgeInsets.symmetric(
          horizontal: AppTokens.spaceSmall + AppTokens.spaceExtraSmall,
          vertical: AppTokens.spaceExtraSmall,
        ),
      ),

      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: surfaceContainerLowest,
        surfaceTintColor: Colors.transparent,
        elevation: AppTokens.elevationOverlay,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AppTokens.radiusMedium),
          ),
        ),
        showDragHandle: true,
      ),

      dialogTheme: const DialogThemeData(
        backgroundColor: surfaceContainerLowest,
        surfaceTintColor: Colors.transparent,
        elevation: AppTokens.elevationOverlay,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(
            Radius.circular(AppTokens.radiusMedium),
          ),
        ),
      ),

      // Labels are mandatory: icon-only navigation is ambiguous in Arabic.
      // The selected item is orange with no pill indicator, as in the
      // references. The selected label uses the accessible orange.
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surfaceContainerLowest,
        surfaceTintColor: Colors.transparent,
        indicatorColor: Colors.transparent,
        elevation: AppTokens.elevationBase,
        height: 72,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            size: AppTokens.navIconSize,
            color: states.contains(WidgetState.selected)
                ? primary
                : onSurfaceVariant,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontFamily: fontFamily,
            fontSize: 12,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w600
                : FontWeight.w500,
            color: states.contains(WidgetState.selected)
                ? primaryText
                : onSurfaceVariant,
          ),
        ),
      ),

      dividerTheme: const DividerThemeData(
        color: outlineVariant,
        thickness: 1,
        space: AppTokens.spaceMedium,
      ),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: inverseSurface,
        contentTextStyle: const TextStyle(
          fontFamily: fontFamily,
          color: inverseOnSurface,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTokens.radiusDefault),
        ),
        behavior: SnackBarBehavior.floating,
      ),

      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: primary,
        linearTrackColor: surfaceContainerHigh,
        circularTrackColor: surfaceContainerHigh,
      ),

      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? onPrimary
              : surfaceContainerLowest,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) =>
              states.contains(WidgetState.selected) ? primary : outlineVariant,
        ),
      ),

      listTileTheme: const ListTileThemeData(
        iconColor: onSurfaceVariant,
        textColor: onSurface,
      ),
    );
  }
}
