import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/i18n/locale_controller.dart';
import '../../../../core/theme/passenger_theme.dart';
import '../../../auth/presentation/auth_completion_screen.dart' show authText;

/// Where the rating is kept. The API has no endpoint for app ratings, so the
/// passenger's last rating and note are stored on the device only.
const ratingStorageKey = 'passenger_app_rating';
const ratingFeedbackStorageKey = 'passenger_app_rating_feedback';

Future<void> showRateAppSheet(BuildContext context) => showModalBottomSheet<void>(
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

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    final prefs = await ref.read(sharedPreferencesProvider.future);
    if (!mounted) return;
    setState(() {
      _rating = prefs.getInt(ratingStorageKey) ?? 0;
      _feedback.text = prefs.getString(ratingFeedbackStorageKey) ?? '';
    });
  }

  @override
  void dispose() {
    _feedback.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_rating == 0 || _saving) return;
    setState(() => _saving = true);
    final prefs = await ref.read(sharedPreferencesProvider.future);
    await prefs.setInt(ratingStorageKey, _rating);
    await prefs.setString(ratingFeedbackStorageKey, _feedback.text.trim());
    if (mounted) {
      setState(() {
        _saving = false;
        _thanked = true;
      });
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
          authText(context, 'Thank you!', 'شكراً لك!'),
          textAlign: TextAlign.center,
          style: PassengerStyle.sectionTitle,
        ),
        const SizedBox(height: 6),
        Text(
          authText(
            context,
            'Your feedback helps us improve Masari.',
            'ملاحظاتك تساعدنا على تحسين مسار.',
          ),
          textAlign: TextAlign.center,
          style: PassengerStyle.cardBody,
        ),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(authText(context, 'Done', 'تم')),
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
          authText(context, 'Rate Our App', 'قيّم التطبيق'),
          textAlign: TextAlign.center,
          style: PassengerStyle.sectionTitle,
        ),
        const SizedBox(height: 6),
        Text(
          authText(
            context,
            'How is your experience with Masari?',
            'كيف تجد تجربتك مع مسار؟',
          ),
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
            hintText: authText(
              context,
              'Tell us more (optional)',
              'أخبرنا المزيد (اختياري)',
            ),
          ),
        ),
        const SizedBox(height: 8),
        FilledButton(
          key: const ValueKey('ratingSubmit'),
          onPressed: _rating == 0 || _saving ? null : _submit,
          child: Text(authText(context, 'Submit', 'إرسال')),
        ),
      ],
    );
  }
}
