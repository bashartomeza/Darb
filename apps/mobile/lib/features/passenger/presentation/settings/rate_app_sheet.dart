import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/i18n/locale_controller.dart';
import '../../../../core/theme/passenger_theme.dart';
import '../../../app_rating/data/app_rating_repository.dart';
import '../../../../l10n/app_localizations.dart';

/// Keys an earlier build used to keep the rating on the phone only. The rating
/// now lives in the database; these are removed when the sheet opens.
const retiredRatingStorageKeys = [
  'passenger_app_rating',
  'passenger_app_rating_feedback',
];

Future<void> showRateAppSheet(BuildContext context) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const RateAppSheet(),
    );

/// Interactive 1–5 star rating with an optional note.
class RateAppSheet extends ConsumerStatefulWidget {
  const RateAppSheet({super.key});

  @override
  ConsumerState<RateAppSheet> createState() => _RateAppSheetState();
}

class _RateAppSheetState extends ConsumerState<RateAppSheet> {
  final _feedback = TextEditingController();
  int _rating = 0;
  bool _saving = false;
  bool _thanked = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _restore();
  }

  /// Shows the rating saved on the server, if any. A failed read just leaves
  /// the form empty: the user can still rate.
  Future<void> _restore() async {
    try {
      final prefs = await ref.read(sharedPreferencesProvider.future);
      for (final key in retiredRatingStorageKeys) {
        await prefs.remove(key);
      }
    } catch (_) {
      // Nothing to clean, or storage unavailable.
    }
    try {
      final saved = await ref.read(appRatingRepositoryProvider).fetch();
      if (!mounted || saved == null || _rating != 0) return;
      setState(() {
        _rating = saved.stars;
        _feedback.text = saved.feedback ?? '';
      });
    } catch (_) {
      // Leave the form empty.
    }
  }

  @override
  void dispose() {
    _feedback.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_rating == 0 || _saving) return;
    setState(() {
      _saving = true;
      _failed = false;
    });
    try {
      await ref
          .read(appRatingRepositoryProvider)
          .save(stars: _rating, feedback: _feedback.text.trim());
      if (mounted) setState(() => _thanked = true);
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + inset),
        child: SingleChildScrollView(
          child: _thanked ? _thanks(context) : _form(context),
        ),
      ),
    );
  }

  Widget _thanks(BuildContext context) {
    return Column(
      key: const ValueKey('ratingThanks'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(
          Icons.favorite_rounded,
          color: PassengerStyle.orange,
          size: 44,
        ),
        const SizedBox(height: 12),
        Text(
          AppLocalizations.of(context).rateAppThank,
          textAlign: TextAlign.center,
          style: PassengerStyle.sectionTitle,
        ),
        const SizedBox(height: 6),
        Text(
          AppLocalizations.of(context).rateAppFeedbackHelpsUsImprove,
          textAlign: TextAlign.center,
          style: PassengerStyle.cardBody,
        ),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(AppLocalizations.of(context).rateAppDone),
        ),
      ],
    );
  }

  Widget _form(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          AppLocalizations.of(context).settingsRateOurApp,
          textAlign: TextAlign.center,
          style: PassengerStyle.sectionTitle,
        ),
        const SizedBox(height: 6),
        Text(
          AppLocalizations.of(context).rateAppHowExperienceDarb,
          textAlign: TextAlign.center,
          style: PassengerStyle.cardBody,
        ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          textDirection: TextDirection.ltr,
          children: [
            for (var star = 1; star <= 5; star++)
              IconButton(
                key: ValueKey('ratingStar-$star'),
                tooltip: '$star',
                iconSize: 38,
                onPressed: () => setState(() => _rating = star),
                icon: Icon(
                  star <= _rating
                      ? Icons.star_rounded
                      : Icons.star_outline_rounded,
                  color: star <= _rating
                      ? PassengerStyle.orange
                      : PassengerStyle.iconMuted,
                ),
              ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          key: const ValueKey('ratingFeedback'),
          controller: _feedback,
          minLines: 3,
          maxLines: 4,
          maxLength: 500,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            hintText: AppLocalizations.of(context).rateAppTellUsMoreOptional,
          ),
        ),
        if (_failed) ...[
          Text(
            AppLocalizations.of(context).rateAppRatingCouldNotSent,
            key: const ValueKey('ratingError'),
            textAlign: TextAlign.center,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        const SizedBox(height: 8),
        FilledButton(
          key: const ValueKey('ratingSubmit'),
          onPressed: _rating == 0 || _saving ? null : _submit,
          child: Text(AppLocalizations.of(context).rateAppSubmit),
        ),
      ],
    );
  }
}
