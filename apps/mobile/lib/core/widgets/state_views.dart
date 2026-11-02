import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/passenger_theme.dart';
import '../theme/app_tokens.dart';
import '../theme/semantic_colors.dart';
import 'darb_button.dart';

/// Empty state: a monochromatic teal icon, a short explanation, and a single
/// clear action underneath.
///
/// All copy is passed in already localised.
class EmptyState extends StatelessWidget {
  const EmptyState({
    required this.title,
    this.message,
    this.icon = Icons.inbox_outlined,
    this.actionLabel,
    this.onAction,
    super.key,
  });

  final String title;
  final String? message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTokens.spaceLarge,
        vertical: AppTokens.spaceExtraLarge,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: PassengerTheme.isActive(context)
                  ? PassengerStyle.panel
                  : AppTheme.surfaceContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(
              icon,
              size: 32,
              color: PassengerTheme.isActive(context)
                  ? PassengerStyle.orange
                  : AppTheme.primary,
            ),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          Text(
            title,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleLarge,
          ),
          if (message != null) ...[
            const SizedBox(height: AppTokens.spaceSmall),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: AppTheme.onSurfaceVariant,
              ),
            ),
          ],
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: AppTokens.spaceLarge),
            DarbButton(label: actionLabel!, onPressed: onAction, expand: false),
          ],
        ],
      ),
    );
  }
}

/// Error state with a retry affordance.
///
/// Keeps the same silhouette as [EmptyState] so a list swapping between the two
/// does not visibly jump.
class ErrorStateView extends StatelessWidget {
  const ErrorStateView({
    required this.title,
    this.message,
    this.retryLabel,
    this.onRetry,
    super.key,
  });

  final String title;
  final String? message;
  final String? retryLabel;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTokens.spaceLarge,
        vertical: AppTokens.spaceExtraLarge,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: const BoxDecoration(
              color: SemanticColors.errorContainer,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.error_outline,
              size: 32,
              color: SemanticColors.onErrorContainer,
            ),
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          Text(
            title,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleLarge,
          ),
          if (message != null) ...[
            const SizedBox(height: AppTokens.spaceSmall),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: AppTheme.onSurfaceVariant,
              ),
            ),
          ],
          if (retryLabel != null && onRetry != null) ...[
            const SizedBox(height: AppTokens.spaceLarge),
            DarbButton.outline(
              label: retryLabel!,
              onPressed: onRetry,
              icon: Icons.refresh,
              expand: false,
            ),
          ],
        ],
      ),
    );
  }
}

/// A shimmering placeholder block.
///
/// Used instead of a spinner where the shape of the incoming content is already
/// known, which reads as faster on slow connections.
class LoadingSkeleton extends StatefulWidget {
  const LoadingSkeleton({
    this.height = 16,
    this.width,
    this.radius = AppTokens.radiusDefault,
    super.key,
  });

  /// A block roughly the size of a card, for list placeholders.
  const LoadingSkeleton.card({super.key})
    : height = 120,
      width = double.infinity,
      radius = AppTokens.radiusDefault;

  final double height;
  final double? width;
  final double radius;

  @override
  State<LoadingSkeleton> createState() => _LoadingSkeletonState();
}

class _LoadingSkeletonState extends State<LoadingSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => Container(
        height: widget.height,
        width: widget.width,
        decoration: BoxDecoration(
          color: Color.lerp(
            PassengerTheme.isActive(context)
                ? PassengerStyle.panel
                : AppTheme.surfaceContainer,
            PassengerTheme.isActive(context)
                ? PassengerStyle.border
                : AppTheme.surfaceContainerHighest,
            _controller.value,
          ),
          borderRadius: BorderRadius.circular(widget.radius),
        ),
      ),
    );
  }
}

/// A full-width banner for connectivity or session problems.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({
    required this.message,
    this.icon = Icons.cloud_off_outlined,
    this.tone = BannerTone.warning,
    super.key,
  });

  final String message;
  final IconData icon;
  final BannerTone tone;

  @override
  Widget build(BuildContext context) {
    final background = tone == BannerTone.warning
        ? SemanticColors.warningContainer
        : SemanticColors.errorContainer;
    final foreground = tone == BannerTone.warning
        ? SemanticColors.onWarningContainer
        : SemanticColors.onErrorContainer;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: AppTokens.spaceMedium,
        vertical: AppTokens.gutterMobile,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AppTokens.radiusDefault),
      ),
      child: Row(
        children: [
          Icon(icon, size: 20, color: foreground),
          const SizedBox(width: AppTokens.spaceSmall),
          Expanded(
            child: Text(
              message,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: foreground),
            ),
          ),
        ],
      ),
    );
  }
}

/// Severity of an [OfflineBanner].
enum BannerTone { warning, error }
