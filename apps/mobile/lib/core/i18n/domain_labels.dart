import 'package:flutter/widgets.dart';

class DomainLabels {
  const DomainLabels._();

  static const arabicLocale = Locale('ar');
  static const englishLocale = Locale('en');
  static const defaultLocale = arabicLocale;
  static const localeStorageKey = 'darb_locale';

  static bool isSupported(String? value) => value == 'ar' || value == 'en';
}
