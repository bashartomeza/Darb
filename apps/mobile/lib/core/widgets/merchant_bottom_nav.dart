import 'package:flutter/material.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../theme/merchant_theme.dart';

class MerchantBottomNav extends StatelessWidget {
  const MerchantBottomNav({
    required this.currentBranch,
    required this.onSelected,
    super.key,
  });
  final int currentBranch;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final items = [
      (0, Icons.home_outlined, Icons.home_rounded, l10n.navHome),
      (
        1,
        Icons.inventory_2_outlined,
        Icons.inventory_2_rounded,
        ar ? 'طلباتي' : 'My orders',
      ),
      (2, Icons.assessment_outlined, Icons.assessment_rounded, l10n.navReports),
      (
        4,
        Icons.person_outline_rounded,
        Icons.person_rounded,
        ar ? 'الملف الشخصي' : 'Profile',
      ),
    ];
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: MerchantStyle.card,
        border: Border(top: BorderSide(color: MerchantStyle.border)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 70,
          child: Row(
            children: [
              for (final item in items)
                Expanded(
                  child: Semantics(
                    selected: currentBranch == item.$1,
                    button: true,
                    child: InkWell(
                      key: ValueKey('roleNavigation-${item.$1}'),
                      onTap: () => onSelected(item.$1),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            currentBranch == item.$1 ? item.$3 : item.$2,
                            size: 22,
                            color: currentBranch == item.$1
                                ? MerchantStyle.orange
                                : MerchantStyle.muted,
                          ),
                          const SizedBox(height: 5),
                          Text(
                            item.$4,
                            style: MerchantStyle.text(
                              size: 10,
                              color: currentBranch == item.$1
                                  ? MerchantStyle.orange
                                  : MerchantStyle.muted,
                              weight: currentBranch == item.$1
                                  ? FontWeight.w600
                                  : FontWeight.w400,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
