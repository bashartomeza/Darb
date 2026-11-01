import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Visual constants and building blocks shared by the login and sign-up
/// screens so both follow the same design.
abstract final class AuthStyle {
  static const orange = Color(0xFFFA5F12);
  static const border = Color(0xFFE0E0E0);
  static const hint = Color(0xFFAEAEAE);
  static const text = Color(0xFF383838);
  static const ink = Color(0xFF1C1A1A);
  static const muted = Color(0xFF707070);
  static const radius = 16.0;
  static const fieldHeight = 52.0;
  static const buttonHeight = 56.0;
}

/// The brand mark shown at the top of the auth screens.
class AuthLogo extends StatelessWidget {
  const AuthLogo({super.key});

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/masari_logo.png',
      key: const ValueKey('authLogo'),
      width: 176,
      fit: BoxFit.contain,
      semanticLabel: 'Masari',
    );
  }
}

/// Orange title with a quiet subtitle underneath.
class AuthHeader extends StatelessWidget {
  const AuthHeader({super.key, required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: AuthStyle.orange,
            fontSize: 24,
            fontWeight: FontWeight.w500,
            height: 29 / 24,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: AuthStyle.text.withValues(alpha: 0.8),
            fontSize: 13,
            height: 16 / 13,
          ),
        ),
      ],
    );
  }
}

/// A rounded text field with a leading icon and a grey hint, as in the design.
class AuthTextField extends StatelessWidget {
  const AuthTextField({
    super.key,
    required this.controller,
    required this.hint,
    required this.icon,
    this.validator,
    this.onChanged,
    this.onFieldSubmitted,
    this.keyboardType,
    this.textInputAction,
    this.autofillHints,
    this.inputFormatters,
    this.textCapitalization = TextCapitalization.none,
    this.obscureText = false,
    this.suffix,
    this.helperText,
  });

  final TextEditingController controller;
  final String hint;
  final IconData icon;
  final FormFieldValidator<String>? validator;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onFieldSubmitted;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final List<TextInputFormatter>? inputFormatters;
  final TextCapitalization textCapitalization;
  final bool obscureText;
  final Widget? suffix;
  final String? helperText;

  @override
  Widget build(BuildContext context) {
    OutlineInputBorder outline(Color color, [double width = 0.5]) =>
        OutlineInputBorder(
          borderRadius: BorderRadius.circular(AuthStyle.radius),
          borderSide: BorderSide(color: color, width: width),
        );
    final error = Theme.of(context).colorScheme.error;
    return TextFormField(
      controller: controller,
      onChanged: onChanged,
      onFieldSubmitted: onFieldSubmitted,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      autofillHints: autofillHints,
      inputFormatters: inputFormatters,
      textCapitalization: textCapitalization,
      obscureText: obscureText,
      validator: validator,
      style: const TextStyle(color: AuthStyle.ink, fontSize: 16),
      cursorColor: AuthStyle.orange,
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: AuthStyle.hint, fontSize: 16),
        helperText: helperText,
        helperMaxLines: 2,
        filled: true,
        fillColor: Colors.white,
        prefixIcon: Icon(icon, color: AuthStyle.hint, size: 20),
        suffixIcon: suffix,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        enabledBorder: outline(AuthStyle.border),
        border: outline(AuthStyle.border),
        focusedBorder: outline(AuthStyle.orange, 1),
        errorBorder: outline(error),
        focusedErrorBorder: outline(error, 1),
      ),
    );
  }
}

/// Full-width orange call-to-action.
class AuthPrimaryButton extends StatelessWidget {
  const AuthPrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.loading = false,
    this.buttonKey,
  });

  final Key? buttonKey;
  final String label;
  final VoidCallback? onPressed;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: AuthStyle.buttonHeight,
      child: FilledButton(
        key: buttonKey,
        onPressed: onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: AuthStyle.orange,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AuthStyle.orange.withValues(alpha: 0.5),
          disabledForegroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AuthStyle.radius),
          ),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
        ),
        child: loading
            ? const SizedBox.square(
                dimension: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : Text(label),
      ),
    );
  }
}

/// "Don't have an account? Register" style line with an orange action.
class AuthSwitchPrompt extends StatelessWidget {
  const AuthSwitchPrompt({
    super.key,
    required this.prompt,
    required this.action,
    required this.onPressed,
    this.actionKey,
  });

  final String prompt;
  final String action;
  final VoidCallback? onPressed;
  final Key? actionKey;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 6,
      children: [
        Text(
          prompt,
          style: const TextStyle(
            color: AuthStyle.text,
            fontSize: 13,
            height: 16 / 13,
          ),
        ),
        InkWell(
          key: actionKey,
          onTap: onPressed,
          borderRadius: BorderRadius.circular(4),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 2),
            child: Text(
              action,
              style: const TextStyle(
                color: AuthStyle.orange,
                fontSize: 13,
                fontWeight: FontWeight.w700,
                height: 16 / 13,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// A multi-colour "G" mark used on the Google button.
class GoogleGMark extends StatelessWidget {
  const GoogleGMark({super.key, this.size = 24});

  final double size;

  @override
  Widget build(BuildContext context) {
    return ShaderMask(
      blendMode: BlendMode.srcIn,
      shaderCallback: (bounds) => const SweepGradient(
        startAngle: 0,
        endAngle: 6.2832,
        colors: [
          Color(0xFF4285F4),
          Color(0xFF34A853),
          Color(0xFFFBBC05),
          Color(0xFFEA4335),
          Color(0xFF4285F4),
        ],
        stops: [0.0, 0.3, 0.5, 0.75, 1.0],
      ).createShader(bounds),
      child: Text(
        'G',
        style: TextStyle(
          fontSize: size,
          height: 1,
          fontWeight: FontWeight.w700,
          color: Colors.white,
        ),
      ),
    );
  }
}
