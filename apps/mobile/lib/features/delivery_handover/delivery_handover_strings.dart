import 'package:flutter/widgets.dart';

import '../../core/api/api_error.dart';

/// English and Arabic copy for the receiver handover flow. Kept beside the
/// feature so any parcel screen (merchant or passenger sender, driver) can use
/// it without touching the shared ARB files.
class HandoverStrings {
  const HandoverStrings._(this._ar);

  final bool _ar;

  static HandoverStrings of(BuildContext context) =>
      HandoverStrings._(Localizations.localeOf(context).languageCode == 'ar');

  String _t(String en, String ar) => _ar ? ar : en;

  String get senderTitle => _t('Receiver handover code', 'رمز تسليم المستلم');
  String get senderHint => _t(
    'Give this code to the person receiving the parcel. The driver will ask for it at hand-over. Do not share it before the parcel arrives.',
    'أعطِ هذا الرمز للشخص الذي سيستلم الطرد. سيطلبه السائق عند التسليم. لا تشاركه قبل وصول الطرد.',
  );
  String get codeHidden => _t(
    'A code was issued. For safety it is shown only once; get a new one if you need to read it again.',
    'تم إصدار رمز. يظهر مرة واحدة فقط لأسباب أمنية؛ اطلب رمزاً جديداً إذا احتجت لقراءته مجدداً.',
  );
  String get notIssued => _t(
    'No handover code yet. Create one to give to the receiver.',
    'لا يوجد رمز تسليم بعد. أنشئ رمزاً لتعطيه للمستلم.',
  );
  String get createCode => _t('Create handover code', 'إنشاء رمز التسليم');
  String get newCode => _t('Get a new code', 'الحصول على رمز جديد');
  String get locked => _t(
    'Too many wrong attempts. Get a new code to unlock the hand-over.',
    'محاولات خاطئة كثيرة. احصل على رمز جديد لفتح التسليم.',
  );
  String get expired => _t(
    'This code has expired. Get a new code.',
    'انتهت صلاحية هذا الرمز. احصل على رمز جديد.',
  );
  String attemptsLeft(int count) =>
      _t('$count wrong attempts left', 'تبقّت $count محاولات خاطئة');
  String get confirmedByCode => _t(
    'Delivered. The receiver confirmed with the code.',
    'تم التسليم. أكّد المستلم بالرمز.',
  );
  String get confirmedUnavailable => _t(
    'Delivered without the receiver: the driver reported the receiver was unavailable.',
    'تم التسليم دون المستلم: أبلغ السائق أن المستلم غير متوفر.',
  );
  String get confirmedAdmin => _t(
    'Delivery was closed by Masari support.',
    'أغلق دعم مسار عملية التسليم.',
  );
  String reasonLabel(String reason) =>
      _t('Driver note: $reason', 'ملاحظة السائق: $reason');
  String get couldNotLoad => _t(
    'Could not load the handover code. Pull to refresh and try again.',
    'تعذّر تحميل رمز التسليم. اسحب للتحديث وحاول مجدداً.',
  );

  String get driverTitle => _t('Confirm hand-over', 'تأكيد التسليم');
  String get driverIntro => _t(
    'Ask the receiver for their 6-digit code and enter it below.',
    'اطلب من المستلم رمزه المكوّن من 6 أرقام وأدخله أدناه.',
  );
  String codeFieldLabel(int index, int total) => total > 1
      ? _t(
          'Code for parcel order $index of $total',
          'رمز الطلب $index من $total',
        )
      : _t('Receiver code', 'رمز المستلم');
  String get confirm => _t('Confirm delivery', 'تأكيد التسليم');
  String get cancel => _t('Cancel', 'إلغاء');
  String get receiverUnavailable =>
      _t('Receiver unavailable', 'المستلم غير متوفر');
  String get unavailableIntro => _t(
    'Only use this if the receiver cannot give the code. Your reason is recorded and Masari will review it.',
    'استخدم هذا فقط إذا تعذّر على المستلم إعطاء الرمز. يُسجَّل سببك وستراجعه مسار.',
  );
  String get reasonLabelField =>
      _t('Reason (at least 10 characters)', 'السبب (10 أحرف على الأقل)');
  String get confirmUnavailable =>
      _t('Complete without receiver', 'إتمام دون المستلم');
  String get back => _t('Back', 'رجوع');
  String get invalidCodeFormat =>
      _t('Enter the 6-digit code.', 'أدخل الرمز المكوّن من 6 أرقام.');
  String get reasonTooShort => _t(
    'Describe why the receiver was unavailable (at least 10 characters).',
    'اشرح سبب عدم توفر المستلم (10 أحرف على الأقل).',
  );

  /// Maps an API failure to a message the driver can act on.
  String errorFor(Object error) {
    if (error is ApiException) {
      switch (error.message) {
        case 'invalid_handover_code':
          return _t(
            'That code is not right. Check it with the receiver and try again.',
            'هذا الرمز غير صحيح. تحقق منه مع المستلم وحاول مجدداً.',
          );
        case 'handover_locked':
          return _t(
            'Too many wrong codes. The sender must issue a new code, or use "Receiver unavailable".',
            'رموز خاطئة كثيرة. على المرسل إصدار رمز جديد، أو استخدم «المستلم غير متوفر».',
          );
        case 'handover_expired':
          return _t(
            'This code has expired. The sender must issue a new code, or use "Receiver unavailable".',
            'انتهت صلاحية الرمز. على المرسل إصدار رمز جديد، أو استخدم «المستلم غير متوفر».',
          );
        case 'handover_not_issued':
          return _t(
            'No code was issued for this parcel. Use "Receiver unavailable" or ask the sender to create one.',
            'لم يُصدر رمز لهذا الطرد. استخدم «المستلم غير متوفر» أو اطلب من المرسل إنشاء رمز.',
          );
        case 'delivery_confirmation_required':
          return _t(
            'The receiver must confirm before the delivery can be completed.',
            'يجب أن يؤكد المستلم قبل إتمام التسليم.',
          );
      }
    }
    return _t(
      'Could not confirm the delivery. Try again.',
      'تعذّر تأكيد التسليم. حاول مجدداً.',
    );
  }
}
