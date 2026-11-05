import 'package:darb_mobile/core/validation/phone_rule.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('accepts local and international mobile numbers', () {
    for (final value in [
      '0599123456',
      ' 0599 123 456 ',
      '059-912-3456',
      '+970599123456',
      '+970 599-123-456',
      '+972501234567',
      '٠٥٩٩١٢٣٤٥٦',
    ]) {
      expect(isValidMobileNumber(value), isTrue, reason: value);
    }
  });

  test('refuses anything that is not a number', () {
    for (final value in [
      null,
      '',
      '   ',
      '123456',
      '0599',
      'not a number',
      '059912abc',
      '+0599123456',
      '00970599123456789012',
      '+970',
    ]) {
      expect(isValidMobileNumber(value), isFalse, reason: '$value');
    }
  });
}
