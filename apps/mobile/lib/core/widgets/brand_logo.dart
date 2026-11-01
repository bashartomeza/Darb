import 'package:flutter/material.dart';

/// The Darb wordmark (`assets/brand/logo.png`, supplied by the owner).
///
/// The image is used as delivered, never redrawn. [semanticLabel] should be the
/// localised app name so screen readers announce the brand.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.width = 190, this.semanticLabel});

  /// Rendered width; the height follows the 550x228 aspect ratio.
  final double width;
  final String? semanticLabel;

  static const assetPath = 'assets/brand/logo.png';

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      assetPath,
      width: width,
      fit: BoxFit.contain,
      semanticLabel: semanticLabel,
      filterQuality: FilterQuality.high,
    );
  }
}
