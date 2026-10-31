import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../data/trip_repository.dart';

/// Asks the passenger to rate a completed trip, once. Ratings are private:
/// the copy says so, and the driver never receives them.
class TripRatingPrompt extends ConsumerStatefulWidget {
  const TripRatingPrompt({required this.tripId, super.key});

  final String tripId;

  @override
  ConsumerState<TripRatingPrompt> createState() => _TripRatingPromptState();
}

class _TripRatingPromptState extends ConsumerState<TripRatingPrompt> {
  bool _loading = true;
  bool _rated = false;
  bool _justRated = false;
  bool _submitting = false;
  int _stars = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadExisting();
  }

  Future<void> _loadExisting() async {
    try {
      final existing = await ref
          .read(tripRepositoryProvider)
          .myRating(widget.tripId);
      if (!mounted) return;
      setState(() {
        _rated = existing != null;
        _stars = existing ?? 0;
        _loading = false;
      });
    } catch (_) {
      // If the lookup fails, still offer the prompt; the server enforces one
      // rating per trip.
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ref
          .read(tripRepositoryProvider)
          .submitRating(widget.tripId, _stars);
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _rated = true;
        _justRated = true;
      });
    } catch (error) {
      if (!mounted) return;
      if (error is ApiException && error.statusCode == 409) {
        setState(() {
          _submitting = false;
          _rated = true;
        });
        return;
      }
      setState(() {
        _submitting = false;
        _error = error is ApiException && error.type == ApiErrorType.network
            ? l10n.networkUnavailable
            : l10n.ratingFailed;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    if (_rated) {
      return Padding(
        key: const ValueKey('tripRatingDone'),
        padding: const EdgeInsets.symmetric(vertical: AppTokens.spaceSmall),
        child: Text(
          _justRated ? l10n.ratingThanks : l10n.ratingAlreadyRated,
          style: theme.textTheme.bodyMedium,
        ),
      );
    }

    return Container(
      key: const ValueKey('tripRatingPrompt'),
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppTokens.spaceSmall),
      padding: const EdgeInsets.all(AppTokens.spaceMedium),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.ratingPromptTitle, style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(l10n.ratingPromptBody, style: theme.textTheme.bodySmall),
          const SizedBox(height: AppTokens.spaceSmall),
          Row(
            children: [
              for (var star = 1; star <= 5; star++)
                IconButton(
                  key: ValueKey('ratingStar-$star'),
                  tooltip: l10n.ratingStarLabel(star),
                  onPressed: _submitting
                      ? null
                      : () => setState(() => _stars = star),
                  icon: Icon(
                    star <= _stars
                        ? Icons.star_rounded
                        : Icons.star_border_rounded,
                    color: const Color(0xFFC66A3D),
                  ),
                ),
            ],
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTokens.spaceSmall),
              child: Text(
                _error!,
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ),
          FilledButton(
            key: const ValueKey('ratingSubmit'),
            onPressed: _stars == 0 || _submitting ? null : _submit,
            child: Text(l10n.ratingSubmit),
          ),
        ],
      ),
    );
  }
}
