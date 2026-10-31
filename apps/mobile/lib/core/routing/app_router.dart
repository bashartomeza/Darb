import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../features/auth/application/auth_controller.dart';
import '../../features/auth/domain/auth_models.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/auth_completion_screen.dart';
import '../../features/auth/presentation/register_role_screen.dart';
import '../../features/auth/presentation/signup_screen.dart';
import '../../features/auth/presentation/splash_screen.dart';
import '../../features/auth/presentation/unsupported_role_screen.dart';
import '../../features/assistant/presentation/passenger_assistant_screen.dart';
import '../../features/canonical_routes/presentation/driver_availability_screens.dart';
import '../../features/canonical_routes/presentation/merchant_route_order_screen.dart';
import '../../features/canonical_routes/presentation/passenger_route_request_screen.dart';
import '../../features/passenger_parcels/presentation/passenger_parcels_screen.dart';
import '../../features/passenger_parcels/presentation/send_parcel_screen.dart';
import '../../features/canonical_assignments/presentation/canonical_assignment_screens.dart';
import '../../features/driver/presentation/driver_home_screen.dart';
import '../../features/driver/presentation/driver_match_detail_screen.dart';
import '../../features/driver/presentation/driver_match_inbox_screen.dart';
import '../../features/driver/presentation/driver_my_trip_screen.dart';
import '../../features/driver/presentation/driver_performance_screen.dart';
import '../../features/driver/presentation/driver_route_screen.dart';
import '../../features/driver/presentation/driver_trip_screen.dart';
import '../../features/driver_renewal/presentation/driver_renewal_banner.dart';
import '../../features/driver_renewal/presentation/driver_renewal_screen.dart';
import '../../features/matching/presentation/match_detail_screen.dart';
import '../../features/merchant/presentation/create_merchant_order_screen.dart';
import '../../features/merchant/presentation/merchant_bulk_orders_screen.dart';
import '../../features/merchant/presentation/merchant_home_screen.dart';
import '../../features/merchant/presentation/merchant_match_detail_screen.dart';
import '../../features/merchant/presentation/merchant_match_inbox_screen.dart';
import '../../features/merchant/presentation/merchant_order_detail_screen.dart';
import '../../features/merchant/presentation/merchant_reports_screen.dart';
import '../../features/merchant/presentation/merchant_shipments_screen.dart';
import '../../features/merchant/presentation/merchant_trip_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/onboarding/presentation/onboarding_flow_screen.dart';
import '../../features/onboarding/presentation/pending_status_recovery_screen.dart';
import '../../features/passenger/presentation/create_request_screen.dart';
import '../../features/passenger/presentation/passenger_home_screen.dart';
import '../../features/passenger/presentation/passenger_map_alerts_screen.dart';
import '../../features/passenger/presentation/passenger_trips_screen.dart';
import '../../features/passenger/presentation/request_detail_screen.dart';
import '../../features/security/presentation/session_management_screen.dart';
import '../../features/shared_trips/presentation/shared_trip_screens.dart';
import '../../features/trips/presentation/passenger_trip_screen.dart';
import '../widgets/role_nav_scaffold.dart';

/// Account tab path per role.
///
/// Each role needs its own path because a path may belong to only one shell
/// branch, and the account tab exists in all three shells. The historical
/// `/security/sessions` link still works — [_accountRedirect] maps it onto the
/// signed-in role's tab.
const passengerAccountPath = '/passenger/account';
const driverAccountPath = '/driver/account';
const merchantAccountPath = '/merchant/account';

/// The legacy shared entry point for session management, kept so existing deep
/// links and in-app links keep resolving.
const securitySessionsPath = '/security/sessions';

