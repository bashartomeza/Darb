import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import 'masari_bottom_nav.dart';
import 'language_switch.dart';
import 'masari_back_button.dart';
import '../theme/app_theme.dart';

/// A bottom-nav destination. The branch it selects is its index in the list, so
/// the order here must match the order of the shell's branches.
class RoleNavDestination {
  const RoleNavDestination({required this.item});

  final MasariNavItem item;
}

/// The single Scaffold that owns the bottom navigation for a role.
///
/// This is the *only* Scaffold that renders a navigation bar. Every top-level
/// tab is a branch of a [StatefulShellRoute.indexedStack], so the bar is part
/// of the shell rather than something each screen opts into — which is why it
/// can no longer disappear when a tab is selected.
///
/// Screens inside a branch may still use their own [Scaffold] for an app bar;
/// nesting is fine because only this one supplies `bottomNavigationBar`.
class RoleShellScaffold extends StatelessWidget {
  const RoleShellScaffold({
    required this.navigationShell,
    required this.destinations,
    super.key,
  });

  final StatefulNavigationShell navigationShell;
  final List<RoleNavDestination> destinations;

  void _onSelected(int index) {
    // `initialLocation: true` only when re-tapping the active tab: that pops
    // the branch back to its root instead of stacking another copy of the same
    // page. Tapping a different tab restores that branch's saved stack and
    // scroll position rather than rebuilding it.
    navigationShell.goBranch(
      index,
      initialLocation: index == navigationShell.currentIndex,
    );
  }

