import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/passenger_palette.dart';
import '../../../core/widgets/entity_cards.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/route_chip.dart';
import '../../../core/widgets/state_views.dart';
import '../../auth/application/auth_controller.dart';
import '../../trips/data/trip_models.dart';
import '../application/passenger_controller.dart';
import '../data/passenger_models.dart';

class PassengerHomeScreen extends ConsumerWidget {
  const PassengerHomeScreen({super.key});

  static const _newRequestRoute = '/passenger/request/new';
  static const _assistantRoute = '/passenger/assistant';
  static const _notificationsRoute = '/passenger/notifications';

  String _monthShortName(BuildContext context, DateTime date) {
    final locale = Localizations.localeOf(context).languageCode;
    if (locale == 'ar') {
      return switch (date.month) {
        1 => 'يناير',
        2 => 'فبراير',
        3 => 'مارس',
        4 => 'أبريل',
        5 => 'مايو',
        6 => 'يونيو',
        7 => 'يوليو',
        8 => 'أغسطس',
        9 => 'سبتمبر',
        10 => 'أكتوبر',
        11 => 'نوفمبر',
        12 => 'ديسمبر',
        _ => '',
      };
    }
    return switch (date.month) {
      1 => 'Jan',
      2 => 'Feb',
      3 => 'Mar',
      4 => 'Apr',
      5 => 'May',
      6 => 'Jun',
      7 => 'Jul',
      8 => 'Aug',
      9 => 'Sep',
      10 => 'Oct',
      11 => 'Nov',
      12 => 'Dec',
      _ => '',
    };
  }