/// Branch navigators. Each keeps its own page stack and scroll position, which
/// is what makes tab state survive switching.
final _passengerHomeKey = GlobalKey<NavigatorState>(
  debugLabel: 'passengerHome',
);
final _passengerTripsKey = GlobalKey<NavigatorState>(
  debugLabel: 'passengerTrips',
);
final _passengerMapKey = GlobalKey<NavigatorState>(debugLabel: 'passengerMap');
final _passengerAlertsKey = GlobalKey<NavigatorState>(
  debugLabel: 'passengerAlerts',
);
final _passengerAccountKey = GlobalKey<NavigatorState>(
  debugLabel: 'passengerAccount',
);
final _driverHomeKey = GlobalKey<NavigatorState>(debugLabel: 'driverHome');
final _driverInboxKey = GlobalKey<NavigatorState>(debugLabel: 'driverInbox');
final _driverTripKey = GlobalKey<NavigatorState>(debugLabel: 'driverTrip');
final _driverPerformanceKey = GlobalKey<NavigatorState>(
  debugLabel: 'driverPerformance',
);
final _driverAccountKey = GlobalKey<NavigatorState>(
  debugLabel: 'driverAccount',
);
final _merchantHomeKey = GlobalKey<NavigatorState>(debugLabel: 'merchantHome');
final _merchantOrdersKey = GlobalKey<NavigatorState>(
  debugLabel: 'merchantOrders',
);
final _merchantReportsKey = GlobalKey<NavigatorState>(
  debugLabel: 'merchantReports',
);
final _merchantAlertsKey = GlobalKey<NavigatorState>(
  debugLabel: 'merchantAlerts',
);
final _merchantAccountKey = GlobalKey<NavigatorState>(
  debugLabel: 'merchantAccount',
);

