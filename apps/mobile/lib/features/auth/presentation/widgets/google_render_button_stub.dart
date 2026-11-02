import 'package:flutter/widgets.dart';

/// Non-web platforms never render the GIS button — they call
/// `GoogleSignInService.authenticate()` directly.
Widget googleRenderButton() => const SizedBox.shrink();
