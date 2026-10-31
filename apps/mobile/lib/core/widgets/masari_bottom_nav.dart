import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

/// One destination in the bottom navigation bar.
class MasariNavItem {
  const MasariNavItem({
    required this.icon,
    required this.selectedIcon,
    required this.label,
  });

  final IconData icon;
  final IconData selectedIcon;

  /// Already localised. Labels are always shown: icon-only navigation is
  /// ambiguous, and the design system makes labels mandatory.
  final String label;
}

/// The app's bottom navigation bar.
///
/// Destinations are supplied per role rather than fixed, so each role shows
/// only navigation that maps to functionality it actually has. RTL ordering is
/// handled by Flutter: under Arabic the first destination sits on the right.
class MasariBottomNav extends StatelessWidget {
  const MasariBottomNav({
    required this.items,
    required this.currentIndex,
    required this.onSelected,
    super.key,
  }) : assert(items.length >= 2, 'a nav bar needs at least two destinations');

  final List<MasariNavItem> items;
  final int currentIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return NavigationBar(
      selectedIndex: currentIndex.clamp(0, items.length - 1),
      onDestinationSelected: onSelected,
      destinations: [
        for (final item in items)
          NavigationDestination(
            icon: Icon(item.icon),
            selectedIcon: Icon(item.selectedIcon),
            label: item.label,
            tooltip: item.label,
          ),
      ],
    );
  }
}

/// Shows [child] in a modal sheet styled to the design system.
///
/// Scrolls internally and caps at 90% of screen height, so tall content on a
/// small screen stays reachable instead of overflowing.
Future<T?> showMasariBottomSheet<T>({
  required BuildContext context,
  required Widget child,
  bool isDismissible = true,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    isDismissible: isDismissible,
    enableDrag: isDismissible,
    builder: (context) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.9,
        ),
        child: SingleChildScrollView(
          padding: EdgeInsets.only(
            left: AppTokens.spaceMedium,
            right: AppTokens.spaceMedium,
            top: AppTokens.spaceSmall,
            // Keeps content clear of the keyboard when the sheet holds inputs.
            bottom:
                AppTokens.spaceLarge + MediaQuery.of(context).viewInsets.bottom,
          ),
          child: child,
        ),
      ),
    ),
  );
}
