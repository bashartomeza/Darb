import 'package:flutter/material.dart';

import 'app_theme.dart';

/// The warm surfaces and compact typography of the merchant reference.
abstract final class MerchantStyle {
  static const background = Color(0xFFFAF9F4);
  static const card = Color(0xFFFFFEFB);
  static const border = Color(0xFFEFEDE6);
  static const ink = Color(0xFF405461);
  static const muted = Color(0xFF7F8B92);
  static const orange = Color(0xFFFF6B18);
  static const orangeSoft = Color(0xFFFFEEDD);
  static const green = Color(0xFF269968);
  static const greenSoft = Color(0xFFE8F4EB);
  static const blue = Color(0xFF399CC0);
  static const blueSoft = Color(0xFFE8F4F9);
  static const radius = 17.0;
  static const pagePadding = EdgeInsets.symmetric(horizontal: 20);

  static TextStyle text({
    double size = 14,
    FontWeight weight = FontWeight.w500,
    Color color = ink,
  }) => TextStyle(
    fontFamily: AppTheme.fontFamily,
    fontSize: size,
    height: 1.5,
    fontWeight: weight,
    color: color,
  );
}

class MerchantTheme extends StatelessWidget {
  const MerchantTheme({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context);
    return Theme(
      data: base.copyWith(
        scaffoldBackgroundColor: MerchantStyle.background,
        colorScheme: base.colorScheme.copyWith(
          primary: MerchantStyle.orange,
          surface: MerchantStyle.background,
          onSurface: MerchantStyle.ink,
          onSurfaceVariant: MerchantStyle.muted,
          outlineVariant: MerchantStyle.border,
        ),
        textTheme: base.textTheme.apply(
          bodyColor: MerchantStyle.ink,
          displayColor: MerchantStyle.ink,
        ),
        iconTheme: const IconThemeData(color: MerchantStyle.ink, size: 22),
        appBarTheme: base.appBarTheme.copyWith(
          backgroundColor: MerchantStyle.background,
          foregroundColor: MerchantStyle.ink,
          titleTextStyle: MerchantStyle.text(size: 18, weight: FontWeight.w700),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: MerchantStyle.orange,
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(54),
            elevation: 0,
            textStyle: MerchantStyle.text(size: 17, weight: FontWeight.w600),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(13),
            ),
          ),
        ),
        dividerTheme: const DividerThemeData(
          color: MerchantStyle.border,
          thickness: 1,
        ),
      ),
      child: child,
    );
  }
}
