import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/passenger_theme.dart';

/// One tab in the passenger bottom bar.
class PassengerNavItem {
  const PassengerNavItem({
    required this.branch,
    required this.asset,
    required this.iconSize,
    required this.label,
    this.flexible = true,
  });

  /// The shell branch this tab opens.
  final int branch;

  /// SVG icon lifted from the design, drawn in its original frame.
  final String asset;
  final Size iconSize;
  final String label;

  /// Whether the column shares out spare width. The design keeps "Maps" at
  /// its content width while the other three stretch.
  final bool flexible;
}

/// The passenger bottom bar from the Home-Passenger design.
///
/// A 45px row inset 16px from both edges with 51px between columns, Roboto
/// 12/14 captions and an orange active state. There is no indicator pill or
/// top divider: the bar sits flat on the white page.
class PassengerBottomNav extends StatelessWidget {
  const PassengerBottomNav({
    required this.items,
    required this.currentBranch,
    required this.onSelected,
    super.key,
  });

  final List<PassengerNavItem> items;
  final int currentBranch;
  final ValueChanged<int> onSelected;

  /// Height of the row of tabs itself.
  static const rowHeight = 45.0;

  /// Space under the row on a device without a system inset — the design's
  /// 30px home-indicator area plus its 8px margin.
  static const _bottomGap = 38.0;

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.viewPaddingOf(context).bottom;
    final children = <Widget>[];
    for (var i = 0; i < items.length; i++) {
      if (i > 0) children.add(const SizedBox(width: 51));
      final item = items[i];
      final tab = _Tab(
        item: item,
        selected: item.branch == currentBranch,
        onTap: () => onSelected(item.branch),
      );
      children.add(item.flexible ? Expanded(child: tab) : tab);
    }
    return Material(
      color: PassengerStyle.surface,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          16,
          0,
          16,
          inset > 0 ? inset + 4 : _bottomGap,
        ),
        child: SizedBox(
          height: rowHeight,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: children,
          ),
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({required this.item, required this.selected, required this.onTap});

  final PassengerNavItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? PassengerStyle.orange : PassengerStyle.muted;
    return Semantics(
      button: true,
      selected: selected,
      label: item.label,
      excludeSemantics: true,
      child: GestureDetector(
        key: ValueKey('roleNavigation-${item.branch}'),
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SvgPicture.asset(
              item.asset,
              width: item.iconSize.width,
              height: item.iconSize.height,
              colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
            ),
            const SizedBox(height: 4),
            Text(
              item.label,
              maxLines: 1,
              softWrap: false,
              overflow: TextOverflow.visible,
              textAlign: TextAlign.center,
              style: PassengerStyle.caption.copyWith(color: color),
            ),
          ],
        ),
      ),
    );
  }
}
