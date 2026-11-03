import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/theme/merchant_theme.dart';
import '../../../core/widgets/language_switch.dart';
import '../../auth/application/auth_controller.dart';
import '../../security/presentation/security_actions.dart';
import '../application/merchant_controller.dart';
import 'widgets/merchant_design.dart';

class MerchantProfileScreen extends ConsumerWidget {
  const MerchantProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).value?.user;
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      key: const ValueKey('merchantProfile'),
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            MerchantHeader(
              title: merchantText(context, 'الملف الشخصي', 'Profile'),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
                children: [
                  Center(
                    child: Container(
                      width: 86,
                      height: 86,
                      decoration: BoxDecoration(
                        color: MerchantStyle.orangeSoft.withValues(alpha: .6),
                        shape: BoxShape.circle,
                        border: Border.all(color: MerchantStyle.border),
                      ),
                      child: const Icon(
                        Icons.storefront_rounded,
                        size: 46,
                        color: MerchantStyle.orange,
                      ),
                    ),
                  ),
                  const SizedBox(height: 15),
                  Text(
                    user?.name ?? l10n.merchant,
                    textAlign: TextAlign.center,
                    style: MerchantStyle.text(
                      size: 24,
                      weight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    merchantText(context, 'حساب تاجر', 'Merchant account'),
                    textAlign: TextAlign.center,
                    style: MerchantStyle.text(
                      size: 13,
                      color: MerchantStyle.muted,
                    ),
                  ),
                  const SizedBox(height: 28),
                  MerchantMenuRow(
                    key: const ValueKey('merchantStoreInformation'),
                    icon: Icons.storefront_outlined,
                    label: merchantText(
                      context,
                      'معلومات المتجر',
                      'Store information',
                    ),
                    onTap: () => _storeInformation(context),
                  ),
                  const SizedBox(height: 10),
                  MerchantMenuRow(
                    key: const ValueKey('merchantProducts'),
                    icon: Icons.inventory_2_outlined,
                    label: merchantText(context, 'المنتجات', 'Products'),
                    onTap: () => _parcels(context, ref),
                  ),
                  const SizedBox(height: 10),
                  MerchantMenuRow(
                    icon: Icons.receipt_long_outlined,
                    label: l10n.orders,
                    onTap: () => context.go('/merchant/shipments'),
                  ),
                  const SizedBox(height: 10),
                  MerchantMenuRow(
                    icon: Icons.notifications_none_rounded,
                    label: l10n.notifications,
                    onTap: () => context.go('/merchant/notifications'),
                  ),
                  const SizedBox(height: 10),
                  MerchantMenuRow(
                    key: const ValueKey('merchantHelp'),
                    icon: Icons.help_outline_rounded,
                    label: merchantText(context, 'المساعدة', 'Help'),
                    onTap: () => _help(context),
                  ),
                  const SizedBox(height: 20),
                  TextButton.icon(
                    key: const ValueKey('securitySessionsButton'),
                    onPressed: () => context.push('/merchant/account/sessions'),
                    icon: const Icon(Icons.security_outlined, size: 18),
                    label: Text(l10n.securityAndSessions),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        merchantText(context, 'لغة التطبيق', 'App language'),
                        style: MerchantStyle.text(
                          size: 12,
                          color: MerchantStyle.muted,
                        ),
                      ),
                      const LanguageSwitch(),
                    ],
                  ),
                  TextButton.icon(
                    key: const ValueKey('logoutButton'),
                    onPressed: () async {
                      final confirmed = await confirmSecurityAction(
                        context,
                        title: l10n.confirmLogout,
                        message: l10n.confirmLogoutMessage,
                        confirmLabel: l10n.logout,
                      );
                      if (confirmed && context.mounted) {
                        await ref
                            .read(authControllerProvider.notifier)
                            .logout();
                      }
                    },
                    icon: const Icon(Icons.logout_rounded, size: 18),
                    label: Text(l10n.logout),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _storeInformation(BuildContext context) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => const _MerchantStoreInformation(),
  );

  void _parcels(BuildContext context, WidgetRef ref) {
    final dashboard = ref.read(merchantDashboardProvider);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: SizedBox(
            height: MediaQuery.sizeOf(context).height * .6,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  merchantText(
                    context,
                    'الطرود في طلباتك',
                    'Parcels in your orders',
                  ),
                  style: MerchantStyle.text(size: 20, weight: FontWeight.w700),
                ),
                const SizedBox(height: 16),
                Expanded(
                  child: dashboard.when(
                    loading: () =>
                        const Center(child: CircularProgressIndicator()),
                    error: (_, _) => Center(
                      child: Text(
                        merchantText(
                          context,
                          'تعذر تحميل الطرود',
                          'Could not load parcels',
                        ),
                      ),
                    ),
                    data: (state) {
                      final parcels = [
                        for (final order in state.orders) ...order.parcels,
                      ];
                      if (parcels.isEmpty) {
                        return Center(
                          child: Text(
                            merchantText(
                              context,
                              'لا توجد طرود بعد',
                              'No parcels yet',
                            ),
                          ),
                        );
                      }
                      return ListView.separated(
                        itemCount: parcels.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (_, index) => MerchantInfoTile(
                          icon: Icons.inventory_2_outlined,
                          title:
                              '${AppLocalizations.of(context).parcel} ${index + 1} · ${parcels[index].size}',
                          value: parcels[index].destinationLabel,
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _help(BuildContext context) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              merchantText(context, 'كيف نقدر نساعدك؟', 'How can we help?'),
              style: MerchantStyle.text(size: 20, weight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
            for (final faq in [
              (
                merchantText(
                  context,
                  'كيف أنشئ طلب توصيل؟',
                  'How do I create a delivery order?',
                ),
                merchantText(
                  context,
                  'من الرئيسية اختر «طلب توصيل جديد»، أضف الطرود ووجهاتها ثم أرسل الطلب.',
                  'From Home choose New delivery, add your parcels and destinations, then submit.',
                ),
              ),
              (
                merchantText(
                  context,
                  'كيف أتابع التوصيل؟',
                  'How do I track a delivery?',
                ),
                merchantText(
                  context,
                  'افتح طلبك من «طلباتي». بعد قبول السائق، ستظهر لك متابعة التوصيل وآخر موقع متاح.',
                  'Open an order from My orders. Once a driver accepts, you can follow the delivery and its latest reported location.',
                ),
              ),
              (
                merchantText(
                  context,
                  'أين أجد رمز التسليم؟',
                  'Where is the handover code?',
                ),
                merchantText(
                  context,
                  'رمز التسليم متاح في تفاصيل الطلب. شاركه مع المستلم ليؤكد استلام الطرد مع السائق.',
                  'The handover code is in the order details. Share it with the receiver to confirm delivery with the driver.',
                ),
              ),
            ])
              ExpansionTile(
                title: Text(
                  faq.$1,
                  style: MerchantStyle.text(weight: FontWeight.w600),
                ),
                children: [
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(faq.$2, style: MerchantStyle.text()),
                  ),
                ],
              ),
          ],
        ),
      ),
    ),
  );
}

class _MerchantStoreInformation extends ConsumerWidget {
  const _MerchantStoreInformation();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).value?.user;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              merchantText(context, 'معلومات المتجر', 'Store information'),
              style: MerchantStyle.text(size: 20, weight: FontWeight.w700),
            ),
            const SizedBox(height: 20),
            for (final item in [
              (
                Icons.storefront_outlined,
                merchantText(context, 'اسم المتجر', 'Store name'),
                user?.name,
              ),
              (
                Icons.email_outlined,
                merchantText(context, 'البريد الإلكتروني', 'Email'),
                user?.email,
              ),
              (
                Icons.phone_outlined,
                merchantText(context, 'رقم الهاتف', 'Phone number'),
                user?.phone,
              ),
            ]) ...[
              MerchantInfoTile(
                icon: item.$1,
                title: item.$2,
                value: item.$3 ?? '—',
              ),
              const SizedBox(height: 12),
            ],
          ],
        ),
      ),
    );
  }
}
