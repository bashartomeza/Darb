import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/passenger_theme.dart';
import '../../../core/widgets/state_views.dart';
import '../../../core/widgets/foreground_refresh.dart';
import '../../auth/application/auth_controller.dart';
import '../../notifications/application/notifications_controller.dart';
import '../../security/presentation/session_status_banner.dart';
import '../../trips/data/trip_models.dart';
import '../application/passenger_controller.dart';
import '../data/passenger_models.dart';
import 'passenger_request_labels.dart';

/// The passenger's home, built to the Figma "Home-Passenger" frame.
///
/// Geometry is taken directly from the 390 × 844 design: every offset below is
/// the design's own number, measured from the top-left of the frame (or the
/// start edge under RTL). The content scrolls, so taller states — an active
/// request, the parcel entry — extend the page without disturbing the layout
/// above them.
class PassengerHomeScreen extends ConsumerWidget {
  const PassengerHomeScreen({this.now, super.key});

  /// Injectable clock for the greeting and the week strip.
  final DateTime? now;

  /// Where the request flow starts.
  static const _newRequestRoute = '/passenger/request/new';

  static const _asset = 'assets/images/passenger';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final dashboard = ref.watch(passengerDashboardProvider);
    final user = ref.watch(authControllerProvider).value?.user;
    final today = now ?? DateTime.now();

    // Driver accept/start/complete reaches Home without pull-to-refresh.
    return ForegroundRefresh(
      refresh: () => ref.read(passengerDashboardProvider.notifier).poll(),
      child: ColoredBox(
        key: const ValueKey('passengerHome'),
        color: PassengerStyle.surface,
        child: Stack(
          children: [
            SafeArea(
              bottom: false,
              child: RefreshIndicator(
                color: PassengerStyle.orange,
                onRefresh: () =>
                    ref.read(passengerDashboardProvider.notifier).refresh(),
                child: ListView(
                  padding: EdgeInsets.zero,
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: [
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 16),
                      child: SessionStatusBanner(),
                    ),
                    _Header(name: user?.name ?? '', now: today),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: _PlanTripCard(
                        onSearch: () => context.go(_newRequestRoute),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Padding(
                      padding: const EdgeInsetsDirectional.only(start: 20),
                      child: Text(
                        l10n.passengerUpcomingTrips,
                        style: PassengerStyle.sectionTitle,
                      ),
                    ),
                    const SizedBox(height: 24),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: _UpcomingTrips(dashboard: dashboard),
                    ),
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 20),
                      child: _ParcelEntryCard(),
                    ),
                    // Keeps the last card clear of the assistant button.
                    const SizedBox(height: 25 + 63 + 16),
                  ],
                ),
              ),
            ),
            const PositionedDirectional(
              end: 17,
              bottom: 25,
              child: _AssistantButton(),
            ),
          ],
        ),
      ),
    );
  }
}

/// Bell, avatar and greeting, month label, and the week strip: the top 225px.
class _Header extends ConsumerWidget {
  const _Header({required this.name, required this.now});

  final String name;
  final DateTime now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final unread = ref.watch(unreadNotificationCountProvider);
    final hour = now.hour;
    final greeting = hour < 12
        ? l10n.passengerGreetingMorning
        : hour < 17
        ? l10n.passengerGreetingAfternoon
        : l10n.passengerGreetingEvening;

