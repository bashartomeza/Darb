import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../../core/theme/merchant_theme.dart';
import '../../data/merchant_models.dart';
import '../merchant_ui.dart';

String merchantText(BuildContext context, String ar, String en) =>
    Localizations.localeOf(context).languageCode == 'ar' ? ar : en;

String merchantReference(String id) =>
    '\u2066#${id.length <= 6 ? id : id.substring(id.length - 6)}\u2069';

String merchantOrderDestination(BuildContext context, MerchantOrder order) {
  final destinations = order.parcels
      .map((p) => merchantDestinationLabel(context, p.destinationLabel))
      .toSet();
  return destinations.isEmpty ? '—' : destinations.join('، ');
}

class MerchantCard extends StatelessWidget {
  const MerchantCard({
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(16),
    super.key,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) => Material(
    color: MerchantStyle.card,
    clipBehavior: Clip.antiAlias,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(MerchantStyle.radius),
      side: const BorderSide(color: MerchantStyle.border),
    ),
    child: InkWell(
      onTap: onTap,
      child: Padding(padding: padding, child: child),
    ),
  );
}

class MerchantHeader extends StatelessWidget {
  const MerchantHeader({
    required this.title,
    this.titleKey,
    this.fallback = '/merchant',
    this.trailing,
    super.key,
  });

  final String title;
  final Key? titleKey;
  final String fallback;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsetsDirectional.fromSTEB(20, 12, 10, 12),
    child: SizedBox(
      height: 44,
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              key: titleKey,
              style: MerchantStyle.text(size: 18, weight: FontWeight.w700),
            ),
          ),
          ?trailing,
          IconButton(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            onPressed: () {
              final router = GoRouter.of(context);
              if (router.canPop()) {
                router.pop();
              } else {
                router.go(fallback);
              }
            },
            icon: const Icon(
              Icons.chevron_left_rounded,
              textDirection: TextDirection.ltr,
              size: 26,
            ),
          ),
        ],
      ),
    ),
  );
}

class MerchantStatusPill extends StatelessWidget {
  const MerchantStatusPill({
    required this.status,
    this.blueForNew = false,
    super.key,
  });
  final String status;
  final bool blueForNew;

  @override
  Widget build(BuildContext context) {
    final done = const {'completed', 'delivered'}.contains(status);
    final fresh = const {
      'draft',
      'submitted',
      'created',
      'pending',
    }.contains(status);
    final cancelled = const {
      'cancelled',
      'failed',
      'expired',
      'rejected',
    }.contains(status);
    final color = done
        ? MerchantStyle.green
        : fresh && blueForNew
        ? MerchantStyle.blue
        : cancelled
        ? const Color(0xFFAD6662)
        : MerchantStyle.orange;
    final fill = done
        ? MerchantStyle.greenSoft
        : fresh && blueForNew
        ? MerchantStyle.blueSoft
        : cancelled
        ? const Color(0xFFF8ECE9)
        : MerchantStyle.orangeSoft;
    final label = switch (status) {
      'submitted' || 'draft' => merchantText(context, 'جديد', 'New'),
      'accepted' ||
      'assigned' ||
      'pickup_started' ||
      'picked_up' ||
      'in_transit' => merchantText(context, 'قيد التوصيل', 'In delivery'),
      _ => merchantStatusLabel(AppLocalizations.of(context), status),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: MerchantStyle.text(
          size: 11,
          color: color,
          weight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// A compact order card shared by Home and the filtered order list.
class MerchantOrderCard extends StatelessWidget {
  const MerchantOrderCard({
    required this.order,
    this.home = false,
    this.tripId,
    super.key,
  });
  final MerchantOrder order;
  final bool home;
  final String? tripId;

  @override
  Widget build(BuildContext context) {
    final material = MaterialLocalizations.of(context);
    final time = material.formatTimeOfDay(
      TimeOfDay.fromDateTime(order.createdAt),
    );
    return MerchantCard(
      onTap: () => context.push('/merchant/order/${order.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              if (home) ...[
                const Icon(
                  Icons.inventory_2_outlined,
                  color: MerchantStyle.orange,
                  size: 17,
                ),
                const SizedBox(width: 7),
              ],
              Expanded(
                child: Text(
                  '${merchantText(context, 'طلب رقم', 'Order')} ${merchantReference(order.id)}',
                  style: MerchantStyle.text(size: 13, weight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              MerchantStatusPill(status: order.status, blueForNew: home),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Text(
                  merchantOrderDestination(context, order),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: MerchantStyle.text(
                    size: 12,
                    color: MerchantStyle.muted,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                time,
                style: MerchantStyle.text(size: 12, color: MerchantStyle.muted),
              ),
            ],
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              Text(
                '${order.parcels.length} ${AppLocalizations.of(context).parcel}',
                style: MerchantStyle.text(size: 12),
              ),
              const Spacer(),
              if (tripId != null)
                InkWell(
                  onTap: () => context.push('/merchant/trip/$tripId'),
                  child: Text(
                    merchantText(context, 'تتبّع التوصيل', 'Track delivery'),
                    style: MerchantStyle.text(
                      size: 12,
                      color: MerchantStyle.orange,
                    ),
                  ),
                )
              else
                Text(
                  material.formatCompactDate(order.createdAt),
                  style: MerchantStyle.text(
                    size: 11,
                    color: MerchantStyle.muted,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class MerchantInfoTile extends StatelessWidget {
  const MerchantInfoTile({
    required this.icon,
    required this.title,
    required this.value,
    super.key,
  });
  final IconData icon;
  final String title;
  final String value;

  @override
  Widget build(BuildContext context) => MerchantCard(
    child: Row(
      children: [
        Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: MerchantStyle.orangeSoft.withValues(alpha: .6),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, size: 22, color: MerchantStyle.orange),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: MerchantStyle.text(size: 12, color: MerchantStyle.muted),
              ),
              const SizedBox(height: 4),
              Text(
                value,
                style: MerchantStyle.text(size: 13, weight: FontWeight.w600),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class MerchantMenuRow extends StatelessWidget {
  const MerchantMenuRow({
    required this.icon,
    required this.label,
    required this.onTap,
    super.key,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => MerchantCard(
    onTap: onTap,
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 17),
    child: Row(
      children: [
        Icon(icon, color: MerchantStyle.orange, size: 22),
        const SizedBox(width: 13),
        Expanded(
          child: Text(
            label,
            style: MerchantStyle.text(size: 14, weight: FontWeight.w600),
          ),
        ),
        const Icon(
          Icons.chevron_right_rounded,
          size: 21,
          color: MerchantStyle.muted,
        ),
      ],
    ),
  );
}
