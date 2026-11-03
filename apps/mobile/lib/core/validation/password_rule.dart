import 'dart:convert';

import 'package:flutter/widgets.dart';

import '../../l10n/app_localizations.dart';

/// The one password rule for every password field in the app, mirroring the
/// server (apps/api/src/lib/passwordRule.ts):
///
/// - at least 8 characters,
/// - at least one letter (any script: Arabic and Latin both count),
/// - at least one digit (0-9 or Arabic-Indic ٠-٩),
/// - at most 72 UTF-8 bytes (bcrypt's limit).
///
/// Sign-in never applies it, so passwords set under an older rule keep working.
const passwordMinimumCharacters = 8;
const passwordMaximumUtf8Bytes = 72;

final _letter = RegExp(r'\p{L}', unicode: true);
final _digit = RegExp(r'[0-9٠-٩]');

bool validNewPassword(String value) =>
    value.runes.length >= passwordMinimumCharacters &&
    utf8.encode(value).length <= passwordMaximumUtf8Bytes &&
    _letter.hasMatch(value) &&
    _digit.hasMatch(value);

/// The rule in words, shown under every new-password field and as its error.
/// Falls back to a direct lookup where no localizations delegate is installed.
String passwordRuleHint(BuildContext context) =>
    (Localizations.of<AppLocalizations>(context, AppLocalizations) ??
            lookupAppLocalizations(Localizations.localeOf(context)))
        .passwordRuleHint;