    return SizedBox(
      height: 225,
      child: Stack(
        children: [
          // Bell: the 23 × 31 icon sits at (351, 12.5); the tap target is
          // widened to 48px around it without moving the glyph.
          PositionedDirectional(
            top: 4,
            end: 4.5,
            child: Semantics(
              button: true,
              label: l10n.notifications,
              excludeSemantics: true,
              child: InkResponse(
                key: const ValueKey('passengerNotifications'),
                radius: 24,
                onTap: () => context.go('/passenger/notifications'),
                child: SizedBox(
                  width: 46,
                  height: 48,
                  child: Center(
                    child: SvgPicture.asset(
                      unread > 0
                          ? '${PassengerHomeScreen._asset}/bell.svg'
                          : '${PassengerHomeScreen._asset}/bell_plain.svg',
                      key: const ValueKey('notificationBadge'),
                      width: 23,
                      height: 31,
                    ),
                  ),
                ),
              ),
            ),
          ),
          PositionedDirectional(start: 23, top: 43, child: _Avatar(name: name)),
          PositionedDirectional(
            start: 92.78,
            top: 47.22,
            end: 88,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  height: 17,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Flexible(
                        child: Text(
                          greeting,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: PassengerStyle.inter(
                            size: 13.9631,
                            height: 17,
                            color: PassengerStyle.subtle,
                          ),
                        ),
                      ),
                      const SizedBox(width: 9.31),
                      hour < 17
                          ? SvgPicture.asset(
                              '${PassengerHomeScreen._asset}/sun.svg',
                              width: 16.7558,
                              height: 16.7558,
                            )
                          : const Icon(
                              Icons.nightlight_round,
                              size: 16.7558,
                              color: PassengerStyle.orange,
                            ),
                    ],
                  ),
                ),
                const SizedBox(height: 8.38),
                Text(
                  name,
                  key: const ValueKey('passengerGreetingName'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: PassengerStyle.inter(size: 18.6175, height: 23),
                ),
              ],
            ),
          ),
          PositionedDirectional(
            end: 17,
            top: 83,
            child: Text(
              '${DateFormat.MMM(locale).format(now)}, ${now.year}',
              style: PassengerStyle.inter(
                size: 13,
                height: 16,
                color: PassengerStyle.subtle,
              ),
            ),
          ),
          PositionedDirectional(
            start: 16,
            end: 17,
            top: 118,
            height: 84,
            child: _WeekStrip(today: now, locale: locale),
          ),
        ],
      ),
    );
  }
}

/// Circular avatar. The API carries no profile photo, so it shows the
/// passenger's initials on a soft orange disc in the photo's place.
class _Avatar extends StatelessWidget {
  const _Avatar({required this.name});

  final String name;

  static const size = 56.75;

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
      height: 56.82,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: PassengerStyle.orangeContainer,
        shape: BoxShape.circle,
      ),
      child: Text(
        _initials.toUpperCase(),
        style: PassengerStyle.inter(
          size: 20,
          height: 24,
          weight: 600,
          color: PassengerStyle.orange,
        ),
      ),
    );
  }
}

/// The current week, Sunday first, with today on an orange pill.
class _WeekStrip extends StatelessWidget {
  const _WeekStrip({required this.today, required this.locale});

  final DateTime today;
  final String locale;

  @override
  Widget build(BuildContext context) {
    final date = DateTime(today.year, today.month, today.day);
    final sunday = date.subtract(Duration(days: date.weekday % 7));
    final weekday = DateFormat.E(locale);

    return Semantics(
      label: AppLocalizations.of(context).passengerWeekStrip,
      child: Row(
        children: [
          for (var i = 0; i < 7; i++)
            Expanded(
              child: _Day(
                day: sunday.add(Duration(days: i)),
                label: weekday.format(sunday.add(Duration(days: i))),
                selected: i == date.weekday % 7,
              ),
            ),
        ],
      ),
    );
  }
}

class _Day extends StatelessWidget {
  const _Day({required this.day, required this.label, required this.selected});