  String _greetingText(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final hour = DateTime.now().hour;
    if (hour < 12) return l10n.homeGreetingMorning;
    if (hour < 17) return l10n.homeGreetingAfternoon;
    return l10n.homeGreetingEvening;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final name =
        ref.watch(authControllerProvider).value?.user?.name ?? '';
    final dashboard = ref.watch(passengerDashboardProvider);
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final weekStart = today.subtract(Duration(days: today.weekday % 7));

    void openNewRequest() => context.go(_newRequestRoute);
    void openAssistant() => context.go(_assistantRoute);
    void openNotifications() => context.go(_notificationsRoute);

    Future<void> refresh() async {
      await ref.read(passengerDashboardProvider.notifier).refresh();
    }

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: refresh,
          child: Stack(
            children: [
              ListView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
                key: const ValueKey('passengerHome'),
                children: [
                  _Header(
                    name: name,
                    greeting: _greetingText(context),
                    dateText:
                        '${_monthShortName(context, now)}, ${now.year}',
                    onBellTap: openNotifications,
                  ),
                  const SizedBox(height: 16),
                  _WeekStrip(
                    context: context,
                    weekStart: weekStart,
                    today: today,
                  ),
                  const SizedBox(height: 20),
                  _PlanTripCard(
                    title: l10n.homePlanTripTitle,
                    body: l10n.homePlanTripBody,
                    cta: l10n.homeSearchRide,
                    onTap: openNewRequest,
                  ),
                  const SizedBox(height: 28),
                  _UpcomingSection(
                    l10n: l10n,
                    dashboard: dashboard,
                    onRequest: openNewRequest,
                  ),
                ],
              ),
              Positioned(
                right: 17,
                bottom: 24,
                child: _AiButton(
                  key: const ValueKey('openPassengerAssistant'),
                  onTap: openAssistant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.name,
    required this.greeting,
    required this.dateText,
    required this.onBellTap,
  });

  final String name;
  final String greeting;
  final String dateText;
  final VoidCallback onBellTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: Stack(
            alignment: Alignment.center,
            children: [
              IconButton(
                key: const ValueKey('homeNotificationsBell'),
                icon: const Icon(
                  Icons.notifications_none,
                  size: 24,
                  color: PassengerPalette.textPrimary,
                ),
                onPressed: onBellTap,
              ),
              Positioned(
                top: 10,
                right: 12,
                child: Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(
                    color: PassengerPalette.orange,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 2),
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            RoleAvatar(name: name, role: 'passenger', size: 56),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          greeting,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w500,
                            color: PassengerPalette.textMuted,
                            fontFamily: 'IBMPlexSansArabic',
                          ),
                          overflow: TextOverflow.clip,
                        ),
                      ),
                      const SizedBox(width: 6),
                      const Icon(
                        Icons.wb_sunny_outlined,
                        size: 17,
                        color: PassengerPalette.orange,
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    name,
                    style: const TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.w600,
                      color: PassengerPalette.textPrimary,
                      fontFamily: 'IBMPlexSansArabic',
                    ),
                    overflow: TextOverflow.clip,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Text(
              dateText,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: PassengerPalette.textMuted,
                fontFamily: 'IBMPlexSansArabic',
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _WeekStrip extends StatelessWidget {
  const _WeekStrip({
    required this.context,
    required this.weekStart,
    required this.today,
  });

  final BuildContext context;
  final DateTime weekStart;
  final DateTime today;

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).languageCode;
    return SizedBox(
      height: 55,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: List.generate(7, (i) {
          final date = weekStart.add(Duration(days: i));
          final isSelected = date.year == today.year &&
              date.month == today.month &&
              date.day == today.day;
          return SizedBox(
            width: 36,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: isSelected
                      ? BoxDecoration(
                          color: PassengerPalette.orange,
                          borderRadius: BorderRadius.circular(30),
                        )
                      : null,
                  alignment: Alignment.center,
                  child: Text(
                    '${date.day}',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w500,
                      color: isSelected
                          ? Colors.white
                          : PassengerPalette.textPrimary,
                      fontFamily: 'IBMPlexSansArabic',
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                Flexible(
                  child: Text(
                    _weekdayShort(locale, date),
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: PassengerPalette.textMuted,
                      fontFamily: 'IBMPlexSansArabic',
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
            ),
          );
        }),
      ),
    );
  }

  String _weekdayShort(String locale, DateTime date) {
    if (locale == 'ar') {
      return switch (date.weekday) {
        7 => 'أحد',
        1 => 'اثن',
        2 => 'ثلا',
        3 => 'أرب',
        4 => 'خمي',
        5 => 'جمع',
        6 => 'سبت',
        _ => '',
      };
    }
    return switch (date.weekday) {
      7 => 'Sun',
      1 => 'Mon',
      2 => 'Tue',
      3 => 'Wed',
      4 => 'Thu',
      5 => 'Fri',
      6 => 'Sat',
      _ => '',
    };
  }
}

class _PlanTripCard extends StatelessWidget {
  const _PlanTripCard({
    required this.title,
    required this.body,
    required this.cta,
    required this.onTap,
  });

  final String title;
  final String body;
  final String cta;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 210,
      decoration: BoxDecoration(
        color: PassengerPalette.card,
        borderRadius: BorderRadius.circular(30),
      ),
      padding: const EdgeInsets.fromLTRB(21, 29, 21, 24),
      child: Stack(
        children: [
          Positioned(
            right: -8,
            top: -8,
            child: Image.asset(
              'assets/images/home_trip_illustration.png',
              width: 120,
              height: 85,
              fit: BoxFit.cover,
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: PassengerPalette.textPrimary,
                            fontFamily: 'IBMPlexSansArabic',
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.clip,
                        ),
                        const SizedBox(height: 10),
                        Text(
                          body,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w400,
                            color: PassengerPalette.textSecondary,
                            height: 1.4,
                            fontFamily: 'IBMPlexSansArabic',
                          ),
                          maxLines: 3,
                          overflow: TextOverflow.clip,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 110),
                ],
              ),
              const Spacer(),
              InkWell(
                onTap: onTap,
                borderRadius: BorderRadius.circular(26),
                child: Container(
                  height: 52,
                  decoration: BoxDecoration(
                    color: PassengerPalette.orange,
                    borderRadius: BorderRadius.circular(26),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(
                        Icons.search,
                        color: Colors.white,
                        size: 22,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        cta,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: Colors.white,
                          fontFamily: 'IBMPlexSansArabic',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _UpcomingSection extends StatelessWidget {
  const _UpcomingSection({
    required this.l10n,
    required this.dashboard,
    required this.onRequest,
  });

  final AppLocalizations l10n;
  final AsyncValue<PassengerDashboardState> dashboard;
  final VoidCallback onRequest;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.homeUpcomingTrips,
          style: const TextStyle(
            fontSize: 18.5,
            fontWeight: FontWeight.w600,
            color: PassengerPalette.textPrimary,
            fontFamily: 'IBMPlexSansArabic',
          ),
        ),
        const SizedBox(height: 16),
        dashboard.when(
          loading: () => const LoadingSkeleton(height: 113),
          error: (_, _) => const SizedBox(),
          data: (state) {
            final request = state.activeRequest;
            final trip = request == null
                ? state.activeTrip
                : state.tripForRequest(request.id);
            if (request == null && trip == null) {
              return _EmptyUpcomingCard(
                title: l10n.homeNoUpcomingTrips,
                body: l10n.homeNoUpcomingTripsBody,
              );
            }
            if (request != null) {
              return _ActiveRequestCard(request: request, trip: trip);
            }
            return _ConnectedTripCard(trip: trip!);
          },
        ),
      ],
    );
  }
}

class _EmptyUpcomingCard extends StatelessWidget {
  const _EmptyUpcomingCard({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 113,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(29.5),
        border: Border.all(color: PassengerPalette.cardBorder),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12.5, vertical: 13),
      child: Row(
        children: [
          Container(
            width: 70,
            height: 80.34,
            decoration: BoxDecoration(
              color: PassengerPalette.card,
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Center(
              child: Icon(
                Icons.directions_bus_outlined,
                size: 30,
                color: Color(0xFFA9A9A9),
              ),
            ),
          ),
          const SizedBox(width: 15),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 18.5,
                    fontWeight: FontWeight.w500,
                    color: PassengerPalette.textSecondary,
                    fontFamily: 'IBMPlexSansArabic',
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 6),
                Text(
                  body,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w400,
                    color: PassengerPalette.textSecondary,
                    fontFamily: 'IBMPlexSansArabic',
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AiButton extends StatelessWidget {
  const _AiButton({required this.onTap, super.key});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(31.5),
      child: Container(
        width: 63,
        height: 63,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              PassengerPalette.orangeGradientStart,
              PassengerPalette.orangeGradientEnd,
            ],
          ),
        ),
        child: const Center(
          child: Icon(
            Icons.auto_awesome,
            size: 38,
            color: Colors.white,
          ),
        ),
      ),
    );
  }
}

/// The passenger's own open request.
class _ActiveRequestCard extends StatelessWidget {
  const _ActiveRequestCard({required this.request, this.trip});

  final PassengerRequest request;
  final PassengerTrip? trip;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final connected = trip;

    return MasariInfoCard(
      title: l10n.activeRequest,
      icon: Icons.person_pin_circle_outlined,
      statusLabel: passengerStatusLabel(l10n, request.status),
      statusTone: statusToneFor(request.status),
      emphasis: true,
      body: RouteChip(
        from: request.pickupLabel,
        to: request.destinationLabel,
        compact: true,
      ),
      primaryAction: CardAction(
        label: connected == null ? l10n.requestDetails : l10n.openTrip,
        onPressed: () => context.go(
          connected == null
              ? '/passenger/request/${request.id}'
              : '/passenger/trip/${connected.id}',
        ),
      ),
    );
  }
}

/// A trip that exists without an open request behind it.
class _ConnectedTripCard extends StatelessWidget {
  const _ConnectedTripCard({required this.trip});

  final PassengerTrip trip;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return MasariInfoCard(
      title: l10n.passengerTrip,
      icon: Icons.directions_car_outlined,
      statusLabel: passengerStatusLabel(l10n, trip.status),
      statusTone: statusToneFor(trip.status),
      primaryAction: CardAction(
        label: l10n.openTrip,
        onPressed: () => context.go('/passenger/trip/${trip.id}'),
      ),
    );
  }
}

String passengerStatusLabel(AppLocalizations l10n, String status) =>
    switch (status) {
      'pending' => l10n.statusPending,
      'matched' => l10n.statusMatched,
      'accepted' => l10n.statusAccepted,
      'picked_up' => l10n.statusPickedUp,
      'in_transit' => l10n.statusInTransit,
      'delivered' => l10n.statusDelivered,
      'cancelled' => l10n.statusCancelled,
      'completed' => l10n.statusCompleted,
      'pickup_started' => l10n.statusPickupStarted,
      _ => status,
    };
