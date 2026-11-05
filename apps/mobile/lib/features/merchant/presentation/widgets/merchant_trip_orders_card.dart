import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../../core/theme/merchant_theme.dart';
import '../../../delivery_handover/presentation/handover_code_card.dart';
import '../../data/merchant_models.dart';
import '../merchant_ui.dart';
import 'merchant_design.dart';

/// The merchant's own orders on a batched delivery: each order's pickup, its
/// parcels' drop-offs and receivers, and its hand-over code while the parcels
/// are still on the way. Other merchants' orders are never listed here.
class MerchantTripOrdersCard extends StatelessWidget {
  const MerchantTripOrdersCard({
    required this.orders,
    required this.showHandover,
    super.key,
  });

  final List<MerchantOrder> orders;
  final bool showHandover;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return MerchantCard(
      key: const ValueKey('merchantTripOrders'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.merchantTripOrdersTitle,
            style: MerchantStyle.text(size: 14, weight: FontWeight.w700),
          ),
          for (final (index, order) in orders.indexed) ...[
            if (index > 0) const Divider(height: 24),
            const SizedBox(height: 10),
            InkWell(
              onTap: () => context.push('/merchant/order/${order.id}'),
              child: Text(
                '${merchantText(context, 'طلب رقم', 'Order')} ${merchantReference(order.id)}',
                key: ValueKey('merchantTripOrder-${order.id}'),
                style: MerchantStyle.text(size: 13, weight: FontWeight.w600),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${l10n.pickup}: ${merchantPickupText(context, order)}',
              style: MerchantStyle.text(size: 12, color: MerchantStyle.muted),
            ),
            for (final parcel in order.parcels)
              Text(
                [
                  merchantParcelDropoffText(context, parcel),
                  ?parcel.receiverName,
                ].join(' · '),
                key: ValueKey('merchantTripParcel-${parcel.id}'),
                style: MerchantStyle.text(size: 12),
              ),
            if (showHandover) ...[
              const SizedBox(height: 10),
              HandoverCodeCard(orderId: order.id),
            ],
          ],
        ],
      ),
    );
  }
}