  @override
  Widget build(BuildContext context) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final wide = MediaQuery.sizeOf(context).width >= 1024;
    final path = GoRouterState.of(context).uri.path;
    final roleHome =
        '/${path.split('/').where((part) => part.isNotEmpty).first}';
    const tabRoots = {
      '/passenger',
      '/passenger/trips',
      '/passenger/map',
      '/passenger/notifications',
      '/driver',
      '/driver/matches',
      '/driver/my-trip',
      '/driver/performance',
      '/merchant',
      '/merchant/shipments',
      '/merchant/reports',
      '/merchant/notifications',
    };
    final isDetail = !tabRoots.contains(path) && !path.endsWith('/account');
    final l10n = AppLocalizations.of(context);
    final title = path.endsWith('/assistant')
        ? l10n.assistantTitle
        : path.contains('/request/')
        ? l10n.requestDetails
        : path.contains('/match/')
        ? l10n.navRequests
        : destinations[navigationShell.currentIndex].item.label;
    final panel = Scaffold(
      appBar: AppBar(
        title: Text(title),
        centerTitle: false,
        automaticallyImplyLeading: false,
        leading: isDetail ? MasariBackButton(fallback: roleHome) : null,
        actions: [
          if (!wide)
            Builder(
              builder: (context) => IconButton(
                tooltip: MaterialLocalizations.of(context).openAppDrawerTooltip,
                icon: const Icon(Icons.menu_rounded),
                onPressed: () => Scaffold.of(context).openDrawer(),
              ),
            ),
          const LanguageSwitch(),
          const SizedBox(width: 12),
        ],
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(1),
          child: Divider(height: 1),
        ),
      ),
      body: ShellLanguageControl(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 840),
            child: navigationShell,
          ),
        ),
      ),
      drawer: wide
          ? null
          : Drawer(child: _sidebar(context, arabic, closeDrawer: true)),
    );
    return ColoredBox(
      color: const Color(0xFFEAE5D9),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1200),
          child: wide
              ? Row(
                  children: [
                    SizedBox(width: 264, child: _sidebar(context, arabic)),
                    Expanded(child: panel),
                  ],
                )
              : panel,
        ),
      ),
    );
  }

  Widget _sidebar(
    BuildContext context,
    bool arabic, {
    bool closeDrawer = false,
  }) {
    return Material(
      color: const Color(0xFF263C2F),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(
                      color: AppTheme.tertiary,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(Icons.route_rounded, color: Colors.white),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        arabic ? 'مساري' : 'Masari',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 26,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const Text(
                        'M A S A R I',
                        style: TextStyle(
                          color: Color(0xFFBAC8BE),
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 48),
              Text(
                arabic ? 'القائمة الرئيسية' : 'MAIN MENU',
                style: const TextStyle(color: Color(0xFFA9B8AB), fontSize: 12),
              ),
              const SizedBox(height: 16),
              Expanded(
                child: ListView(
                  children: [
                    for (var i = 0; i < destinations.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: ListTile(
                          key: ValueKey('roleNavigation-$i'),
                          selected: i == navigationShell.currentIndex,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          tileColor: i == navigationShell.currentIndex
                              ? const Color(0xFF3F5145)
                              : Colors.transparent,
                          leading: Icon(
                            destinations[i].item.icon,
                            color: i == navigationShell.currentIndex
                                ? Colors.white
                                : const Color(0xFFB8C5BB),
                          ),
                          title: Text(
                            destinations[i].item.label,
                            style: TextStyle(
                              color: i == navigationShell.currentIndex
                                  ? Colors.white
                                  : const Color(0xFFB8C5BB),
                              fontSize: 14,
                            ),
                          ),
                          onTap: () {
                            if (closeDrawer) Navigator.of(context).pop();
                            _onSelected(i);
                          },
                        ),
                      ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  border: Border.all(color: const Color(0xFF48604E)),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.verified_user_outlined,
                      color: Color(0xFFE7CFAD),
                      size: 22,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            arabic ? 'رحلتك بأمان' : 'Travel with confidence',
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            arabic
                                ? 'تابع رحلاتك وراجع جلسات حسابك.'
                                : 'Follow your trips and manage your account sessions.',
                            style: const TextStyle(
                              color: Color(0xFFB8C5BB),
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Bottom-navigation destinations per role.
///
/// The tab sets come from the product flow diagrams, which give each role five
/// destinations. Some of those — notifications, maps and alerts, merchant
/// reports — have no endpoint behind them. They are still present, because the
/// app's structure is meant to match the agreed flows and a missing tab makes
/// the two disagree; each one renders an [UnavailableTab] that names the
/// missing backend rather than an empty list that reads as a failed load.
///
/// Five is the ceiling: [MasariBottomNav] and Material's own guidance both stop
/// being legible past that, which is why the merchant's "create shipment" node
/// stays a primary action on the home and shipments screens instead of a sixth
/// tab.
///
/// The order of each list must match the branch order in the router.
class RoleNavDestinations {
  const RoleNavDestinations._();

  static List<RoleNavDestination> passenger(AppLocalizations l10n) => [
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.home_outlined,
        selectedIcon: Icons.home,
        label: l10n.navHome,
      ),
    ),
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.route_outlined,
        selectedIcon: Icons.route,
        label: l10n.navTrips,
      ),
    ),
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.map_outlined,
        selectedIcon: Icons.map,
        label: l10n.navMapAlerts,
      ),
    ),
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.notifications_none,
        selectedIcon: Icons.notifications,
        label: l10n.navNotifications,
      ),
    ),
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.person_outline,
        selectedIcon: Icons.person,
        label: l10n.navAccount,
      ),
    ),
  ];

  static List<RoleNavDestination> driver(AppLocalizations l10n) => [
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.home_outlined,
        selectedIcon: Icons.home,
        label: l10n.navHome,
      ),
    ),
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.inbox_outlined,
        selectedIcon: Icons.inbox,
        label: l10n.navRequests,
      ),
    ),
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.local_shipping_outlined,
        selectedIcon: Icons.local_shipping,
        label: l10n.navMyTrip,
      ),
    ),
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.insights_outlined,
        selectedIcon: Icons.insights,
        label: l10n.navPerformance,
      ),
    ),
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.person_outline,
        selectedIcon: Icons.person,
        label: l10n.navAccount,
      ),
    ),
  ];

  static List<RoleNavDestination> merchant(AppLocalizations l10n) => [
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.home_outlined,
        selectedIcon: Icons.home,
        label: l10n.navHome,
      ),
    ),
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.inventory_2_outlined,
        selectedIcon: Icons.inventory_2,
        label: l10n.navShipments,
      ),
    ),
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.assessment_outlined,
        selectedIcon: Icons.assessment,
        label: l10n.navReports,
      ),
    ),
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.notifications_none,
        selectedIcon: Icons.notifications,
        label: l10n.navNotifications,
      ),
    ),
    RoleNavDestination(
      item: MasariNavItem(
        icon: Icons.person_outline,
        selectedIcon: Icons.person,
        label: l10n.navAccount,
      ),
    ),
  ];
}
