import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import '../theme/semantic_colors.dart';
import 'darb_card.dart';
import 'route_chip.dart';
import 'status_chip.dart';

/// Circular role avatar.
///
/// The project has no profile-photo field, so this renders initials over the
/// role's indicator colour rather than a placeholder portrait. If an image URL
/// is added later, pass it as [imageUrl] and it takes over.
class RoleAvatar extends StatelessWidget {
  const RoleAvatar({
    required this.name,
    this.role,
    this.imageUrl,
    this.size = 48,
    super.key,
  });

  final String name;
  final String? role;
  final String? imageUrl;
  final double size;

  String get _initials {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    if (parts.isEmpty) return '';
    if (parts.length == 1) return parts.first.characters.first;
    return parts.first.characters.first + parts.elementAt(1).characters.first;
  }

  @override
  Widget build(BuildContext context) {
    final color = SemanticColors.forRole(role);

    return Container(
      width: size,
      height: size,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        shape: BoxShape.circle,
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      alignment: Alignment.center,
      child: imageUrl == null
          ? Text(
              _initials,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                color: color,
                fontWeight: FontWeight.w700,
              ),
            )
          : Image.network(
              imageUrl!,
              fit: BoxFit.cover,
              width: size,
              height: size,
              errorBuilder: (context, _, _) =>
                  Icon(Icons.person_outline, size: size * 0.5, color: color),
            ),
    );
  }
}

/// A driver summary: identity, vehicle, and optional contact actions.
///
/// [rating], [tripCount] and [vehicleLabel] are optional because the API does
/// not currently return them. Each row is omitted entirely when its data is
/// absent — nothing is faked to fill the layout.
class DriverCard extends StatelessWidget {
  const DriverCard({
    required this.name,
    this.role = 'driver',
    this.vehicleLabel,
    this.rating,
    this.tripCount,
    this.imageUrl,
    this.statusLabel,
    this.statusTone = StatusTone.neutral,
    this.onCall,
    this.onMessage,
    this.onTap,
    super.key,
  });

  final String name;
  final String role;

  /// e.g. a vehicle type; shown only when provided.
  final String? vehicleLabel;

  /// 0..5. Shown only when provided.
  final double? rating;

  /// Completed trips. Shown only alongside a [rating].
  final int? tripCount;

  final String? imageUrl;
  final String? statusLabel;
  final StatusTone statusTone;

  /// Contact actions render only when a handler is supplied, so screens without
  /// calling or messaging support simply do not show them.
  final VoidCallback? onCall;
  final VoidCallback? onMessage;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return DarbCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppTokens.spaceMedium),
      child: Row(
        children: [
          if (onCall != null || onMessage != null) ...[
            if (onCall != null)
              _CircleAction(icon: Icons.call, onPressed: onCall!, filled: true),
            if (onCall != null && onMessage != null)
              const SizedBox(width: AppTokens.spaceSmall),
            if (onMessage != null)
              _CircleAction(
                icon: Icons.chat_bubble_outline,
                onPressed: onMessage!,
                filled: false,
              ),
            const SizedBox(width: AppTokens.spaceMedium),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: theme.textTheme.titleMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (vehicleLabel != null)
                  Text(
                    vehicleLabel!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: AppTheme.onSurfaceVariant,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                if (rating != null) ...[
                  const SizedBox(height: AppTokens.spaceExtraSmall),
                  _RatingRow(rating: rating!, tripCount: tripCount),
                ],
                if (statusLabel != null) ...[
                  const SizedBox(height: AppTokens.spaceSmall),
                  StatusChip(label: statusLabel!, tone: statusTone),
                ],
              ],
            ),
          ),
          const SizedBox(width: AppTokens.spaceMedium),
          RoleAvatar(name: name, role: role, imageUrl: imageUrl),
        ],
      ),
    );
  }
}

class _RatingRow extends StatelessWidget {
  const _RatingRow({required this.rating, this.tripCount});

