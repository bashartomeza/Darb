import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/core/presentation/localized_labels.dart';
import 'package:darb_mobile/features/matching/presentation/match_detail_screen.dart';
import 'package:darb_mobile/l10n/app_localizations_ar.dart';
import 'package:darb_mobile/l10n/app_localizations_en.dart';

void main() {
  test('passenger match statuses use localized presentation labels', () {
    expect(localizedMatchStatus(AppLocalizationsAr(), 'proposed'), 'مقترحة');
    expect(localizedMatchStatus(AppLocalizationsEn(), 'accepted'), 'Accepted');
    expect(localizedMatchStatus(AppLocalizationsEn(), 'unknown'), 'unknown');
    expect(
      AppLocalizationsAr().routeMatchExplanation,
      contains('اختار درب هذا السائق'),
    );
    expect(
      AppLocalizationsAr().parcelBatchExplanationDemo(5),
      contains('5 طرود'),
    );
    expect(localizedLocationSource(AppLocalizationsAr(), 'simulated'), 'محاكى');
  });
}
