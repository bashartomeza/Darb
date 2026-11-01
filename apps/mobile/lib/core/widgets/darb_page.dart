import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import 'masari_card.dart';

/// Scrollable single-column page body used by the simple Darb form screens
/// (verify, recovery, status): a centred icon header, then the content with
/// consistent gutters, safe area and keyboard handling.
class DarbFormPage extends StatelessWidget {
  const DarbFormPage({
    required this.children,
    this.icon,
    this.title,
    this.subtitle,
    this.header,
    super.key,
  });

  final IconData? icon;
  final String? title;
  final String? subtitle;

  /// Replaces the icon/title header when a screen needs something custom.
  final Widget? header;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: ListView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.fromLTRB(
              AppTokens.spaceLarge,
              AppTokens.spaceMedium,
              AppTokens.spaceLarge,
              AppTokens.spaceLarge,
            ),
            children: [
              header ??
                  DarbPageHeader(icon: icon, title: title, subtitle: subtitle),
              const SizedBox(height: AppTokens.spaceLarge),
              ...children,
            ],
          ),
        ),
      ),
    );
  }
}

/// Orange-soft circular icon, bold ink title and grey explanation.
class DarbPageHeader extends StatelessWidget {
  const DarbPageHeader({this.icon, this.title, this.subtitle, super.key});

  final IconData? icon;
  final String? title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      children: [
        if (icon != null) ...[
          Container(
            width: 72,
            height: 72,
            decoration: const BoxDecoration(
              color: AppTheme.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 34, color: AppTheme.primary),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
        ],
        if (title != null)
          Text(
            title!,
            textAlign: TextAlign.center,
            style: text.headlineSmall?.copyWith(
              color: AppTheme.onSurface,
              fontWeight: FontWeight.w800,
            ),
          ),
        if (subtitle != null) ...[
          const SizedBox(height: AppTokens.spaceSmall),
          Text(
            subtitle!,
            textAlign: TextAlign.center,
            style: text.bodyMedium?.copyWith(
              color: AppTheme.onSurfaceVariant,
              height: 1.5,
            ),
          ),
        ],
      ],
    );
  }
}

/// Grey rounded card holding a group of fields; children are spaced evenly.
class DarbFormCard extends StatelessWidget {
  const DarbFormCard({required this.children, super.key});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return MasariCard(
      padding: const EdgeInsets.all(AppTokens.spaceMedium),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) const SizedBox(height: AppTokens.spaceMedium),
            children[i],
          ],
        ],
      ),
    );
  }
}
