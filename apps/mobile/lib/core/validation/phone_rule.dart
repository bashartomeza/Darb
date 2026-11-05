/// The mobile number asked at sign-up (and editable in the profile).
///
/// A quick check before sending; the server applies the real rule
/// (apps/api/src/lib/phone.ts, `normalizeContactPhone`) and stores the
/// number as E.164. Accepted: a local number such as 0599123456 or an
/// international one such as +970599123456; spaces, dashes and brackets are
/// ignored and Arabic-Indic digits are read as digits.
bool isValidMobileNumber(String? value) {
  final text = _latinDigits((value ?? '').trim());
  if (text.isEmpty || RegExp(r'[^0-9+()\- ]').hasMatch(text)) return false;
  final compact = text.replaceAll(RegExp(r'[()\- ]'), '');
  if (compact.startsWith('+')) {
    return RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(compact);
  }
  return RegExp(r'^0\d{8,9}$').hasMatch(compact);
}

String _latinDigits(String value) {
  final out = StringBuffer();
  for (final unit in value.runes) {
    if (unit >= 0x0660 && unit <= 0x0669) {
      out.writeCharCode(0x30 + unit - 0x0660);
    } else if (unit >= 0x06f0 && unit <= 0x06f9) {
      out.writeCharCode(0x30 + unit - 0x06f0);
    } else {
      out.writeCharCode(unit);
    }
  }
  return out.toString();
}
