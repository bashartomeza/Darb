import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import '../theme/semantic_colors.dart';

/// Where a step sits relative to progress.
enum TimelineStepState { completed, current, upcoming }

/// One entry in a [TimelineTracker].
class TimelineStep {
  const TimelineStep({
    required this.title,
    required this.state,
    this.subtitle,
    this.trailing,
  });

  final String title;
  final String? subtitle;

  /// Optional end-aligned text, typically a timestamp.
  final String? trailing;

  final TimelineStepState state;
}

/// A vertical progress tracker for trips and parcel journeys.
///
/// Completed steps are navy, the current step is warm orange (the design
/// system's kinetic colour), and upcoming steps recede to grey. The connector
/// sits on the start edge, so it runs down the right-hand side under Arabic
/// and the left under English without any per-locale branching.
class TimelineTracker extends StatelessWidget {
  const TimelineTracker({required this.steps, super.key});

  final List<TimelineStep> steps;

  Color _colorFor(TimelineStepState state) => switch (state) {
    TimelineStepState.completed => SemanticColors.completedRoute,
    TimelineStepState.current => SemanticColors.activeRoute,
    TimelineStepState.upcoming => SemanticColors.upcomingRoute,
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < steps.length; i++)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _Connector(
                  color: _colorFor(steps[i].state),
                  isCurrent: steps[i].state == TimelineStepState.current,
                  drawTail: i != steps.length - 1,
                  tailColor: _colorFor(
                    // The tail belongs to the segment between this step and the
                    // next, so it takes the *next* step's state.
                    steps[i + 1 < steps.length ? i + 1 : i].state,
                  ),
                ),
                const SizedBox(width: AppTokens.gutterMobile),
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(
                      bottom: i == steps.length - 1 ? 0 : AppTokens.spaceLarge,
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                steps[i].title,
                                style: theme.textTheme.titleSmall?.copyWith(
                                  color:
                                      steps[i].state ==
                                          TimelineStepState.upcoming
                                      ? AppTheme.onSurfaceVariant
                                      : AppTheme.onSurface,
                                ),
                              ),
                              if (steps[i].subtitle != null)
                                Text(
                                  steps[i].subtitle!,
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: AppTheme.onSurfaceVariant,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        if (steps[i].trailing != null) ...[
                          const SizedBox(width: AppTokens.spaceSmall),
                          Text(
                            steps[i].trailing!,
                            style: theme.textTheme.labelMedium?.copyWith(
                              color: AppTheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _Connector extends StatelessWidget {
  const _Connector({
    required this.color,
    required this.isCurrent,
    required this.drawTail,
    required this.tailColor,
  });

  final Color color;
  final bool isCurrent;
  final bool drawTail;
  final Color tailColor;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: AppTokens.spaceMedium,
      child: Column(
        children: [
          Container(
            width: isCurrent ? 16 : 12,
            height: isCurrent ? 16 : 12,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              border: isCurrent
                  ? Border.all(color: AppTheme.primaryContainer, width: 3)
                  : null,
            ),
          ),
          if (drawTail)
            Expanded(
              child: Container(
                width: 2,
                color: tailColor.withValues(alpha: 0.4),
              ),
            ),
        ],
      ),
    );
  }
}
