import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:darb_mobile/core/validation/password_rule.dart';

void main() {
  group('validNewPassword mirrors the server rule', () {
    const refused = {
      '7 characters': 'abcde12',
      'letters only': 'abcdefghij',
      'digits only': '12345678',
      'Arabic-Indic digits only': '١٢٣٤٥٦٧٨',
      'Arabic letters only': 'كلمةسريةطويلة',
      'spaces and symbols only': '        !!',
      'seven characters with an emoji': 'abcde1😀',
    };
    for (final entry in refused.entries) {
      test('refuses ${entry.key}', () {
        expect(validNewPassword(entry.value), isFalse);
      });
    }

    const accepted = {
      '8 characters with a letter and a digit': 'abcdefg1',
      'a digit first': '1abcdefg',
      'Arabic letters with Arabic-Indic digits': 'كلمةسر١٢',
      'Arabic letters with a Western digit': 'كلمةسرية1',
      'Latin letters with an Arabic-Indic digit': 'password٣',
      'spaces inside': 'my pass 2026',
    };
    for (final entry in accepted.entries) {
      test('accepts ${entry.key}', () {
        expect(validNewPassword(entry.value), isTrue);
      });
    }

    test('measures the 72-byte ceiling in UTF-8 bytes', () {
      expect(validNewPassword('a1${'b' * 70}'), isTrue); // 72 bytes
      expect(validNewPassword('a1${'b' * 71}'), isFalse); // 73 bytes
      // 37 characters but 73 bytes: each Arabic letter is two bytes.
      expect(validNewPassword('${'ب' * 36}1'), isFalse);
      expect(validNewPassword('${'ب' * 35}12'), isTrue); // 72 bytes
    });
  });

  testWidgets('the hint reads the same in English and Arabic everywhere', (
    tester,
  ) async {
    final hints = <String>[];
    for (final locale in const [Locale('en'), Locale('ar')]) {
      await tester.pumpWidget(
        Localizations(
          locale: locale,
          delegates: const [DefaultWidgetsLocalizations.delegate],
          child: Builder(
            builder: (context) {
              hints.add(passwordRuleHint(context));
              return const SizedBox();
            },
          ),
        ),
      );
    }
    expect(hints, [
      '8+ characters with a letter and a number',
      '8 أحرف أو أكثر، تتضمن حرفاً ورقماً',
    ]);
  });
}
