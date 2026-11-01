import 'package:flutter/material.dart';

import 'auth_style.dart';

/// A labelled rule ("— OR —") separating the primary credential form from the
/// alternative sign-in options.
class AuthDivider extends StatelessWidget {
  const AuthDivider({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    const line = Expanded(
      child: Divider(color: AuthStyle.border, thickness: 2, height: 2),
    );
    return Row(
      children: [
        line,
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: AuthStyle.muted,
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
        line,
      ],
    );
  }
}