  final double rating;
  final int? tripCount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Every text child is flexible: on a narrow card the contact actions and
    // avatar leave little room, and a rigid row would overflow rather than
    // ellipsize.
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.star, size: 14, color: SemanticColors.warning),
        const SizedBox(width: AppTokens.spaceExtraSmall),
        // Latin digits for figures.
        Flexible(
          child: Text(
            rating.toStringAsFixed(1),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.labelMedium?.copyWith(
              color: AppTheme.onSurface,
            ),
          ),
        ),
        if (tripCount != null) ...[
          const SizedBox(width: AppTokens.spaceExtraSmall),
          Flexible(
            child: Text(
              '($tripCount)',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.labelMedium?.copyWith(
                color: AppTheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _CircleAction extends StatelessWidget {
  const _CircleAction({
    required this.icon,
    required this.onPressed,
    required this.filled,
  });

  final IconData icon;
  final VoidCallback onPressed;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: filled ? AppTheme.primary : AppTheme.surfaceContainerHigh,
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: SizedBox(
          width: AppTokens.minTouchTarget,
          height: AppTokens.minTouchTarget,
          child: Icon(
            icon,
            size: 20,
            color: filled ? AppTheme.onPrimary : AppTheme.primary,
          ),
        ),
      ),
    );
  }
}

/// A bookable or in-progress trip.
///
/// [priceLabel] is optional and formatted by the caller — the API exposes no
/// fare field today, so the price row disappears rather than showing a zero.
class TripCard extends StatelessWidget {
  const TripCard({
    required this.title,
    this.subtitle,
    this.from,
    this.to,
    this.priceLabel,
    this.priceCaption,
    this.statusLabel,
    this.statusTone = StatusTone.neutral,
    this.actionLabel,
    this.onAction,
    this.onTap,
    this.details = const [],
    super.key,
  });

  final String title;
  final String? subtitle;
  final String? from;
  final String? to;
  final String? priceLabel;
  final String? priceCaption;
  final String? statusLabel;
  final StatusTone statusTone;
  final String? actionLabel;
  final VoidCallback? onAction;
  final VoidCallback? onTap;

  /// Icon/text pairs such as departure time or vehicle.
  final List<({IconData icon, String text})> details;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return DarbCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppTokens.spaceMedium),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
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
                      style: theme.textTheme.titleMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (subtitle != null)
                      Text(
                        subtitle!,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: AppTheme.onSurfaceVariant,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                ),
              ),
              if (priceLabel != null) ...[
                const SizedBox(width: AppTokens.spaceSmall),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      priceLabel!,
                      style: theme.textTheme.titleLarge?.copyWith(
                        color: AppTheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (priceCaption != null)
                      Text(
                        priceCaption!,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: AppTheme.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
              ],
            ],
          ),
          if (from != null && to != null) ...[
            const SizedBox(height: AppTokens.gutterMobile),
            RouteChip(from: from!, to: to!, compact: true),
          ],
          if (details.isNotEmpty) ...[
            const Divider(),
            for (final detail in details)
              Padding(
                padding: const EdgeInsets.only(
                  bottom: AppTokens.spaceExtraSmall,
                ),
                child: Row(
                  children: [
                    Icon(
                      detail.icon,
                      size: 16,
                      color: AppTheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: AppTokens.spaceSmall),
                    Expanded(
                      child: Text(
                        detail.text,
                        style: theme.textTheme.bodySmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
          ],
          if (statusLabel != null || (actionLabel != null && onAction != null))
            Padding(
              padding: const EdgeInsets.only(top: AppTokens.gutterMobile),
              child: Row(
                children: [
                  if (statusLabel != null)
                    Flexible(
                      child: StatusChip(label: statusLabel!, tone: statusTone),
                    ),
                  const Spacer(),
                  if (actionLabel != null && onAction != null)
                    FilledButton(
                      onPressed: onAction,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(0, AppTokens.minTouchTarget),
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppTokens.spaceLarge,
                        ),
                      ),
                      child: Text(actionLabel!),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// A merchant parcel or order.
class ShipmentCard extends StatelessWidget {
  const ShipmentCard({
    required this.reference,
    this.from,
    this.to,
    this.statusLabel,
    this.statusTone = StatusTone.neutral,
    this.details = const [],
    this.onTap,
    super.key,
  });

  /// Order or parcel reference, e.g. "#4921".
  final String reference;

  final String? from;
  final String? to;
  final String? statusLabel;
  final StatusTone statusTone;
  final List<({IconData icon, String text})> details;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return DarbCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppTokens.spaceMedium),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: AppTokens.spaceSmall + 2,
            height: AppTokens.spaceSmall + 2,
            margin: const EdgeInsets.only(top: AppTokens.spaceExtraSmall + 2),
            decoration: const BoxDecoration(
              color: SemanticColors.parcel,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: AppTokens.gutterMobile),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  reference,
                  style: theme.textTheme.titleMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (from != null && to != null) ...[
                  const SizedBox(height: AppTokens.spaceExtraSmall),
                  RouteChip(from: from!, to: to!, compact: true),
                ],
                for (final detail in details)
                  Padding(
                    padding: const EdgeInsets.only(
                      top: AppTokens.spaceExtraSmall,
                    ),
                    child: Row(
                      children: [
                        Icon(
                          detail.icon,
                          size: 14,
                          color: AppTheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: AppTokens.spaceExtraSmall),
                        Expanded(
                          child: Text(
                            detail.text,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: AppTheme.onSurfaceVariant,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          if (statusLabel != null) ...[
            const SizedBox(width: AppTokens.spaceSmall),
            StatusChip(label: statusLabel!, tone: statusTone),
          ],
        ],
      ),
    );
  }
}

/// A compact metric tile, e.g. "8 active shipments".
///
/// Used for the dashboard summary rows. Renders whatever the caller computed
/// from real data; it does not fetch or invent anything itself.
class MetricTile extends StatelessWidget {
  const MetricTile({
    required this.value,
    required this.label,
    this.caption,
    this.icon,
    this.emphasis = false,
    super.key,
  });

  final String value;
  final String label;
  final String? caption;
  final IconData? icon;

  /// Fills the tile with the brand colour for the single most important metric.
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final foreground = emphasis ? AppTheme.onPrimary : AppTheme.onSurface;
    final muted = emphasis
        ? AppTheme.onPrimary.withValues(alpha: 0.8)
        : AppTheme.onSurfaceVariant;

    return Container(
      padding: const EdgeInsets.all(AppTokens.spaceMedium),
      decoration: BoxDecoration(
        color: emphasis ? AppTheme.primary : AppTheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(AppTokens.radiusMedium),
        border: Border.all(
          color: emphasis ? AppTheme.primary : AppTheme.outlineVariant,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: theme.textTheme.bodySmall?.copyWith(color: muted),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (icon != null) Icon(icon, size: 20, color: muted),
            ],
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          Text(
            value,
            style: theme.textTheme.displayMedium?.copyWith(
              color: foreground,
              fontWeight: FontWeight.w700,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          if (caption != null)
            Text(
              caption!,
              style: theme.textTheme.bodySmall?.copyWith(color: muted),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
        ],
      ),
    );
  }
}
