import 'package:flutter/widgets.dart';
import 'package:google_sign_in_web/web_only.dart' as web;

/// Renders the official Google Identity Services button. Sign-in results are
/// delivered on `GoogleSignIn.instance.authenticationEvents`.
Widget googleRenderButton() => web.renderButton(
  configuration: web.GSIButtonConfiguration(
    theme: web.GSIButtonTheme.outline,
    size: web.GSIButtonSize.large,
    shape: web.GSIButtonShape.rectangular,
    text: web.GSIButtonText.continueWith,
    logoAlignment: web.GSIButtonLogoAlignment.left,
  ),
);
