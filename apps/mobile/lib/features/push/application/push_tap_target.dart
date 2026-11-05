import '../../auth/domain/auth_models.dart';
import '../../driver_renewal/presentation/driver_renewal_banner.dart';
import '../../notifications/presentation/notifications_screen.dart'
    show opensDriverRenewal;

/// Full-screen inbox for drivers, whose shell has no notifications tab.
const driverNotificationsPath = '/driver/notifications';

/// Where a tapped push leads: the same places the in-app inbox leads to.
///
/// Expiry notices open the document renewal page (as tapping them in the inbox
/// does), a new match offer opens the driver's offer inbox, and everything else
/// opens the role's notifications inbox, where the entry explains itself.
/// [push] means "open on top of the current page" rather than switch tabs.
({String location, bool push})? pushTapTarget(
  UserRole role,
  Map<String, String> data,
) {
  final type = data['type'] ?? '';
  return switch (role) {
    UserRole.passenger => (location: '/passenger/notifications', push: false),
    UserRole.merchant => (location: '/merchant/notifications', push: false),
    UserRole.driver when opensDriverRenewal(type) => (
      location: driverRenewalPath,
      push: true,
    ),
    UserRole.driver when type == 'match_offered' => (
      location: '/driver/matches',
      push: false,
    ),
    UserRole.driver => (location: driverNotificationsPath, push: true),
    UserRole.admin || UserRole.unsupported => null,
  };
}