  final DateTime day;
  final String label;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 47,
        height: 84,
        decoration: selected
            ? BoxDecoration(
                color: PassengerStyle.orange,
                borderRadius: BorderRadius.circular(23.5),
              )
            : null,
        child: Column(
          children: [
            const SizedBox(height: 15.5),
            Text(
              '${day.day}',
              maxLines: 1,
              softWrap: false,
              overflow: TextOverflow.visible,
              style: PassengerStyle.inter(
                size: 18,
                height: 22,
                color: selected ? PassengerStyle.surface : PassengerStyle.ink,
              ),
            ),
            const SizedBox(height: 12.5),
            Text(
              label,
              maxLines: 1,
              softWrap: false,
              overflow: TextOverflow.visible,
              style: PassengerStyle.inter(
                size: 13,
                height: 16,
                color: selected ? PassengerStyle.surface : PassengerStyle.muted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// "Plan Your Next Trip": the grey 350 × 210 panel with the car and the
/// search button.
class _PlanTripCard extends StatelessWidget {
  const _PlanTripCard({required this.onSearch});

  final VoidCallback onSearch;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final rtl = Directionality.of(context) == TextDirection.rtl;

    return Container(
      height: 210,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: PassengerStyle.panel,
        borderRadius: BorderRadius.circular(PassengerStyle.radiusCard),
      ),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // The car is cropped by the panel's edge: only its front half shows,
          // as in the design. The Container's clip trims the overflow.
          PositionedDirectional(
            end: -57,
            top: 56,
            child: Transform.flip(
              flipX: rtl,
              child: Image.asset(
                '${PassengerHomeScreen._asset}/car.png',
                width: 192,
                height: 70,
                fit: BoxFit.fill,
                excludeFromSemantics: true,
              ),
            ),
          ),
          PositionedDirectional(
            start: 21,
            top: 26,
            end: 21,
            child: Text(
              l10n.passengerPlanTripTitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: PassengerStyle.cardTitle,
            ),
          ),
          PositionedDirectional(
            start: 21,
            top: 56,
            width: 239,
            child: Text(
              l10n.passengerPlanTripBody,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: PassengerStyle.cardBody,
            ),
          ),
          PositionedDirectional(
            start: 21,
            end: 21,
            top: 134,
            height: 52,
            child: Material(
              color: PassengerStyle.orange,
              borderRadius: BorderRadius.circular(26),
              child: InkWell(
                key: const ValueKey('passengerSearchRide'),
                borderRadius: BorderRadius.circular(26),
                onTap: onSearch,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SvgPicture.asset(
                      '${PassengerHomeScreen._asset}/search.svg',
                      width: 24,
                      height: 24,
                    ),
                    const SizedBox(width: 9),
                    Flexible(
                      child: Text(
                        l10n.passengerSearchRide,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: PassengerStyle.buttonLabel,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The passenger's open requests and live trips, or the empty card.
class _UpcomingTrips extends StatelessWidget {
  const _UpcomingTrips({required this.dashboard});

  final AsyncValue<PassengerDashboardState> dashboard;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return dashboard.when(
      loading: () =>
          const LoadingSkeleton(height: 114, radius: PassengerStyle.radiusCard),
      error: (error, _) =>
          OfflineBanner(message: l10n.requestFailed, tone: BannerTone.error),
      data: (state) {
        final linked = <String>{};
        final cards = <Widget>[];
        for (final request in state.activeRequests) {
          final trip = state.tripForRequest(request.id);
          if (trip != null) linked.add(trip.id);
          cards.add(_RequestCard(request: request, trip: trip));
        }
        for (final trip in state.trips) {
          if (linked.contains(trip.id) || !_isLive(trip.status)) continue;
          cards.add(_TripCard(trip: trip));
        }
        if (cards.isEmpty) return const _EmptyUpcoming();
        return Column(
          children: [
            for (var i = 0; i < cards.length; i++) ...[
              if (i > 0) const SizedBox(height: 12),
              cards[i],
            ],
          ],
        );
      },
    );
  }

  static bool _isLive(String status) =>
      status != 'completed' && status != 'cancelled' && status != 'failed';
}

/// The design's 350 × 114 outlined card: a grey 70 × 80 icon tile, then a
/// title and a one-line description.
class _UpcomingCard extends StatelessWidget {
  const _UpcomingCard({
    required this.title,
    required this.body,
    this.titleColor = PassengerStyle.muted,
    this.iconColor,
    this.icon,
    this.onTap,
    super.key,
  });

  final String title;
  final String body;
  final Color titleColor;

  /// Tints the bus glyph; null keeps the design's grey.
  final Color? iconColor;

  /// Replaces the bus glyph, for entries that are not trips.
  final IconData? icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(PassengerStyle.radiusCard),
      side: const BorderSide(color: PassengerStyle.border),
    );
    return Material(
      color: PassengerStyle.surface,
      shape: shape,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: 114,
          // 12px padding inside the design's 1px border-box stroke.
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 13),
            child: Row(
              children: [
                Container(
                  width: 70,
                  height: 80.34,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: PassengerStyle.panel,
                    borderRadius: BorderRadius.circular(
                      PassengerStyle.radiusTile,
                    ),
                  ),
                  child: icon != null
                      ? Icon(
                          icon,
                          size: 36,
                          color: iconColor ?? PassengerStyle.iconMuted,
                        )
                      : SvgPicture.asset(
                          '${PassengerHomeScreen._asset}/bus_large.svg',
                          width: 45.4815,
                          height: 42.3448,
                          colorFilter: iconColor == null
                              ? null
                              : ColorFilter.mode(iconColor!, BlendMode.srcIn),
                        ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: PassengerStyle.sectionTitle.copyWith(
                          color: titleColor,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        body,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: PassengerStyle.inter(
                          size: 12,
                          height: 15,
                          color: PassengerStyle.muted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptyUpcoming extends StatelessWidget {
  const _EmptyUpcoming();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _UpcomingCard(
      key: const ValueKey('passengerNoUpcomingTrips'),
      title: l10n.passengerNoUpcomingTitle,
      body: l10n.passengerNoUpcomingBody,
      onTap: () => context.go(PassengerHomeScreen._newRequestRoute),
    );
  }
}

String _route(BuildContext context, String from, String to) {
  final arrow = Directionality.of(context) == TextDirection.rtl ? '←' : '→';
  // Each label is bidi-isolated so a Latin place name inside an Arabic line
  // keeps pickup first and destination second.
  return '\u2068$from\u2069 $arrow \u2068$to\u2069';
}

/// The passenger's own open request.
class _RequestCard extends StatelessWidget {
  const _RequestCard({required this.request, this.trip});

  final PassengerRequest request;
  final PassengerTrip? trip;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final when = DateFormat(
      'E d MMM · HH:mm',
      locale,
    ).format(request.preferredTime.toLocal());
    final connected = trip;
    return _UpcomingCard(
      key: ValueKey('passengerActiveRequest-${request.id}'),
      // The route's name, then the exact pickup the passenger typed.
      title: request.routeTitle(context),
      titleColor: PassengerStyle.ink,
      iconColor: PassengerStyle.orange,
      body: [
        '${passengerStatusLabel(l10n, request.status)} · $when',
        ?request.pickupDetails,
      ].join('\n'),
      onTap: () => context.go(
        connected == null
            ? '/passenger/request/${request.id}'
            : '/passenger/trip/${connected.id}',
      ),
    );
  }
}

/// A live trip with no open request behind it.
class _TripCard extends StatelessWidget {
  const _TripCard({required this.trip});

  final PassengerTrip trip;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final origin = trip.originLabel;
    final destination = trip.destinationLabel;
    return _UpcomingCard(
      key: ValueKey('passengerActiveTrip-${trip.id}'),
      title: origin != null && destination != null
          ? _route(context, origin, destination)
          : l10n.passengerTrip,
      titleColor: PassengerStyle.ink,
      iconColor: PassengerStyle.orange,
      body: passengerStatusLabel(l10n, trip.status),
      onTap: () => context.go('/passenger/trip/${trip.id}'),
    );
  }
}

/// Entry to sending a parcel along one of the predefined routes. Always
/// offered: passenger parcels need no feature flag.
class _ParcelEntryCard extends StatelessWidget {
  const _ParcelEntryCard();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: _UpcomingCard(
        key: const ValueKey('openPassengerParcels'),
        title: l10n.sendParcelTitle,
        titleColor: PassengerStyle.ink,
        body: l10n.sendParcelEntryBody,
        icon: Icons.inventory_2_outlined,
        iconColor: PassengerStyle.orange,
        onTap: () => context.go('/passenger/parcels'),
      ),
    );
  }
}

/// The floating assistant button: a 63px orange gradient disc with sparkles.
class _AssistantButton extends StatelessWidget {
  const _AssistantButton();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Tooltip(
      message: l10n.assistantHomeTitle,
      child: Semantics(
        button: true,
        label: l10n.assistantHomeTitle,
        excludeSemantics: true,
        child: Material(
          type: MaterialType.transparency,
          child: Ink(
            width: 63,
            height: 63,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [PassengerStyle.orangeLight, PassengerStyle.orange],
                stops: [0, 0.673077],
              ),
            ),
            child: InkWell(
              key: const ValueKey('openPassengerAssistant'),
              customBorder: const CircleBorder(),
              onTap: () => context.go('/passenger/assistant'),
              child: Center(
                child: Image.asset(
                  '${PassengerHomeScreen._asset}/sparkles.png',
                  width: 38,
                  height: 38,
                  excludeFromSemantics: true,
                ),
              ),
            ),
          ),
        ),
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
