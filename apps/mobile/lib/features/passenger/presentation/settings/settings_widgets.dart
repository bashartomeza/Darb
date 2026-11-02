import 'package:flutter/material.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../../core/theme/passenger_theme.dart';
import '../../../../core/widgets/masari_back_button.dart';

/// Page frame shared by the passenger settings sub-screens: white page, the
/// passenger back button and a section-title heading, matching the other
/// passenger screens rather than the driver/merchant app bar.
class SettingsPage extends StatelessWidget {
  const SettingsPage({
    required this.title,
    required this.children,
    this.fallback = '/passenger/account',
    this.actions,
    super.key,
  });

  final String title;
  final List<Widget> children;
  final String fallback;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: PassengerStyle.surface,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        leading: MasariBackButton(fallback: fallback),
        title: Text(title),
        actions: actions,
      ),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          children: children,
        ),
      ),
    );
  }
}

/// An orange glyph on a soft orange square, the icon treatment the passenger
/// screens use for list entries.
class SettingsIconBadge extends StatelessWidget {
  const SettingsIconBadge({required this.icon, this.color, super.key});

  final IconData icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final tint = color ?? PassengerStyle.orange;
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Icon(icon, color: tint, size: 22),
    );
  }
}

/// One tappable row of the settings list: a panel tile with an icon badge, a
/// label, an optional current value, and a chevron that flips under RTL.
class SettingsRow extends StatelessWidget {
  const SettingsRow({
    required this.icon,
    required this.label,
    required this.onTap,
    this.value,
    this.color,
    this.showChevron = true,
    super.key,
  });

  final IconData icon;
  final String label;
  final String? value;
  final VoidCallback onTap;

  /// Overrides the accent, used to mark the destructive row.
  final Color? color;
  final bool showChevron;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: PassengerStyle.panel,
      borderRadius: BorderRadius.circular(PassengerStyle.radiusTile),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 64),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                SettingsIconBadge(icon: icon, color: color),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    label,
                    style: PassengerStyle.inter(
                      size: 16,
                      height: 20,
                      weight: 560,
                      color: color ?? PassengerStyle.ink,
                    ),
                  ),
                ),
                if (value != null) ...[
                  const SizedBox(width: 8),
                  Text(
                    value!,
                    style: PassengerStyle.inter(
                      size: 14,
                      height: 17,
                      color: PassengerStyle.muted,
                    ),
                  ),
                ],
                if (showChevron) ...[
                  const SizedBox(width: 6),
                  Icon(
                    Directionality.of(context) == TextDirection.rtl
                        ? Icons.chevron_left_rounded
                        : Icons.chevron_right_rounded,
                    color: PassengerStyle.iconMuted,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Initials on a soft orange disc: the API carries no profile photo.
class SettingsAvatar extends StatelessWidget {
  const SettingsAvatar({required this.name, this.size = 56, super.key});

  final String name;
  final double size;

  String get _initials {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    if (parts.isEmpty) return '';
    if (parts.length == 1) return parts.first.characters.first;
    return parts.first.characters.first + parts.elementAt(1).characters.first;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: PassengerStyle.orangeContainer,
        shape: BoxShape.circle,
      ),
      child: Text(
        _initials.toUpperCase(),
        style: PassengerStyle.inter(
          size: size * 0.34,
          height: size * 0.42,
          weight: 600,
          color: PassengerStyle.onOrangeContainer,
        ),
      ),
    );
  }
}

/// The localized label for a language code, always in its own language.
String languageName(AppLocalizations l10n, String code) =>
    code == 'ar' ? l10n.arabic : l10n.english;