final appRouterProvider = Provider<GoRouter>((ref) {
  // Auth changes refresh redirects without replacing the router or mounted
  // forms. In particular, clearing a failed login must preserve its first edit.
  final refresh = ValueNotifier(
    authRoutingSnapshotFor(ref.read(authControllerProvider)),
  );
  ref.listen(authControllerProvider.select(authRoutingSnapshotFor), (_, next) {
    refresh.value = next;
  });

  final router = GoRouter(
    initialLocation: refresh.value.status == AuthStatus.authenticating
        ? '/login'
        : '/splash',
    refreshListenable: refresh,
    routes: [
      GoRoute(path: '/', redirect: (context, state) => '/splash'),
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/auth/complete-registration',
        builder: (context, state) => const AuthCompletionScreen(phone: false),
      ),
      GoRoute(
        path: '/profile/phone',
        builder: (context, state) => const AuthCompletionScreen(phone: true),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterRoleScreen(),
      ),
      GoRoute(
        path: '/signup',
        builder: (context, state) => const SignUpScreen(),
      ),
      GoRoute(
        path: '/onboarding',
        builder: (context, state) => const OnboardingFlowScreen(),
      ),
      GoRoute(
        path: '/onboarding/recover',
        builder: (context, state) => const PendingStatusRecoveryScreen(),
      ),

      // ---------------------------------------------------------------------
      // Intentional full-screen flows.
      //
      // These sit outside every shell, so they render without a navigation bar:
      // creating a request or order is a focused task, and a live trip is a
      // map experience that needs the full viewport.
      //
      // They are declared *before* the shells on purpose. Routes match in
      // declaration order, so `/passenger/request/new` has to come before the
      // shell's `/passenger/request/:id` or `new` would be read as an id.
      // ---------------------------------------------------------------------
      GoRoute(
        path: '/passenger/request/new',
        builder: (context, state) => const CreateRequestScreen(),
      ),
      GoRoute(
        path: '/passenger/routes/request/new',
        builder: (context, state) => const PassengerRouteRequestScreen(),
      ),
      GoRoute(
        path: '/passenger/parcels',
        builder: (context, state) => const PassengerParcelsScreen(),
      ),
      GoRoute(
        path: '/passenger/parcels/new',
        builder: (context, state) => const SendParcelScreen(),
      ),
      GoRoute(
        path: '/passenger/trip/:id',
        builder: (context, state) =>
            PassengerTripScreen(tripId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/driver/availability/new',
        builder: (context, state) => const DriverAvailabilityFormScreen(),
      ),
      GoRoute(
        path: driverRenewalPath,
        builder: (context, state) => const DriverRenewalScreen(),
      ),
      GoRoute(
        path: '/driver/trip/:id',
        builder: (context, state) =>
            DriverTripScreen(tripId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/merchant/order/new',
        builder: (context, state) => const CreateMerchantOrderScreen(),
      ),
      GoRoute(
        path: '/merchant/order/bulk',
        builder: (context, state) => const MerchantBulkOrdersScreen(),
      ),
      GoRoute(
        path: '/merchant/routes/order/new',
        builder: (context, state) => const MerchantRouteOrderScreen(),
      ),
      GoRoute(
        path: '/merchant/trip/:id',
        builder: (context, state) =>
            MerchantTripScreen(tripId: state.pathParameters['id']!),
      ),

      // ---------------------------------------------------------------------
      // Passenger shell.
      // ---------------------------------------------------------------------
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => RoleShellScaffold(
          navigationShell: navigationShell,
          destinations: RoleNavDestinations.passenger(
            AppLocalizations.of(context),
          ),
        ),
        branches: [
          StatefulShellBranch(
            navigatorKey: _passengerHomeKey,
            routes: [
              GoRoute(
                path: '/passenger',
                builder: (context, state) => const PassengerHomeScreen(),
                routes: [
                  GoRoute(
                    path: 'assistant',
                    builder: (context, state) =>
                        const PassengerAssistantScreen(),
                  ),
                  GoRoute(
                    path: 'request/:id',
                    builder: (context, state) => RequestDetailScreen(
                      requestId: state.pathParameters['id']!,
                    ),
                  ),
                  GoRoute(
                    path: 'match/:id',
                    builder: (context, state) =>
                        MatchDetailScreen(matchId: state.pathParameters['id']!),
                  ),
                ],
              ),
            ],
          ),
          // "My trips" roots at the passenger's own request history. Canonical
          // assignments live under it as a sibling rather than as the root:
          // they are one kind of trip, not the whole tab, and the existing
          // `/passenger/canonical-assignments` deep link is preserved exactly.
          StatefulShellBranch(
            navigatorKey: _passengerTripsKey,
            routes: [
              GoRoute(
                path: '/passenger/trips',
                builder: (context, state) => const PassengerTripsScreen(),
              ),
              GoRoute(
                path: '/passenger/canonical-assignments',
                builder: (context, state) =>
                    const CanonicalAssignmentListScreen(role: 'passenger'),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (context, state) =>
                        CanonicalAssignmentDetailScreen(
                          role: 'passenger',
                          assignmentId: state.pathParameters['id']!,
                        ),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            navigatorKey: _passengerMapKey,
            routes: [
              GoRoute(
                path: '/passenger/map',
                builder: (context, state) => const PassengerMapAlertsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            navigatorKey: _passengerAlertsKey,
            routes: [
              GoRoute(
                path: '/passenger/notifications',
                builder: (context, state) => const NotificationsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            navigatorKey: _passengerAccountKey,
            routes: [
              GoRoute(
                path: passengerAccountPath,
                builder: (context, state) => const SessionManagementScreen(),
              ),
            ],
          ),
        ],
      ),

      // ---------------------------------------------------------------------
      // Driver shell.
      // ---------------------------------------------------------------------
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => RoleShellScaffold(
          navigationShell: navigationShell,
          destinations: RoleNavDestinations.driver(
            AppLocalizations.of(context),
          ),
        ),
        branches: [
          StatefulShellBranch(
            navigatorKey: _driverHomeKey,
            routes: [
              GoRoute(
                path: '/driver',
                builder: (context, state) => const DriverHomeScreen(),
                routes: [
                  GoRoute(
                    path: 'route',
                    builder: (context, state) => const DriverRouteScreen(),
                  ),
                  GoRoute(
                    path: 'availabilities',
                    builder: (context, state) =>
                        const DriverAvailabilityListScreen(),
                  ),
                  GoRoute(
                    path: 'availability/:id',
                    builder: (context, state) => DriverAvailabilityDetailScreen(
                      availabilityId: state.pathParameters['id']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            navigatorKey: _driverInboxKey,
            routes: [
              GoRoute(
                path: '/driver/matches',
                builder: (context, state) => const DriverMatchInboxScreen(),
              ),
              // A sibling rather than a child: the existing `/driver/match/:id`
              // deep link is preserved exactly, and living in this branch means
              // a match detail returns to the inbox tab.
              GoRoute(
                path: '/driver/match/:id',
                builder: (context, state) => DriverMatchDetailScreen(
                  matchId: state.pathParameters['id']!,
                ),
              ),
              GoRoute(
                path: '/driver/canonical-offers',
                builder: (context, state) =>
                    const DriverCanonicalOfferListScreen(),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (context, state) =>
                        DriverCanonicalOfferDetailScreen(
                          offerId: state.pathParameters['id']!,
                        ),
                  ),
                ],
              ),
              GoRoute(
                path: '/driver/shared-offers',
                builder: (context, state) =>
                    const DriverSharedOfferListScreen(),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (context, state) => DriverSharedOfferDetailScreen(
                      offerId: state.pathParameters['id']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          // The live trip as a tab. It resolves the driver's active trip
          // itself, so the tab needs no id — the `/driver/trip/:id` full-screen
          // route above still serves links that name one.
          StatefulShellBranch(
            navigatorKey: _driverTripKey,
            routes: [
              GoRoute(
                path: '/driver/my-trip',
                builder: (context, state) => const DriverMyTripScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            navigatorKey: _driverPerformanceKey,
            routes: [
              GoRoute(
                path: '/driver/performance',
                builder: (context, state) => const DriverPerformanceScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            navigatorKey: _driverAccountKey,
            routes: [
              GoRoute(
                path: driverAccountPath,
                builder: (context, state) => const SessionManagementScreen(),
              ),
            ],
          ),
        ],
      ),

      // ---------------------------------------------------------------------
      // Merchant shell.
      // ---------------------------------------------------------------------
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => RoleShellScaffold(
          navigationShell: navigationShell,
          destinations: RoleNavDestinations.merchant(
            AppLocalizations.of(context),
          ),
        ),
        branches: [
          StatefulShellBranch(
            navigatorKey: _merchantHomeKey,
            routes: [
              GoRoute(
                path: '/merchant',
                builder: (context, state) => const MerchantHomeScreen(),
                routes: [
                  GoRoute(
                    path: 'order/:id',
                    builder: (context, state) => MerchantOrderDetailScreen(
                      orderId: state.pathParameters['id']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          // The shipments tab. It roots at the merchant's own orders — this
          // branch previously rooted at the match inbox while being labelled
          // "orders", so `GET /merchant/orders` had no list of its own. The
          // inbox stays here as a sibling, reachable from the shipments screen
          // and by its unchanged `/merchant/matches` link.
          StatefulShellBranch(
            navigatorKey: _merchantOrdersKey,
            routes: [
              GoRoute(
                path: '/merchant/shipments',
                builder: (context, state) => const MerchantShipmentsScreen(),
              ),
              GoRoute(
                path: '/merchant/matches',
                builder: (context, state) => const MerchantMatchInboxScreen(),
              ),
              GoRoute(
                path: '/merchant/match/:id',
                builder: (context, state) => MerchantMatchDetailScreen(
                  matchId: state.pathParameters['id']!,
                ),
              ),
              GoRoute(
                path: '/merchant/canonical-assignments',
                builder: (context, state) =>
                    const CanonicalAssignmentListScreen(role: 'merchant'),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (context, state) =>
                        CanonicalAssignmentDetailScreen(
                          role: 'merchant',
                          assignmentId: state.pathParameters['id']!,
                        ),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            navigatorKey: _merchantReportsKey,
            routes: [
              GoRoute(
                path: '/merchant/reports',
                builder: (context, state) => const MerchantReportsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            navigatorKey: _merchantAlertsKey,
            routes: [
              GoRoute(
                path: '/merchant/notifications',
                builder: (context, state) => const NotificationsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            navigatorKey: _merchantAccountKey,
            routes: [
              GoRoute(
                path: merchantAccountPath,
                builder: (context, state) => const SessionManagementScreen(),
              ),
            ],
          ),
        ],
      ),

      GoRoute(
        path: '/unsupported-role',
        builder: (context, state) => const UnsupportedRoleScreen(),
      ),
      GoRoute(
        path: securitySessionsPath,
        builder: (context, state) => const SessionManagementScreen(),
      ),
    ],
    redirect: (context, state) {
      final auth = authRoutingSnapshotFor(ref.read(authControllerProvider));
      final authenticating = auth.status == AuthStatus.authenticating;
      final path = state.uri.path;
      if (auth.isLoading) {
        if (authenticating || path == '/login') {
          return null;
        }
        return path == '/splash' ? null : '/splash';
      }
      if (auth.hasError) {
        return (path == '/login' || path == '/register' || path == '/signup')
            ? null
            : '/login';
      }

      if (auth.status == AuthStatus.restoring ||
          auth.status == AuthStatus.restoreFailed) {
        return path == '/splash' ? null : '/splash';
      }

      if (auth.status == AuthStatus.authenticating) {
        return (path == '/login' || path == '/register' || path == '/signup')
            ? null
            : '/login';
      }

      if (auth.status == AuthStatus.registrationRequired) {
        return path == '/auth/complete-registration'
            ? null
            : '/auth/complete-registration';
      }

      if (auth.status != AuthStatus.authenticated || auth.user == null) {
        if (path == '/login' ||
            path == '/register' ||
            path == '/signup' ||
            path.startsWith('/onboarding')) {
          return null;
        }
        return '/login';
      }

      final role = auth.user!.role;
      if (auth.user!.requiresPhone &&
          role != UserRole.admin &&
          role != UserRole.unsupported) {
        return path == '/profile/phone' ? null : '/profile/phone';
      }
      final target = routeForRole(role);

      // Send the shared security link to the signed-in role's account tab, so
      // it lands inside the shell and keeps the navigation bar. Admin and
      // unsupported roles fall through to the role guard below, which is what
      // keeps session management off-limits to them.
      if (path == securitySessionsPath) {
        final account = accountRouteForRole(role);
        if (account != null) return account;
      }

      if (path == target || path.startsWith('$target/')) {
        return null;
      }
      return target;
    },
  );
  ref.onDispose(() {
    router.dispose();
    refresh.dispose();
  });
  return router;
});

typedef AuthRoutingSnapshot = ({
  bool isLoading,
  bool hasError,
  AuthStatus status,
  AuthUser? user,
});

AuthRoutingSnapshot authRoutingSnapshotFor(AsyncValue<AuthState> auth) {
  final status = switch (auth.value?.status) {
    AuthStatus.refreshing ||
    AuthStatus.retryableFailure => AuthStatus.authenticated,
    final status? => status,
    null => AuthStatus.restoring,
  };
  return (
    isLoading: auth.isLoading,
    hasError: auth.hasError,
    status: status,
    user: auth.value?.user,
  );
}

String routeForRole(UserRole role) {
  return switch (role) {
    UserRole.passenger => '/passenger',
    UserRole.driver => '/driver',
    UserRole.merchant => '/merchant',
    UserRole.admin || UserRole.unsupported => '/unsupported-role',
  };
}

/// The account tab for a role, or null for roles that have no mobile shell.
String? accountRouteForRole(UserRole role) {
  return switch (role) {
    UserRole.passenger => passengerAccountPath,
    UserRole.driver => driverAccountPath,
    UserRole.merchant => merchantAccountPath,
    UserRole.admin || UserRole.unsupported => null,
  };
}
