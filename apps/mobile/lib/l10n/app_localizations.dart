import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ar.dart';
import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en'),
  ];

  /// No description provided for @appTitle.
  ///
  /// In ar, this message translates to:
  /// **'درب'**
  String get appTitle;

  /// No description provided for @tagline.
  ///
  /// In ar, this message translates to:
  /// **'لوجستيات ذكية لتشارك المسار'**
  String get tagline;

  /// No description provided for @welcomeTitle.
  ///
  /// In ar, this message translates to:
  /// **'مرحباً بك في درب'**
  String get welcomeTitle;

  /// No description provided for @welcomeBody.
  ///
  /// In ar, this message translates to:
  /// **'هذا تطبيق أندرويد التجريبي المخصص للمسافر والسائق والتاجر. تم تجهيز الهيكل الأساسي فقط في هذه المرحلة.'**
  String get welcomeBody;

  /// No description provided for @arabic.
  ///
  /// In ar, this message translates to:
  /// **'العربية'**
  String get arabic;

  /// No description provided for @english.
  ///
  /// In ar, this message translates to:
  /// **'English'**
  String get english;

  /// No description provided for @mobileDemoPreparation.
  ///
  /// In ar, this message translates to:
  /// **'تحضير العرض التجريبي للهاتف'**
  String get mobileDemoPreparation;

  /// No description provided for @apiEnvironment.
  ///
  /// In ar, this message translates to:
  /// **'بيئة واجهة API'**
  String get apiEnvironment;

  /// No description provided for @continueAction.
  ///
  /// In ar, this message translates to:
  /// **'متابعة'**
  String get continueAction;

  /// No description provided for @shellStatusTitle.
  ///
  /// In ar, this message translates to:
  /// **'حالة هيكل التطبيق'**
  String get shellStatusTitle;

  /// No description provided for @shellStatusBody.
  ///
  /// In ar, this message translates to:
  /// **'العربية هي اللغة الافتراضية، واتجاه الواجهة من اليمين إلى اليسار، وتبديل اللغة محفوظ بعد إعادة التشغيل.'**
  String get shellStatusBody;

  /// No description provided for @language.
  ///
  /// In ar, this message translates to:
  /// **'اللغة'**
  String get language;

  /// No description provided for @configuredApiBaseUrl.
  ///
  /// In ar, this message translates to:
  /// **'رابط API المضبوط'**
  String get configuredApiBaseUrl;

  /// No description provided for @androidOnly.
  ///
  /// In ar, this message translates to:
  /// **'هدف أندرويد فقط'**
  String get androidOnly;

  /// No description provided for @businessFlowsPending.
  ///
  /// In ar, this message translates to:
  /// **'تدفقات المسافر والسائق والتاجر ستضاف في مراحل لاحقة.'**
  String get businessFlowsPending;

  /// No description provided for @diagnostics.
  ///
  /// In ar, this message translates to:
  /// **'تشخيصات تقنية'**
  String get diagnostics;

  /// No description provided for @loadingSession.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ استعادة الجلسة...'**
  String get loadingSession;

  /// No description provided for @sessionRestoreFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذرت استعادة الجلسة. يرجى إعادة المحاولة.'**
  String get sessionRestoreFailed;

  /// No description provided for @retry.
  ///
  /// In ar, this message translates to:
  /// **'إعادة المحاولة'**
  String get retry;

  /// No description provided for @whereToGo.
  ///
  /// In ar, this message translates to:
  /// **'إلى أين تريد الذهاب؟'**
  String get whereToGo;

  /// No description provided for @newRideLabel.
  ///
  /// In ar, this message translates to:
  /// **'رحلة جديدة'**
  String get newRideLabel;

  /// No description provided for @newRideBody.
  ///
  /// In ar, this message translates to:
  /// **'حدد نقطة الانطلاق والوجهة، لنساعدك في إيجاد الرحلة المناسبة.'**
  String get newRideBody;

  /// No description provided for @selectPickupLocation.
  ///
  /// In ar, this message translates to:
  /// **'اختاري موقع الانطلاق'**
  String get selectPickupLocation;

  /// No description provided for @selectDestination.
  ///
  /// In ar, this message translates to:
  /// **'اختاري الوجهة'**
  String get selectDestination;

  /// No description provided for @selectPickupLocationTitle.
  ///
  /// In ar, this message translates to:
  /// **'اختيار موقع الانطلاق'**
  String get selectPickupLocationTitle;

  /// No description provided for @selectDestinationTitle.
  ///
  /// In ar, this message translates to:
  /// **'اختيار الوجهة'**
  String get selectDestinationTitle;

  /// No description provided for @selectBothLocations.
  ///
  /// In ar, this message translates to:
  /// **'اختاري موقع الانطلاق والوجهة أولاً'**
  String get selectBothLocations;

  /// No description provided for @timeField.
  ///
  /// In ar, this message translates to:
  /// **'الوقت'**
  String get timeField;

  /// No description provided for @dateField.
  ///
  /// In ar, this message translates to:
  /// **'التاريخ'**
  String get dateField;

  /// No description provided for @searchRide.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن رحلة'**
  String get searchRide;

  /// No description provided for @increasePassengers.
  ///
  /// In ar, this message translates to:
  /// **'إضافة راكب'**
  String get increasePassengers;

  /// No description provided for @decreasePassengers.
  ///
  /// In ar, this message translates to:
  /// **'إزالة راكب'**
  String get decreasePassengers;

  /// No description provided for @loginWelcomeBack.
  ///
  /// In ar, this message translates to:
  /// **'أهلاً بعودتك'**
  String get loginWelcomeBack;

  /// No description provided for @loginWelcomeSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'يسعدنا عودتك'**
  String get loginWelcomeSubtitle;

  /// No description provided for @signInWelcome.
  ///
  /// In ar, this message translates to:
  /// **'سجل الدخول للمتابعة إلى مساحة عمل دورك.'**
  String get signInWelcome;

  /// No description provided for @signIn.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الدخول'**
  String get signIn;

  /// No description provided for @phone.
  ///
  /// In ar, this message translates to:
  /// **'رقم الهاتف'**
  String get phone;

  /// No description provided for @email.
  ///
  /// In ar, this message translates to:
  /// **'البريد الإلكتروني'**
  String get email;

  /// No description provided for @fullName.
  ///
  /// In ar, this message translates to:
  /// **'الاسم الكامل'**
  String get fullName;

  /// No description provided for @password.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور'**
  String get password;

  /// No description provided for @showPassword.
  ///
  /// In ar, this message translates to:
  /// **'إظهار كلمة المرور'**
  String get showPassword;

  /// No description provided for @hidePassword.
  ///
  /// In ar, this message translates to:
  /// **'إخفاء كلمة المرور'**
  String get hidePassword;

  /// No description provided for @signUp.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء الحساب'**
  String get signUp;

  /// No description provided for @createAccount.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء الحساب'**
  String get createAccount;

  /// No description provided for @createAccountSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'أنشئ حساب مسافر للبدء.'**
  String get createAccountSubtitle;

  /// No description provided for @newToDarb.
  ///
  /// In ar, this message translates to:
  /// **'جديد في درب؟ أنشئ حساباً'**
  String get newToDarb;

  /// No description provided for @alreadyHaveAccount.
  ///
  /// In ar, this message translates to:
  /// **'لديك حساب؟ سجّل الدخول'**
  String get alreadyHaveAccount;

  /// No description provided for @continueWithGoogle.
  ///
  /// In ar, this message translates to:
  /// **'المتابعة عبر Google'**
  String get continueWithGoogle;

  /// No description provided for @welcomeBack.
  ///
  /// In ar, this message translates to:
  /// **'أهلاً بعودتك'**
  String get welcomeBack;

  /// No description provided for @welcomeBackSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'يسعدنا عودتك'**
  String get welcomeBackSubtitle;

  /// No description provided for @login.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الدخول'**
  String get login;

  /// No description provided for @noAccountPrompt.
  ///
  /// In ar, this message translates to:
  /// **'ليس لديك حساب؟'**
  String get noAccountPrompt;

  /// No description provided for @registerAction.
  ///
  /// In ar, this message translates to:
  /// **'سجّل الآن'**
  String get registerAction;

  /// No description provided for @haveAccountPrompt.
  ///
  /// In ar, this message translates to:
  /// **'لديك حساب بالفعل؟'**
  String get haveAccountPrompt;

  /// No description provided for @orSeparator.
  ///
  /// In ar, this message translates to:
  /// **'أو'**
  String get orSeparator;

  /// No description provided for @emailRequired.
  ///
  /// In ar, this message translates to:
  /// **'أدخل بريدك الإلكتروني.'**
  String get emailRequired;

  /// No description provided for @emailInvalid.
  ///
  /// In ar, this message translates to:
  /// **'أدخل بريداً إلكترونياً صحيحاً.'**
  String get emailInvalid;

  /// No description provided for @nameRequired.
  ///
  /// In ar, this message translates to:
  /// **'أدخل اسمك.'**
  String get nameRequired;

  /// No description provided for @passwordRequired.
  ///
  /// In ar, this message translates to:
  /// **'أدخل كلمة المرور.'**
  String get passwordRequired;

  /// No description provided for @passwordRuleHint.
  ///
  /// In ar, this message translates to:
  /// **'8 أحرف أو أكثر، تتضمن حرفاً ورقماً'**
  String get passwordRuleHint;

  /// No description provided for @authSignExistingAccountThen.
  ///
  /// In ar, this message translates to:
  /// **'سجل الدخول إلى حسابك الحالي ثم اربط Google من إعدادات أمان الحساب.'**
  String get authSignExistingAccountThen;

  /// No description provided for @authPhoneBelongsAnotherAccount.
  ///
  /// In ar, this message translates to:
  /// **'هذا الرقم مرتبط بحساب آخر. استعد ذلك الحساب أو تواصل مع الدعم.'**
  String get authPhoneBelongsAnotherAccount;

  /// No description provided for @authVerifyEmailUsingEmail.
  ///
  /// In ar, this message translates to:
  /// **'تحقق من بريدك باستخدام خيار التحقق أدناه.'**
  String get authVerifyEmailUsingEmail;

  /// No description provided for @authProofIncorrectExpiredRequest.
  ///
  /// In ar, this message translates to:
  /// **'الإثبات غير صحيح أو منتهي. اطلب رمزاً جديداً أو أعد بدء التسجيل بالبريد.'**
  String get authProofIncorrectExpiredRequest;

  /// No description provided for @authDocumentsChangedReadAccept.
  ///
  /// In ar, this message translates to:
  /// **'تغيرت المستندات. اقرأ أحدث الإصدارات ووافق عليها.'**
  String get authDocumentsChangedReadAccept;

  /// No description provided for @authConfirmCurrentPasswordRequest.
  ///
  /// In ar, this message translates to:
  /// **'أكد كلمة المرور الحالية أو اطلب إثبات بريد جديداً.'**
  String get authConfirmCurrentPasswordRequest;

  /// No description provided for @authGoogleIdentityAlreadyLinked.
  ///
  /// In ar, this message translates to:
  /// **'هوية Google مرتبطة بالفعل. استخدم استعادة الحساب أو تواصل مع الدعم.'**
  String get authGoogleIdentityAlreadyLinked;

  /// No description provided for @authEnterValidInternationalPhone.
  ///
  /// In ar, this message translates to:
  /// **'أدخل رقم هاتف دولياً صحيحاً يبدأ بعلامة +.'**
  String get authEnterValidInternationalPhone;

  /// No description provided for @authGooglePassengerRegistrationNot.
  ///
  /// In ar, this message translates to:
  /// **'التسجيل كراكب باستخدام Google غير متاح لهذا الحساب بعد.'**
  String get authGooglePassengerRegistrationNot;

  /// No description provided for @authUnableCompleteRequestCheck.
  ///
  /// In ar, this message translates to:
  /// **'تعذر إكمال الطلب. تحقق من الاتصال وحاول مجدداً.'**
  String get authUnableCompleteRequestCheck;

  /// No description provided for @authCompleteRegistration.
  ///
  /// In ar, this message translates to:
  /// **'إكمال التسجيل'**
  String get authCompleteRegistration;

  /// No description provided for @authReadAcceptAllRequired.
  ///
  /// In ar, this message translates to:
  /// **'اقرأ ووافق على المستندات المطلوبة لإنشاء حساب الراكب.'**
  String get authReadAcceptAllRequired;

  /// No description provided for @authIHaveReadAccept.
  ///
  /// In ar, this message translates to:
  /// **'قرأت هذا المستند وأوافق عليه'**
  String get authIHaveReadAccept;

  /// No description provided for @authCancelRegistration.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء التسجيل'**
  String get authCancelRegistration;

  /// No description provided for @authSixDigitCodeFrom.
  ///
  /// In ar, this message translates to:
  /// **'الرمز المكون من ستة أرقام من بريدك الإلكتروني'**
  String get authSixDigitCodeFrom;

  /// No description provided for @authSetChangePassword.
  ///
  /// In ar, this message translates to:
  /// **'تعيين أو تغيير كلمة المرور'**
  String get authSetChangePassword;

  /// No description provided for @authLinkGoogleExplicitly.
  ///
  /// In ar, this message translates to:
  /// **'ربط حساب Google'**
  String get authLinkGoogleExplicitly;

  /// No description provided for @authVerifyEmail.
  ///
  /// In ar, this message translates to:
  /// **'التحقق من البريد الإلكتروني'**
  String get authVerifyEmail;

  /// No description provided for @authResetPassword.
  ///
  /// In ar, this message translates to:
  /// **'إعادة تعيين كلمة المرور'**
  String get authResetPassword;

  /// No description provided for @authCompletedSignAgainIf.
  ///
  /// In ar, this message translates to:
  /// **'اكتمل الطلب. سجل الدخول مجدداً عند الحاجة.'**
  String get authCompletedSignAgainIf;

  /// No description provided for @authEnterCurrentPasswordIf.
  ///
  /// In ar, this message translates to:
  /// **'أدخل كلمة المرور الحالية. إذا لم تكن لديك كلمة مرور، اطلب إثباتاً عبر البريد الإلكتروني.'**
  String get authEnterCurrentPasswordIf;

  /// No description provided for @authCurrentPassword.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور الحالية'**
  String get authCurrentPassword;

  /// No description provided for @authSendEmailProof.
  ///
  /// In ar, this message translates to:
  /// **'إرسال إثبات البريد'**
  String get authSendEmailProof;

  /// No description provided for @authIfEligibleEmailHas.
  ///
  /// In ar, this message translates to:
  /// **'إذا كان الحساب مؤهلاً، أُرسلت رسالة. تحقق من الوارد والبريد غير المرغوب.'**
  String get authIfEligibleEmailHas;

  /// No description provided for @authNewPassword.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور الجديدة'**
  String get authNewPassword;

  /// No description provided for @authSelectingGoogleConfirmsLinking.
  ///
  /// In ar, this message translates to:
  /// **'اختيار Google يؤكد ربط تلك الهوية بهذا الحساب المسجل دخوله.'**
  String get authSelectingGoogleConfirmsLinking;

  /// No description provided for @authClose.
  ///
  /// In ar, this message translates to:
  /// **'إغلاق'**
  String get authClose;

  /// No description provided for @authConfirm.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد'**
  String get authConfirm;

  /// No description provided for @authLinkGoogleAccount.
  ///
  /// In ar, this message translates to:
  /// **'ربط حساب Google'**
  String get authLinkGoogleAccount;

  /// No description provided for @onboardingSetUpAccount.
  ///
  /// In ar, this message translates to:
  /// **'إعداد حسابك'**
  String get onboardingSetUpAccount;

  /// No description provided for @onboardingGetStarted.
  ///
  /// In ar, this message translates to:
  /// **'لنبدأ'**
  String get onboardingGetStarted;

  /// No description provided for @onboardingStep.
  ///
  /// In ar, this message translates to:
  /// **'الخطوة {value} من {stepsLength}'**
  String onboardingStep(Object value, Object stepsLength);

  /// No description provided for @onboardingBack.
  ///
  /// In ar, this message translates to:
  /// **'رجوع'**
  String get onboardingBack;

  /// No description provided for @onboardingSubmitApplication.
  ///
  /// In ar, this message translates to:
  /// **'إرسال الطلب'**
  String get onboardingSubmitApplication;

  /// No description provided for @onboardingChooseOneSetsUp.
  ///
  /// In ar, this message translates to:
  /// **'اختر واحداً، وسنجهز لك التجربة المناسبة.'**
  String get onboardingChooseOneSetsUp;

  /// No description provided for @onboardingPassenger.
  ///
  /// In ar, this message translates to:
  /// **'راكب'**
  String get onboardingPassenger;

  /// No description provided for @onboardingBookRidesSendParcels.
  ///
  /// In ar, this message translates to:
  /// **'احجز رحلات وأرسل طروداً. جاهز فوراً.'**
  String get onboardingBookRidesSendParcels;

  /// No description provided for @onboardingDriveDarbRoutesNeeds.
  ///
  /// In ar, this message translates to:
  /// **'قُد على مسارات درب. يتطلب موافقة الإدارة أولاً.'**
  String get onboardingDriveDarbRoutesNeeds;

  /// No description provided for @onboardingDriverApplicationsAreNot.
  ///
  /// In ar, this message translates to:
  /// **'طلبات السائقين غير متاحة حالياً.'**
  String get onboardingDriverApplicationsAreNot;

  /// No description provided for @onboardingSendOrdersCustomersReady.
  ///
  /// In ar, this message translates to:
  /// **'أرسل الطلبات إلى زبائنك. جاهز فوراً.'**
  String get onboardingSendOrdersCustomersReady;

  /// No description provided for @onboardingAbout.
  ///
  /// In ar, this message translates to:
  /// **'معلوماتك'**
  String get onboardingAbout;

  /// No description provided for @onboardingFilledNameFromGoogle.
  ///
  /// In ar, this message translates to:
  /// **'أخذنا اسمك من Google، ويمكنك تعديله.'**
  String get onboardingFilledNameFromGoogle;

  /// No description provided for @onboardingWhereAre.
  ///
  /// In ar, this message translates to:
  /// **'أين أنت؟'**
  String get onboardingWhereAre;

  /// No description provided for @onboardingCityHelpsUsShow.
  ///
  /// In ar, this message translates to:
  /// **'تساعدنا مدينتك على عرض المسارات القريبة منك.'**
  String get onboardingCityHelpsUsShow;

  /// No description provided for @onboardingIdentityLicence.
  ///
  /// In ar, this message translates to:
  /// **'الهوية والرخصة'**
  String get onboardingIdentityLicence;

  /// No description provided for @onboardingAdminChecksTheseAgainst.
  ///
  /// In ar, this message translates to:
  /// **'تطابق الإدارة هذه البيانات مع المستندات التي سترفعها لاحقاً.'**
  String get onboardingAdminChecksTheseAgainst;

  /// No description provided for @onboardingNationalIdNumber.
  ///
  /// In ar, this message translates to:
  /// **'رقم الهوية الوطنية'**
  String get onboardingNationalIdNumber;

  /// No description provided for @onboardingEnterIdNumber.
  ///
  /// In ar, this message translates to:
  /// **'أدخل رقم هويتك'**
  String get onboardingEnterIdNumber;

  /// No description provided for @onboardingDrivingLicenceNumber.
  ///
  /// In ar, this message translates to:
  /// **'رقم رخصة القيادة'**
  String get onboardingDrivingLicenceNumber;

  /// No description provided for @onboardingEnterLicenceNumber.
  ///
  /// In ar, this message translates to:
  /// **'أدخل رقم الرخصة'**
  String get onboardingEnterLicenceNumber;

  /// No description provided for @onboardingLicenceExpiryDate.
  ///
  /// In ar, this message translates to:
  /// **'تاريخ انتهاء الرخصة'**
  String get onboardingLicenceExpiryDate;

  /// No description provided for @onboardingPickExpiryDate.
  ///
  /// In ar, this message translates to:
  /// **'اختر تاريخ الانتهاء'**
  String get onboardingPickExpiryDate;

  /// No description provided for @onboardingVehicle.
  ///
  /// In ar, this message translates to:
  /// **'مركبتك'**
  String get onboardingVehicle;

  /// No description provided for @onboardingCarDriveDarb.
  ///
  /// In ar, this message translates to:
  /// **'السيارة التي ستقودها على درب.'**
  String get onboardingCarDriveDarb;

  /// No description provided for @onboardingMakeModelEG.
  ///
  /// In ar, this message translates to:
  /// **'الشركة والطراز (مثل كيا أوبتيما)'**
  String get onboardingMakeModelEG;

  /// No description provided for @onboardingEnterMakeModel.
  ///
  /// In ar, this message translates to:
  /// **'أدخل الشركة والطراز'**
  String get onboardingEnterMakeModel;

  /// No description provided for @onboardingColour.
  ///
  /// In ar, this message translates to:
  /// **'اللون'**
  String get onboardingColour;

  /// No description provided for @onboardingEnterColour.
  ///
  /// In ar, this message translates to:
  /// **'أدخل اللون'**
  String get onboardingEnterColour;

  /// No description provided for @onboardingPlateNumber.
  ///
  /// In ar, this message translates to:
  /// **'رقم اللوحة'**
  String get onboardingPlateNumber;

  /// No description provided for @onboardingEnterPlate.
  ///
  /// In ar, this message translates to:
  /// **'أدخل اللوحة'**
  String get onboardingEnterPlate;

  /// No description provided for @onboardingParcelsCarry.
  ///
  /// In ar, this message translates to:
  /// **'الطرود التي يمكنك حملها'**
  String get onboardingParcelsCarry;

  /// No description provided for @onboardingSedan.
  ///
  /// In ar, this message translates to:
  /// **'سيدان'**
  String get onboardingSedan;

  /// No description provided for @onboardingSuv.
  ///
  /// In ar, this message translates to:
  /// **'دفع رباعي'**
  String get onboardingSuv;

  /// No description provided for @onboardingVan.
  ///
  /// In ar, this message translates to:
  /// **'فان'**
  String get onboardingVan;

  /// No description provided for @onboardingMinibus.
  ///
  /// In ar, this message translates to:
  /// **'ميني باص'**
  String get onboardingMinibus;

  /// No description provided for @onboardingStore.
  ///
  /// In ar, this message translates to:
  /// **'متجرك'**
  String get onboardingStore;

  /// No description provided for @onboardingTellCustomersWhoAre.
  ///
  /// In ar, this message translates to:
  /// **'عرّف زبائنك بمتجرك.'**
  String get onboardingTellCustomersWhoAre;

  /// No description provided for @onboardingStoreName.
  ///
  /// In ar, this message translates to:
  /// **'اسم المتجر'**
  String get onboardingStoreName;

  /// No description provided for @onboardingEnterStoreName.
  ///
  /// In ar, this message translates to:
  /// **'أدخل اسم المتجر'**
  String get onboardingEnterStoreName;

  /// No description provided for @onboardingOwnerFullName.
  ///
  /// In ar, this message translates to:
  /// **'اسم المالك الكامل'**
  String get onboardingOwnerFullName;

  /// No description provided for @onboardingStoreType.
  ///
  /// In ar, this message translates to:
  /// **'نوع المتجر'**
  String get onboardingStoreType;

  /// No description provided for @onboardingChooseStoreType.
  ///
  /// In ar, this message translates to:
  /// **'اختر نوع المتجر'**
  String get onboardingChooseStoreType;

  /// No description provided for @onboardingGrocery.
  ///
  /// In ar, this message translates to:
  /// **'بقالة'**
  String get onboardingGrocery;

  /// No description provided for @onboardingRestaurant.
  ///
  /// In ar, this message translates to:
  /// **'مطعم'**
  String get onboardingRestaurant;

  /// No description provided for @onboardingPharmacy.
  ///
  /// In ar, this message translates to:
  /// **'صيدلية'**
  String get onboardingPharmacy;

  /// No description provided for @onboardingClothing.
  ///
  /// In ar, this message translates to:
  /// **'ملابس'**
  String get onboardingClothing;

  /// No description provided for @onboardingElectronics.
  ///
  /// In ar, this message translates to:
  /// **'إلكترونيات'**
  String get onboardingElectronics;

  /// No description provided for @onboardingBakery.
  ///
  /// In ar, this message translates to:
  /// **'مخبز'**
  String get onboardingBakery;

  /// No description provided for @onboardingContactLocation.
  ///
  /// In ar, this message translates to:
  /// **'التواصل والموقع'**
  String get onboardingContactLocation;

  /// No description provided for @onboardingHowCustomersDriversReach.
  ///
  /// In ar, this message translates to:
  /// **'كيف يصل إليك الزبائن والسائقون.'**
  String get onboardingHowCustomersDriversReach;

  /// No description provided for @onboardingWhereDoSell.
  ///
  /// In ar, this message translates to:
  /// **'أين تبيع؟'**
  String get onboardingWhereDoSell;

  /// No description provided for @onboardingShop.
  ///
  /// In ar, this message translates to:
  /// **'في محل'**
  String get onboardingShop;

  /// No description provided for @onboardingOnline.
  ///
  /// In ar, this message translates to:
  /// **'عبر الإنترنت'**
  String get onboardingOnline;

  /// No description provided for @onboardingBoth.
  ///
  /// In ar, this message translates to:
  /// **'كلاهما'**
  String get onboardingBoth;

  /// No description provided for @onboardingShopAddress.
  ///
  /// In ar, this message translates to:
  /// **'عنوان المحل'**
  String get onboardingShopAddress;

  /// No description provided for @onboardingEnterShopAddress.
  ///
  /// In ar, this message translates to:
  /// **'أدخل عنوان المحل'**
  String get onboardingEnterShopAddress;

  /// No description provided for @onboardingAlmostDone.
  ///
  /// In ar, this message translates to:
  /// **'اقتربت من الانتهاء'**
  String get onboardingAlmostDone;

  /// No description provided for @onboardingAcceptTermsSendDetails.
  ///
  /// In ar, this message translates to:
  /// **'وافق على الشروط لإرسال بياناتك. بعدها ترفع رخصة القيادة ورخصة المركبة والهوية لمراجعة الإدارة.'**
  String get onboardingAcceptTermsSendDetails;

  /// No description provided for @onboardingReadAcceptTheseCreate.
  ///
  /// In ar, this message translates to:
  /// **'اقرأ هذه المستندات ووافق عليها لإنشاء حسابك.'**
  String get onboardingReadAcceptTheseCreate;

  /// No description provided for @onboardingIHaveReadAccept.
  ///
  /// In ar, this message translates to:
  /// **'قرأت هذا وأوافق عليه'**
  String get onboardingIHaveReadAccept;

  /// No description provided for @onboardingTermsService.
  ///
  /// In ar, this message translates to:
  /// **'شروط الخدمة'**
  String get onboardingTermsService;

  /// No description provided for @onboardingPrivacyPolicy.
  ///
  /// In ar, this message translates to:
  /// **'سياسة الخصوصية'**
  String get onboardingPrivacyPolicy;

  /// No description provided for @authAdultSelfAttestation.
  ///
  /// In ar, this message translates to:
  /// **'الإقرار ببلوغ السن القانوني'**
  String get authAdultSelfAttestation;

  /// No description provided for @onboardingIAm18Older.
  ///
  /// In ar, this message translates to:
  /// **'عمري 18 عاماً أو أكثر'**
  String get onboardingIAm18Older;

  /// No description provided for @onboardingEnterFullName.
  ///
  /// In ar, this message translates to:
  /// **'أدخل اسمك الكامل'**
  String get onboardingEnterFullName;

  /// No description provided for @onboardingPhoneEG970599123456.
  ///
  /// In ar, this message translates to:
  /// **'الهاتف، مثل ‎+970599123456'**
  String get onboardingPhoneEG970599123456;

  /// No description provided for @onboardingUseInternationalFormatStarting.
  ///
  /// In ar, this message translates to:
  /// **'استخدم الصيغة الدولية التي تبدأ بـ +'**
  String get onboardingUseInternationalFormatStarting;

  /// No description provided for @onboardingCity.
  ///
  /// In ar, this message translates to:
  /// **'المدينة'**
  String get onboardingCity;

  /// No description provided for @onboardingEnterCity.
  ///
  /// In ar, this message translates to:
  /// **'أدخل مدينتك'**
  String get onboardingEnterCity;

  /// No description provided for @onboardingDrivingLicenceHasExpired.
  ///
  /// In ar, this message translates to:
  /// **'رخصة القيادة منتهية. جددها قبل التقديم.'**
  String get onboardingDrivingLicenceHasExpired;

  /// No description provided for @onboardingDriverApplicationsAreNotOpen.
  ///
  /// In ar, this message translates to:
  /// **'طلبات السائقين غير متاحة حالياً. اختر دوراً آخر أو حاول لاحقاً.'**
  String get onboardingDriverApplicationsAreNotOpen;

  /// No description provided for @onboardingSomeDetailsAreNot.
  ///
  /// In ar, this message translates to:
  /// **'بعض البيانات غير صحيحة. ارجع وتحقق منها.'**
  String get onboardingSomeDetailsAreNot;

  /// No description provided for @authForgotPassword.
  ///
  /// In ar, this message translates to:
  /// **'نسيت كلمة المرور؟'**
  String get authForgotPassword;

  /// No description provided for @authEnterPhoneNumber7.
  ///
  /// In ar, this message translates to:
  /// **'أدخل رقم جوال صحيح، مثل 0599123456.'**
  String get authEnterPhoneNumber7;

  /// No description provided for @emailAlreadyRegistered.
  ///
  /// In ar, this message translates to:
  /// **'هذا البريد الإلكتروني مسجّل بالفعل. حاول تسجيل الدخول.'**
  String get emailAlreadyRegistered;

  /// No description provided for @googleSignInFailed.
  ///
  /// In ar, this message translates to:
  /// **'فشل تسجيل الدخول عبر Google. حاول مرة أخرى.'**
  String get googleSignInFailed;

  /// No description provided for @googleSignInUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الدخول عبر Google غير متاح حالياً.'**
  String get googleSignInUnavailable;

  /// No description provided for @demoAccounts.
  ///
  /// In ar, this message translates to:
  /// **'حسابات تجريبية'**
  String get demoAccounts;

  /// No description provided for @passenger.
  ///
  /// In ar, this message translates to:
  /// **'مسافر'**
  String get passenger;

  /// No description provided for @driver.
  ///
  /// In ar, this message translates to:
  /// **'سائق'**
  String get driver;

  /// No description provided for @merchant.
  ///
  /// In ar, this message translates to:
  /// **'تاجر'**
  String get merchant;

  /// No description provided for @admin.
  ///
  /// In ar, this message translates to:
  /// **'مسؤول'**
  String get admin;

  /// No description provided for @unsupportedRole.
  ///
  /// In ar, this message translates to:
  /// **'دور غير مدعوم'**
  String get unsupportedRole;

  /// No description provided for @logout.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الخروج'**
  String get logout;

  /// No description provided for @sessionExpired.
  ///
  /// In ar, this message translates to:
  /// **'انتهت جلستك، يرجى تسجيل الدخول مرة أخرى'**
  String get sessionExpired;

  /// No description provided for @invalidCredentials.
  ///
  /// In ar, this message translates to:
  /// **'البريد الإلكتروني أو كلمة المرور غير صحيحة.'**
  String get invalidCredentials;

  /// No description provided for @networkUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'الشبكة غير متاحة. تحقق من اتصال واجهة API ثم أعد المحاولة.'**
  String get networkUnavailable;

  /// No description provided for @requestTimedOut.
  ///
  /// In ar, this message translates to:
  /// **'انتهت مهلة الطلب. يرجى إعادة المحاولة.'**
  String get requestTimedOut;

  /// No description provided for @validationError.
  ///
  /// In ar, this message translates to:
  /// **'يرجى التحقق من البيانات المدخلة.'**
  String get validationError;

  /// No description provided for @forbidden.
  ///
  /// In ar, this message translates to:
  /// **'هذا الحساب غير مسموح له بتنفيذ هذا الإجراء.'**
  String get forbidden;

  /// No description provided for @serverError.
  ///
  /// In ar, this message translates to:
  /// **'حدث خطأ في الخادم. يرجى المحاولة لاحقاً.'**
  String get serverError;

  /// No description provided for @requestFailed.
  ///
  /// In ar, this message translates to:
  /// **'فشل الطلب. يرجى إعادة المحاولة.'**
  String get requestFailed;

  /// No description provided for @roleWorkspace.
  ///
  /// In ar, this message translates to:
  /// **'مساحة عمل الدور'**
  String get roleWorkspace;

  /// No description provided for @currentUser.
  ///
  /// In ar, this message translates to:
  /// **'المستخدم الحالي'**
  String get currentUser;

  /// No description provided for @role.
  ///
  /// In ar, this message translates to:
  /// **'الدور'**
  String get role;

  /// No description provided for @lockedCorridorLabel.
  ///
  /// In ar, this message translates to:
  /// **'المسار المثبت'**
  String get lockedCorridorLabel;

  /// No description provided for @workspaceReadyMessage.
  ///
  /// In ar, this message translates to:
  /// **'مساحة عمل هذا الدور جاهزة للمرحلة التالية.'**
  String get workspaceReadyMessage;

  /// No description provided for @comingNext.
  ///
  /// In ar, this message translates to:
  /// **'قريباً'**
  String get comingNext;

  /// No description provided for @businessFeaturesComingNext.
  ///
  /// In ar, this message translates to:
  /// **'ستضاف إجراءات الدور التجارية في مراحل لاحقة. لا توجد حالياً تدفقات طلبات أو مسارات أو طلبات تاجر أو مطابقات أو رحلات أو تتبع.'**
  String get businessFeaturesComingNext;

  /// No description provided for @unsupportedRoleTitle.
  ///
  /// In ar, this message translates to:
  /// **'الدور غير مدعوم على الهاتف'**
  String get unsupportedRoleTitle;

  /// No description provided for @adminWebConsoleMessage.
  ///
  /// In ar, this message translates to:
  /// **'لوحة تحكم المسؤول متاحة عبر تطبيق الويب.'**
  String get adminWebConsoleMessage;

  /// No description provided for @passengerDashboard.
  ///
  /// In ar, this message translates to:
  /// **'لوحة المسافر'**
  String get passengerDashboard;

  /// No description provided for @activeRequest.
  ///
  /// In ar, this message translates to:
  /// **'الطلب النشط'**
  String get activeRequest;

  /// No description provided for @noActiveRequest.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد طلب نشط حالياً.'**
  String get noActiveRequest;

  /// No description provided for @createRequest.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء طلب'**
  String get createRequest;

  /// No description provided for @pickup.
  ///
  /// In ar, this message translates to:
  /// **'نقطة الانطلاق'**
  String get pickup;

  /// No description provided for @ppu.
  ///
  /// In ar, this message translates to:
  /// **'بوابة جامعة بوليتكنك فلسطين'**
  String get ppu;

  /// No description provided for @babAlZawiya.
  ///
  /// In ar, this message translates to:
  /// **'باب الزاوية'**
  String get babAlZawiya;

  /// No description provided for @destination.
  ///
  /// In ar, this message translates to:
  /// **'الوجهة'**
  String get destination;

  /// No description provided for @bethlehem.
  ///
  /// In ar, this message translates to:
  /// **'بيت لحم'**
  String get bethlehem;

  /// No description provided for @preferredTime.
  ///
  /// In ar, this message translates to:
  /// **'الوقت المفضل'**
  String get preferredTime;

  /// No description provided for @dateTimeValue.
  ///
  /// In ar, this message translates to:
  /// **'{date}، {time}'**
  String dateTimeValue(String date, String time);

  /// No description provided for @passengerCount.
  ///
  /// In ar, this message translates to:
  /// **'عدد الركاب'**
  String get passengerCount;

  /// No description provided for @submitRequest.
  ///
  /// In ar, this message translates to:
  /// **'إرسال الطلب'**
  String get submitRequest;

  /// No description provided for @requestCreated.
  ///
  /// In ar, this message translates to:
  /// **'تم إنشاء الطلب'**
  String get requestCreated;

  /// No description provided for @requestDetails.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل الطلب'**
  String get requestDetails;

  /// No description provided for @cancelRequest.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الطلب'**
  String get cancelRequest;

  /// No description provided for @cancelRequestConfirm.
  ///
  /// In ar, this message translates to:
  /// **'هل تريد إلغاء هذا الطلب؟'**
  String get cancelRequestConfirm;

  /// No description provided for @requestCancelled.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء الطلب'**
  String get requestCancelled;

  /// No description provided for @requestCannotBeCancelled.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن إلغاء هذا الطلب الآن.'**
  String get requestCannotBeCancelled;

  /// No description provided for @findCompatibleRoute.
  ///
  /// In ar, this message translates to:
  /// **'البحث عن مسار متوافق'**
  String get findCompatibleRoute;

  /// No description provided for @retryMatching.
  ///
  /// In ar, this message translates to:
  /// **'إعادة محاولة المطابقة'**
  String get retryMatching;

  /// No description provided for @noCompatibleDriverFound.
  ///
  /// In ar, this message translates to:
  /// **'لم يتم العثور على سائق متوافق. يمكنك إعادة المحاولة لاحقاً.'**
  String get noCompatibleDriverFound;

  /// No description provided for @createdTime.
  ///
  /// In ar, this message translates to:
  /// **'وقت الإنشاء'**
  String get createdTime;

  /// No description provided for @currentStatus.
  ///
  /// In ar, this message translates to:
  /// **'الحالة الحالية'**
  String get currentStatus;

  /// No description provided for @noConnectedTrip.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد رحلة مرتبطة بعد.'**
  String get noConnectedTrip;

  /// No description provided for @matchResult.
  ///
  /// In ar, this message translates to:
  /// **'نتيجة المطابقة'**
  String get matchResult;

  /// No description provided for @selectedDriver.
  ///
  /// In ar, this message translates to:
  /// **'السائق المختار'**
  String get selectedDriver;

  /// No description provided for @selectedDriverUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'مسار السائق المختار لم يعد متاحاً. اختر رحلة أخرى.'**
  String get selectedDriverUnavailable;

  /// No description provided for @selectedRoute.
  ///
  /// In ar, this message translates to:
  /// **'المسار المختار'**
  String get selectedRoute;

  /// No description provided for @matchScore.
  ///
  /// In ar, this message translates to:
  /// **'درجة المطابقة'**
  String get matchScore;

  /// No description provided for @scoringBreakdown.
  ///
  /// In ar, this message translates to:
  /// **'تفصيل الدرجات'**
  String get scoringBreakdown;

  /// No description provided for @corridorOverlap.
  ///
  /// In ar, this message translates to:
  /// **'تطابق المسار'**
  String get corridorOverlap;

  /// No description provided for @pickupDistance.
  ///
  /// In ar, this message translates to:
  /// **'قرب نقطة الانطلاق'**
  String get pickupDistance;

  /// No description provided for @timingFit.
  ///
  /// In ar, this message translates to:
  /// **'ملاءمة الوقت'**
  String get timingFit;

  /// No description provided for @trustScore.
  ///
  /// In ar, this message translates to:
  /// **'درجة الثقة'**
  String get trustScore;

  /// No description provided for @capacityFit.
  ///
  /// In ar, this message translates to:
  /// **'ملاءمة السعة'**
  String get capacityFit;

  /// No description provided for @matchExplanation.
  ///
  /// In ar, this message translates to:
  /// **'شرح المطابقة'**
  String get matchExplanation;

  /// No description provided for @routeMatchExplanation.
  ///
  /// In ar, this message translates to:
  /// **'اختار درب هذا السائق لأنه يسلك نفس المسار الذي اخترته، ولديه مقعد متاح لك، ودرجة الثقة لديه مرتفعة.'**
  String get routeMatchExplanation;

  /// No description provided for @passengerTrip.
  ///
  /// In ar, this message translates to:
  /// **'رحلة المسافر'**
  String get passengerTrip;

  /// No description provided for @tripTimeline.
  ///
  /// In ar, this message translates to:
  /// **'خط الرحلة الزمني'**
  String get tripTimeline;

  /// No description provided for @latestLocation.
  ///
  /// In ar, this message translates to:
  /// **'آخر موقع'**
  String get latestLocation;

  /// No description provided for @waitingForDriver.
  ///
  /// In ar, this message translates to:
  /// **'بانتظار السائق'**
  String get waitingForDriver;

  /// No description provided for @noLocationYet.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد موقع بعد.'**
  String get noLocationYet;

  /// No description provided for @locationIsStale.
  ///
  /// In ar, this message translates to:
  /// **'الموقع قديم.'**
  String get locationIsStale;

  /// No description provided for @latitude.
  ///
  /// In ar, this message translates to:
  /// **'خط العرض'**
  String get latitude;

  /// No description provided for @longitude.
  ///
  /// In ar, this message translates to:
  /// **'خط الطول'**
  String get longitude;

  /// No description provided for @sequence.
  ///
  /// In ar, this message translates to:
  /// **'التسلسل'**
  String get sequence;

  /// No description provided for @source.
  ///
  /// In ar, this message translates to:
  /// **'المصدر'**
  String get source;

  /// No description provided for @sourceSimulated.
  ///
  /// In ar, this message translates to:
  /// **'محاكى'**
  String get sourceSimulated;

  /// No description provided for @sourceDriverGps.
  ///
  /// In ar, this message translates to:
  /// **'موقع هاتف السائق'**
  String get sourceDriverGps;

  /// No description provided for @recordedTime.
  ///
  /// In ar, this message translates to:
  /// **'وقت التسجيل'**
  String get recordedTime;

  /// No description provided for @refresh.
  ///
  /// In ar, this message translates to:
  /// **'تحديث'**
  String get refresh;

  /// No description provided for @statusPending.
  ///
  /// In ar, this message translates to:
  /// **'قيد الانتظار'**
  String get statusPending;

  /// No description provided for @statusMatched.
  ///
  /// In ar, this message translates to:
  /// **'تمت المطابقة'**
  String get statusMatched;

  /// No description provided for @statusAccepted.
  ///
  /// In ar, this message translates to:
  /// **'مقبول'**
  String get statusAccepted;

  /// No description provided for @statusPickupStarted.
  ///
  /// In ar, this message translates to:
  /// **'بدأ التوجه للاستلام'**
  String get statusPickupStarted;

  /// No description provided for @statusPickedUp.
  ///
  /// In ar, this message translates to:
  /// **'تم الاستلام'**
  String get statusPickedUp;

  /// No description provided for @statusInTransit.
  ///
  /// In ar, this message translates to:
  /// **'قيد النقل'**
  String get statusInTransit;

  /// No description provided for @statusDelivered.
  ///
  /// In ar, this message translates to:
  /// **'تم التسليم'**
  String get statusDelivered;

  /// No description provided for @statusCompleted.
  ///
  /// In ar, this message translates to:
  /// **'مكتملة'**
  String get statusCompleted;

  /// No description provided for @statusCancelled.
  ///
  /// In ar, this message translates to:
  /// **'ملغاة'**
  String get statusCancelled;

  /// No description provided for @statusFailed.
  ///
  /// In ar, this message translates to:
  /// **'فشلت'**
  String get statusFailed;

  /// No description provided for @driverDashboard.
  ///
  /// In ar, this message translates to:
  /// **'لوحة السائق'**
  String get driverDashboard;

  /// No description provided for @activeRoute.
  ///
  /// In ar, this message translates to:
  /// **'المسار النشط'**
  String get activeRoute;

  /// No description provided for @noActiveRoute.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد مسار نشط حالياً.'**
  String get noActiveRoute;

  /// No description provided for @createRoute.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء مسار'**
  String get createRoute;

  /// No description provided for @viewRoute.
  ///
  /// In ar, this message translates to:
  /// **'عرض المسار'**
  String get viewRoute;

  /// No description provided for @routeDetails.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل المسار'**
  String get routeDetails;

  /// No description provided for @origin.
  ///
  /// In ar, this message translates to:
  /// **'نقطة الانطلاق'**
  String get origin;

  /// No description provided for @seatsAvailable.
  ///
  /// In ar, this message translates to:
  /// **'المقاعد المتاحة'**
  String get seatsAvailable;

  /// No description provided for @parcelCapacity.
  ///
  /// In ar, this message translates to:
  /// **'سعة الطرود'**
  String get parcelCapacity;

  /// No description provided for @activateRoute.
  ///
  /// In ar, this message translates to:
  /// **'تفعيل المسار'**
  String get activateRoute;

  /// No description provided for @deactivateRoute.
  ///
  /// In ar, this message translates to:
  /// **'إيقاف المسار'**
  String get deactivateRoute;

  /// No description provided for @routeActivated.
  ///
  /// In ar, this message translates to:
  /// **'تم تفعيل المسار'**
  String get routeActivated;

  /// No description provided for @routeDeactivated.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء تفعيل المسار'**
  String get routeDeactivated;

  /// No description provided for @routeStatus.
  ///
  /// In ar, this message translates to:
  /// **'حالة المسار'**
  String get routeStatus;

  /// No description provided for @activationTime.
  ///
  /// In ar, this message translates to:
  /// **'وقت التفعيل'**
  String get activationTime;

  /// No description provided for @routeAlreadyActive.
  ///
  /// In ar, this message translates to:
  /// **'يوجد مسار تشغيلي بالفعل.'**
  String get routeAlreadyActive;

  /// No description provided for @routeCannotDeactivate.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن إلغاء تفعيل هذا المسار في حالته الحالية.'**
  String get routeCannotDeactivate;

  /// No description provided for @matchInbox.
  ///
  /// In ar, this message translates to:
  /// **'صندوق المطابقات'**
  String get matchInbox;

  /// No description provided for @noAvailableMatches.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد مطابقات متاحة.'**
  String get noAvailableMatches;

  /// No description provided for @passengerRequest.
  ///
  /// In ar, this message translates to:
  /// **'طلب مسافر'**
  String get passengerRequest;

  /// No description provided for @merchantOrder.
  ///
  /// In ar, this message translates to:
  /// **'طلب تاجر'**
  String get merchantOrder;

  /// No description provided for @combinedAssignment.
  ///
  /// In ar, this message translates to:
  /// **'مهمة مشتركة'**
  String get combinedAssignment;

  /// No description provided for @requestType.
  ///
  /// In ar, this message translates to:
  /// **'نوع الطلب'**
  String get requestType;

  /// No description provided for @parcelCount.
  ///
  /// In ar, this message translates to:
  /// **'عدد الطرود'**
  String get parcelCount;

  /// No description provided for @parcelBatch.
  ///
  /// In ar, this message translates to:
  /// **'دفعة الطرود'**
  String get parcelBatch;

  /// No description provided for @estimatedDistanceSaved.
  ///
  /// In ar, this message translates to:
  /// **'المسافة المقدرة الموفرة'**
  String get estimatedDistanceSaved;

  /// No description provided for @acceptMatch.
  ///
  /// In ar, this message translates to:
  /// **'قبول المطابقة'**
  String get acceptMatch;

  /// No description provided for @rejectMatch.
  ///
  /// In ar, this message translates to:
  /// **'رفض المطابقة'**
  String get rejectMatch;

  /// No description provided for @matchAccepted.
  ///
  /// In ar, this message translates to:
  /// **'تم قبول المطابقة'**
  String get matchAccepted;

  /// No description provided for @matchRejected.
  ///
  /// In ar, this message translates to:
  /// **'تم رفض المطابقة'**
  String get matchRejected;

  /// No description provided for @matchCannotChange.
  ///
  /// In ar, this message translates to:
  /// **'تغيرت هذه المطابقة مسبقاً. تم تحميل أحدث حالة.'**
  String get matchCannotChange;

  /// No description provided for @allMatches.
  ///
  /// In ar, this message translates to:
  /// **'كل المطابقات'**
  String get allMatches;

  /// No description provided for @proposedMatches.
  ///
  /// In ar, this message translates to:
  /// **'المطابقات المقترحة'**
  String get proposedMatches;

  /// No description provided for @viewDetails.
  ///
  /// In ar, this message translates to:
  /// **'عرض التفاصيل'**
  String get viewDetails;

  /// No description provided for @activeTrip.
  ///
  /// In ar, this message translates to:
  /// **'الرحلة النشطة'**
  String get activeTrip;

  /// No description provided for @noActiveTrip.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد رحلة نشطة حالياً.'**
  String get noActiveTrip;

  /// No description provided for @openActiveTrip.
  ///
  /// In ar, this message translates to:
  /// **'فتح الرحلة النشطة'**
  String get openActiveTrip;

  /// No description provided for @driverTrip.
  ///
  /// In ar, this message translates to:
  /// **'رحلة السائق'**
  String get driverTrip;

  /// No description provided for @statusTimeline.
  ///
  /// In ar, this message translates to:
  /// **'الخط الزمني للحالة'**
  String get statusTimeline;

  /// No description provided for @startPickup.
  ///
  /// In ar, this message translates to:
  /// **'بدء التوجه للاستلام'**
  String get startPickup;

  /// No description provided for @pickedUpAction.
  ///
  /// In ar, this message translates to:
  /// **'تم الاستلام'**
  String get pickedUpAction;

  /// No description provided for @startTrip.
  ///
  /// In ar, this message translates to:
  /// **'بدء الرحلة'**
  String get startTrip;

  /// No description provided for @deliver.
  ///
  /// In ar, this message translates to:
  /// **'تسليم'**
  String get deliver;

  /// No description provided for @completeTrip.
  ///
  /// In ar, this message translates to:
  /// **'إكمال الرحلة'**
  String get completeTrip;

  /// No description provided for @tripTransitionConflict.
  ///
  /// In ar, this message translates to:
  /// **'تغيرت حالة الرحلة. تم تحميل أحدث حالة.'**
  String get tripTransitionConflict;

  /// No description provided for @trackingSimulation.
  ///
  /// In ar, this message translates to:
  /// **'محاكاة التتبع'**
  String get trackingSimulation;

  /// No description provided for @simulateNextPoint.
  ///
  /// In ar, this message translates to:
  /// **'محاكاة النقطة التالية'**
  String get simulateNextPoint;

  /// No description provided for @resetSimulation.
  ///
  /// In ar, this message translates to:
  /// **'إعادة ضبط المحاكاة'**
  String get resetSimulation;

  /// No description provided for @simulationReset.
  ///
  /// In ar, this message translates to:
  /// **'تمت إعادة ضبط المحاكاة'**
  String get simulationReset;

  /// No description provided for @routeProgress.
  ///
  /// In ar, this message translates to:
  /// **'تقدم المسار'**
  String get routeProgress;

  /// No description provided for @statusProposed.
  ///
  /// In ar, this message translates to:
  /// **'مقترحة'**
  String get statusProposed;

  /// No description provided for @statusSentToDriver.
  ///
  /// In ar, this message translates to:
  /// **'أرسلت إلى السائق'**
  String get statusSentToDriver;

  /// No description provided for @statusRejected.
  ///
  /// In ar, this message translates to:
  /// **'مرفوضة'**
  String get statusRejected;

  /// No description provided for @statusExpired.
  ///
  /// In ar, this message translates to:
  /// **'منتهية'**
  String get statusExpired;

  /// No description provided for @statusActive.
  ///
  /// In ar, this message translates to:
  /// **'نشطة'**
  String get statusActive;

  /// No description provided for @statusInactive.
  ///
  /// In ar, this message translates to:
  /// **'غير نشط'**
  String get statusInactive;

  /// No description provided for @statusAssigned.
  ///
  /// In ar, this message translates to:
  /// **'مخصص'**
  String get statusAssigned;

  /// No description provided for @statusOnTrip.
  ///
  /// In ar, this message translates to:
  /// **'في رحلة'**
  String get statusOnTrip;

  /// No description provided for @statusCreated.
  ///
  /// In ar, this message translates to:
  /// **'منشأ'**
  String get statusCreated;

  /// No description provided for @merchantDashboard.
  ///
  /// In ar, this message translates to:
  /// **'لوحة التاجر'**
  String get merchantDashboard;

  /// No description provided for @orders.
  ///
  /// In ar, this message translates to:
  /// **'الطلبات'**
  String get orders;

  /// No description provided for @noOrders.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد طلبات بعد.'**
  String get noOrders;

  /// No description provided for @createOrder.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء طلب'**
  String get createOrder;

  /// No description provided for @latestOrder.
  ///
  /// In ar, this message translates to:
  /// **'أحدث طلب'**
  String get latestOrder;

  /// No description provided for @latestBatch.
  ///
  /// In ar, this message translates to:
  /// **'أحدث دفعة طرود'**
  String get latestBatch;

  /// No description provided for @orderDetails.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل الطلب'**
  String get orderDetails;

  /// No description provided for @fixedPickup.
  ///
  /// In ar, this message translates to:
  /// **'نقطة الاستلام الثابتة'**
  String get fixedPickup;

  /// No description provided for @parcel.
  ///
  /// In ar, this message translates to:
  /// **'طرد'**
  String get parcel;

  /// No description provided for @parcelSize.
  ///
  /// In ar, this message translates to:
  /// **'حجم الطرد'**
  String get parcelSize;

  /// No description provided for @handoverReceiverHandoverCode.
  ///
  /// In ar, this message translates to:
  /// **'رمز تسليم المستلم'**
  String get handoverReceiverHandoverCode;

  /// No description provided for @handoverGiveCodePersonReceiving.
  ///
  /// In ar, this message translates to:
  /// **'أعطِ هذا الرمز للشخص الذي سيستلم الطرد. سيطلبه السائق عند التسليم. لا تشاركه قبل وصول الطرد.'**
  String get handoverGiveCodePersonReceiving;

  /// No description provided for @handoverCodeWasIssuedSafety.
  ///
  /// In ar, this message translates to:
  /// **'تم إصدار رمز. يظهر مرة واحدة فقط لأسباب أمنية؛ اطلب رمزاً جديداً إذا احتجت لقراءته مجدداً.'**
  String get handoverCodeWasIssuedSafety;

  /// No description provided for @handoverNoHandoverCodeYet.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد رمز تسليم بعد. أنشئ رمزاً لتعطيه للمستلم.'**
  String get handoverNoHandoverCodeYet;

  /// No description provided for @handoverCreateHandoverCode.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء رمز التسليم'**
  String get handoverCreateHandoverCode;

  /// No description provided for @handoverGetNewCode.
  ///
  /// In ar, this message translates to:
  /// **'الحصول على رمز جديد'**
  String get handoverGetNewCode;

  /// No description provided for @handoverTooManyWrongAttempts.
  ///
  /// In ar, this message translates to:
  /// **'محاولات خاطئة كثيرة. احصل على رمز جديد لفتح التسليم.'**
  String get handoverTooManyWrongAttempts;

  /// No description provided for @handoverCodeHasExpiredGet.
  ///
  /// In ar, this message translates to:
  /// **'انتهت صلاحية هذا الرمز. احصل على رمز جديد.'**
  String get handoverCodeHasExpiredGet;

  /// No description provided for @handoverWrongAttemptsLeft.
  ///
  /// In ar, this message translates to:
  /// **'تبقّت {count} محاولات خاطئة'**
  String handoverWrongAttemptsLeft(Object count);

  /// No description provided for @handoverDeliveredReceiverConfirmedCode.
  ///
  /// In ar, this message translates to:
  /// **'تم التسليم. أكّد المستلم بالرمز.'**
  String get handoverDeliveredReceiverConfirmedCode;

  /// No description provided for @handoverDeliveredWithoutReceiverDriver.
  ///
  /// In ar, this message translates to:
  /// **'تم التسليم دون المستلم: أبلغ السائق أن المستلم غير متوفر.'**
  String get handoverDeliveredWithoutReceiverDriver;

  /// No description provided for @handoverDeliveryWasClosedBy.
  ///
  /// In ar, this message translates to:
  /// **'أغلق دعم درب عملية التسليم.'**
  String get handoverDeliveryWasClosedBy;

  /// No description provided for @handoverDriverNote.
  ///
  /// In ar, this message translates to:
  /// **'ملاحظة السائق: {reason}'**
  String handoverDriverNote(Object reason);

  /// No description provided for @handoverCouldNotLoadHandover.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل رمز التسليم. اسحب للتحديث وحاول مجدداً.'**
  String get handoverCouldNotLoadHandover;

  /// No description provided for @handoverConfirmHandOver.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد التسليم'**
  String get handoverConfirmHandOver;

  /// No description provided for @handoverAskReceiverTheir6.
  ///
  /// In ar, this message translates to:
  /// **'اطلب من المستلم رمزه المكوّن من 6 أرقام وأدخله أدناه.'**
  String get handoverAskReceiverTheir6;

  /// No description provided for @handoverCodeParcelOrder.
  ///
  /// In ar, this message translates to:
  /// **'رمز الطلب {index} من {total}'**
  String handoverCodeParcelOrder(Object index, Object total);

  /// No description provided for @handoverReceiverCode.
  ///
  /// In ar, this message translates to:
  /// **'رمز المستلم'**
  String get handoverReceiverCode;

  /// No description provided for @handoverConfirmDelivery.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد التسليم'**
  String get handoverConfirmDelivery;

  /// No description provided for @handoverReceiverUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'المستلم غير متوفر'**
  String get handoverReceiverUnavailable;

  /// No description provided for @handoverOnlyUseIfReceiver.
  ///
  /// In ar, this message translates to:
  /// **'استخدم هذا فقط إذا تعذّر على المستلم إعطاء الرمز. يُسجَّل سببك وستراجعه درب.'**
  String get handoverOnlyUseIfReceiver;

  /// No description provided for @handoverReasonAtLeast10.
  ///
  /// In ar, this message translates to:
  /// **'السبب (10 أحرف على الأقل)'**
  String get handoverReasonAtLeast10;

  /// No description provided for @handoverCompleteWithoutReceiver.
  ///
  /// In ar, this message translates to:
  /// **'إتمام دون المستلم'**
  String get handoverCompleteWithoutReceiver;

  /// No description provided for @handoverEnter6DigitCode.
  ///
  /// In ar, this message translates to:
  /// **'أدخل الرمز المكوّن من 6 أرقام.'**
  String get handoverEnter6DigitCode;

  /// No description provided for @handoverDescribeWhyReceiverWas.
  ///
  /// In ar, this message translates to:
  /// **'اشرح سبب عدم توفر المستلم (10 أحرف على الأقل).'**
  String get handoverDescribeWhyReceiverWas;

  /// No description provided for @handoverThatCodeNotRight.
  ///
  /// In ar, this message translates to:
  /// **'هذا الرمز غير صحيح. تحقق منه مع المستلم وحاول مجدداً.'**
  String get handoverThatCodeNotRight;

  /// No description provided for @handoverTooManyWrongCodes.
  ///
  /// In ar, this message translates to:
  /// **'رموز خاطئة كثيرة. على المرسل إصدار رمز جديد، أو استخدم «المستلم غير متوفر».'**
  String get handoverTooManyWrongCodes;

  /// No description provided for @handoverCodeHasExpiredSender.
  ///
  /// In ar, this message translates to:
  /// **'انتهت صلاحية الرمز. على المرسل إصدار رمز جديد، أو استخدم «المستلم غير متوفر».'**
  String get handoverCodeHasExpiredSender;

  /// No description provided for @handoverNoCodeWasIssued.
  ///
  /// In ar, this message translates to:
  /// **'لم يُصدر رمز لهذا الطرد. استخدم «المستلم غير متوفر» أو اطلب من المرسل إنشاء رمز.'**
  String get handoverNoCodeWasIssued;

  /// No description provided for @handoverReceiverMustConfirmBefore.
  ///
  /// In ar, this message translates to:
  /// **'يجب أن يؤكد المستلم قبل إتمام التسليم.'**
  String get handoverReceiverMustConfirmBefore;

  /// No description provided for @handoverCouldNotConfirmDelivery.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تأكيد التسليم. حاول مجدداً.'**
  String get handoverCouldNotConfirmDelivery;

  /// No description provided for @priority.
  ///
  /// In ar, this message translates to:
  /// **'الأولوية'**
  String get priority;

  /// No description provided for @priorityLow.
  ///
  /// In ar, this message translates to:
  /// **'منخفضة'**
  String get priorityLow;

  /// No description provided for @priorityNormal.
  ///
  /// In ar, this message translates to:
  /// **'عادية'**
  String get priorityNormal;

  /// No description provided for @priorityHigh.
  ///
  /// In ar, this message translates to:
  /// **'مرتفعة'**
  String get priorityHigh;

  /// No description provided for @addParcel.
  ///
  /// In ar, this message translates to:
  /// **'إضافة طرد'**
  String get addParcel;

  /// No description provided for @removeParcel.
  ///
  /// In ar, this message translates to:
  /// **'إزالة الطرد'**
  String get removeParcel;

  /// No description provided for @parcelLimit.
  ///
  /// In ar, this message translates to:
  /// **'يجب أن يحتوي الطلب على 1 إلى 10 طرود.'**
  String get parcelLimit;

  /// No description provided for @submitOrder.
  ///
  /// In ar, this message translates to:
  /// **'إرسال الطلب'**
  String get submitOrder;

  /// No description provided for @orderCreated.
  ///
  /// In ar, this message translates to:
  /// **'تم إنشاء الطلب'**
  String get orderCreated;

  /// No description provided for @createBatch.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء دفعة طرود'**
  String get createBatch;

  /// No description provided for @batchCreated.
  ///
  /// In ar, this message translates to:
  /// **'تم إنشاء دفعة الطرود'**
  String get batchCreated;

  /// No description provided for @batchExplanation.
  ///
  /// In ar, this message translates to:
  /// **'شرح الدفعة'**
  String get batchExplanation;

  /// No description provided for @parcelBatchExplanationDemo.
  ///
  /// In ar, this message translates to:
  /// **'يمكن تجميع {parcelCount} طرود متوافقة في رحلة واحدة على ممر درب بدلاً من رحلات منفصلة، مما يقلل المسافة والتكلفة.'**
  String parcelBatchExplanationDemo(int parcelCount);

  /// No description provided for @runMatching.
  ///
  /// In ar, this message translates to:
  /// **'البحث عن مسار سائق متوافق'**
  String get runMatching;

  /// No description provided for @matchingStarted.
  ///
  /// In ar, this message translates to:
  /// **'أُرسلت المطابقة المقترحة إلى السائق'**
  String get matchingStarted;

  /// No description provided for @merchantMatchInbox.
  ///
  /// In ar, this message translates to:
  /// **'صندوق مطابقات التاجر'**
  String get merchantMatchInbox;

  /// No description provided for @waitingReadOnly.
  ///
  /// In ar, this message translates to:
  /// **'يقرر السائق القبول أو الرفض. هذه الشاشة للقراءة فقط.'**
  String get waitingReadOnly;

  /// No description provided for @openTrip.
  ///
  /// In ar, this message translates to:
  /// **'فتح الرحلة المرتبطة'**
  String get openTrip;

  /// No description provided for @merchantTrip.
  ///
  /// In ar, this message translates to:
  /// **'رحلة التاجر'**
  String get merchantTrip;

  /// No description provided for @orderStatus.
  ///
  /// In ar, this message translates to:
  /// **'حالة الطلب'**
  String get orderStatus;

  /// No description provided for @parcelStatus.
  ///
  /// In ar, this message translates to:
  /// **'حالة الطرد'**
  String get parcelStatus;

  /// No description provided for @statusDraft.
  ///
  /// In ar, this message translates to:
  /// **'مسودة'**
  String get statusDraft;

  /// No description provided for @statusSubmitted.
  ///
  /// In ar, this message translates to:
  /// **'مُرسل'**
  String get statusSubmitted;

  /// No description provided for @statusBatched.
  ///
  /// In ar, this message translates to:
  /// **'مُجمّع'**
  String get statusBatched;

  /// No description provided for @orderAlreadyBatched.
  ///
  /// In ar, this message translates to:
  /// **'يحتوي هذا الطلب على دفعة طرود بالفعل.'**
  String get orderAlreadyBatched;

  /// No description provided for @matchingUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'أنشئ دفعة أولاً أو انتظر المطابقة الحالية.'**
  String get matchingUnavailable;

  /// No description provided for @deliveryProgress.
  ///
  /// In ar, this message translates to:
  /// **'تقدم التوصيل'**
  String get deliveryProgress;

  /// No description provided for @securityAndSessions.
  ///
  /// In ar, this message translates to:
  /// **'الأمان والجلسات'**
  String get securityAndSessions;

  /// No description provided for @activeSessions.
  ///
  /// In ar, this message translates to:
  /// **'الجلسات النشطة'**
  String get activeSessions;

  /// No description provided for @currentDevice.
  ///
  /// In ar, this message translates to:
  /// **'الجهاز الحالي'**
  String get currentDevice;

  /// No description provided for @otherDevice.
  ///
  /// In ar, this message translates to:
  /// **'جهاز آخر'**
  String get otherDevice;

  /// No description provided for @mobileSession.
  ///
  /// In ar, this message translates to:
  /// **'تطبيق الهاتف'**
  String get mobileSession;

  /// No description provided for @adminSession.
  ///
  /// In ar, this message translates to:
  /// **'متصفح المسؤول'**
  String get adminSession;

  /// No description provided for @created.
  ///
  /// In ar, this message translates to:
  /// **'تاريخ الإنشاء'**
  String get created;

  /// No description provided for @lastActive.
  ///
  /// In ar, this message translates to:
  /// **'آخر نشاط'**
  String get lastActive;

  /// No description provided for @expires.
  ///
  /// In ar, this message translates to:
  /// **'تنتهي في'**
  String get expires;

  /// No description provided for @revokeSession.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الجلسة'**
  String get revokeSession;

  /// No description provided for @revokeThisDevice.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء جلسة هذا الجهاز'**
  String get revokeThisDevice;

  /// No description provided for @logoutAllDevices.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الخروج من جميع الأجهزة'**
  String get logoutAllDevices;

  /// No description provided for @confirmLogout.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد تسجيل الخروج'**
  String get confirmLogout;

  /// No description provided for @confirmLogoutMessage.
  ///
  /// In ar, this message translates to:
  /// **'هل تريد تسجيل الخروج من هذا الجهاز؟'**
  String get confirmLogoutMessage;

  /// No description provided for @confirmLogoutAll.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد تسجيل الخروج من جميع الأجهزة'**
  String get confirmLogoutAll;

  /// No description provided for @confirmLogoutAllMessage.
  ///
  /// In ar, this message translates to:
  /// **'ستنتهي جميع الجلسات النشطة، وستحتاج إلى تسجيل الدخول مجدداً على كل جهاز.'**
  String get confirmLogoutAllMessage;

  /// No description provided for @confirmRevokeSession.
  ///
  /// In ar, this message translates to:
  /// **'هل تريد إلغاء هذه الجلسة؟'**
  String get confirmRevokeSession;

  /// No description provided for @cancel.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء'**
  String get cancel;

  /// No description provided for @sessionRevoked.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء الجلسة'**
  String get sessionRevoked;

  /// No description provided for @sessionEnded.
  ///
  /// In ar, this message translates to:
  /// **'انتهت جلستك، يرجى تسجيل الدخول مرة أخرى'**
  String get sessionEnded;

  /// No description provided for @accountUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'هذا الحساب غير متاح. تواصل مع المسؤول إذا كنت بحاجة إلى مساعدة.'**
  String get accountUnavailable;

  /// No description provided for @refreshingSession.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ تحديث الجلسة...'**
  String get refreshingSession;

  /// No description provided for @unableToRefresh.
  ///
  /// In ar, this message translates to:
  /// **'تعذر تحديث الجلسة. تحقق من الاتصال ثم أعد المحاولة.'**
  String get unableToRefresh;

  /// No description provided for @localLogout.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل الخروج من هذا الجهاز'**
  String get localLogout;

  /// No description provided for @noActiveSessions.
  ///
  /// In ar, this message translates to:
  /// **'لم يتم إرجاع جلسات نشطة.'**
  String get noActiveSessions;

  /// No description provided for @sessionActionFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذر إكمال إجراء الجلسة. يرجى إعادة المحاولة.'**
  String get sessionActionFailed;

  /// No description provided for @selectAccountType.
  ///
  /// In ar, this message translates to:
  /// **'اختر نوع الحساب'**
  String get selectAccountType;

  /// No description provided for @passengerActiveAfterRegistration.
  ///
  /// In ar, this message translates to:
  /// **'يصبح الحساب نشطاً بعد التسجيل'**
  String get passengerActiveAfterRegistration;

  /// No description provided for @pendingAfterRegistration.
  ///
  /// In ar, this message translates to:
  /// **'يبقى الحساب قيد المراجعة حتى الموافقة'**
  String get pendingAfterRegistration;

  /// No description provided for @registerChooseTitle.
  ///
  /// In ar, this message translates to:
  /// **'كيف ستستخدم درب؟'**
  String get registerChooseTitle;

  /// No description provided for @registerChooseSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'اختر ما يناسبك وسنأخذك عبر الخطوات الصحيحة.'**
  String get registerChooseSubtitle;

  /// No description provided for @registerPassengerTitle.
  ///
  /// In ar, this message translates to:
  /// **'مستخدم عادي'**
  String get registerPassengerTitle;

  /// No description provided for @registerPassengerHelp.
  ///
  /// In ar, this message translates to:
  /// **'اطلب رحلات وتوصيلات. يصبح حسابك جاهزاً مباشرة بعد التسجيل.'**
  String get registerPassengerHelp;

  /// No description provided for @registerDriverTitle.
  ///
  /// In ar, this message translates to:
  /// **'سائق'**
  String get registerDriverTitle;

  /// No description provided for @registerDriverHelp.
  ///
  /// In ar, this message translates to:
  /// **'انقل الرحلات والتوصيلات. ترفع مستنداتك ويوافق المشرف على حسابك.'**
  String get registerDriverHelp;

  /// No description provided for @registerMerchantTitle.
  ///
  /// In ar, this message translates to:
  /// **'صاحب متجر'**
  String get registerMerchantTitle;

  /// No description provided for @registerMerchantHelp.
  ///
  /// In ar, this message translates to:
  /// **'أرسل طلبات من متجرك. ترفع مستنداتك ويوافق المشرف على حسابك.'**
  String get registerMerchantHelp;

  /// No description provided for @phoneNumber.
  ///
  /// In ar, this message translates to:
  /// **'رقم الهاتف'**
  String get phoneNumber;

  /// No description provided for @sendVerificationCode.
  ///
  /// In ar, this message translates to:
  /// **'إرسال رمز التحقق'**
  String get sendVerificationCode;

  /// No description provided for @emailForCode.
  ///
  /// In ar, this message translates to:
  /// **'البريد الإلكتروني (نرسل الرمز إليه)'**
  String get emailForCode;

  /// No description provided for @onboardingNoCodeNote.
  ///
  /// In ar, this message translates to:
  /// **'لا نرسل رمز تحقق. أدخل بريدك الإلكتروني ورقم جوالك الحقيقيين: يراجع فريق درب مستنداتك ويوافق على حسابك قبل أن تتمكن من تسجيل الدخول.'**
  String get onboardingNoCodeNote;

  /// No description provided for @codeSentToEmail.
  ///
  /// In ar, this message translates to:
  /// **'أرسلنا رمزاً من ستة أرقام إلى بريدك الإلكتروني. تحقق من بريدك، بما في ذلك مجلد الرسائل غير المرغوبة.'**
  String get codeSentToEmail;

  /// No description provided for @enterVerificationCode.
  ///
  /// In ar, this message translates to:
  /// **'أدخل رمز التحقق'**
  String get enterVerificationCode;

  /// No description provided for @resendCode.
  ///
  /// In ar, this message translates to:
  /// **'إعادة إرسال الرمز'**
  String get resendCode;

  /// No description provided for @resendAvailableIn.
  ///
  /// In ar, this message translates to:
  /// **'تتوفر إعادة الإرسال خلال'**
  String get resendAvailableIn;

  /// No description provided for @verify.
  ///
  /// In ar, this message translates to:
  /// **'تحقق'**
  String get verify;

  /// No description provided for @accountInformation.
  ///
  /// In ar, this message translates to:
  /// **'معلومات الحساب'**
  String get accountInformation;

  /// No description provided for @displayName.
  ///
  /// In ar, this message translates to:
  /// **'الاسم الظاهر'**
  String get displayName;

  /// No description provided for @confirmPassword.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد كلمة المرور'**
  String get confirmPassword;

  /// No description provided for @terms.
  ///
  /// In ar, this message translates to:
  /// **'الشروط'**
  String get terms;

  /// No description provided for @privacyNotice.
  ///
  /// In ar, this message translates to:
  /// **'إشعار الخصوصية'**
  String get privacyNotice;

  /// No description provided for @confirmAdult.
  ///
  /// In ar, this message translates to:
  /// **'أؤكد أن عمري 18 عاماً أو أكثر'**
  String get confirmAdult;

  /// No description provided for @acceptAndContinue.
  ///
  /// In ar, this message translates to:
  /// **'قبول ومتابعة'**
  String get acceptAndContinue;

  /// No description provided for @accountCreated.
  ///
  /// In ar, this message translates to:
  /// **'تم إنشاء الحساب'**
  String get accountCreated;

  /// No description provided for @signInToContinue.
  ///
  /// In ar, this message translates to:
  /// **'تم إنشاء حسابك. سجّل الدخول للمتابعة.'**
  String get signInToContinue;

  /// No description provided for @applicationUnderReview.
  ///
  /// In ar, this message translates to:
  /// **'الطلب قيد المراجعة'**
  String get applicationUnderReview;

  /// No description provided for @pendingReviewBody.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال طلبك إلى المشرف وهو بانتظار الموافقة. يستغرق ذلك عادةً حتى 24 ساعة. يمكنك تسجيل الدخول بعد الموافقة عليه.'**
  String get pendingReviewBody;

  /// No description provided for @merchantDocumentsHint.
  ///
  /// In ar, this message translates to:
  /// **'للحصول على الموافقة، ارفع صوراً واضحة أو ملفات PDF للسجل التجاري (أو رخصة المتجر) والهوية الوطنية وصورة للمتجر. تُحفظ الملفات على خادمنا ولا يفتحها إلا فريق المراجعة.'**
  String get merchantDocumentsHint;

  /// No description provided for @documentKindCommercialRegister.
  ///
  /// In ar, this message translates to:
  /// **'السجل التجاري'**
  String get documentKindCommercialRegister;

  /// No description provided for @documentKindShopPhoto.
  ///
  /// In ar, this message translates to:
  /// **'صورة المتجر'**
  String get documentKindShopPhoto;

  /// No description provided for @checkApplicationStatus.
  ///
  /// In ar, this message translates to:
  /// **'متابعة حالة طلب سابق'**
  String get checkApplicationStatus;

  /// No description provided for @registrationUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'التسجيل غير متاح مؤقتاً.'**
  String get registrationUnavailable;

  /// No description provided for @unableToStartRegistration.
  ///
  /// In ar, this message translates to:
  /// **'تعذر بدء التسجيل. تحقق من رقم الهاتف والبريد الإلكتروني وحاول مرة أخرى.'**
  String get unableToStartRegistration;

  /// No description provided for @incorrectVerificationCode.
  ///
  /// In ar, this message translates to:
  /// **'رمز التحقق غير صحيح.'**
  String get incorrectVerificationCode;

  /// No description provided for @codeExpired.
  ///
  /// In ar, this message translates to:
  /// **'انتهت صلاحية الرمز.'**
  String get codeExpired;

  /// No description provided for @tooManyAttempts.
  ///
  /// In ar, this message translates to:
  /// **'محاولات كثيرة جداً. يرجى المحاولة لاحقاً.'**
  String get tooManyAttempts;

  /// No description provided for @consentDocumentsChanged.
  ///
  /// In ar, this message translates to:
  /// **'تغيرت مستندات الموافقة. يرجى مراجعتها مرة أخرى.'**
  String get consentDocumentsChanged;

  /// No description provided for @requestReference.
  ///
  /// In ar, this message translates to:
  /// **'مرجع الطلب'**
  String get requestReference;

  /// No description provided for @leaveRegistration.
  ///
  /// In ar, this message translates to:
  /// **'مغادرة التسجيل'**
  String get leaveRegistration;

  /// No description provided for @continueRegistration.
  ///
  /// In ar, this message translates to:
  /// **'متابعة التسجيل'**
  String get continueRegistration;

  /// No description provided for @leaveRegistrationWarning.
  ///
  /// In ar, this message translates to:
  /// **'سيؤدي الخروج إلى مسح حالة التسجيل المحفوظة على هذا الجهاز. هل تريد المتابعة؟'**
  String get leaveRegistrationWarning;

  /// No description provided for @secondsShort.
  ///
  /// In ar, this message translates to:
  /// **'ثانية'**
  String get secondsShort;

  /// No description provided for @consentVersion.
  ///
  /// In ar, this message translates to:
  /// **'الإصدار'**
  String get consentVersion;

  /// No description provided for @accountApproved.
  ///
  /// In ar, this message translates to:
  /// **'تمت الموافقة على الحساب'**
  String get accountApproved;

  /// No description provided for @signInAfterApproval.
  ///
  /// In ar, this message translates to:
  /// **'تمت الموافقة على حسابك. سجّل الدخول للمتابعة.'**
  String get signInAfterApproval;

  /// No description provided for @canonicalRoutes.
  ///
  /// In ar, this message translates to:
  /// **'خدمات المسارات المتعددة'**
  String get canonicalRoutes;

  /// No description provided for @canonicalRoutesBody.
  ///
  /// In ar, this message translates to:
  /// **'اختر من المسارات الحالية والمحطات المعتمدة.'**
  String get canonicalRoutesBody;

  /// No description provided for @featureUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'هذه الخدمة غير متاحة في هذه البيئة.'**
  String get featureUnavailable;

  /// No description provided for @routeCatalogUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'المسارات غير متاحة مؤقتاً. حدّثها قبل الإرسال.'**
  String get routeCatalogUnavailable;

  /// No description provided for @orderRouteLabel.
  ///
  /// In ar, this message translates to:
  /// **'المسار'**
  String get orderRouteLabel;

  /// No description provided for @merchantCancelOrderTitle.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء هذا الطلب؟'**
  String get merchantCancelOrderTitle;

  /// No description provided for @merchantCancelOrderBody.
  ///
  /// In ar, this message translates to:
  /// **'سيُلغى الطلب {reference} مع {count, plural, =1{طرد واحد} =2{طردين} few{{count} طرود} other{{count} طرداً}}. لا يمكن التراجع عن ذلك.'**
  String merchantCancelOrderBody(String reference, int count);

  /// No description provided for @merchantCancelBatchNote.
  ///
  /// In ar, this message translates to:
  /// **'هذا الطلب مجمّع مع {count, plural, =1{طلب آخر} =2{طلبين آخرين} few{{count} طلبات أخرى} other{{count} طلباً آخر}} لسائق واحد. يُلغى هذا الطلب فقط، وتبقى الطلبات الأخرى مجمّعة بانتظار سائق.'**
  String merchantCancelBatchNote(int count);

  /// No description provided for @merchantCancelOfferNote.
  ///
  /// In ar, this message translates to:
  /// **'يُسحب عرض السائق للمجموعة، وتحتاج الطلبات الأخرى إلى مطابقة سائق جديدة.'**
  String get merchantCancelOfferNote;

  /// No description provided for @merchantCancelConfirm.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الطلب'**
  String get merchantCancelConfirm;

  /// No description provided for @merchantCancelKeep.
  ///
  /// In ar, this message translates to:
  /// **'الإبقاء على الطلب'**
  String get merchantCancelKeep;

  /// No description provided for @merchantTripOrdersTitle.
  ///
  /// In ar, this message translates to:
  /// **'طلباتك في هذا التوصيل'**
  String get merchantTripOrdersTitle;

  /// No description provided for @orderRouteChoose.
  ///
  /// In ar, this message translates to:
  /// **'اختر المسار'**
  String get orderRouteChoose;

  /// No description provided for @orderRoutesLoadFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل المسارات. تحقّق من الاتصال وحاول مرة أخرى.'**
  String get orderRoutesLoadFailed;

  /// No description provided for @orderRoutesEmpty.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد مسارات تعمل حالياً. حاول لاحقاً.'**
  String get orderRoutesEmpty;

  /// No description provided for @orderRouteRequired.
  ///
  /// In ar, this message translates to:
  /// **'اختر المسار أولاً.'**
  String get orderRouteRequired;

  /// No description provided for @orderRouteUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'هذا المسار لم يعد يعمل. اختر مساراً آخر.'**
  String get orderRouteUnavailable;

  /// No description provided for @orderRouteSaved.
  ///
  /// In ar, this message translates to:
  /// **'المسار المحفوظ'**
  String get orderRouteSaved;

  /// No description provided for @orderDetailsTooShort.
  ///
  /// In ar, this message translates to:
  /// **'اكتب 3 أحرف على الأقل ليجد السائق المكان.'**
  String get orderDetailsTooShort;

  /// No description provided for @merchantPickupDetailsLabel.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل مكان الاستلام'**
  String get merchantPickupDetailsLabel;

  /// No description provided for @merchantPickupDetailsHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: اسم المتجر والشارع'**
  String get merchantPickupDetailsHint;

  /// No description provided for @merchantDropoffDetailsLabel.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل مكان التسليم'**
  String get merchantDropoffDetailsLabel;

  /// No description provided for @merchantDropoffDetailsHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: الحي والشارع وأقرب معلم'**
  String get merchantDropoffDetailsHint;

  /// No description provided for @merchantReceiverNameLabel.
  ///
  /// In ar, this message translates to:
  /// **'اسم المستلم (اختياري)'**
  String get merchantReceiverNameLabel;

  /// No description provided for @merchantReceiverPhoneLabel.
  ///
  /// In ar, this message translates to:
  /// **'هاتف المستلم (اختياري)'**
  String get merchantReceiverPhoneLabel;

  /// No description provided for @merchantReceiverPhoneInvalid.
  ///
  /// In ar, this message translates to:
  /// **'أدخل رقم هاتف صحيحاً، مثل ‎+970599123456.'**
  String get merchantReceiverPhoneInvalid;

  /// No description provided for @merchantReceiverLabel.
  ///
  /// In ar, this message translates to:
  /// **'المستلم'**
  String get merchantReceiverLabel;

  /// No description provided for @merchantPendingOrderTitle.
  ///
  /// In ar, this message translates to:
  /// **'طلب بانتظار التأكيد'**
  String get merchantPendingOrderTitle;

  /// No description provided for @driverRoutePickTitle.
  ///
  /// In ar, this message translates to:
  /// **'اختر مسارك'**
  String get driverRoutePickTitle;

  /// No description provided for @driverRoutePickBody.
  ///
  /// In ar, this message translates to:
  /// **'ستصلك طلبات الركاب والطرود على هذا المسار فقط.'**
  String get driverRoutePickBody;

  /// No description provided for @driverRoutePickConfirm.
  ///
  /// In ar, this message translates to:
  /// **'ابدأ العمل'**
  String get driverRoutePickConfirm;

  /// No description provided for @driverRouteNone.
  ///
  /// In ar, this message translates to:
  /// **'لم تختر مساراً بعد'**
  String get driverRouteNone;

  /// No description provided for @driverPickupDetailsLabel.
  ///
  /// In ar, this message translates to:
  /// **'مكان الصعود'**
  String get driverPickupDetailsLabel;

  /// No description provided for @driverDropoffDetailsLabel.
  ///
  /// In ar, this message translates to:
  /// **'مكان النزول'**
  String get driverDropoffDetailsLabel;

  /// No description provided for @driverMerchantPickupLabel.
  ///
  /// In ar, this message translates to:
  /// **'استلم الطرود من'**
  String get driverMerchantPickupLabel;

  /// No description provided for @driverParcelStopsTitle.
  ///
  /// In ar, this message translates to:
  /// **'أماكن تسليم الطرود'**
  String get driverParcelStopsTitle;

  /// No description provided for @driverParcelStopLabel.
  ///
  /// In ar, this message translates to:
  /// **'الطرد {number}'**
  String driverParcelStopLabel(int number);

  /// No description provided for @driverReceiverLabel.
  ///
  /// In ar, this message translates to:
  /// **'المستلم'**
  String get driverReceiverLabel;

  /// No description provided for @driverWhereToFindTitle.
  ///
  /// In ar, this message translates to:
  /// **'أماكن الاستلام والتسليم'**
  String get driverWhereToFindTitle;

  /// No description provided for @driverBatchOrderTitle.
  ///
  /// In ar, this message translates to:
  /// **'الطلب {number} من {total}'**
  String driverBatchOrderTitle(int number, int total);

  /// No description provided for @passengerParcelAssignment.
  ///
  /// In ar, this message translates to:
  /// **'طرد راكب'**
  String get passengerParcelAssignment;

  /// No description provided for @handoverStopIntro.
  ///
  /// In ar, this message translates to:
  /// **'أدخل الرمز الذي يعطيك إياه المستلم في المحطة التي وصلت إليها. تبقى المحطات التي لم تصلها بعد مفتوحة.'**
  String get handoverStopIntro;

  /// No description provided for @handoverStopLabel.
  ///
  /// In ar, this message translates to:
  /// **'المحطة {number} · {place}'**
  String handoverStopLabel(int number, String place);

  /// No description provided for @handoverStopCodeRequired.
  ///
  /// In ar, this message translates to:
  /// **'أدخل رمز محطة واحدة على الأقل.'**
  String get handoverStopCodeRequired;

  /// No description provided for @handoverUnavailableStop.
  ///
  /// In ar, this message translates to:
  /// **'مستلم أي محطة غير متوفر؟'**
  String get handoverUnavailableStop;

  /// No description provided for @noPublishedRoutes.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد مسارات منشورة ومؤهلة حالياً.'**
  String get noPublishedRoutes;

  /// No description provided for @selectRoute.
  ///
  /// In ar, this message translates to:
  /// **'اختر المسار'**
  String get selectRoute;

  /// No description provided for @routeDirection.
  ///
  /// In ar, this message translates to:
  /// **'الاتجاه'**
  String get routeDirection;

  /// No description provided for @directionOutbound.
  ///
  /// In ar, this message translates to:
  /// **'ذهاب'**
  String get directionOutbound;

  /// No description provided for @directionInbound.
  ///
  /// In ar, this message translates to:
  /// **'عودة'**
  String get directionInbound;

  /// No description provided for @directionLoop.
  ///
  /// In ar, this message translates to:
  /// **'دائري'**
  String get directionLoop;

  /// No description provided for @orderedStops.
  ///
  /// In ar, this message translates to:
  /// **'المحطات بالترتيب'**
  String get orderedStops;

  /// No description provided for @stopSequence.
  ///
  /// In ar, this message translates to:
  /// **'المحطة {sequence}'**
  String stopSequence(int sequence);

  /// No description provided for @driverAvailabilities.
  ///
  /// In ar, this message translates to:
  /// **'إتاحة المسار'**
  String get driverAvailabilities;

  /// No description provided for @newAvailability.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء إتاحة لمسار'**
  String get newAvailability;

  /// No description provided for @noAvailabilities.
  ///
  /// In ar, this message translates to:
  /// **'لم تُنشأ إتاحة لمسار بعد.'**
  String get noAvailabilities;

  /// No description provided for @departureTime.
  ///
  /// In ar, this message translates to:
  /// **'وقت الانطلاق'**
  String get departureTime;

  /// No description provided for @availabilityWindowEnd.
  ///
  /// In ar, this message translates to:
  /// **'نهاية نافذة الإتاحة (اختياري)'**
  String get availabilityWindowEnd;

  /// No description provided for @seatCapacity.
  ///
  /// In ar, this message translates to:
  /// **'سعة المقاعد'**
  String get seatCapacity;

  /// No description provided for @reviewAndConfirm.
  ///
  /// In ar, this message translates to:
  /// **'مراجعة وتأكيد'**
  String get reviewAndConfirm;

  /// No description provided for @availabilityRecorded.
  ///
  /// In ar, this message translates to:
  /// **'تم تسجيل الإتاحة'**
  String get availabilityRecorded;

  /// No description provided for @remainingCapacity.
  ///
  /// In ar, this message translates to:
  /// **'المتبقي: {seats} مقاعد، {parcels} طرود'**
  String remainingCapacity(int seats, int parcels);

  /// No description provided for @activateAvailability.
  ///
  /// In ar, this message translates to:
  /// **'تفعيل الإتاحة'**
  String get activateAvailability;

  /// No description provided for @pauseAvailability.
  ///
  /// In ar, this message translates to:
  /// **'إيقاف الإتاحة مؤقتاً'**
  String get pauseAvailability;

  /// No description provided for @resumeAvailability.
  ///
  /// In ar, this message translates to:
  /// **'استئناف الإتاحة'**
  String get resumeAvailability;

  /// No description provided for @cancelAvailability.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الإتاحة'**
  String get cancelAvailability;

  /// No description provided for @editAvailability.
  ///
  /// In ar, this message translates to:
  /// **'تعديل الإتاحة'**
  String get editAvailability;

  /// No description provided for @canonicalPassengerRequest.
  ///
  /// In ar, this message translates to:
  /// **'طلب مسار'**
  String get canonicalPassengerRequest;

  /// No description provided for @canonicalPassengerRequestBody.
  ///
  /// In ar, this message translates to:
  /// **'اطلب التنقل عبر مسار ومحطات معتمدة.'**
  String get canonicalPassengerRequestBody;

  /// No description provided for @pickupStop.
  ///
  /// In ar, this message translates to:
  /// **'محطة الصعود'**
  String get pickupStop;

  /// No description provided for @dropoffStop.
  ///
  /// In ar, this message translates to:
  /// **'محطة النزول'**
  String get dropoffStop;

  /// No description provided for @departureFrom.
  ///
  /// In ar, this message translates to:
  /// **'بداية وقت الانطلاق'**
  String get departureFrom;

  /// No description provided for @departureUntil.
  ///
  /// In ar, this message translates to:
  /// **'نهاية وقت الانطلاق'**
  String get departureUntil;

  /// No description provided for @requestRecorded.
  ///
  /// In ar, this message translates to:
  /// **'تم تسجيل طلب المسار.'**
  String get requestRecorded;

  /// No description provided for @matchingDisabledNotice.
  ///
  /// In ar, this message translates to:
  /// **'المطابقة غير مفعلة في هذه المرحلة. لم يُعيَّن سائق ولم تُنشأ رحلة.'**
  String get matchingDisabledNotice;

  /// No description provided for @canonicalMerchantOrder.
  ///
  /// In ar, this message translates to:
  /// **'طلب طرود عبر مسار'**
  String get canonicalMerchantOrder;

  /// No description provided for @canonicalMerchantOrderBody.
  ///
  /// In ar, this message translates to:
  /// **'أنشئ طلباً واحداً متكاملاً على مسار معتمد.'**
  String get canonicalMerchantOrderBody;

  /// No description provided for @parcelPickupStop.
  ///
  /// In ar, this message translates to:
  /// **'محطة استلام الطرود'**
  String get parcelPickupStop;

  /// No description provided for @parcelDestination.
  ///
  /// In ar, this message translates to:
  /// **'وجهة الطرد'**
  String get parcelDestination;

  /// No description provided for @parcelPriority.
  ///
  /// In ar, this message translates to:
  /// **'أولوية الطرد'**
  String get parcelPriority;

  /// No description provided for @orderRecorded.
  ///
  /// In ar, this message translates to:
  /// **'تم تسجيل طلب الطرود عبر المسار.'**
  String get orderRecorded;

  /// No description provided for @batchingMatchingDisabledNotice.
  ///
  /// In ar, this message translates to:
  /// **'التجميع والمطابقة غير مفعلين في هذه المرحلة. لم يُعيَّن سائق ولم تُنشأ رحلة توصيل.'**
  String get batchingMatchingDisabledNotice;

  /// No description provided for @submitAvailability.
  ///
  /// In ar, this message translates to:
  /// **'إرسال الإتاحة'**
  String get submitAvailability;

  /// No description provided for @selectDateTime.
  ///
  /// In ar, this message translates to:
  /// **'اختر التاريخ والوقت'**
  String get selectDateTime;

  /// No description provided for @invalidDepartureWindow.
  ///
  /// In ar, this message translates to:
  /// **'اختر نافذة انطلاق مستقبلية وصحيحة.'**
  String get invalidDepartureWindow;

  /// No description provided for @availabilityDepartureTooSoon.
  ///
  /// In ar, this message translates to:
  /// **'وقت الانطلاق قريب جداً. اختر وقتاً بعد 10 دقائق على الأقل من الآن.'**
  String get availabilityDepartureTooSoon;

  /// No description provided for @availabilityDepartureTooFar.
  ///
  /// In ar, this message translates to:
  /// **'وقت الانطلاق بعيد جداً. اختر وقتاً خلال الـ30 يوماً القادمة.'**
  String get availabilityDepartureTooFar;

  /// No description provided for @availabilityInvalidWindow.
  ///
  /// In ar, this message translates to:
  /// **'نهاية نافذة الإتاحة يجب أن تكون بعد الانطلاق بساعتين كحد أقصى.'**
  String get availabilityInvalidWindow;

  /// No description provided for @availabilityExceedsVehicleCapacity.
  ///
  /// In ar, this message translates to:
  /// **'سعة المقاعد أو الطرود التي اخترتها تتجاوز سعة مركبتك المسجلة.'**
  String get availabilityExceedsVehicleCapacity;

  /// No description provided for @availabilityDriverNotApproved.
  ///
  /// In ar, this message translates to:
  /// **'حسابك كسائق لم يُعتمد بعد. تواصل مع الدعم لإتمام التحقق.'**
  String get availabilityDriverNotApproved;

  /// No description provided for @availabilityRouteNoLongerEligible.
  ///
  /// In ar, this message translates to:
  /// **'لم يعد هذا المسار متاحاً. اختر مساراً آخر.'**
  String get availabilityRouteNoLongerEligible;

  /// No description provided for @availabilityDuplicate.
  ///
  /// In ar, this message translates to:
  /// **'لديك بالفعل إتاحة مطابقة لهذا المسار والوقت.'**
  String get availabilityDuplicate;

  /// No description provided for @invalidStopOrder.
  ///
  /// In ar, this message translates to:
  /// **'اختر محطة معتمدة لاحقة في المسار.'**
  String get invalidStopOrder;

  /// No description provided for @operationTemporaryFailure.
  ///
  /// In ar, this message translates to:
  /// **'نتيجة العملية غير مؤكدة. أعد محاولة العملية نفسها عند توفر الاتصال.'**
  String get operationTemporaryFailure;

  /// No description provided for @canonicalRecoveryRequired.
  ///
  /// In ar, this message translates to:
  /// **'توجد عملية سابقة غير محسومة. سجّل الدخول بالحساب الأصلي وأعد العملية نفسها، أو تواصل مع الدعم إذا انتهت مهلة الاسترداد.'**
  String get canonicalRecoveryRequired;

  /// No description provided for @savedRequestRejected.
  ///
  /// In ar, this message translates to:
  /// **'لم يقبل درب الطلب المحفوظ عند إعادة إرساله، لذلك أُزيل. راجع قائمتك، ثم ابدأ من جديد إن كنت ما زلت بحاجة إليه.'**
  String get savedRequestRejected;

  /// No description provided for @savedRequestExpired.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تأكيد الطلب المحفوظ في الوقت المحدد، لذلك أُزيل. راجع قائمتك، ثم ابدأ من جديد إن كنت ما زلت بحاجة إليه.'**
  String get savedRequestExpired;

  /// No description provided for @discardSavedRequest.
  ///
  /// In ar, this message translates to:
  /// **'تجاهل والبدء من جديد'**
  String get discardSavedRequest;

  /// No description provided for @discardSavedRequestTitle.
  ///
  /// In ar, this message translates to:
  /// **'تجاهل الطلب المحفوظ؟'**
  String get discardSavedRequestTitle;

  /// No description provided for @discardSavedRequestBody.
  ///
  /// In ar, this message translates to:
  /// **'لم يتمكن درب من تأكيد وصول إرسالك السابق. إن كان قد وصل، فقد يؤدي البدء من جديد إلى طلب مكرر. راجع قائمتك أولاً إن لم تكن متأكداً.'**
  String get discardSavedRequestBody;

  /// No description provided for @discardSavedRequestConfirm.
  ///
  /// In ar, this message translates to:
  /// **'تجاهل'**
  String get discardSavedRequestConfirm;

  /// No description provided for @transactionRetryRequired.
  ///
  /// In ar, this message translates to:
  /// **'حدث تعارض مؤقت في المعاملة. أعد محاولة هذه العملية.'**
  String get transactionRetryRequired;

  /// No description provided for @refreshRoutes.
  ///
  /// In ar, this message translates to:
  /// **'تحديث المسارات'**
  String get refreshRoutes;

  /// No description provided for @statusPaused.
  ///
  /// In ar, this message translates to:
  /// **'متوقفة مؤقتاً'**
  String get statusPaused;

  /// No description provided for @statusFilled.
  ///
  /// In ar, this message translates to:
  /// **'ممتلئة'**
  String get statusFilled;

  /// No description provided for @statusDeparted.
  ///
  /// In ar, this message translates to:
  /// **'انطلقت'**
  String get statusDeparted;

  /// No description provided for @returnToDashboard.
  ///
  /// In ar, this message translates to:
  /// **'العودة إلى لوحة التحكم'**
  String get returnToDashboard;

  /// No description provided for @viewRouteRequests.
  ///
  /// In ar, this message translates to:
  /// **'عرض طلبات المسار الخاصة بي'**
  String get viewRouteRequests;

  /// No description provided for @canonicalDriverOffers.
  ///
  /// In ar, this message translates to:
  /// **'عروض المسار'**
  String get canonicalDriverOffers;

  /// No description provided for @canonicalDriverOffersBody.
  ///
  /// In ar, this message translates to:
  /// **'راجع طلبات الركاب والطرود الحالية المرتبطة بإتاحة مسارك.'**
  String get canonicalDriverOffersBody;

  /// No description provided for @noCanonicalOffers.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد عروض مسار حالياً.'**
  String get noCanonicalOffers;

  /// No description provided for @loadMore.
  ///
  /// In ar, this message translates to:
  /// **'تحميل المزيد'**
  String get loadMore;

  /// No description provided for @offerDetails.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل العرض'**
  String get offerDetails;

  /// No description provided for @offerExpires.
  ///
  /// In ar, this message translates to:
  /// **'ينتهي العرض'**
  String get offerExpires;

  /// No description provided for @offerExpired.
  ///
  /// In ar, this message translates to:
  /// **'انتهت صلاحية هذا العرض.'**
  String get offerExpired;

  /// No description provided for @demandPassenger.
  ///
  /// In ar, this message translates to:
  /// **'طلب راكب'**
  String get demandPassenger;

  /// No description provided for @demandMerchant.
  ///
  /// In ar, this message translates to:
  /// **'طلب طرود'**
  String get demandMerchant;

  /// No description provided for @acceptOffer.
  ///
  /// In ar, this message translates to:
  /// **'قبول العرض'**
  String get acceptOffer;

  /// No description provided for @rejectOffer.
  ///
  /// In ar, this message translates to:
  /// **'رفض العرض'**
  String get rejectOffer;

  /// No description provided for @rejectReason.
  ///
  /// In ar, this message translates to:
  /// **'سبب الرفض'**
  String get rejectReason;

  /// No description provided for @rejectDriverDeclined.
  ///
  /// In ar, this message translates to:
  /// **'لا أستطيع تنفيذ هذه المهمة'**
  String get rejectDriverDeclined;

  /// No description provided for @rejectScheduleConflict.
  ///
  /// In ar, this message translates to:
  /// **'تعارض في الموعد'**
  String get rejectScheduleConflict;

  /// No description provided for @rejectCapacityUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'السعة غير متوفرة'**
  String get rejectCapacityUnavailable;

  /// No description provided for @confirmAcceptOffer.
  ///
  /// In ar, this message translates to:
  /// **'هل تريد قبول مهمة المسار هذه؟'**
  String get confirmAcceptOffer;

  /// No description provided for @confirmRejectOffer.
  ///
  /// In ar, this message translates to:
  /// **'هل تريد رفض مهمة المسار هذه؟'**
  String get confirmRejectOffer;

  /// No description provided for @offerAccepted.
  ///
  /// In ar, this message translates to:
  /// **'تم قبول المهمة.'**
  String get offerAccepted;

  /// No description provided for @offerRejected.
  ///
  /// In ar, this message translates to:
  /// **'تم رفض المهمة.'**
  String get offerRejected;

  /// No description provided for @operationResultUncertain.
  ///
  /// In ar, this message translates to:
  /// **'نتيجة العملية غير مؤكدة. احتفظ بهذه العملية وقم بمطابقتها قبل محاولة عملية أخرى.'**
  String get operationResultUncertain;

  /// No description provided for @recoverOperation.
  ///
  /// In ar, this message translates to:
  /// **'مطابقة نتيجة العملية'**
  String get recoverOperation;

  /// No description provided for @canonicalAssignmentStatus.
  ///
  /// In ar, this message translates to:
  /// **'حالة إسناد المسار'**
  String get canonicalAssignmentStatus;

  /// No description provided for @canonicalAssignments.
  ///
  /// In ar, this message translates to:
  /// **'طلبات المسار والإسناد'**
  String get canonicalAssignments;

  /// No description provided for @noCanonicalAssignments.
  ///
  /// In ar, this message translates to:
  /// **'لم تُسجل إسنادات مسار بعد.'**
  String get noCanonicalAssignments;

  /// No description provided for @statusOffered.
  ///
  /// In ar, this message translates to:
  /// **'معروض على سائق'**
  String get statusOffered;

  /// No description provided for @statusUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد إسناد متاح'**
  String get statusUnavailable;

  /// No description provided for @canonicalTrip.
  ///
  /// In ar, this message translates to:
  /// **'الرحلة المسندة'**
  String get canonicalTrip;

  /// No description provided for @vehicleType.
  ///
  /// In ar, this message translates to:
  /// **'نوع المركبة'**
  String get vehicleType;

  /// No description provided for @trackingNotAvailable.
  ///
  /// In ar, this message translates to:
  /// **'التتبع المباشر والخرائط وتقديرات الوصول غير متوفرة في هذه المرحلة.'**
  String get trackingNotAvailable;

  /// No description provided for @manualRefreshNotice.
  ///
  /// In ar, this message translates to:
  /// **'اسحب للأسفل أو استخدم زر التحديث للتحقق من المستجدات.'**
  String get manualRefreshNotice;

  /// No description provided for @assignmentPendingBody.
  ///
  /// In ar, this message translates to:
  /// **'طلبك بانتظار المطابقة.'**
  String get assignmentPendingBody;

  /// No description provided for @assignmentOfferedBody.
  ///
  /// In ar, this message translates to:
  /// **'العرض بانتظار قرار السائق.'**
  String get assignmentOfferedBody;

  /// No description provided for @assignmentAssignedBody.
  ///
  /// In ar, this message translates to:
  /// **'قبل السائق وتم إنشاء رحلة.'**
  String get assignmentAssignedBody;

  /// No description provided for @assignmentUnavailableBody.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد إسناد نشط لسائق.'**
  String get assignmentUnavailableBody;

  /// No description provided for @assignmentCancelledBody.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء هذا الطلب.'**
  String get assignmentCancelledBody;

  /// No description provided for @leaveRejectionWarning.
  ///
  /// In ar, this message translates to:
  /// **'لم يتم إرسال سبب الرفض المحدد. هل تريد مغادرة الشاشة؟'**
  String get leaveRejectionWarning;

  /// No description provided for @routeStops.
  ///
  /// In ar, this message translates to:
  /// **'محطات المسار'**
  String get routeStops;

  /// No description provided for @navNewRequest.
  ///
  /// In ar, this message translates to:
  /// **'طلب جديد'**
  String get navNewRequest;

  /// No description provided for @navHome.
  ///
  /// In ar, this message translates to:
  /// **'الرئيسية'**
  String get navHome;

  /// No description provided for @navAccount.
  ///
  /// In ar, this message translates to:
  /// **'الحساب'**
  String get navAccount;

  /// No description provided for @navTrips.
  ///
  /// In ar, this message translates to:
  /// **'رحلاتي'**
  String get navTrips;

  /// No description provided for @greetingMorning.
  ///
  /// In ar, this message translates to:
  /// **'صباح الخير، {name}'**
  String greetingMorning(String name);

  /// No description provided for @greetingAfternoon.
  ///
  /// In ar, this message translates to:
  /// **'مساء الخير، {name}'**
  String greetingAfternoon(String name);

  /// No description provided for @greetingEvening.
  ///
  /// In ar, this message translates to:
  /// **'مساء الخير، {name}'**
  String greetingEvening(String name);

  /// No description provided for @smartSearch.
  ///
  /// In ar, this message translates to:
  /// **'بحث ذكي'**
  String get smartSearch;

  /// No description provided for @destinationSearchHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: من البوليتكنك إلى بيت لحم'**
  String get destinationSearchHint;

  /// No description provided for @quickDestinations.
  ///
  /// In ar, this message translates to:
  /// **'الوجهات السريعة'**
  String get quickDestinations;

  /// No description provided for @availableTripsTo.
  ///
  /// In ar, this message translates to:
  /// **'رحلات متاحة إلى {destination}'**
  String availableTripsTo(String destination);

  /// No description provided for @searchForTrip.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن رحلة'**
  String get searchForTrip;

  /// No description provided for @perPassenger.
  ///
  /// In ar, this message translates to:
  /// **'للراكب'**
  String get perPassenger;

  /// No description provided for @departure.
  ///
  /// In ar, this message translates to:
  /// **'المغادرة'**
  String get departure;

  /// No description provided for @bookSeat.
  ///
  /// In ar, this message translates to:
  /// **'احجز'**
  String get bookSeat;

  /// No description provided for @noAvailableTrips.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد رحلات متاحة حالياً'**
  String get noAvailableTrips;

  /// No description provided for @noAvailableTripsBody.
  ///
  /// In ar, this message translates to:
  /// **'أنشئ طلباً وسيقوم درب بمطابقتك مع سائق على المسار.'**
  String get noAvailableTripsBody;

  /// No description provided for @seatsRemaining.
  ///
  /// In ar, this message translates to:
  /// **'{count} مقاعد متاحة'**
  String seatsRemaining(int count);

  /// No description provided for @completedTripsCount.
  ///
  /// In ar, this message translates to:
  /// **'{count} رحلة'**
  String completedTripsCount(int count);

  /// No description provided for @notifications.
  ///
  /// In ar, this message translates to:
  /// **'الإشعارات'**
  String get notifications;

  /// No description provided for @noNotifications.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد إشعارات بعد.'**
  String get noNotifications;

  /// No description provided for @sampleDataNotice.
  ///
  /// In ar, this message translates to:
  /// **'بيانات تجريبية للعرض فقط، غير مرتبطة بالخادم.'**
  String get sampleDataNotice;

  /// No description provided for @driverOnline.
  ///
  /// In ar, this message translates to:
  /// **'متصل'**
  String get driverOnline;

  /// No description provided for @driverOffline.
  ///
  /// In ar, this message translates to:
  /// **'غير متصل'**
  String get driverOffline;

  /// No description provided for @trustPoints.
  ///
  /// In ar, this message translates to:
  /// **'نقاط الثقة'**
  String get trustPoints;

  /// No description provided for @trustExcellent.
  ///
  /// In ar, this message translates to:
  /// **'ممتاز'**
  String get trustExcellent;

  /// No description provided for @trustGood.
  ///
  /// In ar, this message translates to:
  /// **'جيد'**
  String get trustGood;

  /// No description provided for @trustFair.
  ///
  /// In ar, this message translates to:
  /// **'مقبول'**
  String get trustFair;

  /// No description provided for @trustWeak.
  ///
  /// In ar, this message translates to:
  /// **'ضعيف'**
  String get trustWeak;

  /// No description provided for @trustScoreUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'غير متاح بعد'**
  String get trustScoreUnavailable;

  /// No description provided for @todayEarnings.
  ///
  /// In ar, this message translates to:
  /// **'أرباح اليوم'**
  String get todayEarnings;

  /// No description provided for @earningsUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'غير متاحة'**
  String get earningsUnavailable;

  /// No description provided for @completedTripsToday.
  ///
  /// In ar, this message translates to:
  /// **'{count} رحلات مكتملة'**
  String completedTripsToday(int count);

  /// No description provided for @activateYourRoute.
  ///
  /// In ar, this message translates to:
  /// **'فعّل مسارك'**
  String get activateYourRoute;

  /// No description provided for @activateRouteHint.
  ///
  /// In ar, this message translates to:
  /// **'قم بتحديد وجهتك لاستقبال الطلبات على طريقك'**
  String get activateRouteHint;

  /// No description provided for @mapNoLocation.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد بيانات موقع بعد.'**
  String get mapNoLocation;

  /// No description provided for @batchSavings.
  ///
  /// In ar, this message translates to:
  /// **'توفير التجميع'**
  String get batchSavings;

  /// No description provided for @batchSavingsCaption.
  ///
  /// In ar, this message translates to:
  /// **'تم توفيرها عبر دمج الشحنات'**
  String get batchSavingsCaption;

  /// No description provided for @distanceSavedKm.
  ///
  /// In ar, this message translates to:
  /// **'{km} كم'**
  String distanceSavedKm(String km);

  /// No description provided for @noSavingsYet.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد توفير بعد'**
  String get noSavingsYet;

  /// No description provided for @inDelivery.
  ///
  /// In ar, this message translates to:
  /// **'قيد التوصيل'**
  String get inDelivery;

  /// No description provided for @activeShipmentsCount.
  ///
  /// In ar, this message translates to:
  /// **'{count} شحنات نشطة'**
  String activeShipmentsCount(int count);

  /// No description provided for @createShipment.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء شحنة جديدة'**
  String get createShipment;

  /// No description provided for @smartBatchingTitle.
  ///
  /// In ar, this message translates to:
  /// **'توصيات التجميع الذكية'**
  String get smartBatchingTitle;

  /// No description provided for @batchSuggestionTitle.
  ///
  /// In ar, this message translates to:
  /// **'{count} طرود إلى {destination}'**
  String batchSuggestionTitle(int count, String destination);

  /// No description provided for @batchSuggestionBody.
  ///
  /// In ar, this message translates to:
  /// **'يمكن دمجها في دفعة واحدة على المسار.'**
  String get batchSuggestionBody;

  /// No description provided for @mergeAndSend.
  ///
  /// In ar, this message translates to:
  /// **'دمج وإرسال'**
  String get mergeAndSend;

  /// No description provided for @noBatchSuggestions.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد طلبات جاهزة للتجميع.'**
  String get noBatchSuggestions;

  /// No description provided for @liveTracking.
  ///
  /// In ar, this message translates to:
  /// **'التتبع المباشر'**
  String get liveTracking;

  /// No description provided for @recentOrders.
  ///
  /// In ar, this message translates to:
  /// **'الطلبات الأخيرة'**
  String get recentOrders;

  /// No description provided for @orderReference.
  ///
  /// In ar, this message translates to:
  /// **'طلب #{reference}'**
  String orderReference(String reference);

  /// No description provided for @navRequests.
  ///
  /// In ar, this message translates to:
  /// **'الطلبات'**
  String get navRequests;

  /// No description provided for @navMyTrip.
  ///
  /// In ar, this message translates to:
  /// **'رحلتي'**
  String get navMyTrip;

  /// No description provided for @navPerformance.
  ///
  /// In ar, this message translates to:
  /// **'الأرباح والأداء'**
  String get navPerformance;

  /// No description provided for @navNotifications.
  ///
  /// In ar, this message translates to:
  /// **'الإشعارات'**
  String get navNotifications;

  /// No description provided for @navMapAlerts.
  ///
  /// In ar, this message translates to:
  /// **'الخرائط والبلاغات'**
  String get navMapAlerts;

  /// No description provided for @navShipments.
  ///
  /// In ar, this message translates to:
  /// **'الشحنات'**
  String get navShipments;

  /// No description provided for @navReports.
  ///
  /// In ar, this message translates to:
  /// **'التقارير'**
  String get navReports;

  /// No description provided for @navMyOrders.
  ///
  /// In ar, this message translates to:
  /// **'طلباتي'**
  String get navMyOrders;

  /// No description provided for @navMainMenu.
  ///
  /// In ar, this message translates to:
  /// **'القائمة الرئيسية'**
  String get navMainMenu;

  /// No description provided for @navSidebarTitle.
  ///
  /// In ar, this message translates to:
  /// **'رحلتك بأمان'**
  String get navSidebarTitle;

  /// No description provided for @navSidebarBody.
  ///
  /// In ar, this message translates to:
  /// **'تابع رحلاتك وراجع جلسات حسابك.'**
  String get navSidebarBody;

  /// No description provided for @myTrips.
  ///
  /// In ar, this message translates to:
  /// **'رحلاتي'**
  String get myTrips;

  /// No description provided for @myTripsSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'كل رحلاتك في مكان واحد'**
  String get myTripsSubtitle;

  /// No description provided for @myTripsCurrentTrip.
  ///
  /// In ar, this message translates to:
  /// **'الرحلة الحالية'**
  String get myTripsCurrentTrip;

  /// No description provided for @myTripsFilterEmptyTitle.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد رحلات هنا'**
  String get myTripsFilterEmptyTitle;

  /// No description provided for @myTripsFilterEmptyBody.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد رحلات في هذه الفئة بعد.'**
  String get myTripsFilterEmptyBody;

  /// No description provided for @myTripsShowAll.
  ///
  /// In ar, this message translates to:
  /// **'عرض كل الرحلات'**
  String get myTripsShowAll;

  /// No description provided for @tripsActiveSection.
  ///
  /// In ar, this message translates to:
  /// **'الرحلة النشطة'**
  String get tripsActiveSection;

  /// No description provided for @tripsUpcomingSection.
  ///
  /// In ar, this message translates to:
  /// **'الرحلات القادمة'**
  String get tripsUpcomingSection;

  /// No description provided for @tripsPastSection.
  ///
  /// In ar, this message translates to:
  /// **'الرحلات السابقة'**
  String get tripsPastSection;

  /// No description provided for @tripsCancelledSection.
  ///
  /// In ar, this message translates to:
  /// **'الرحلات الملغاة'**
  String get tripsCancelledSection;

  /// No description provided for @noTripsYet.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد رحلات بعد'**
  String get noTripsYet;

  /// No description provided for @noTripsYetBody.
  ///
  /// In ar, this message translates to:
  /// **'ستظهر رحلاتك هنا بعد إنشاء أول طلب.'**
  String get noTripsYetBody;

  /// No description provided for @tripHistoryFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل سجل الرحلات.'**
  String get tripHistoryFailed;

  /// No description provided for @mapsUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'الخريطة غير متاحة'**
  String get mapsUnavailable;

  /// No description provided for @mapsUnavailableBody.
  ///
  /// In ar, this message translates to:
  /// **'لم يتم تفعيل خدمة الخرائط في هذه النسخة، لذلك لا يمكن عرض موقع مباشر.'**
  String get mapsUnavailableBody;

  /// No description provided for @incidentReports.
  ///
  /// In ar, this message translates to:
  /// **'البلاغات'**
  String get incidentReports;

  /// No description provided for @incidentReportingUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'الإبلاغ عن حادث غير متاح'**
  String get incidentReportingUnavailable;

  /// No description provided for @incidentReportingUnavailableBody.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد حتى الآن نظام خلفي لاستقبال البلاغات، ولن يتم إرسال أي بلاغ من هنا.'**
  String get incidentReportingUnavailableBody;

  /// No description provided for @notificationsUnavailableBody.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد نظام إشعارات في هذه النسخة. ستصلك التحديثات داخل شاشة الرحلة.'**
  String get notificationsUnavailableBody;

  /// No description provided for @performanceTitle.
  ///
  /// In ar, this message translates to:
  /// **'الأرباح والأداء'**
  String get performanceTitle;

  /// No description provided for @earningsNotTracked.
  ///
  /// In ar, this message translates to:
  /// **'لا يتم احتساب الأرباح'**
  String get earningsNotTracked;

  /// No description provided for @earningsNotTrackedBody.
  ///
  /// In ar, this message translates to:
  /// **'لا تحتوي قاعدة البيانات على أي بيانات أسعار أو أجرة، لذلك لا يمكن عرض رقم أرباح حقيقي.'**
  String get earningsNotTrackedBody;

  /// No description provided for @completedTripsTotal.
  ///
  /// In ar, this message translates to:
  /// **'إجمالي الرحلات المكتملة'**
  String get completedTripsTotal;

  /// No description provided for @acceptanceRateUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'نسبة القبول غير متاحة'**
  String get acceptanceRateUnavailable;

  /// No description provided for @destinationCount.
  ///
  /// In ar, this message translates to:
  /// **'{count} وجهات'**
  String destinationCount(int count);

  /// No description provided for @shipmentsTitle.
  ///
  /// In ar, this message translates to:
  /// **'الشحنات'**
  String get shipmentsTitle;

  /// No description provided for @noShipments.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد شحنات'**
  String get noShipments;

  /// No description provided for @noShipmentsBody.
  ///
  /// In ar, this message translates to:
  /// **'أنشئ شحنة جديدة لتظهر هنا.'**
  String get noShipmentsBody;

  /// No description provided for @shipmentsFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل الشحنات.'**
  String get shipmentsFailed;

  /// No description provided for @reportsUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'التقارير غير متاحة'**
  String get reportsUnavailable;

  /// No description provided for @reportsUnavailableBody.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد نظام خلفي لتوليد التقارير أو تصديرها بصيغة PDF أو Excel.'**
  String get reportsUnavailableBody;

  /// No description provided for @accountProfile.
  ///
  /// In ar, this message translates to:
  /// **'الملف الشخصي'**
  String get accountProfile;

  /// No description provided for @accountSupport.
  ///
  /// In ar, this message translates to:
  /// **'الدعم'**
  String get accountSupport;

  /// No description provided for @supportUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'الدعم داخل التطبيق غير متاح'**
  String get supportUnavailable;

  /// No description provided for @supportUnavailableBody.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد قناة دعم متصلة بالنظام الخلفي في هذه النسخة.'**
  String get supportUnavailableBody;

  /// No description provided for @accountSettings.
  ///
  /// In ar, this message translates to:
  /// **'الإعدادات'**
  String get accountSettings;

  /// No description provided for @settingsMyProfile.
  ///
  /// In ar, this message translates to:
  /// **'ملفي الشخصي'**
  String get settingsMyProfile;

  /// No description provided for @settingsChangePassword.
  ///
  /// In ar, this message translates to:
  /// **'تغيير كلمة المرور'**
  String get settingsChangePassword;

  /// No description provided for @settingsRateOurApp.
  ///
  /// In ar, this message translates to:
  /// **'قيّم التطبيق'**
  String get settingsRateOurApp;

  /// No description provided for @settingsHelpSupport.
  ///
  /// In ar, this message translates to:
  /// **'المساعدة والدعم'**
  String get settingsHelpSupport;

  /// No description provided for @profileEnterValidPhoneNumber.
  ///
  /// In ar, this message translates to:
  /// **'أدخل رقم هاتف صحيحاً.'**
  String get profileEnterValidPhoneNumber;

  /// No description provided for @profileProfileUpdated.
  ///
  /// In ar, this message translates to:
  /// **'تم تحديث الملف.'**
  String get profileProfileUpdated;

  /// No description provided for @profileEdit.
  ///
  /// In ar, this message translates to:
  /// **'تعديل'**
  String get profileEdit;

  /// No description provided for @profileNotAdded.
  ///
  /// In ar, this message translates to:
  /// **'غير مضاف'**
  String get profileNotAdded;

  /// No description provided for @profileName.
  ///
  /// In ar, this message translates to:
  /// **'الاسم'**
  String get profileName;

  /// No description provided for @profileVerifiedNumberCannotChanged.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن تغيير رقمك الموثّق من هنا.'**
  String get profileVerifiedNumberCannotChanged;

  /// No description provided for @profileSaveChanges.
  ///
  /// In ar, this message translates to:
  /// **'حفظ التغييرات'**
  String get profileSaveChanges;

  /// No description provided for @changePasswordEnterCurrentPassword.
  ///
  /// In ar, this message translates to:
  /// **'أدخل كلمة المرور الحالية.'**
  String get changePasswordEnterCurrentPassword;

  /// No description provided for @changePasswordChoosePasswordDifferentFrom.
  ///
  /// In ar, this message translates to:
  /// **'اختر كلمة مرور مختلفة عن الحالية.'**
  String get changePasswordChoosePasswordDifferentFrom;

  /// No description provided for @changePasswordPasswordsDoNotMatch.
  ///
  /// In ar, this message translates to:
  /// **'كلمتا المرور غير متطابقتين.'**
  String get changePasswordPasswordsDoNotMatch;

  /// No description provided for @changePasswordPasswordChanged.
  ///
  /// In ar, this message translates to:
  /// **'تم تغيير كلمة المرور'**
  String get changePasswordPasswordChanged;

  /// No description provided for @changePasswordSecurityPleaseSignAgain.
  ///
  /// In ar, this message translates to:
  /// **'لأمانك، سجّل الدخول من جديد بكلمة المرور الجديدة.'**
  String get changePasswordSecurityPleaseSignAgain;

  /// No description provided for @changePasswordOk.
  ///
  /// In ar, this message translates to:
  /// **'حسناً'**
  String get changePasswordOk;

  /// No description provided for @changePasswordCurrentPasswordIncorrect.
  ///
  /// In ar, this message translates to:
  /// **'كلمة المرور الحالية غير صحيحة.'**
  String get changePasswordCurrentPasswordIncorrect;

  /// No description provided for @changePasswordConfirmNewPassword.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد كلمة المرور الجديدة'**
  String get changePasswordConfirmNewPassword;

  /// No description provided for @changePasswordUpdatePassword.
  ///
  /// In ar, this message translates to:
  /// **'تحديث كلمة المرور'**
  String get changePasswordUpdatePassword;

  /// No description provided for @changePasswordIDonTHave.
  ///
  /// In ar, this message translates to:
  /// **'ليس لديّ كلمة مرور'**
  String get changePasswordIDonTHave;

  /// No description provided for @helpHowDoIRequest.
  ///
  /// In ar, this message translates to:
  /// **'كيف أطلب رحلة؟'**
  String get helpHowDoIRequest;

  /// No description provided for @helpOpenHomeTapSearch.
  ///
  /// In ar, this message translates to:
  /// **'افتح الرئيسية واضغط على بطاقة البحث، اختر خط الرحلة (مثل الخليل إلى بيت لحم)، واكتب مكان الانطلاق والوصول بالتفصيل ثم أرسل الطلب. سيراه السائقون على هذا الخط.'**
  String get helpOpenHomeTapSearch;

  /// No description provided for @helpWhereISeeMy.
  ///
  /// In ar, this message translates to:
  /// **'أين أجد رحلاتي؟'**
  String get helpWhereISeeMy;

  /// No description provided for @helpTripsTabListsRequests.
  ///
  /// In ar, this message translates to:
  /// **'تعرض لك صفحة الرحلات طلباتك وحالتها، من قيد الانتظار حتى الاكتمال.'**
  String get helpTripsTabListsRequests;

  /// No description provided for @helpHowDoIFollow.
  ///
  /// In ar, this message translates to:
  /// **'كيف أتابع السائق؟'**
  String get helpHowDoIFollow;

  /// No description provided for @helpOnceDriverAcceptsOpen.
  ///
  /// In ar, this message translates to:
  /// **'بعد قبول السائق افتح صفحة الخرائط لترى المسار وآخر موقع للسائق وتنبيهات الحواجز.'**
  String get helpOnceDriverAcceptsOpen;

  /// No description provided for @helpIForgotMyPassword.
  ///
  /// In ar, this message translates to:
  /// **'نسيت كلمة المرور'**
  String get helpIForgotMyPassword;

  /// No description provided for @helpLoginScreenChooseForgot.
  ///
  /// In ar, this message translates to:
  /// **'من شاشة تسجيل الدخول اختر «نسيت كلمة المرور» وسنرسل لك رمزاً عبر البريد لإعادة تعيينها.'**
  String get helpLoginScreenChooseForgot;

  /// No description provided for @helpAskDarbAssistant.
  ///
  /// In ar, this message translates to:
  /// **'اسأل مساعد درب'**
  String get helpAskDarbAssistant;

  /// No description provided for @helpCommonQuestions.
  ///
  /// In ar, this message translates to:
  /// **'أسئلة شائعة'**
  String get helpCommonQuestions;

  /// No description provided for @rateAppThank.
  ///
  /// In ar, this message translates to:
  /// **'شكراً لك!'**
  String get rateAppThank;

  /// No description provided for @rateAppFeedbackHelpsUsImprove.
  ///
  /// In ar, this message translates to:
  /// **'ملاحظاتك تساعدنا على تحسين درب.'**
  String get rateAppFeedbackHelpsUsImprove;

  /// No description provided for @rateAppDone.
  ///
  /// In ar, this message translates to:
  /// **'تم'**
  String get rateAppDone;

  /// No description provided for @rateAppHowExperienceDarb.
  ///
  /// In ar, this message translates to:
  /// **'كيف تجد تجربتك مع درب؟'**
  String get rateAppHowExperienceDarb;

  /// No description provided for @rateAppTellUsMoreOptional.
  ///
  /// In ar, this message translates to:
  /// **'أخبرنا المزيد (اختياري)'**
  String get rateAppTellUsMoreOptional;

  /// No description provided for @rateAppRatingCouldNotSent.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر إرسال تقييمك. تحقّق من الاتصال وحاول مرة أخرى.'**
  String get rateAppRatingCouldNotSent;

  /// No description provided for @rateAppSubmit.
  ///
  /// In ar, this message translates to:
  /// **'إرسال'**
  String get rateAppSubmit;

  /// No description provided for @featureNotBackedNotice.
  ///
  /// In ar, this message translates to:
  /// **'هذا القسم غير مدعوم من النظام الخلفي بعد.'**
  String get featureNotBackedNotice;

  /// No description provided for @offers.
  ///
  /// In ar, this message translates to:
  /// **'العروض'**
  String get offers;

  /// No description provided for @individualOffers.
  ///
  /// In ar, this message translates to:
  /// **'العروض الفردية'**
  String get individualOffers;

  /// No description provided for @sharedOffers.
  ///
  /// In ar, this message translates to:
  /// **'عروض الرحلات المشتركة'**
  String get sharedOffers;

  /// No description provided for @sharedOffersBody.
  ///
  /// In ar, this message translates to:
  /// **'راجع عروض المسار المجمّعة. تتغير الحالة فقط عند التحديث.'**
  String get sharedOffersBody;

  /// No description provided for @noSharedOffers.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد عروض رحلات مشتركة حالياً.'**
  String get noSharedOffers;

  /// No description provided for @sharedTrip.
  ///
  /// In ar, this message translates to:
  /// **'رحلة مشتركة'**
  String get sharedTrip;

  /// No description provided for @sharedOfferDetails.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل العرض المشترك'**
  String get sharedOfferDetails;

  /// No description provided for @compositionPassengerOnly.
  ///
  /// In ar, this message translates to:
  /// **'ركاب فقط'**
  String get compositionPassengerOnly;

  /// No description provided for @compositionMerchantOnly.
  ///
  /// In ar, this message translates to:
  /// **'طرود فقط'**
  String get compositionMerchantOnly;

  /// No description provided for @compositionMixed.
  ///
  /// In ar, this message translates to:
  /// **'رحلة مختلطة'**
  String get compositionMixed;

  /// No description provided for @passengerRequests.
  ///
  /// In ar, this message translates to:
  /// **'طلبات الركاب'**
  String get passengerRequests;

  /// No description provided for @passengerSeats.
  ///
  /// In ar, this message translates to:
  /// **'مقاعد الركاب'**
  String get passengerSeats;

  /// No description provided for @merchantOrders.
  ///
  /// In ar, this message translates to:
  /// **'طلبات التجار'**
  String get merchantOrders;

  /// No description provided for @parcels.
  ///
  /// In ar, this message translates to:
  /// **'الطرود'**
  String get parcels;

  /// No description provided for @entireGroup.
  ///
  /// In ar, this message translates to:
  /// **'المجموعة كاملة'**
  String get entireGroup;

  /// No description provided for @acceptEntireSharedTrip.
  ///
  /// In ar, this message translates to:
  /// **'قبول الرحلة المشتركة كاملة'**
  String get acceptEntireSharedTrip;

  /// No description provided for @rejectEntireSharedTrip.
  ///
  /// In ar, this message translates to:
  /// **'رفض الرحلة المشتركة كاملة'**
  String get rejectEntireSharedTrip;

  /// No description provided for @confirmAcceptSharedTrip.
  ///
  /// In ar, this message translates to:
  /// **'هل تريد قبول جميع طلبات الركاب والتجار المجمّعة معاً في رحلة مشتركة واحدة؟'**
  String get confirmAcceptSharedTrip;

  /// No description provided for @confirmRejectSharedTrip.
  ///
  /// In ar, this message translates to:
  /// **'هل تريد رفض المجموعة كاملة وتحرير جميع الطلبات المجمّعة؟'**
  String get confirmRejectSharedTrip;

  /// No description provided for @sharedGroupDecisionNotice.
  ///
  /// In ar, this message translates to:
  /// **'ينطبق القبول أو الرفض على المجموعة كاملة.'**
  String get sharedGroupDecisionNotice;

  /// No description provided for @sharedAcceptedNotice.
  ///
  /// In ar, this message translates to:
  /// **'تم إسناد رحلة مشتركة واحدة. لم تبدأ الرحلة.'**
  String get sharedAcceptedNotice;

  /// No description provided for @sharedRejectedNotice.
  ///
  /// In ar, this message translates to:
  /// **'تم رفض العرض المشترك كاملاً.'**
  String get sharedRejectedNotice;

  /// No description provided for @sharedInvalidatedNotice.
  ///
  /// In ar, this message translates to:
  /// **'لم يعد هذا العرض المشترك صالحاً. حدّث الشاشة لمعرفة الحالة الحالية.'**
  String get sharedInvalidatedNotice;

  /// No description provided for @sharedCapacityNotice.
  ///
  /// In ar, this message translates to:
  /// **'هذه المجاميع محجوزة للمسار كاملاً. لا تُعرض السعة المتبقية مجدداً لهذا الانطلاق، وإعادة استخدام السعة بين المحطات غير مفعلة.'**
  String get sharedCapacityNotice;

  /// No description provided for @stopEventTimeline.
  ///
  /// In ar, this message translates to:
  /// **'أحداث المحطات المشتركة'**
  String get stopEventTimeline;

  /// No description provided for @passengerPickups.
  ///
  /// In ar, this message translates to:
  /// **'ركاب يصعدون'**
  String get passengerPickups;

  /// No description provided for @passengerDropoffs.
  ///
  /// In ar, this message translates to:
  /// **'ركاب ينزلون'**
  String get passengerDropoffs;

  /// No description provided for @parcelPickups.
  ///
  /// In ar, this message translates to:
  /// **'طرود تُستلم'**
  String get parcelPickups;

  /// No description provided for @parcelDestinations.
  ///
  /// In ar, this message translates to:
  /// **'وجهات الطرود'**
  String get parcelDestinations;

  /// No description provided for @sharedAssignmentIndicator.
  ///
  /// In ar, this message translates to:
  /// **'مُسند إلى رحلة مشتركة'**
  String get sharedAssignmentIndicator;

  /// No description provided for @sharedAssignmentPrivacyNotice.
  ///
  /// In ar, this message translates to:
  /// **'يظهر طلبك فقط. معلومات أعضاء الرحلة الآخرين خاصة.'**
  String get sharedAssignmentPrivacyNotice;

  /// No description provided for @statusUnsupported.
  ///
  /// In ar, this message translates to:
  /// **'الحالة غير متاحة'**
  String get statusUnsupported;

  /// No description provided for @unsupportedDataNotice.
  ///
  /// In ar, this message translates to:
  /// **'هذه الحالة غير مدعومة في إصدار التطبيق الحالي. حدّث الشاشة أو تواصل مع الدعم.'**
  String get unsupportedDataNotice;

  /// No description provided for @vehicleSedan.
  ///
  /// In ar, this message translates to:
  /// **'سيارة سيدان'**
  String get vehicleSedan;

  /// No description provided for @vehicleVan.
  ///
  /// In ar, this message translates to:
  /// **'مركبة فان'**
  String get vehicleVan;

  /// No description provided for @vehicleUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'نوع المركبة غير متاح'**
  String get vehicleUnavailable;

  /// No description provided for @actionDisabledExpired.
  ///
  /// In ar, this message translates to:
  /// **'الإجراء غير متاح لأن صلاحية العرض انتهت.'**
  String get actionDisabledExpired;

  /// No description provided for @actionDisabledUncertain.
  ///
  /// In ar, this message translates to:
  /// **'الإجراء غير متاح حتى تتم مطابقة نتيجة العملية السابقة.'**
  String get actionDisabledUncertain;

  /// No description provided for @sharedFeatureUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'عروض الرحلات المشتركة غير متاحة في هذه البيئة.'**
  String get sharedFeatureUnavailable;

  /// No description provided for @sharedAssignmentUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل إسناد الرحلة المشتركة غير متاحة في هذه البيئة.'**
  String get sharedAssignmentUnavailable;

  /// No description provided for @notLiveNotice.
  ///
  /// In ar, this message translates to:
  /// **'هذه الشاشة ليست مباشرة. استخدم التحديث للتحقق من المستجدات.'**
  String get notLiveNotice;

  /// No description provided for @assistantTitle.
  ///
  /// In ar, this message translates to:
  /// **'مساعد درب'**
  String get assistantTitle;

  /// No description provided for @assistantHomeTitle.
  ///
  /// In ar, this message translates to:
  /// **'اسأل مساعد درب'**
  String get assistantHomeTitle;

  /// No description provided for @assistantHomeBody.
  ///
  /// In ar, this message translates to:
  /// **'استفسر عن رحلاتك والمسارات المتاحة.'**
  String get assistantHomeBody;

  /// No description provided for @assistantWelcomeTitle.
  ///
  /// In ar, this message translates to:
  /// **'كيف يمكنني مساعدتك؟'**
  String get assistantWelcomeTitle;

  /// No description provided for @assistantWelcomeBody.
  ///
  /// In ar, this message translates to:
  /// **'اسأل عن بيانات رحلاتك أو المسارات المتاحة في درب. إذا كانت التفاصيل ناقصة، سأطلب منك توضيحها.'**
  String get assistantWelcomeBody;

  /// No description provided for @assistantTryAsking.
  ///
  /// In ar, this message translates to:
  /// **'جرّب أن تسأل'**
  String get assistantTryAsking;

  /// No description provided for @assistantExampleTripTime.
  ///
  /// In ar, this message translates to:
  /// **'متى موعد رحلتي القادمة؟'**
  String get assistantExampleTripTime;

  /// No description provided for @assistantExampleAvailableTrip.
  ///
  /// In ar, this message translates to:
  /// **'هل توجد رحلة إلى بيت لحم؟'**
  String get assistantExampleAvailableTrip;

  /// No description provided for @assistantInputHint.
  ///
  /// In ar, this message translates to:
  /// **'اكتب سؤالك هنا'**
  String get assistantInputHint;

  /// No description provided for @assistantVoiceStart.
  ///
  /// In ar, this message translates to:
  /// **'تحدّث بطلبك'**
  String get assistantVoiceStart;

  /// No description provided for @assistantVoiceStop.
  ///
  /// In ar, this message translates to:
  /// **'إيقاف الاستماع'**
  String get assistantVoiceStop;

  /// No description provided for @assistantVoiceSettings.
  ///
  /// In ar, this message translates to:
  /// **'إعدادات الصوت'**
  String get assistantVoiceSettings;

  /// No description provided for @assistantVoiceSpeakReplies.
  ///
  /// In ar, this message translates to:
  /// **'قراءة الردود بصوت عالٍ عند التحدث'**
  String get assistantVoiceSpeakReplies;

  /// No description provided for @assistantVoiceAutoSend.
  ///
  /// In ar, this message translates to:
  /// **'إرسال الطلب عند التوقف عن الكلام'**
  String get assistantVoiceAutoSend;

  /// No description provided for @assistantVoiceSpeed.
  ///
  /// In ar, this message translates to:
  /// **'سرعة القراءة'**
  String get assistantVoiceSpeed;

  /// No description provided for @assistantVoiceStopSpeaking.
  ///
  /// In ar, this message translates to:
  /// **'إيقاف القراءة'**
  String get assistantVoiceStopSpeaking;

  /// No description provided for @assistantVoiceListening.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ الاستماع…'**
  String get assistantVoiceListening;

  /// No description provided for @assistantVoicePermissionDenied.
  ///
  /// In ar, this message translates to:
  /// **'نحتاج إذن الميكروفون للإدخال الصوتي. يمكنك كتابة طلبك بدلًا من ذلك.'**
  String get assistantVoicePermissionDenied;

  /// No description provided for @assistantVoicePermissionPermanent.
  ///
  /// In ar, this message translates to:
  /// **'إذن الميكروفون أو التعرف على الكلام معطّل. افتح الإعدادات للسماح به أو اكتب طلبك.'**
  String get assistantVoicePermissionPermanent;

  /// No description provided for @assistantVoiceOpenSettings.
  ///
  /// In ar, this message translates to:
  /// **'فتح الإعدادات'**
  String get assistantVoiceOpenSettings;

  /// No description provided for @assistantVoiceUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'الإدخال الصوتي غير متاح على هذا الجهاز. يرجى كتابة طلبك.'**
  String get assistantVoiceUnavailable;

  /// No description provided for @assistantVoiceNoSpeech.
  ///
  /// In ar, this message translates to:
  /// **'لم أسمعك جيدًا. اضغط على الميكروفون وحاول مجددًا أو اكتب طلبك.'**
  String get assistantVoiceNoSpeech;

  /// No description provided for @assistantVoiceOffline.
  ///
  /// In ar, this message translates to:
  /// **'يحتاج الإدخال الصوتي إلى اتصال حاليًا. اكتب طلبك أو حاول لاحقًا.'**
  String get assistantVoiceOffline;

  /// No description provided for @assistantVoiceError.
  ///
  /// In ar, this message translates to:
  /// **'توقف الإدخال الصوتي بشكل غير متوقع. حاول مجددًا أو اكتب طلبك.'**
  String get assistantVoiceError;

  /// No description provided for @assistantSend.
  ///
  /// In ar, this message translates to:
  /// **'إرسال'**
  String get assistantSend;

  /// No description provided for @assistantProcessing.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ التحقق من بيانات درب…'**
  String get assistantProcessing;

  /// No description provided for @assistantErrorTitle.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر إكمال الطلب'**
  String get assistantErrorTitle;

  /// No description provided for @assistantErrorBody.
  ///
  /// In ar, this message translates to:
  /// **'لم يتمكن المساعد من إكمال طلبك. حاول مرة أخرى.'**
  String get assistantErrorBody;

  /// No description provided for @assistantUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'خدمة المساعد غير متاحة في هذا الإصدار. لم يتم إنشاء أي نتيجة.'**
  String get assistantUnavailable;

  /// No description provided for @assistantHistoryErrorTitle.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل المحادثة'**
  String get assistantHistoryErrorTitle;

  /// No description provided for @assistantHistoryErrorBody.
  ///
  /// In ar, this message translates to:
  /// **'محادثتك مع المساعد محفوظة في حسابك. تحقق من اتصالك وحاول مرة أخرى.'**
  String get assistantHistoryErrorBody;

  /// No description provided for @assistantNewChat.
  ///
  /// In ar, this message translates to:
  /// **'محادثة جديدة'**
  String get assistantNewChat;

  /// No description provided for @assistantNewChatTitle.
  ///
  /// In ar, this message translates to:
  /// **'بدء محادثة جديدة؟'**
  String get assistantNewChatTitle;

  /// No description provided for @assistantNewChatBody.
  ///
  /// In ar, this message translates to:
  /// **'سيتم حذف هذه المحادثة من حسابك. الرحلات التي حجزتها لن تتأثر.'**
  String get assistantNewChatBody;

  /// No description provided for @assistantNewChatFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر بدء محادثة جديدة. تحقق من اتصالك وحاول مرة أخرى.'**
  String get assistantNewChatFailed;

  /// No description provided for @passengerRouteLabel.
  ///
  /// In ar, this message translates to:
  /// **'المسار'**
  String get passengerRouteLabel;

  /// No description provided for @passengerRouteHint.
  ///
  /// In ar, this message translates to:
  /// **'اختر المسار'**
  String get passengerRouteHint;

  /// No description provided for @passengerRoutesLoading.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ تحميل المسارات…'**
  String get passengerRoutesLoading;

  /// No description provided for @passengerRoutesLoadFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل المسارات. تحقّق من اتصالك وحاول مرة أخرى.'**
  String get passengerRoutesLoadFailed;

  /// No description provided for @passengerRoutesEmpty.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد مسارات متاحة حاليًا. يُرجى المحاولة لاحقًا.'**
  String get passengerRoutesEmpty;

  /// No description provided for @passengerRouteRequired.
  ///
  /// In ar, this message translates to:
  /// **'اختر المسار للمتابعة.'**
  String get passengerRouteRequired;

  /// No description provided for @passengerRouteUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'هذا المسار لم يعد متاحًا. اختر مسارًا آخر.'**
  String get passengerRouteUnavailable;

  /// No description provided for @passengerPickupDetailsLabel.
  ///
  /// In ar, this message translates to:
  /// **'مكان الصعود بالتحديد'**
  String get passengerPickupDetailsLabel;

  /// No description provided for @passengerPickupDetailsHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: أمام البوابة الرئيسية لجامعة بوليتكنك فلسطين'**
  String get passengerPickupDetailsHint;

  /// No description provided for @passengerDropoffDetailsLabel.
  ///
  /// In ar, this message translates to:
  /// **'مكان النزول بالتحديد'**
  String get passengerDropoffDetailsLabel;

  /// No description provided for @passengerDropoffDetailsHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: مجمّع سيارات بيت لحم، بجانب الصيدلية'**
  String get passengerDropoffDetailsHint;

  /// No description provided for @passengerDetailsHelper.
  ///
  /// In ar, this message translates to:
  /// **'صِف المكان بوضوح ليصل إليه السائق بسهولة.'**
  String get passengerDetailsHelper;

  /// No description provided for @passengerDetailsTooShort.
  ///
  /// In ar, this message translates to:
  /// **'اكتب 3 أحرف على الأقل.'**
  String get passengerDetailsTooShort;

  /// No description provided for @passengerPickupPoint.
  ///
  /// In ar, this message translates to:
  /// **'مكان الصعود'**
  String get passengerPickupPoint;

  /// No description provided for @passengerDropoffPoint.
  ///
  /// In ar, this message translates to:
  /// **'مكان النزول'**
  String get passengerDropoffPoint;

  /// No description provided for @assistantRouteChoose.
  ///
  /// In ar, this message translates to:
  /// **'اختر المسار المناسب لرحلتك، ثم تأكّد من مكانَي الصعود والنزول.'**
  String get assistantRouteChoose;

  /// No description provided for @passengerParcelRouteIntro.
  ///
  /// In ar, this message translates to:
  /// **'اختر المسار، وصِف مكان استلام الطرد ومكان تسليمه، ثم أخبرنا من سيستلمه.'**
  String get passengerParcelRouteIntro;

  /// No description provided for @passengerParcelPickupDetailsLabel.
  ///
  /// In ar, this message translates to:
  /// **'مكان استلام الطرد منك'**
  String get passengerParcelPickupDetailsLabel;

  /// No description provided for @passengerParcelPickupDetailsHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: المحل المجاور لدوار ابن رشد في الخليل'**
  String get passengerParcelPickupDetailsHint;

  /// No description provided for @passengerParcelDropoffDetailsLabel.
  ///
  /// In ar, this message translates to:
  /// **'مكان تسليم الطرد'**
  String get passengerParcelDropoffDetailsLabel;

  /// No description provided for @passengerParcelDropoffDetailsHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: بيت المستلم، قرب كنيسة المهد'**
  String get passengerParcelDropoffDetailsHint;

  /// No description provided for @passengerParcelPreferredTime.
  ///
  /// In ar, this message translates to:
  /// **'الوقت المفضّل للاستلام'**
  String get passengerParcelPreferredTime;

  /// No description provided for @welcomeRoutesTitle.
  ///
  /// In ar, this message translates to:
  /// **'المسارات التي نخدمها'**
  String get welcomeRoutesTitle;

  /// No description provided for @welcomeRoutesMore.
  ///
  /// In ar, this message translates to:
  /// **'و{count} أخرى'**
  String welcomeRoutesMore(int count);

  /// No description provided for @welcomeRoutesOffline.
  ///
  /// In ar, this message translates to:
  /// **'ستظهر المسارات عند الاتصال بالإنترنت.'**
  String get welcomeRoutesOffline;

  /// No description provided for @assistantClarificationLabel.
  ///
  /// In ar, this message translates to:
  /// **'يحتاج مساعد درب إلى توضيح'**
  String get assistantClarificationLabel;

  /// No description provided for @assistantResultLabel.
  ///
  /// In ar, this message translates to:
  /// **'رد مساعد درب'**
  String get assistantResultLabel;

  /// No description provided for @assistantPassengerMessage.
  ///
  /// In ar, this message translates to:
  /// **'رسالتك'**
  String get assistantPassengerMessage;

  /// No description provided for @assistantExampleFindTrip.
  ///
  /// In ar, this message translates to:
  /// **'ابحث لي عن رحلة من باب الزاوية إلى بيت لحم الساعة 3 لشخص واحد'**
  String get assistantExampleFindTrip;

  /// No description provided for @assistantReviewTitle.
  ///
  /// In ar, this message translates to:
  /// **'راجع معلومات الرحلة'**
  String get assistantReviewTitle;

  /// No description provided for @assistantReviewBody.
  ///
  /// In ar, this message translates to:
  /// **'تأكد من المعلومات وعدّلها قبل بدء البحث الحقيقي.'**
  String get assistantReviewBody;

  /// No description provided for @assistantConfirmSearch.
  ///
  /// In ar, this message translates to:
  /// **'تأكيد وبدء البحث'**
  String get assistantConfirmSearch;

  /// No description provided for @assistantSearching.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ البحث عن رحلة…'**
  String get assistantSearching;

  /// No description provided for @assistantSearchError.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر إنشاء الطلب أو العثور على مسار مناسب. لم يتم إنشاء نتيجة وهمية.'**
  String get assistantSearchError;

  /// No description provided for @assistantFutureTimeRequired.
  ///
  /// In ar, this message translates to:
  /// **'اختر وقتاً قادماً قبل بدء البحث.'**
  String get assistantFutureTimeRequired;

  /// No description provided for @mapAttribution.
  ///
  /// In ar, this message translates to:
  /// **'© مساهمو OpenStreetMap'**
  String get mapAttribution;

  /// No description provided for @mapLoading.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ تحميل الخريطة...'**
  String get mapLoading;

  /// No description provided for @mapLoadFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل الخريطة'**
  String get mapLoadFailed;

  /// No description provided for @mapLoadFailedBody.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر جلب بيانات المسار. تحقق من اتصالك ثم أعد المحاولة.'**
  String get mapLoadFailedBody;

  /// No description provided for @mapYourLocation.
  ///
  /// In ar, this message translates to:
  /// **'موقعك الحالي'**
  String get mapYourLocation;

  /// No description provided for @mapRequestedRoute.
  ///
  /// In ar, this message translates to:
  /// **'المسار المطلوب'**
  String get mapRequestedRoute;

  /// No description provided for @mapDriverRoute.
  ///
  /// In ar, this message translates to:
  /// **'مسار السائق المتاح'**
  String get mapDriverRoute;

  /// No description provided for @mapOriginLabel.
  ///
  /// In ar, this message translates to:
  /// **'نقطة الانطلاق: {name}'**
  String mapOriginLabel(String name);

  /// No description provided for @mapDestinationLabel.
  ///
  /// In ar, this message translates to:
  /// **'الوجهة: {name}'**
  String mapDestinationLabel(String name);

  /// No description provided for @mapStopLabel.
  ///
  /// In ar, this message translates to:
  /// **'محطة: {name}'**
  String mapStopLabel(String name);

  /// No description provided for @mapLegend.
  ///
  /// In ar, this message translates to:
  /// **'دليل الرموز'**
  String get mapLegend;

  /// No description provided for @locationServiceDisabled.
  ///
  /// In ar, this message translates to:
  /// **'خدمة الموقع متوقفة على الجهاز. فعّلها لعرض موقعك على الخريطة.'**
  String get locationServiceDisabled;

  /// No description provided for @locationPermissionDenied.
  ///
  /// In ar, this message translates to:
  /// **'لم يُسمح بالوصول إلى الموقع. اسمح بالوصول لعرض موقعك.'**
  String get locationPermissionDenied;

  /// No description provided for @locationPermanentlyDenied.
  ///
  /// In ar, this message translates to:
  /// **'الوصول إلى الموقع مرفوض نهائياً. فعّله من إعدادات النظام.'**
  String get locationPermanentlyDenied;

  /// No description provided for @locationUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحديد موقعك الآن.'**
  String get locationUnavailable;

  /// No description provided for @locationEnable.
  ///
  /// In ar, this message translates to:
  /// **'تفعيل الموقع'**
  String get locationEnable;

  /// No description provided for @locationSharingConsentTitle.
  ///
  /// In ar, this message translates to:
  /// **'مشاركة موقعك في هذه الرحلة؟'**
  String get locationSharingConsentTitle;

  /// No description provided for @locationSharingConsentBody.
  ///
  /// In ar, this message translates to:
  /// **'أثناء فتح شاشة الرحلة، يرسل درب موقعك إلى الركاب والمرسلين في هذه الرحلة ليعرفوا مكانك وموعد وصولك. تتوقف المشاركة عند انتهاء الرحلة أو مغادرة هذه الشاشة أو انتقال التطبيق إلى الخلفية.'**
  String get locationSharingConsentBody;

  /// No description provided for @locationSharingAllow.
  ///
  /// In ar, this message translates to:
  /// **'مشاركة موقعي'**
  String get locationSharingAllow;

  /// No description provided for @locationSharingNotNow.
  ///
  /// In ar, this message translates to:
  /// **'ليس الآن'**
  String get locationSharingNotNow;

  /// No description provided for @locationSharingActive.
  ///
  /// In ar, this message translates to:
  /// **'موقعك مُشارك مع هذه الرحلة ما دامت هذه الشاشة مفتوحة.'**
  String get locationSharingActive;

  /// No description provided for @locationSharingDeclined.
  ///
  /// In ar, this message translates to:
  /// **'موقعك غير مُشارك، لذلك لا يرى الركاب مكانك.'**
  String get locationSharingDeclined;

  /// No description provided for @locationSharingDenied.
  ///
  /// In ar, this message translates to:
  /// **'لم يُسمح بالوصول إلى الموقع، لذلك لا يرى الركاب مكانك.'**
  String get locationSharingDenied;

  /// No description provided for @locationSharingPermanentlyDenied.
  ///
  /// In ar, this message translates to:
  /// **'الوصول إلى الموقع محظور لتطبيق درب. اسمح به من إعدادات الهاتف ليرى الركاب مكانك.'**
  String get locationSharingPermanentlyDenied;

  /// No description provided for @locationSharingServiceDisabled.
  ///
  /// In ar, this message translates to:
  /// **'خدمات الموقع متوقفة على هذا الهاتف. شغّلها لمشاركة موقعك.'**
  String get locationSharingServiceDisabled;

  /// No description provided for @locationSharingUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'موقعك غير متاح الآن. يواصل درب المحاولة ما دامت هذه الشاشة مفتوحة.'**
  String get locationSharingUnavailable;

  /// No description provided for @locationSharingTurnOn.
  ///
  /// In ar, this message translates to:
  /// **'مشاركة الموقع'**
  String get locationSharingTurnOn;

  /// No description provided for @locationSharingOpenSettings.
  ///
  /// In ar, this message translates to:
  /// **'فتح الإعدادات'**
  String get locationSharingOpenSettings;

  /// No description provided for @locationLastSeenMinutes.
  ///
  /// In ar, this message translates to:
  /// **'قبل {minutes} د'**
  String locationLastSeenMinutes(int minutes);

  /// No description provided for @checkpoints.
  ///
  /// In ar, this message translates to:
  /// **'الحواجز'**
  String get checkpoints;

  /// No description provided for @checkpointsUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'بيانات الحواجز غير متاحة'**
  String get checkpointsUnavailable;

  /// No description provided for @checkpointsUnavailableBody.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر جلب حالة الحواجز. المسار معروض بدونها.'**
  String get checkpointsUnavailableBody;

  /// No description provided for @checkpointsDisabled.
  ///
  /// In ar, this message translates to:
  /// **'خدمة الحواجز غير مفعّلة في هذا الإصدار.'**
  String get checkpointsDisabled;

  /// No description provided for @checkpointsStale.
  ///
  /// In ar, this message translates to:
  /// **'هذه آخر حالة مؤكدة للحواجز، وقد لا تكون محدّثة الآن.'**
  String get checkpointsStale;

  /// No description provided for @checkpointsEmpty.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد حواجز مسجّلة على هذا المسار.'**
  String get checkpointsEmpty;

  /// No description provided for @checkpointCount.
  ///
  /// In ar, this message translates to:
  /// **'{count, plural, =0{لا حواجز} =1{حاجز واحد} =2{حاجزان} few{{count} حواجز} other{{count} حاجزاً}}'**
  String checkpointCount(int count);

  /// No description provided for @checkpointOpen.
  ///
  /// In ar, this message translates to:
  /// **'مفتوح'**
  String get checkpointOpen;

  /// No description provided for @checkpointCongested.
  ///
  /// In ar, this message translates to:
  /// **'ازدحام'**
  String get checkpointCongested;

  /// No description provided for @checkpointClosed.
  ///
  /// In ar, this message translates to:
  /// **'مغلق'**
  String get checkpointClosed;

  /// No description provided for @checkpointUnknown.
  ///
  /// In ar, this message translates to:
  /// **'الحالة غير معروفة'**
  String get checkpointUnknown;

  /// No description provided for @checkpointStatusOpen.
  ///
  /// In ar, this message translates to:
  /// **'سالك'**
  String get checkpointStatusOpen;

  /// No description provided for @checkpointStatusCongested.
  ///
  /// In ar, this message translates to:
  /// **'أزمة'**
  String get checkpointStatusCongested;

  /// No description provided for @checkpointStatusClosed.
  ///
  /// In ar, this message translates to:
  /// **'مغلق'**
  String get checkpointStatusClosed;

  /// No description provided for @checkpointStatusUnknown.
  ///
  /// In ar, this message translates to:
  /// **'غير معروف'**
  String get checkpointStatusUnknown;

  /// No description provided for @checkpointStatusNotAvailable.
  ///
  /// In ar, this message translates to:
  /// **'الحالة غير متوفرة'**
  String get checkpointStatusNotAvailable;

  /// No description provided for @checkpointEnteringStatus.
  ///
  /// In ar, this message translates to:
  /// **'دخول: {status}'**
  String checkpointEnteringStatus(String status);

  /// No description provided for @checkpointLeavingStatus.
  ///
  /// In ar, this message translates to:
  /// **'خروج: {status}'**
  String checkpointLeavingStatus(String status);

  /// No description provided for @checkpointDirectionStatus.
  ///
  /// In ar, this message translates to:
  /// **'الحالة'**
  String get checkpointDirectionStatus;

  /// No description provided for @checkpointDirectionEntering.
  ///
  /// In ar, this message translates to:
  /// **'الدخول'**
  String get checkpointDirectionEntering;

  /// No description provided for @checkpointDirectionLeaving.
  ///
  /// In ar, this message translates to:
  /// **'الخروج'**
  String get checkpointDirectionLeaving;

  /// No description provided for @checkpointUpdatedAt.
  ///
  /// In ar, this message translates to:
  /// **'التحديث: {time}'**
  String checkpointUpdatedAt(String time);

  /// No description provided for @checkpointUpdatedUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'التحديث: غير متوفر'**
  String get checkpointUpdatedUnavailable;

  /// No description provided for @checkpointLastUpdatedAt.
  ///
  /// In ar, this message translates to:
  /// **'آخر تحديث: {time}'**
  String checkpointLastUpdatedAt(String time);

  /// No description provided for @checkpointLastUpdatedUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'آخر تحديث غير متوفر'**
  String get checkpointLastUpdatedUnavailable;

  /// No description provided for @checkpointTimeUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'غير متوفر'**
  String get checkpointTimeUnavailable;

  /// No description provided for @checkpointCityUnspecified.
  ///
  /// In ar, this message translates to:
  /// **'مدينة غير محددة'**
  String get checkpointCityUnspecified;

  /// No description provided for @checkpointCityHasCongestion.
  ///
  /// In ar, this message translates to:
  /// **'يوجد أزمة'**
  String get checkpointCityHasCongestion;

  /// No description provided for @checkpointsOnRoad.
  ///
  /// In ar, this message translates to:
  /// **'الحواجز على الطريق'**
  String get checkpointsOnRoad;

  /// No description provided for @checkpointsCityCount.
  ///
  /// In ar, this message translates to:
  /// **'{checkpoints} حاجز · {cities} مدينة'**
  String checkpointsCityCount(int checkpoints, int cities);

  /// No description provided for @checkpointsCitiesLabel.
  ///
  /// In ar, this message translates to:
  /// **'المدن'**
  String get checkpointsCitiesLabel;

  /// No description provided for @checkpointsCongestedLabel.
  ///
  /// In ar, this message translates to:
  /// **'حواجز عليها ازدحام'**
  String get checkpointsCongestedLabel;

  /// No description provided for @checkpointsViewDetails.
  ///
  /// In ar, this message translates to:
  /// **'عرض تفاصيل الحواجز وحالتها'**
  String get checkpointsViewDetails;

  /// No description provided for @checkpointsDataUpdated.
  ///
  /// In ar, this message translates to:
  /// **'آخر تحديث للبيانات: {time}'**
  String checkpointsDataUpdated(String time);

  /// No description provided for @checkpointsRefreshData.
  ///
  /// In ar, this message translates to:
  /// **'تحديث بيانات الحواجز'**
  String get checkpointsRefreshData;

  /// No description provided for @checkpointsByCity.
  ///
  /// In ar, this message translates to:
  /// **'الحواجز حسب المدينة'**
  String get checkpointsByCity;

  /// No description provided for @checkpointsRefreshing.
  ///
  /// In ar, this message translates to:
  /// **'جاري تحديث الحواجز...'**
  String get checkpointsRefreshing;

  /// No description provided for @checkpointsNoData.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد بيانات حواجز متاحة حالياً.'**
  String get checkpointsNoData;

  /// No description provided for @checkpointsPickCity.
  ///
  /// In ar, this message translates to:
  /// **'اختر المدينة لعرض حواجزها'**
  String get checkpointsPickCity;

  /// No description provided for @checkpointLabel.
  ///
  /// In ar, this message translates to:
  /// **'{name} — {status}'**
  String checkpointLabel(String name, String status);

  /// No description provided for @checkpointUnnamed.
  ///
  /// In ar, this message translates to:
  /// **'حاجز'**
  String get checkpointUnnamed;

  /// No description provided for @mapRouteMissingCoordinates.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد إحداثيات لهذا المسار، لذلك لا يمكن رسمه على الخريطة.'**
  String get mapRouteMissingCoordinates;

  /// No description provided for @mapSelectRoute.
  ///
  /// In ar, this message translates to:
  /// **'اختر مساراً لعرضه على الخريطة.'**
  String get mapSelectRoute;

  /// No description provided for @recoverMerchantOrder.
  ///
  /// In ar, this message translates to:
  /// **'استعادة الطلب'**
  String get recoverMerchantOrder;

  /// No description provided for @merchantOrderUncertain.
  ///
  /// In ar, this message translates to:
  /// **'قد يكون الطلب قد حُفظ. استعده قبل إنشاء طلب آخر.'**
  String get merchantOrderUncertain;

  /// No description provided for @merchantOrderRecoveryExpired.
  ///
  /// In ar, this message translates to:
  /// **'انتهت مهلة إعادة المحاولة. يُسمح فقط بالتحقق من الطلب المحفوظ. تواصل مع الدعم إذا لم تُحسم نتيجة الطلب.'**
  String get merchantOrderRecoveryExpired;

  /// No description provided for @merchantOrderRecoveryUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'استعادة الطلب غير متاحة. سجّل الدخول إلى حساب التاجر الأصلي أو تواصل مع الدعم. لا ترسل طلباً بديلاً.'**
  String get merchantOrderRecoveryUnavailable;

  /// No description provided for @bookingTimePassed.
  ///
  /// In ar, this message translates to:
  /// **'وقت المغادرة هذا قد مضى. اختر وقتاً قادماً.'**
  String get bookingTimePassed;

  /// No description provided for @bookingOutcomeUnknown.
  ///
  /// In ar, this message translates to:
  /// **'قد يكون الحجز محفوظًا بالفعل. سنتحقق منه عند عودة الاتصال. لا تنشئ حجزًا آخر.'**
  String get bookingOutcomeUnknown;

  /// No description provided for @verifyBooking.
  ///
  /// In ar, this message translates to:
  /// **'التحقق من الحجز'**
  String get verifyBooking;

  /// No description provided for @checkpointDirectoryTitle.
  ///
  /// In ar, this message translates to:
  /// **'دليل الحواجز'**
  String get checkpointDirectoryTitle;

  /// No description provided for @checkpointDirectoryDisabled.
  ///
  /// In ar, this message translates to:
  /// **'دليل الحواجز غير مفعّل.'**
  String get checkpointDirectoryDisabled;

  /// No description provided for @checkpointDirectoryLoadFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذر تحميل دليل الحواجز.'**
  String get checkpointDirectoryLoadFailed;

  /// No description provided for @checkpointDirectorySearch.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن حاجز أو مدينة'**
  String get checkpointDirectorySearch;

  /// No description provided for @checkpointDirectoryNoResults.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد حواجز مطابقة'**
  String get checkpointDirectoryNoResults;

  /// No description provided for @checkpointDirectoryTrafficUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'حالة المرور غير متاحة'**
  String get checkpointDirectoryTrafficUnavailable;

  /// No description provided for @checkpointDirectoryLimitedNotice.
  ///
  /// In ar, this message translates to:
  /// **'بيانات محدودة من المزود: حتى سبع نقاط في كل مدينة. هذه ليست القائمة الكاملة.'**
  String get checkpointDirectoryLimitedNotice;

  /// No description provided for @checkpointDirectoryGenerated.
  ///
  /// In ar, this message translates to:
  /// **'وقت إنشاء استجابة المزود'**
  String get checkpointDirectoryGenerated;

  /// No description provided for @checkpointDirectoryEnteringUpdated.
  ///
  /// In ar, this message translates to:
  /// **'آخر تغيير لحالة الدخول (الحالة غير متاحة)'**
  String get checkpointDirectoryEnteringUpdated;

  /// No description provided for @checkpointDirectoryLeavingUpdated.
  ///
  /// In ar, this message translates to:
  /// **'آخر تغيير لحالة الخروج (الحالة غير متاحة)'**
  String get checkpointDirectoryLeavingUpdated;

  /// No description provided for @checkpointDirectoryTimezoneUnspecified.
  ///
  /// In ar, this message translates to:
  /// **'المنطقة الزمنية غير محددة'**
  String get checkpointDirectoryTimezoneUnspecified;

  /// No description provided for @notifMatchOfferedTitle.
  ///
  /// In ar, this message translates to:
  /// **'عرض مطابقة جديد'**
  String get notifMatchOfferedTitle;

  /// No description provided for @notifMatchOfferedBody.
  ///
  /// In ar, this message translates to:
  /// **'لديك طلب جديد بانتظار ردّك.'**
  String get notifMatchOfferedBody;

  /// No description provided for @notifMatchAcceptedTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم قبول طلبك'**
  String get notifMatchAcceptedTitle;

  /// No description provided for @notifMatchAcceptedBody.
  ///
  /// In ar, this message translates to:
  /// **'قَبِل أحد السائقين طلبك.'**
  String get notifMatchAcceptedBody;

  /// No description provided for @notifMatchRejectedTitle.
  ///
  /// In ar, this message translates to:
  /// **'اعتذر السائق'**
  String get notifMatchRejectedTitle;

  /// No description provided for @notifMatchRejectedBody.
  ///
  /// In ar, this message translates to:
  /// **'اعتذر السائق عن الطلب. يمكنك البحث عن مطابقة أخرى.'**
  String get notifMatchRejectedBody;

  /// No description provided for @notifTripStatusTitle.
  ///
  /// In ar, this message translates to:
  /// **'تحديث على الرحلة'**
  String get notifTripStatusTitle;

  /// No description provided for @notifTripStatusBody.
  ///
  /// In ar, this message translates to:
  /// **'حالة الرحلة الآن: {status}'**
  String notifTripStatusBody(String status);

  /// No description provided for @notifVerificationApprovedTitle.
  ///
  /// In ar, this message translates to:
  /// **'تمت الموافقة على حسابك'**
  String get notifVerificationApprovedTitle;

  /// No description provided for @notifVerificationApprovedBody.
  ///
  /// In ar, this message translates to:
  /// **'تمت الموافقة على حساب السائق. يمكنك الآن البدء بالعمل.'**
  String get notifVerificationApprovedBody;

  /// No description provided for @notifVerificationRejectedTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم رفض طلب التحقق'**
  String get notifVerificationRejectedTitle;

  /// No description provided for @notifVerificationRejectedBody.
  ///
  /// In ar, this message translates to:
  /// **'لم تتم الموافقة على طلب التحقق من حسابك.'**
  String get notifVerificationRejectedBody;

  /// No description provided for @notifVerificationRejectedReason.
  ///
  /// In ar, this message translates to:
  /// **'السبب: {reason}'**
  String notifVerificationRejectedReason(String reason);

  /// No description provided for @notifUnknownTitle.
  ///
  /// In ar, this message translates to:
  /// **'إشعار جديد'**
  String get notifUnknownTitle;

  /// No description provided for @notificationsMarkAllRead.
  ///
  /// In ar, this message translates to:
  /// **'تعليم الكل كمقروء'**
  String get notificationsMarkAllRead;

  /// No description provided for @notificationsLoadError.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل الإشعارات.'**
  String get notificationsLoadError;

  /// No description provided for @notificationsUnreadCount.
  ///
  /// In ar, this message translates to:
  /// **'{count} غير مقروءة'**
  String notificationsUnreadCount(int count);

  /// No description provided for @reportsDeliveries.
  ///
  /// In ar, this message translates to:
  /// **'التوصيلات'**
  String get reportsDeliveries;

  /// No description provided for @reportsLoadError.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل التقرير.'**
  String get reportsLoadError;

  /// No description provided for @reportsOrdersByStatus.
  ///
  /// In ar, this message translates to:
  /// **'الطلبات حسب الحالة'**
  String get reportsOrdersByStatus;

  /// No description provided for @reportsDeliveriesByStatus.
  ///
  /// In ar, this message translates to:
  /// **'التوصيلات حسب الحالة'**
  String get reportsDeliveriesByStatus;

  /// No description provided for @reportsNoRecords.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد سجلات بعد.'**
  String get reportsNoRecords;

  /// No description provided for @incidentReportAction.
  ///
  /// In ar, this message translates to:
  /// **'الإبلاغ عن مشكلة'**
  String get incidentReportAction;

  /// No description provided for @incidentReportTitle.
  ///
  /// In ar, this message translates to:
  /// **'الإبلاغ عن مشكلة'**
  String get incidentReportTitle;

  /// No description provided for @incidentReportNotice.
  ///
  /// In ar, this message translates to:
  /// **'يُسجَّل بلاغك لتراجعه الإدارة. هذه ليست خدمة طوارئ؛ في حال الخطر اتصل بالجهات المختصة مباشرة.'**
  String get incidentReportNotice;

  /// No description provided for @incidentDescriptionLabel.
  ///
  /// In ar, this message translates to:
  /// **'صف المشكلة'**
  String get incidentDescriptionLabel;

  /// No description provided for @incidentSubmit.
  ///
  /// In ar, this message translates to:
  /// **'إرسال البلاغ'**
  String get incidentSubmit;

  /// No description provided for @incidentSubmitted.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال البلاغ.'**
  String get incidentSubmitted;

  /// No description provided for @incidentSubmitFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر إرسال البلاغ. حاول مرة أخرى.'**
  String get incidentSubmitFailed;

  /// No description provided for @incidentTooMany.
  ///
  /// In ar, this message translates to:
  /// **'لديك عدة بلاغات قيد المراجعة. انتظر معالجتها قبل إرسال بلاغ جديد.'**
  String get incidentTooMany;

  /// No description provided for @incidentCategorySafety.
  ///
  /// In ar, this message translates to:
  /// **'السلامة'**
  String get incidentCategorySafety;

  /// No description provided for @incidentCategoryDelay.
  ///
  /// In ar, this message translates to:
  /// **'تأخير'**
  String get incidentCategoryDelay;

  /// No description provided for @incidentCategoryParcelDamage.
  ///
  /// In ar, this message translates to:
  /// **'تلف طرد'**
  String get incidentCategoryParcelDamage;

  /// No description provided for @incidentCategoryBehavior.
  ///
  /// In ar, this message translates to:
  /// **'سلوك'**
  String get incidentCategoryBehavior;

  /// No description provided for @incidentCategoryOther.
  ///
  /// In ar, this message translates to:
  /// **'أخرى'**
  String get incidentCategoryOther;

  /// No description provided for @myIncidentReports.
  ///
  /// In ar, this message translates to:
  /// **'بلاغاتي'**
  String get myIncidentReports;

  /// No description provided for @myIncidentReportsEmpty.
  ///
  /// In ar, this message translates to:
  /// **'لم ترسل أي بلاغ بعد.'**
  String get myIncidentReportsEmpty;

  /// No description provided for @myIncidentReportsFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل بلاغاتك.'**
  String get myIncidentReportsFailed;

  /// No description provided for @incidentStatusOpen.
  ///
  /// In ar, this message translates to:
  /// **'مفتوح'**
  String get incidentStatusOpen;

  /// No description provided for @incidentStatusReviewing.
  ///
  /// In ar, this message translates to:
  /// **'قيد المراجعة'**
  String get incidentStatusReviewing;

  /// No description provided for @incidentStatusResolved.
  ///
  /// In ar, this message translates to:
  /// **'تمت المعالجة'**
  String get incidentStatusResolved;

  /// No description provided for @notifIncidentUpdatedTitle.
  ///
  /// In ar, this message translates to:
  /// **'تحديث على بلاغك'**
  String get notifIncidentUpdatedTitle;

  /// No description provided for @notifIncidentReviewingBody.
  ///
  /// In ar, this message translates to:
  /// **'بلاغك قيد المراجعة.'**
  String get notifIncidentReviewingBody;

  /// No description provided for @notifIncidentResolvedBody.
  ///
  /// In ar, this message translates to:
  /// **'تمت معالجة بلاغك.'**
  String get notifIncidentResolvedBody;

  /// No description provided for @notifOrderExpiredTitle.
  ///
  /// In ar, this message translates to:
  /// **'انتهت صلاحية الطلب'**
  String get notifOrderExpiredTitle;

  /// No description provided for @notifOrderExpiredMaxAgeBody.
  ///
  /// In ar, this message translates to:
  /// **'لم يأخذ أي سائق هذا الطلب خلال {hours} ساعة، فانتهت صلاحيته ولن يُستلم شيء. أنشئه من جديد إن كنت ما زلت تريد إرساله.'**
  String notifOrderExpiredMaxAgeBody(int hours);

  /// No description provided for @notifOrderExpiredWindowBody.
  ///
  /// In ar, this message translates to:
  /// **'لم يُعثر على سائق قبل انتهاء وقت الاستلام الذي اخترته، فانتهت صلاحية الطلب ولن يُستلم شيء. أنشئه من جديد إن كنت ما زلت تريد إرساله.'**
  String get notifOrderExpiredWindowBody;

  /// No description provided for @notifOfferWithdrawnTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم سحب العرض'**
  String get notifOfferWithdrawnTitle;

  /// No description provided for @notifOfferWithdrawnCancelledBody.
  ///
  /// In ar, this message translates to:
  /// **'ألغى المرسل طلباً في عرض الطرود هذا، لذلك لم يعد بانتظارك. المساحة التي كان يحجزها متاحة من جديد.'**
  String get notifOfferWithdrawnCancelledBody;

  /// No description provided for @notifOfferWithdrawnExpiredBody.
  ///
  /// In ar, this message translates to:
  /// **'انتهت صلاحية طلب في عرض الطرود هذا، لذلك لم يعد بانتظارك. المساحة التي كان يحجزها متاحة من جديد.'**
  String get notifOfferWithdrawnExpiredBody;

  /// No description provided for @cancelReasonPrompt.
  ///
  /// In ar, this message translates to:
  /// **'ما سبب الإلغاء؟'**
  String get cancelReasonPrompt;

  /// No description provided for @cancelNoteLabel.
  ///
  /// In ar, this message translates to:
  /// **'أضف ملاحظة (اختياري)'**
  String get cancelNoteLabel;

  /// No description provided for @cancelReasonKeep.
  ///
  /// In ar, this message translates to:
  /// **'إبقاء'**
  String get cancelReasonKeep;

  /// No description provided for @cancelReasonChangedPlans.
  ///
  /// In ar, this message translates to:
  /// **'تغيّرت الخطط'**
  String get cancelReasonChangedPlans;

  /// No description provided for @cancelReasonFoundOtherTransport.
  ///
  /// In ar, this message translates to:
  /// **'وجدت وسيلة نقل أخرى'**
  String get cancelReasonFoundOtherTransport;

  /// No description provided for @cancelReasonDriverTooFar.
  ///
  /// In ar, this message translates to:
  /// **'السائق بعيد أو متأخر'**
  String get cancelReasonDriverTooFar;

  /// No description provided for @cancelReasonWrongDetails.
  ///
  /// In ar, this message translates to:
  /// **'إدخال بيانات خاطئة'**
  String get cancelReasonWrongDetails;

  /// No description provided for @cancelReasonFoundOtherDelivery.
  ///
  /// In ar, this message translates to:
  /// **'وجدت خيار توصيل آخر'**
  String get cancelReasonFoundOtherDelivery;

  /// No description provided for @cancelReasonVehicleProblem.
  ///
  /// In ar, this message translates to:
  /// **'مشكلة في المركبة'**
  String get cancelReasonVehicleProblem;

  /// No description provided for @cancelReasonEmergency.
  ///
  /// In ar, this message translates to:
  /// **'حالة طارئة'**
  String get cancelReasonEmergency;

  /// No description provided for @cancelReasonCannotReachPickup.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن الوصول إلى نقطة الاستلام'**
  String get cancelReasonCannotReachPickup;

  /// No description provided for @cancelReasonRouteChanged.
  ///
  /// In ar, this message translates to:
  /// **'تغيّر المسار'**
  String get cancelReasonRouteChanged;

  /// No description provided for @cancelReasonCustomerRequest.
  ///
  /// In ar, this message translates to:
  /// **'بطلب من العميل'**
  String get cancelReasonCustomerRequest;

  /// No description provided for @cancelReasonDriverUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'السائق غير متاح'**
  String get cancelReasonDriverUnavailable;

  /// No description provided for @cancelReasonSafetyConcern.
  ///
  /// In ar, this message translates to:
  /// **'مخاوف تتعلق بالسلامة'**
  String get cancelReasonSafetyConcern;

  /// No description provided for @cancelReasonDuplicate.
  ///
  /// In ar, this message translates to:
  /// **'طلب مكرر'**
  String get cancelReasonDuplicate;

  /// No description provided for @cancelReasonPolicyViolation.
  ///
  /// In ar, this message translates to:
  /// **'مخالفة للسياسة'**
  String get cancelReasonPolicyViolation;

  /// No description provided for @cancelReasonNoDriverInTime.
  ///
  /// In ar, this message translates to:
  /// **'لم يقبله أي سائق في الوقت المحدد'**
  String get cancelReasonNoDriverInTime;

  /// No description provided for @cancelReasonOther.
  ///
  /// In ar, this message translates to:
  /// **'سبب آخر'**
  String get cancelReasonOther;

  /// No description provided for @cancelledAutomaticallyReason.
  ///
  /// In ar, this message translates to:
  /// **'أُلغي تلقائياً: {reason}'**
  String cancelledAutomaticallyReason(String reason);

  /// No description provided for @cancelledByDriverReason.
  ///
  /// In ar, this message translates to:
  /// **'ألغاه السائق: {reason}'**
  String cancelledByDriverReason(String reason);

  /// No description provided for @cancelledByAdminReason.
  ///
  /// In ar, this message translates to:
  /// **'ألغاه فريق درب: {reason}'**
  String cancelledByAdminReason(String reason);

  /// No description provided for @cancelledByYouReason.
  ///
  /// In ar, this message translates to:
  /// **'ألغيتَه: {reason}'**
  String cancelledByYouReason(String reason);

  /// No description provided for @cancelledByPassengerReason.
  ///
  /// In ar, this message translates to:
  /// **'ألغاه الراكب: {reason}'**
  String cancelledByPassengerReason(String reason);

  /// No description provided for @cancelledBySenderReason.
  ///
  /// In ar, this message translates to:
  /// **'ألغاه المرسل: {reason}'**
  String cancelledBySenderReason(String reason);

  /// No description provided for @cancelAcceptedRideConfirm.
  ///
  /// In ar, this message translates to:
  /// **'قبل سائق هذا الطلب. هل تريد إلغاءه؟ سيتم إبلاغ السائق.'**
  String get cancelAcceptedRideConfirm;

  /// No description provided for @cancelAcceptedOrderNote.
  ///
  /// In ar, this message translates to:
  /// **'قبل سائق هذا الطلب بالفعل. الإلغاء يُبلغ السائق ويُعيد المساحة التي حجزها.'**
  String get cancelAcceptedOrderNote;

  /// No description provided for @driverCancelTripWarning.
  ///
  /// In ar, this message translates to:
  /// **'يعود الطلب لانتظار سائق آخر. إلغاء رحلة مقبولة يؤثر على درجة الثقة لديك، وعدد مرات الإلغاء في اليوم محدود.'**
  String get driverCancelTripWarning;

  /// No description provided for @driverCancelLimitReached.
  ///
  /// In ar, this message translates to:
  /// **'وصلتَ إلى حد الإلغاء اليومي للرحلات. تواصل مع الدعم إن تعذّر عليك إكمال هذه الرحلة.'**
  String get driverCancelLimitReached;

  /// No description provided for @driverTripCancelledWaiting.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء الرحلة. الطلب بانتظار سائق آخر.'**
  String get driverTripCancelledWaiting;

  /// No description provided for @notifCancelledRideTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء طلب الرحلة'**
  String get notifCancelledRideTitle;

  /// No description provided for @notifCancelledOrderTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء الطلب'**
  String get notifCancelledOrderTitle;

  /// No description provided for @notifCancelledParcelTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء الطرد'**
  String get notifCancelledParcelTitle;

  /// No description provided for @notifCancelledAutomaticBody.
  ///
  /// In ar, this message translates to:
  /// **'لم يقبله أي سائق في الوقت المحدد، لذلك أُلغي تلقائياً.'**
  String get notifCancelledAutomaticBody;

  /// No description provided for @notifCancelledByAdminBody.
  ///
  /// In ar, this message translates to:
  /// **'ألغاه فريق درب: {reason}.'**
  String notifCancelledByAdminBody(String reason);

  /// No description provided for @notifCancelledWaitingTitle.
  ///
  /// In ar, this message translates to:
  /// **'ألغى السائق الرحلة'**
  String get notifCancelledWaitingTitle;

  /// No description provided for @notifCancelledWaitingBody.
  ///
  /// In ar, this message translates to:
  /// **'طلبك بانتظار سائق آخر.'**
  String get notifCancelledWaitingBody;

  /// No description provided for @notifCancelledDriverTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء الرحلة'**
  String get notifCancelledDriverTitle;

  /// No description provided for @notifCancelledDriverByPassengerBody.
  ///
  /// In ar, this message translates to:
  /// **'ألغى الراكب هذه الرحلة: {reason}.'**
  String notifCancelledDriverByPassengerBody(String reason);

  /// No description provided for @notifCancelledDriverBySenderBody.
  ///
  /// In ar, this message translates to:
  /// **'ألغى المرسل هذه الرحلة: {reason}.'**
  String notifCancelledDriverBySenderBody(String reason);

  /// No description provided for @notifCancelledDriverByAdminBody.
  ///
  /// In ar, this message translates to:
  /// **'ألغى فريق درب هذه الرحلة: {reason}.'**
  String notifCancelledDriverByAdminBody(String reason);

  /// No description provided for @notifCancelledPartialTitle.
  ///
  /// In ar, this message translates to:
  /// **'تمت إزالة طلب من رحلتك'**
  String get notifCancelledPartialTitle;

  /// No description provided for @notifCancelledPartialBody.
  ///
  /// In ar, this message translates to:
  /// **'أُلغي طلب: {reason}. تستمر بقية الرحلة.'**
  String notifCancelledPartialBody(String reason);

  /// No description provided for @notifOfferWithdrawnRequestCancelledBody.
  ///
  /// In ar, this message translates to:
  /// **'ألغى الراكب هذا الطلب، لذلك لم يعد بانتظارك.'**
  String get notifOfferWithdrawnRequestCancelledBody;

  /// No description provided for @verificationDocuments.
  ///
  /// In ar, this message translates to:
  /// **'مستندات التوثيق'**
  String get verificationDocuments;

  /// No description provided for @verificationDocumentsHint.
  ///
  /// In ar, this message translates to:
  /// **'للحصول على الموافقة، ارفع صوراً واضحة أو ملفات PDF لرخصة القيادة وتسجيل المركبة والهوية الوطنية. تُحفظ الملفات على خادمنا ولا يفتحها إلا فريق المراجعة.'**
  String get verificationDocumentsHint;

  /// No description provided for @documentKind.
  ///
  /// In ar, this message translates to:
  /// **'نوع المستند'**
  String get documentKind;

  /// No description provided for @documentKindDriverLicence.
  ///
  /// In ar, this message translates to:
  /// **'رخصة القيادة'**
  String get documentKindDriverLicence;

  /// No description provided for @documentKindVehicleRegistration.
  ///
  /// In ar, this message translates to:
  /// **'ترخيص المركبة'**
  String get documentKindVehicleRegistration;

  /// No description provided for @documentKindVehiclePhoto.
  ///
  /// In ar, this message translates to:
  /// **'صورة المركبة'**
  String get documentKindVehiclePhoto;

  /// No description provided for @documentKindNationalId.
  ///
  /// In ar, this message translates to:
  /// **'الهوية الوطنية'**
  String get documentKindNationalId;

  /// No description provided for @documentKindInsurance.
  ///
  /// In ar, this message translates to:
  /// **'التأمين'**
  String get documentKindInsurance;

  /// No description provided for @documentKindOther.
  ///
  /// In ar, this message translates to:
  /// **'مستند آخر'**
  String get documentKindOther;

  /// No description provided for @addDocument.
  ///
  /// In ar, this message translates to:
  /// **'إضافة مستند'**
  String get addDocument;

  /// No description provided for @removeDocument.
  ///
  /// In ar, this message translates to:
  /// **'إزالة المستند'**
  String get removeDocument;

  /// No description provided for @documentTooLarge.
  ///
  /// In ar, this message translates to:
  /// **'الملف كبير جدًا. الحد الأقصى 5 ميغابايت.'**
  String get documentTooLarge;

  /// No description provided for @documentTypeUnsupported.
  ///
  /// In ar, this message translates to:
  /// **'يمكن رفع ملفات JPEG أو PNG أو PDF فقط.'**
  String get documentTypeUnsupported;

  /// No description provided for @documentLimitReached.
  ///
  /// In ar, this message translates to:
  /// **'وصلت إلى الحد الأقصى لعدد المستندات.'**
  String get documentLimitReached;

  /// No description provided for @acceptanceRateTitle.
  ///
  /// In ar, this message translates to:
  /// **'نسبة القبول'**
  String get acceptanceRateTitle;

  /// No description provided for @acceptanceRateValue.
  ///
  /// In ar, this message translates to:
  /// **'{percent}%'**
  String acceptanceRateValue(int percent);

  /// No description provided for @acceptanceRateDetail.
  ///
  /// In ar, this message translates to:
  /// **'تم قبول {accepted} من {responded} عرضًا أجبت عنها. العروض التي انتهت دون رد لا تُحتسب.'**
  String acceptanceRateDetail(int accepted, int responded);

  /// No description provided for @acceptanceRateNeedMore.
  ///
  /// In ar, this message translates to:
  /// **'تظهر نسبتك بعد {needed} عروض تم الرد عليها ({responded} حتى الآن).'**
  String acceptanceRateNeedMore(int needed, int responded);

  /// No description provided for @emailOrPhone.
  ///
  /// In ar, this message translates to:
  /// **'البريد الإلكتروني أو رقم الهاتف'**
  String get emailOrPhone;

  /// No description provided for @emailOrPhoneRequired.
  ///
  /// In ar, this message translates to:
  /// **'أدخل بريدك الإلكتروني أو رقم هاتفك.'**
  String get emailOrPhoneRequired;

  /// No description provided for @emailOrPhoneInvalid.
  ///
  /// In ar, this message translates to:
  /// **'أدخل بريدًا إلكترونيًا صحيحًا، أو رقم هاتف يبدأ بـ + ورمز الدولة.'**
  String get emailOrPhoneInvalid;

  /// No description provided for @mapLegendStart.
  ///
  /// In ar, this message translates to:
  /// **'البداية'**
  String get mapLegendStart;

  /// No description provided for @mapLegendDestination.
  ///
  /// In ar, this message translates to:
  /// **'الوصول'**
  String get mapLegendDestination;

  /// No description provided for @sendParcelTitle.
  ///
  /// In ar, this message translates to:
  /// **'إرسال طرد'**
  String get sendParcelTitle;

  /// No description provided for @sendParcelEntryBody.
  ///
  /// In ar, this message translates to:
  /// **'أرسل طردًا صغيرًا مع سائق يسير أصلًا على مسار معتمد.'**
  String get sendParcelEntryBody;

  /// No description provided for @sendParcelIntro.
  ///
  /// In ar, this message translates to:
  /// **'اختر المسار والمحطتين ثم أخبرنا من سيستلم الطرد. سيحمله سائق متجه في هذا الاتجاه.'**
  String get sendParcelIntro;

  /// No description provided for @sendParcelPickupHint.
  ///
  /// In ar, this message translates to:
  /// **'سلّم الطرد للسائق عند هذه المحطة.'**
  String get sendParcelPickupHint;

  /// No description provided for @parcelSizeSmallHint.
  ///
  /// In ar, this message translates to:
  /// **'S - صغير، يكفي لحقيبة'**
  String get parcelSizeSmallHint;

  /// No description provided for @parcelSizeMediumHint.
  ///
  /// In ar, this message translates to:
  /// **'M - متوسط، بحجم علبة حذاء تقريبًا'**
  String get parcelSizeMediumHint;

  /// No description provided for @parcelSizeLargeNotAllowed.
  ///
  /// In ar, this message translates to:
  /// **'الطرود الكبيرة مخصصة للمتاجر ولا يمكن إرسالها من حساب شخصي.'**
  String get parcelSizeLargeNotAllowed;

  /// No description provided for @receiverNameLabel.
  ///
  /// In ar, this message translates to:
  /// **'اسم المستلم'**
  String get receiverNameLabel;

  /// No description provided for @receiverPhoneLabel.
  ///
  /// In ar, this message translates to:
  /// **'هاتف المستلم'**
  String get receiverPhoneLabel;

  /// No description provided for @receiverPrivacyNote.
  ///
  /// In ar, this message translates to:
  /// **'المستلم لا يحتاج إلى التطبيق. يُستخدم اسمه ورقمه لهذا التوصيل فقط، ولا يظهران لأي مستخدم آخر، ويُمسحان بعد انتهاء المدة.'**
  String get receiverPrivacyNote;

  /// No description provided for @parcelNoteLabel.
  ///
  /// In ar, this message translates to:
  /// **'ملاحظة للسائق (اختياري)'**
  String get parcelNoteLabel;

  /// No description provided for @forbiddenItemsAck.
  ///
  /// In ar, this message translates to:
  /// **'أقرّ بأن الطرد لا يحتوي على نقود أو أشياء ثمينة أو أدوية أو أسلحة أو مواد قابلة للاشتعال أو ممنوعة أو سريعة التلف.'**
  String get forbiddenItemsAck;

  /// No description provided for @sendParcelSubmit.
  ///
  /// In ar, this message translates to:
  /// **'إرسال الطرد'**
  String get sendParcelSubmit;

  /// No description provided for @sendParcelRecorded.
  ///
  /// In ar, this message translates to:
  /// **'تم تسجيل طلب الطرد.'**
  String get sendParcelRecorded;

  /// No description provided for @sendParcelRecordedBody.
  ///
  /// In ar, this message translates to:
  /// **'نبحث عن سائق على هذا المسار. يمكنك الإلغاء ما لم يُعرض الطرد على سائق.'**
  String get sendParcelRecordedBody;

  /// No description provided for @sendParcelHandoverCodeIntro.
  ///
  /// In ar, this message translates to:
  /// **'أعطِ هذا الرمز للمستلم الآن، فالسائق سيطلبه عند التسليم. يظهر الرمز مرة واحدة فقط؛ إذا فقدته فاحصل على رمز جديد من «طرودي».'**
  String get sendParcelHandoverCodeIntro;

  /// No description provided for @parcelShowReceiverCode.
  ///
  /// In ar, this message translates to:
  /// **'عرض رمز المستلم'**
  String get parcelShowReceiverCode;

  /// No description provided for @parcelHideReceiverCode.
  ///
  /// In ar, this message translates to:
  /// **'إخفاء رمز المستلم'**
  String get parcelHideReceiverCode;

  /// No description provided for @myParcelsTitle.
  ///
  /// In ar, this message translates to:
  /// **'طرودي'**
  String get myParcelsTitle;

  /// No description provided for @myParcelsEmpty.
  ///
  /// In ar, this message translates to:
  /// **'لم ترسل أي طرد بعد.'**
  String get myParcelsEmpty;

  /// No description provided for @parcelTrackSearching.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ البحث عن سائق'**
  String get parcelTrackSearching;

  /// No description provided for @parcelTrackAssigned.
  ///
  /// In ar, this message translates to:
  /// **'تم تعيين سائق'**
  String get parcelTrackAssigned;

  /// No description provided for @parcelTrackPickedUp.
  ///
  /// In ar, this message translates to:
  /// **'تم استلامه منك'**
  String get parcelTrackPickedUp;

  /// No description provided for @parcelTrackInTransit.
  ///
  /// In ar, this message translates to:
  /// **'في الطريق'**
  String get parcelTrackInTransit;

  /// No description provided for @parcelTrackDelivered.
  ///
  /// In ar, this message translates to:
  /// **'تم التسليم'**
  String get parcelTrackDelivered;

  /// No description provided for @parcelTrackCancelled.
  ///
  /// In ar, this message translates to:
  /// **'ملغى'**
  String get parcelTrackCancelled;

  /// No description provided for @parcelTrackFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر التوصيل'**
  String get parcelTrackFailed;

  /// No description provided for @parcelTrackExpired.
  ///
  /// In ar, this message translates to:
  /// **'انتهت المهلة'**
  String get parcelTrackExpired;

  /// No description provided for @parcelCancelAction.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الطرد'**
  String get parcelCancelAction;

  /// No description provided for @parcelCancelConfirm.
  ///
  /// In ar, this message translates to:
  /// **'هل تريد إلغاء هذا الطرد؟ سيتم مسح بيانات المستلم.'**
  String get parcelCancelConfirm;

  /// No description provided for @parcelCancelledNotice.
  ///
  /// In ar, this message translates to:
  /// **'تم إلغاء الطرد.'**
  String get parcelCancelledNotice;

  /// No description provided for @parcelCannotCancel.
  ///
  /// In ar, this message translates to:
  /// **'عُرض الطرد على سائق بالفعل، لذلك لم يعد الإلغاء ممكنًا.'**
  String get parcelCannotCancel;

  /// No description provided for @parcelReceiverLine.
  ///
  /// In ar, this message translates to:
  /// **'المستلم: {name} ({phone})'**
  String parcelReceiverLine(String name, String phone);

  /// No description provided for @parcelReceiverRemoved.
  ///
  /// In ar, this message translates to:
  /// **'تم مسح بيانات المستلم.'**
  String get parcelReceiverRemoved;

  /// No description provided for @parcelLimitReached.
  ///
  /// In ar, this message translates to:
  /// **'لديك الحد الأقصى من الطرود قيد التوصيل. انتظر انتهاء أحدها أو ألغِ واحدًا.'**
  String get parcelLimitReached;

  /// No description provided for @parcelDailyLimit.
  ///
  /// In ar, this message translates to:
  /// **'تم بلوغ حد الطرود اليومي. حاول غدًا.'**
  String get parcelDailyLimit;

  /// No description provided for @invalidReceiverPhone.
  ///
  /// In ar, this message translates to:
  /// **'أدخل رقم هاتف صحيحًا للمستلم.'**
  String get invalidReceiverPhone;

  /// No description provided for @receiverNameInvalid.
  ///
  /// In ar, this message translates to:
  /// **'أدخل اسم المستلم.'**
  String get receiverNameInvalid;

  /// No description provided for @parcelAckRequired.
  ///
  /// In ar, this message translates to:
  /// **'أكّد الإقرار الخاص بالمواد الممنوعة للمتابعة.'**
  String get parcelAckRequired;

  /// No description provided for @keepParcel.
  ///
  /// In ar, this message translates to:
  /// **'إبقاء الطرد'**
  String get keepParcel;

  /// No description provided for @mapOfflineSaved.
  ///
  /// In ar, this message translates to:
  /// **'بدون اتصال - تُعرض الخريطة المحفوظة'**
  String get mapOfflineSaved;

  /// No description provided for @clearMapCache.
  ///
  /// In ar, this message translates to:
  /// **'مسح الخريطة المحفوظة'**
  String get clearMapCache;

  /// No description provided for @clearMapCacheHint.
  ///
  /// In ar, this message translates to:
  /// **'يحذف مربعات الخريطة المحفوظة على هذا الجهاز. تُحفظ من جديد أثناء التصفح.'**
  String get clearMapCacheHint;

  /// No description provided for @mapCacheCleared.
  ///
  /// In ar, this message translates to:
  /// **'تم مسح الخريطة المحفوظة'**
  String get mapCacheCleared;

  /// No description provided for @mapCacheClearFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر مسح الخريطة المحفوظة'**
  String get mapCacheClearFailed;

  /// No description provided for @notifDocsExpiringTitle.
  ///
  /// In ar, this message translates to:
  /// **'مستند على وشك الانتهاء'**
  String get notifDocsExpiringTitle;

  /// No description provided for @notifDocsExpiringBody.
  ///
  /// In ar, this message translates to:
  /// **'ينتهي {document} بتاريخ {date}. أرسل مستندات مجددة قبل ذلك لتواصل العمل دون انقطاع.'**
  String notifDocsExpiringBody(String document, String date);

  /// No description provided for @notifDocsExpiredTitle.
  ///
  /// In ar, this message translates to:
  /// **'انتهت صلاحية مستنداتك'**
  String get notifDocsExpiredTitle;

  /// No description provided for @notifDocsExpiredBody.
  ///
  /// In ar, this message translates to:
  /// **'تم تقييد حسابك ولا يمكنك الاتصال أو قبول رحلات جديدة حتى تُرسل مستندات مجددة وتتم الموافقة عليها. رحلاتك المقبولة سابقاً لا تتأثر.'**
  String get notifDocsExpiredBody;

  /// No description provided for @notifDocsRenewalSubmittedTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم إرسال مستندات التجديد'**
  String get notifDocsRenewalSubmittedTitle;

  /// No description provided for @notifDocsRenewalSubmittedBody.
  ///
  /// In ar, this message translates to:
  /// **'سيراجعها فريقنا وتصلك رسالة عند اتخاذ القرار.'**
  String get notifDocsRenewalSubmittedBody;

  /// No description provided for @documentKindContract.
  ///
  /// In ar, this message translates to:
  /// **'العقد'**
  String get documentKindContract;

  /// No description provided for @availabilityDocumentsExpired.
  ///
  /// In ar, this message translates to:
  /// **'انتهت صلاحية مستنداتك. أرسل مستندات مجددة لاستعادة الوصول.'**
  String get availabilityDocumentsExpired;

  /// No description provided for @applicationDocumentsRequiredTitle.
  ///
  /// In ar, this message translates to:
  /// **'ارفع مستنداتك'**
  String get applicationDocumentsRequiredTitle;

  /// No description provided for @applicationDocumentsRequiredBody.
  ///
  /// In ar, this message translates to:
  /// **'تم إنشاء حسابك لكنه ليس قيد المراجعة بعد. ارفع كل المستندات المطلوبة ثم أرسل طلبك. تستغرق المراجعة عادةً حتى 24 ساعة.'**
  String get applicationDocumentsRequiredBody;

  /// No description provided for @applicationRejectedTitle.
  ///
  /// In ar, this message translates to:
  /// **'تم رفض الطلب'**
  String get applicationRejectedTitle;

  /// No description provided for @applicationRejectedBody.
  ///
  /// In ar, this message translates to:
  /// **'تمت مراجعة طلبك كسائق ولم تتم الموافقة عليه. لا يمكنك استخدام ميزات السائق. تواصل مع الدعم إذا كنت ترى أن هذا خطأ.'**
  String get applicationRejectedBody;

  /// No description provided for @applicationRejectedReason.
  ///
  /// In ar, this message translates to:
  /// **'السبب: {reason}'**
  String applicationRejectedReason(String reason);

  /// No description provided for @documentsStillNeeded.
  ///
  /// In ar, this message translates to:
  /// **'ما زال مطلوباً: {documents}'**
  String documentsStillNeeded(String documents);

  /// No description provided for @submitApplication.
  ///
  /// In ar, this message translates to:
  /// **'إرسال للمراجعة'**
  String get submitApplication;

  /// No description provided for @documentsRequiredError.
  ///
  /// In ar, this message translates to:
  /// **'ارفع كل المستندات المطلوبة قبل إرسال طلبك.'**
  String get documentsRequiredError;

  /// No description provided for @fareEstimatedTitle.
  ///
  /// In ar, this message translates to:
  /// **'الأجرة التقديرية'**
  String get fareEstimatedTitle;

  /// No description provided for @fareBookedTitle.
  ///
  /// In ar, this message translates to:
  /// **'الأجرة التقديرية عند الطلب'**
  String get fareBookedTitle;

  /// No description provided for @fareDisclaimer.
  ///
  /// In ar, this message translates to:
  /// **'تقديرية، وتُدفع مباشرة إلى السائق. لا تتم معالجة أي مدفوعات داخل التطبيق.'**
  String get fareDisclaimer;

  /// No description provided for @fareNotSet.
  ///
  /// In ar, this message translates to:
  /// **'لم تُحدَّد أجرة تقديرية لهذا المسار بعد.'**
  String get fareNotSet;

  /// No description provided for @farePerSeat.
  ///
  /// In ar, this message translates to:
  /// **'للمقعد الواحد'**
  String get farePerSeat;

  /// No description provided for @fareSeatsLine.
  ///
  /// In ar, this message translates to:
  /// **'المقاعد × {count}'**
  String fareSeatsLine(int count);

  /// No description provided for @fareParcelLine.
  ///
  /// In ar, this message translates to:
  /// **'طرد {size}'**
  String fareParcelLine(String size);

  /// No description provided for @fareTotal.
  ///
  /// In ar, this message translates to:
  /// **'الإجمالي'**
  String get fareTotal;

  /// No description provided for @driverPricesTitle.
  ///
  /// In ar, this message translates to:
  /// **'أسعارك على هذا المسار'**
  String get driverPricesTitle;

  /// No description provided for @driverPricesBody.
  ///
  /// In ar, this message translates to:
  /// **'اترك السعر فارغًا لتعتمد السعر الافتراضي للمسار. يرى الركاب والتجار سعرك قبل الحجز.'**
  String get driverPricesBody;

  /// No description provided for @driverPriceSeat.
  ///
  /// In ar, this message translates to:
  /// **'سعر المقعد'**
  String get driverPriceSeat;

  /// No description provided for @driverPriceParcel.
  ///
  /// In ar, this message translates to:
  /// **'سعر الطرد {size}'**
  String driverPriceParcel(String size);

  /// No description provided for @driverPriceRangeHint.
  ///
  /// In ar, this message translates to:
  /// **'الافتراضي {price}. بين {min} و{max}.'**
  String driverPriceRangeHint(String price, String min, String max);

  /// No description provided for @driverPriceFixedHint.
  ///
  /// In ar, this message translates to:
  /// **'سعر ثابت: {price}'**
  String driverPriceFixedHint(String price);

  /// No description provided for @driverPriceInvalid.
  ///
  /// In ar, this message translates to:
  /// **'أدخل سعرًا بين {min} و{max}.'**
  String driverPriceInvalid(String min, String max);

  /// No description provided for @driverPriceOutOfRange.
  ///
  /// In ar, this message translates to:
  /// **'أحد أسعارك خارج النطاق المسموح على هذا المسار. اختر سعرًا داخل النطاق.'**
  String get driverPriceOutOfRange;

  /// No description provided for @driverPriceFixedError.
  ///
  /// In ar, this message translates to:
  /// **'سعر هذا المسار ثابت ولا يمكن تغييره.'**
  String get driverPriceFixedError;

  /// No description provided for @driverYourPrices.
  ///
  /// In ar, this message translates to:
  /// **'أسعارك: {prices}'**
  String driverYourPrices(String prices);

  /// No description provided for @driverPricesDefault.
  ///
  /// In ar, this message translates to:
  /// **'أسعارك: الأسعار الافتراضية للمسار'**
  String get driverPricesDefault;

  /// No description provided for @fareDriverTitle.
  ///
  /// In ar, this message translates to:
  /// **'سعر هذا السائق'**
  String get fareDriverTitle;

  /// No description provided for @notifDriverApproachingTitle.
  ///
  /// In ar, this message translates to:
  /// **'سائقك يقترب'**
  String get notifDriverApproachingTitle;

  /// No description provided for @notifDriverApproachingBody.
  ///
  /// In ar, this message translates to:
  /// **'سائقك قريب من نقطة الانطلاق. يرجى الاستعداد.'**
  String get notifDriverApproachingBody;

  /// No description provided for @notifDriverOnTheWayBody.
  ///
  /// In ar, this message translates to:
  /// **'انطلق سائقك إلى نقطة الانطلاق. يرجى الاستعداد.'**
  String get notifDriverOnTheWayBody;

  /// No description provided for @pushSettingTitle.
  ///
  /// In ar, this message translates to:
  /// **'الإشعارات الفورية'**
  String get pushSettingTitle;

  /// No description provided for @pushSettingSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'تنبيهات على هذا الهاتف للعروض والرحلات وتحديثات الحساب.'**
  String get pushSettingSubtitle;

  /// No description provided for @pushSettingBlocked.
  ///
  /// In ar, this message translates to:
  /// **'الإشعارات متوقفة لتطبيق درب في إعدادات الهاتف.'**
  String get pushSettingBlocked;

  /// No description provided for @pushSettingFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر حفظ إعداد الإشعارات. يرجى المحاولة مرة أخرى.'**
  String get pushSettingFailed;

  /// No description provided for @ratingPromptTitle.
  ///
  /// In ar, this message translates to:
  /// **'كيف كانت رحلتك؟'**
  String get ratingPromptTitle;

  /// No description provided for @ratingPromptBody.
  ///
  /// In ar, this message translates to:
  /// **'قيّم السائق من 1 إلى 5 نجوم. تقييمك سري: لا يرى السائق التقييم ولا من قدّمه.'**
  String get ratingPromptBody;

  /// No description provided for @ratingStarLabel.
  ///
  /// In ar, this message translates to:
  /// **'{count} نجوم'**
  String ratingStarLabel(int count);

  /// No description provided for @ratingSubmit.
  ///
  /// In ar, this message translates to:
  /// **'إرسال التقييم'**
  String get ratingSubmit;

  /// No description provided for @ratingThanks.
  ///
  /// In ar, this message translates to:
  /// **'شكرًا لتقييمك الرحلة.'**
  String get ratingThanks;

  /// No description provided for @ratingFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر إرسال التقييم. حاول مرة أخرى.'**
  String get ratingFailed;

  /// No description provided for @ratingAlreadyRated.
  ///
  /// In ar, this message translates to:
  /// **'لقد قيّمت هذه الرحلة من قبل.'**
  String get ratingAlreadyRated;

  /// No description provided for @renewalTitle.
  ///
  /// In ar, this message translates to:
  /// **'جدّد مستنداتك'**
  String get renewalTitle;

  /// No description provided for @renewalOpen.
  ///
  /// In ar, this message translates to:
  /// **'تجديد المستندات'**
  String get renewalOpen;

  /// No description provided for @renewalBannerTitle.
  ///
  /// In ar, this message translates to:
  /// **'انتهت صلاحية مستنداتك'**
  String get renewalBannerTitle;

  /// No description provided for @renewalBannerBody.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكنك الاتصال بالإنترنت أو قبول رحلات جديدة حتى ترسل مستنداتك المجدَّدة وتتم الموافقة عليها.'**
  String get renewalBannerBody;

  /// No description provided for @renewalBannerSubmittedTitle.
  ///
  /// In ar, this message translates to:
  /// **'التجديد قيد المراجعة'**
  String get renewalBannerSubmittedTitle;

  /// No description provided for @renewalBannerSubmittedBody.
  ///
  /// In ar, this message translates to:
  /// **'مستنداتك المجدَّدة بانتظار المراجعة.'**
  String get renewalBannerSubmittedBody;

  /// No description provided for @renewalIntro.
  ///
  /// In ar, this message translates to:
  /// **'ارفع صوراً واضحة أو ملفات PDF لرخصة القيادة وترخيص المركبة والتأمين المجدَّدة، ثم أرسلها للمراجعة. الرحلات التي قبلتها سابقاً لا تتأثر.'**
  String get renewalIntro;

  /// No description provided for @renewalUploaded.
  ///
  /// In ar, this message translates to:
  /// **'المستندات المرفوعة'**
  String get renewalUploaded;

  /// No description provided for @renewalNoDocuments.
  ///
  /// In ar, this message translates to:
  /// **'لم يتم رفع أي مستندات مجدَّدة بعد.'**
  String get renewalNoDocuments;

  /// No description provided for @renewalSubmit.
  ///
  /// In ar, this message translates to:
  /// **'إرسال للمراجعة'**
  String get renewalSubmit;

  /// No description provided for @renewalSubmittedTitle.
  ///
  /// In ar, this message translates to:
  /// **'بانتظار المراجعة'**
  String get renewalSubmittedTitle;

  /// No description provided for @renewalSubmittedBody.
  ///
  /// In ar, this message translates to:
  /// **'استلمنا مستنداتك المجدَّدة. سيتم إشعارك عندما يوافق فريق المراجعة عليها.'**
  String get renewalSubmittedBody;

  /// No description provided for @renewalDocumentsRequired.
  ///
  /// In ar, this message translates to:
  /// **'ارفع مستنداً مجدَّداً واحداً على الأقل قبل الإرسال.'**
  String get renewalDocumentsRequired;

  /// No description provided for @renewalStateConflict.
  ///
  /// In ar, this message translates to:
  /// **'تغيّرت حالة التجديد. اسحب للتحديث وحاول مرة أخرى.'**
  String get renewalStateConflict;

  /// No description provided for @renewalLoadError.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل حالة التجديد.'**
  String get renewalLoadError;

  /// No description provided for @renewalNothingToRenew.
  ///
  /// In ar, this message translates to:
  /// **'مستنداتك محدّثة. لا يوجد ما يتطلب التجديد.'**
  String get renewalNothingToRenew;

  /// No description provided for @renewalRejectedTitle.
  ///
  /// In ar, this message translates to:
  /// **'لم تتم الموافقة على التجديد'**
  String get renewalRejectedTitle;

  /// No description provided for @renewalRejectedBody.
  ///
  /// In ar, this message translates to:
  /// **'لم يوافق فريق المراجعة على مستنداتك المجددة. صحّح ما طلبوه وأرسلها مرة أخرى.'**
  String get renewalRejectedBody;

  /// No description provided for @renewalRejectedReason.
  ///
  /// In ar, this message translates to:
  /// **'السبب: {reason}'**
  String renewalRejectedReason(String reason);

  /// No description provided for @passengerNavHome.
  ///
  /// In ar, this message translates to:
  /// **'الرئيسية'**
  String get passengerNavHome;

  /// No description provided for @passengerNavTrips.
  ///
  /// In ar, this message translates to:
  /// **'رحلاتي'**
  String get passengerNavTrips;

  /// No description provided for @passengerNavMaps.
  ///
  /// In ar, this message translates to:
  /// **'الخرائط'**
  String get passengerNavMaps;

  /// No description provided for @passengerNavSettings.
  ///
  /// In ar, this message translates to:
  /// **'الإعدادات'**
  String get passengerNavSettings;

  /// No description provided for @passengerGreetingMorning.
  ///
  /// In ar, this message translates to:
  /// **'صباح الخير'**
  String get passengerGreetingMorning;

  /// No description provided for @passengerGreetingAfternoon.
  ///
  /// In ar, this message translates to:
  /// **'نهارك سعيد'**
  String get passengerGreetingAfternoon;

  /// No description provided for @passengerGreetingEvening.
  ///
  /// In ar, this message translates to:
  /// **'مساء الخير'**
  String get passengerGreetingEvening;

  /// No description provided for @passengerPlanTripTitle.
  ///
  /// In ar, this message translates to:
  /// **'خطّط لرحلتك القادمة'**
  String get passengerPlanTripTitle;

  /// No description provided for @passengerPlanTripBody.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن رحلة، شارك الطريق، وصل إلى وجهتك'**
  String get passengerPlanTripBody;

  /// No description provided for @passengerSearchRide.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن رحلة'**
  String get passengerSearchRide;

  /// No description provided for @passengerUpcomingTrips.
  ///
  /// In ar, this message translates to:
  /// **'الرحلات القادمة'**
  String get passengerUpcomingTrips;

  /// No description provided for @passengerNoUpcomingTitle.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد رحلات قادمة'**
  String get passengerNoUpcomingTitle;

  /// No description provided for @passengerNoUpcomingBody.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن رحلة جديدة واحجز مقعدك.'**
  String get passengerNoUpcomingBody;

  /// No description provided for @passengerWeekStrip.
  ///
  /// In ar, this message translates to:
  /// **'هذا الأسبوع'**
  String get passengerWeekStrip;

  /// No description provided for @tripsStatTotal.
  ///
  /// In ar, this message translates to:
  /// **'الإجمالي'**
  String get tripsStatTotal;

  /// No description provided for @tripsStatActive.
  ///
  /// In ar, this message translates to:
  /// **'نشطة'**
  String get tripsStatActive;

  /// No description provided for @tripsStatUpcoming.
  ///
  /// In ar, this message translates to:
  /// **'قادمة'**
  String get tripsStatUpcoming;

  /// No description provided for @tripsStatPast.
  ///
  /// In ar, this message translates to:
  /// **'سابقة'**
  String get tripsStatPast;

  /// No description provided for @tripsFilterAll.
  ///
  /// In ar, this message translates to:
  /// **'الكل'**
  String get tripsFilterAll;

  /// No description provided for @communityReportsTitle.
  ///
  /// In ar, this message translates to:
  /// **'بلاغات المجتمع'**
  String get communityReportsTitle;

  /// No description provided for @communityReportsNote.
  ///
  /// In ar, this message translates to:
  /// **'بلاغات غير مؤكدة من المستخدمين. التصويت رأي المجتمع فقط ولا يغيّر حالة الحواجز أو الطرق.'**
  String get communityReportsNote;

  /// No description provided for @communityReportsAdd.
  ///
  /// In ar, this message translates to:
  /// **'إضافة بلاغ'**
  String get communityReportsAdd;

  /// No description provided for @communityReportsEmpty.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد بلاغات حالياً.'**
  String get communityReportsEmpty;

  /// No description provided for @communityReportsLoadFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تحميل البلاغات.'**
  String get communityReportsLoadFailed;

  /// No description provided for @communityFilterAll.
  ///
  /// In ar, this message translates to:
  /// **'الكل'**
  String get communityFilterAll;

  /// No description provided for @communityGroupRoad.
  ///
  /// In ar, this message translates to:
  /// **'الطرق'**
  String get communityGroupRoad;

  /// No description provided for @communityGroupCheckpoint.
  ///
  /// In ar, this message translates to:
  /// **'الحواجز'**
  String get communityGroupCheckpoint;

  /// No description provided for @communityGroupSafety.
  ///
  /// In ar, this message translates to:
  /// **'السلامة'**
  String get communityGroupSafety;

  /// No description provided for @communityGroupOther.
  ///
  /// In ar, this message translates to:
  /// **'أخرى'**
  String get communityGroupOther;

  /// No description provided for @communitySortRecent.
  ///
  /// In ar, this message translates to:
  /// **'الأحدث'**
  String get communitySortRecent;

  /// No description provided for @communitySortTop.
  ///
  /// In ar, this message translates to:
  /// **'الأكثر تأييداً'**
  String get communitySortTop;

  /// No description provided for @communitySortDisputed.
  ///
  /// In ar, this message translates to:
  /// **'المتنازع عليها'**
  String get communitySortDisputed;

  /// No description provided for @communityBadgeRecent.
  ///
  /// In ar, this message translates to:
  /// **'حديث'**
  String get communityBadgeRecent;

  /// No description provided for @communityBadgeDisputed.
  ///
  /// In ar, this message translates to:
  /// **'محل خلاف'**
  String get communityBadgeDisputed;

  /// No description provided for @communityBadgeWellSupported.
  ///
  /// In ar, this message translates to:
  /// **'مدعوم من المجتمع'**
  String get communityBadgeWellSupported;

  /// No description provided for @communityAwaitingReview.
  ///
  /// In ar, this message translates to:
  /// **'بانتظار تحقق الإدارة'**
  String get communityAwaitingReview;

  /// No description provided for @communityUnverifiedPrefix.
  ///
  /// In ar, this message translates to:
  /// **'بلاغ غير مؤكد: '**
  String get communityUnverifiedPrefix;

  /// No description provided for @communityCategoryRoadClosure.
  ///
  /// In ar, this message translates to:
  /// **'إغلاق طريق'**
  String get communityCategoryRoadClosure;

  /// No description provided for @communityCategoryRoadReopened.
  ///
  /// In ar, this message translates to:
  /// **'إعادة فتح طريق'**
  String get communityCategoryRoadReopened;

  /// No description provided for @communityCategoryRoadCongestion.
  ///
  /// In ar, this message translates to:
  /// **'ازدحام'**
  String get communityCategoryRoadCongestion;

  /// No description provided for @communityCategoryCheckpointOpenMarkedClosed.
  ///
  /// In ar, this message translates to:
  /// **'حاجز مفتوح لكنه معروض مغلقاً'**
  String get communityCategoryCheckpointOpenMarkedClosed;

  /// No description provided for @communityCategoryCheckpointClosedMarkedOpen.
  ///
  /// In ar, this message translates to:
  /// **'حاجز مغلق لكنه معروض مفتوحاً'**
  String get communityCategoryCheckpointClosedMarkedOpen;

  /// No description provided for @communityCategoryCheckpointOutdated.
  ///
  /// In ar, this message translates to:
  /// **'معلومات حاجز قديمة'**
  String get communityCategoryCheckpointOutdated;

  /// No description provided for @communityCategorySafetyAlert.
  ///
  /// In ar, this message translates to:
  /// **'تنبيه سلامة أو أمن'**
  String get communityCategorySafetyAlert;

  /// No description provided for @communityCategoryDriverReport.
  ///
  /// In ar, this message translates to:
  /// **'ملاحظة عن رحلة أو سائق'**
  String get communityCategoryDriverReport;

  /// No description provided for @communityCategoryIncorrectMapInfo.
  ///
  /// In ar, this message translates to:
  /// **'معلومة خاطئة على الخريطة'**
  String get communityCategoryIncorrectMapInfo;

  /// No description provided for @communityCategoryOther.
  ///
  /// In ar, this message translates to:
  /// **'أخرى'**
  String get communityCategoryOther;

  /// No description provided for @communitySheetTitle.
  ///
  /// In ar, this message translates to:
  /// **'إضافة بلاغ'**
  String get communitySheetTitle;

  /// No description provided for @communitySensitiveNote.
  ///
  /// In ar, this message translates to:
  /// **'صف ما رأيته فقط. لا تذكر اسم شخص أو رقم مركبة أو أي بيانات شخصية. سيظهر البلاغ للآخرين كبلاغ غير مؤكد.'**
  String get communitySensitiveNote;

  /// No description provided for @communityFieldCategory.
  ///
  /// In ar, this message translates to:
  /// **'نوع البلاغ'**
  String get communityFieldCategory;

  /// No description provided for @communityFieldDescription.
  ///
  /// In ar, this message translates to:
  /// **'ماذا حدث؟'**
  String get communityFieldDescription;

  /// No description provided for @communityFieldLocation.
  ///
  /// In ar, this message translates to:
  /// **'اسم المكان'**
  String get communityFieldLocation;

  /// No description provided for @communityAttachLocation.
  ///
  /// In ar, this message translates to:
  /// **'إرفاق موقعي الحالي على الخريطة'**
  String get communityAttachLocation;

  /// No description provided for @communitySubmit.
  ///
  /// In ar, this message translates to:
  /// **'إرسال البلاغ'**
  String get communitySubmit;

  /// No description provided for @communitySubmitted.
  ///
  /// In ar, this message translates to:
  /// **'تم نشر البلاغ.'**
  String get communitySubmitted;

  /// No description provided for @communitySubmitFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر إرسال البلاغ. حاول مرة أخرى.'**
  String get communitySubmitFailed;

  /// No description provided for @communityTooMany.
  ///
  /// In ar, this message translates to:
  /// **'أرسلت بلاغات كثيرة. حاول لاحقاً.'**
  String get communityTooMany;

  /// No description provided for @communityUpvote.
  ///
  /// In ar, this message translates to:
  /// **'أؤيد البلاغ'**
  String get communityUpvote;

  /// No description provided for @communityDownvote.
  ///
  /// In ar, this message translates to:
  /// **'لا أؤيد البلاغ'**
  String get communityDownvote;

  /// No description provided for @communityVoteFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر تسجيل صوتك.'**
  String get communityVoteFailed;

  /// No description provided for @communityOwnReportVote.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكنك التصويت على بلاغك.'**
  String get communityOwnReportVote;

  /// No description provided for @communityFlag.
  ///
  /// In ar, this message translates to:
  /// **'الإبلاغ عن بلاغ مضلّل'**
  String get communityFlag;

  /// No description provided for @communityFlagged.
  ///
  /// In ar, this message translates to:
  /// **'شكراً. سيراجع فريقنا البلاغ.'**
  String get communityFlagged;

  /// No description provided for @communityFlagFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر إرسال الإشعار.'**
  String get communityFlagFailed;

  /// No description provided for @communityJustNow.
  ///
  /// In ar, this message translates to:
  /// **'الآن'**
  String get communityJustNow;

  /// No description provided for @communityMinutesAgo.
  ///
  /// In ar, this message translates to:
  /// **'{count, plural, =1{قبل دقيقة} =2{قبل دقيقتين} few{قبل {count} دقائق} other{قبل {count} دقيقة}}'**
  String communityMinutesAgo(int count);

  /// No description provided for @communityHoursAgo.
  ///
  /// In ar, this message translates to:
  /// **'{count, plural, =1{قبل ساعة} =2{قبل ساعتين} few{قبل {count} ساعات} other{قبل {count} ساعة}}'**
  String communityHoursAgo(int count);

  /// No description provided for @communityDaysAgo.
  ///
  /// In ar, this message translates to:
  /// **'{count, plural, =1{قبل يوم} =2{قبل يومين} few{قبل {count} أيام} other{قبل {count} يوماً}}'**
  String communityDaysAgo(int count);

  /// No description provided for @communityVoteCounts.
  ///
  /// In ar, this message translates to:
  /// **'{up} تأييد، {down} اعتراض'**
  String communityVoteCounts(int up, int down);

  /// No description provided for @mapStraightLineNote.
  ///
  /// In ar, this message translates to:
  /// **'تعذر حساب الطريق: يظهر خط مستقيم'**
  String get mapStraightLineNote;

  /// No description provided for @routeChangedClosed.
  ///
  /// In ar, this message translates to:
  /// **'تم تغيير المسار: حاجز {names} مغلق'**
  String routeChangedClosed(String names);

  /// No description provided for @routeChangedClosedExtra.
  ///
  /// In ar, this message translates to:
  /// **'تم تغيير المسار: حاجز {names} مغلق (أطول بحوالي {minutes} دقيقة)'**
  String routeChangedClosedExtra(String names, int minutes);

  /// No description provided for @routeChangedCongested.
  ///
  /// In ar, this message translates to:
  /// **'تم تغيير المسار لتجنب الازدحام عند {names}'**
  String routeChangedCongested(String names);

  /// No description provided for @routeAllClosed.
  ///
  /// In ar, this message translates to:
  /// **'كل المسارات المعروفة تمر بحاجز مغلق: {names}. تأكد قبل الانطلاق.'**
  String routeAllClosed(String names);

  /// No description provided for @routeCongestedWarning.
  ///
  /// In ar, this message translates to:
  /// **'مسارك يمر بحاجز مزدحم: {names}. لم يتوفر بديل معقول.'**
  String routeCongestedWarning(String names);

  /// No description provided for @routeCheckUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'تعذّر فحص هذا المسار مقابل حالة الحواجز'**
  String get routeCheckUnavailable;

  /// No description provided for @routeStatusStale.
  ///
  /// In ar, this message translates to:
  /// **'حالة الحواجز قديمة، لذلك لم يتم تغيير المسار'**
  String get routeStatusStale;

  /// No description provided for @routePositionApproximate.
  ///
  /// In ar, this message translates to:
  /// **'موقع أحد الحواجز على هذا المسار تقريبي'**
  String get routePositionApproximate;

  /// No description provided for @routeCheckpointOnRoute.
  ///
  /// In ar, this message translates to:
  /// **'على مسارك: {name}'**
  String routeCheckpointOnRoute(String name);

  /// No description provided for @mapCheckpointsUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'بيانات الحواجز غير متوفرة'**
  String get mapCheckpointsUnavailable;

  /// No description provided for @mapCheckpointsLoadFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذر تحميل الحواجز'**
  String get mapCheckpointsLoadFailed;

  /// No description provided for @checkpointOfficialUnknown.
  ///
  /// In ar, this message translates to:
  /// **'الحالة الرسمية: غير منشورة'**
  String get checkpointOfficialUnknown;

  /// No description provided for @checkpointEnteringChanged.
  ///
  /// In ar, this message translates to:
  /// **'دخول: آخر تغيير {time}'**
  String checkpointEnteringChanged(String time);

  /// No description provided for @checkpointLeavingChanged.
  ///
  /// In ar, this message translates to:
  /// **'خروج: آخر تغيير {time}'**
  String checkpointLeavingChanged(String time);

  /// No description provided for @checkpointCommunitySays.
  ///
  /// In ar, this message translates to:
  /// **'المجتمع يقول: {status} (غير مؤكد)'**
  String checkpointCommunitySays(String status);

  /// No description provided for @communityStatusOpen.
  ///
  /// In ar, this message translates to:
  /// **'مفتوح'**
  String get communityStatusOpen;

  /// No description provided for @communityStatusClosed.
  ///
  /// In ar, this message translates to:
  /// **'مغلق'**
  String get communityStatusClosed;

  /// No description provided for @communityStatusOutdated.
  ///
  /// In ar, this message translates to:
  /// **'قد تكون الحالة قديمة'**
  String get communityStatusOutdated;

  /// No description provided for @checkpointPositionOsm.
  ///
  /// In ar, this message translates to:
  /// **'الموقع: © مساهمو OpenStreetMap (ODbL)'**
  String get checkpointPositionOsm;

  /// No description provided for @checkpointPositionApproximate.
  ///
  /// In ar, this message translates to:
  /// **'الموقع تقريبي وقد يكون عند بوابة قريبة'**
  String get checkpointPositionApproximate;

  /// No description provided for @checkpointsUnplacedTitle.
  ///
  /// In ar, this message translates to:
  /// **'حواجز بلا موقع على الخريطة'**
  String get checkpointsUnplacedTitle;

  /// No description provided for @checkpointsUnplacedBody.
  ///
  /// In ar, this message translates to:
  /// **'يذكرها المزود، لكن لا يوجد موقع موثوق لها لذلك لا تظهر على الخريطة.'**
  String get checkpointsUnplacedBody;

  /// No description provided for @communityPickLocation.
  ///
  /// In ar, this message translates to:
  /// **'اضغط على الخريطة لتحديد المكان'**
  String get communityPickLocation;

  /// No description provided for @communityUseMyLocation.
  ///
  /// In ar, this message translates to:
  /// **'استخدام موقعي الحالي'**
  String get communityUseMyLocation;

  /// No description provided for @communityLocationRequired.
  ///
  /// In ar, this message translates to:
  /// **'حدد المكان على الخريطة لهذا النوع من البلاغات.'**
  String get communityLocationRequired;

  /// No description provided for @communityLocationOptional.
  ///
  /// In ar, this message translates to:
  /// **'الموقع (اختياري)'**
  String get communityLocationOptional;

  /// No description provided for @communityLocationOutside.
  ///
  /// In ar, this message translates to:
  /// **'هذا المكان خارج منطقة خدمة درب.'**
  String get communityLocationOutside;

  /// No description provided for @communityLocationUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'موقعك الحالي غير متاح.'**
  String get communityLocationUnavailable;

  /// No description provided for @communityLocationSet.
  ///
  /// In ar, this message translates to:
  /// **'تم تحديد المكان على الخريطة'**
  String get communityLocationSet;

  /// No description provided for @communityClearLocation.
  ///
  /// In ar, this message translates to:
  /// **'إزالة المكان'**
  String get communityClearLocation;

  /// No description provided for @mapRouteLabel.
  ///
  /// In ar, this message translates to:
  /// **'المسار'**
  String get mapRouteLabel;

  /// No description provided for @mapDriverLocationFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذر تحديث موقع السائق حاليًا.'**
  String get mapDriverLocationFailed;

  /// No description provided for @mapWaitingDriverLocation.
  ///
  /// In ar, this message translates to:
  /// **'بانتظار آخر موقع مسجل للسائق.'**
  String get mapWaitingDriverLocation;

  /// No description provided for @mapTimeRemaining.
  ///
  /// In ar, this message translates to:
  /// **'الوقت المتبقي: {duration}'**
  String mapTimeRemaining(String duration);

  /// No description provided for @mapRouteFollowsDriver.
  ///
  /// In ar, this message translates to:
  /// **'المسار يتحدث حسب موقع السائق الحالي'**
  String get mapRouteFollowsDriver;

  /// No description provided for @mapRouteIsPlanned.
  ///
  /// In ar, this message translates to:
  /// **'المسار المعروض هو المسار المحدد للرحلة'**
  String get mapRouteIsPlanned;

  /// No description provided for @mapYourTripRoute.
  ///
  /// In ar, this message translates to:
  /// **'مسار رحلتك'**
  String get mapYourTripRoute;

  /// No description provided for @mapPickupPoint.
  ///
  /// In ar, this message translates to:
  /// **'نقطة الالتقاء'**
  String get mapPickupPoint;

  /// No description provided for @mapZoomIn.
  ///
  /// In ar, this message translates to:
  /// **'تكبير الخريطة'**
  String get mapZoomIn;

  /// No description provided for @mapZoomOut.
  ///
  /// In ar, this message translates to:
  /// **'تصغير الخريطة'**
  String get mapZoomOut;

  /// No description provided for @mapShowRoute.
  ///
  /// In ar, this message translates to:
  /// **'إظهار المسار'**
  String get mapShowRoute;

  /// No description provided for @mapMarkerDetails.
  ///
  /// In ar, this message translates to:
  /// **'التفاصيل'**
  String get mapMarkerDetails;

  /// No description provided for @mapMyLocation.
  ///
  /// In ar, this message translates to:
  /// **'موقعي'**
  String get mapMyLocation;

  /// No description provided for @mapYouAreHere.
  ///
  /// In ar, this message translates to:
  /// **'أنت هنا'**
  String get mapYouAreHere;

  /// No description provided for @mapLocationOutsideArea.
  ///
  /// In ar, this message translates to:
  /// **'موقعك خارج منطقة خدمة درب.'**
  String get mapLocationOutsideArea;

  /// No description provided for @driverArrivalTitle.
  ///
  /// In ar, this message translates to:
  /// **'السائق في الطريق إليك'**
  String get driverArrivalTitle;

  /// No description provided for @driverArrivalSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'المسافة والوقت المتبقي للوصول إلى نقطة الالتقاء'**
  String get driverArrivalSubtitle;

  /// No description provided for @driverArrivalDistance.
  ///
  /// In ar, this message translates to:
  /// **'المسافة المتبقية'**
  String get driverArrivalDistance;

  /// No description provided for @driverArrivalEta.
  ///
  /// In ar, this message translates to:
  /// **'وقت الوصول التقريبي'**
  String get driverArrivalEta;

  /// No description provided for @driverArrivalDisclaimer.
  ///
  /// In ar, this message translates to:
  /// **'الوقت تقديري وقد يتغير حسب حركة الطريق.'**
  String get driverArrivalDisclaimer;

  /// No description provided for @distanceKmValue.
  ///
  /// In ar, this message translates to:
  /// **'{km} كم'**
  String distanceKmValue(String km);

  /// No description provided for @distanceMetersValue.
  ///
  /// In ar, this message translates to:
  /// **'{meters} م'**
  String distanceMetersValue(int meters);

  /// No description provided for @durationMinutesValue.
  ///
  /// In ar, this message translates to:
  /// **'{minutes} د'**
  String durationMinutesValue(int minutes);

  /// No description provided for @durationHoursValue.
  ///
  /// In ar, this message translates to:
  /// **'{hours} س'**
  String durationHoursValue(int hours);

  /// No description provided for @durationHoursMinutesValue.
  ///
  /// In ar, this message translates to:
  /// **'{hours} س {minutes} د'**
  String durationHoursMinutesValue(int hours, int minutes);

  /// No description provided for @tripInProgress.
  ///
  /// In ar, this message translates to:
  /// **'الرحلة جارية'**
  String get tripInProgress;

  /// No description provided for @tripLiveTracking.
  ///
  /// In ar, this message translates to:
  /// **'تتبع مباشر'**
  String get tripLiveTracking;

  /// No description provided for @tripWaitingForLocation.
  ///
  /// In ar, this message translates to:
  /// **'بانتظار الموقع'**
  String get tripWaitingForLocation;

  /// No description provided for @tripStartLabel.
  ///
  /// In ar, this message translates to:
  /// **'البداية'**
  String get tripStartLabel;

  /// No description provided for @tripArrivalLabel.
  ///
  /// In ar, this message translates to:
  /// **'الوصول'**
  String get tripArrivalLabel;

  /// No description provided for @tripLocationLabel.
  ///
  /// In ar, this message translates to:
  /// **'الموقع'**
  String get tripLocationLabel;

  /// No description provided for @tripLive.
  ///
  /// In ar, this message translates to:
  /// **'مباشر'**
  String get tripLive;

  /// No description provided for @tripEstimatedArrival.
  ///
  /// In ar, this message translates to:
  /// **'الوصول المتوقع'**
  String get tripEstimatedArrival;

  /// No description provided for @tripDistance.
  ///
  /// In ar, this message translates to:
  /// **'المسافة'**
  String get tripDistance;

  /// No description provided for @tripRemainingTime.
  ///
  /// In ar, this message translates to:
  /// **'الوقت المتبقي'**
  String get tripRemainingTime;

  /// No description provided for @tripCalculatingRoute.
  ///
  /// In ar, this message translates to:
  /// **'جاري حساب المسار...'**
  String get tripCalculatingRoute;

  /// No description provided for @tripVehicleLocation.
  ///
  /// In ar, this message translates to:
  /// **'موقع المركبة'**
  String get tripVehicleLocation;

  /// No description provided for @tripRefreshLocation.
  ///
  /// In ar, this message translates to:
  /// **'تحديث الموقع'**
  String get tripRefreshLocation;

  /// No description provided for @driverFailDeliveryAction.
  ///
  /// In ar, this message translates to:
  /// **'تسجيل فشل التوصيل'**
  String get driverFailDeliveryAction;

  /// No description provided for @driverFailDeliveryTitle.
  ///
  /// In ar, this message translates to:
  /// **'فشل التوصيل'**
  String get driverFailDeliveryTitle;

  /// No description provided for @driverFailDeliveryMessage.
  ///
  /// In ar, this message translates to:
  /// **'هل تريد تسجيل الرحلة كتوصيل فاشل؟'**
  String get driverFailDeliveryMessage;

  /// No description provided for @driverCancelTripTitle.
  ///
  /// In ar, this message translates to:
  /// **'إلغاء الرحلة'**
  String get driverCancelTripTitle;

  /// No description provided for @driverCancelTripMessage.
  ///
  /// In ar, this message translates to:
  /// **'هل أنت متأكد من إلغاء الرحلة الحالية؟'**
  String get driverCancelTripMessage;

  /// No description provided for @merchantOrderMapTitle.
  ///
  /// In ar, this message translates to:
  /// **'مسار الطلب'**
  String get merchantOrderMapTitle;

  /// No description provided for @driverPhoneLabel.
  ///
  /// In ar, this message translates to:
  /// **'هاتف السائق'**
  String get driverPhoneLabel;

  /// No description provided for @callDriver.
  ///
  /// In ar, this message translates to:
  /// **'اتصل بالسائق'**
  String get callDriver;

  /// No description provided for @callDriverUnavailable.
  ///
  /// In ar, this message translates to:
  /// **'لا يمكن إجراء المكالمة من هذا الجهاز. اتصل بالرقم الظاهر.'**
  String get callDriverUnavailable;

  /// No description provided for @routePlacePickupLabel.
  ///
  /// In ar, this message translates to:
  /// **'قرية أو بلدة الالتقاط'**
  String get routePlacePickupLabel;

  /// No description provided for @routePlaceDropoffLabel.
  ///
  /// In ar, this message translates to:
  /// **'قرية أو بلدة التسليم'**
  String get routePlaceDropoffLabel;

  /// No description provided for @routePlacePickupHint.
  ///
  /// In ar, this message translates to:
  /// **'اختر مكان الالتقاط'**
  String get routePlacePickupHint;

  /// No description provided for @routePlaceDropoffHint.
  ///
  /// In ar, this message translates to:
  /// **'اختر مكان التسليم'**
  String get routePlaceDropoffHint;

  /// No description provided for @routePlaceChooseRouteFirst.
  ///
  /// In ar, this message translates to:
  /// **'اختر المسار أولاً'**
  String get routePlaceChooseRouteFirst;

  /// No description provided for @routePlaceRequired.
  ///
  /// In ar, this message translates to:
  /// **'اختر مكاناً للمتابعة.'**
  String get routePlaceRequired;

  /// No description provided for @routePlaceSearchHint.
  ///
  /// In ar, this message translates to:
  /// **'ابحث عن قرية أو بلدة'**
  String get routePlaceSearchHint;

  /// No description provided for @routePlaceNoResults.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد نتائج مطابقة.'**
  String get routePlaceNoResults;

  /// No description provided for @routePlacesLoading.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ تحميل الأماكن…'**
  String get routePlacesLoading;

  /// No description provided for @routePlacesLoadFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذر تحميل الأماكن.'**
  String get routePlacesLoadFailed;

  /// No description provided for @routePlacesEmpty.
  ///
  /// In ar, this message translates to:
  /// **'لا توجد أماكن لهذه المدينة بعد.'**
  String get routePlacesEmpty;

  /// No description provided for @routePlaceMoreDetailsLabel.
  ///
  /// In ar, this message translates to:
  /// **'تفاصيل إضافية (اختياري)'**
  String get routePlaceMoreDetailsLabel;

  /// No description provided for @routePlacePickupDetailsHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: أمام البوابة الرئيسية'**
  String get routePlacePickupDetailsHint;

  /// No description provided for @routePlaceDropoffDetailsHint.
  ///
  /// In ar, this message translates to:
  /// **'مثال: بجانب الصيدلية'**
  String get routePlaceDropoffDetailsHint;

  /// No description provided for @routePlaceDetailsHelper.
  ///
  /// In ar, this message translates to:
  /// **'اختياري: ساعد السائق على إيجاد المكان بدقة.'**
  String get routePlaceDetailsHelper;

  /// No description provided for @routePlaceSavedChoice.
  ///
  /// In ar, this message translates to:
  /// **'مكان مختار من القائمة'**
  String get routePlaceSavedChoice;

  /// No description provided for @placeCategoryCafe.
  ///
  /// In ar, this message translates to:
  /// **'مقهى'**
  String get placeCategoryCafe;

  /// No description provided for @placeCategoryRestaurant.
  ///
  /// In ar, this message translates to:
  /// **'مطعم'**
  String get placeCategoryRestaurant;

  /// No description provided for @placeCategoryFuel.
  ///
  /// In ar, this message translates to:
  /// **'محطة وقود'**
  String get placeCategoryFuel;

  /// No description provided for @placeCategoryRestStop.
  ///
  /// In ar, this message translates to:
  /// **'استراحة / دورة مياه'**
  String get placeCategoryRestStop;

  /// No description provided for @placeCategoryPharmacy.
  ///
  /// In ar, this message translates to:
  /// **'صيدلية'**
  String get placeCategoryPharmacy;

  /// No description provided for @placeCategoryHospital.
  ///
  /// In ar, this message translates to:
  /// **'مستشفى'**
  String get placeCategoryHospital;

  /// No description provided for @placeCategoryClinic.
  ///
  /// In ar, this message translates to:
  /// **'عيادة'**
  String get placeCategoryClinic;

  /// No description provided for @placeCategorySupermarket.
  ///
  /// In ar, this message translates to:
  /// **'سوبرماركت'**
  String get placeCategorySupermarket;

  /// No description provided for @placeCategoryAtm.
  ///
  /// In ar, this message translates to:
  /// **'صراف / بنك'**
  String get placeCategoryAtm;

  /// No description provided for @placeCategoryMosque.
  ///
  /// In ar, this message translates to:
  /// **'مسجد'**
  String get placeCategoryMosque;

  /// No description provided for @placeCategoryCarRepair.
  ///
  /// In ar, this message translates to:
  /// **'ورشة سيارات'**
  String get placeCategoryCarRepair;

  /// No description provided for @placeCategoryEvCharging.
  ///
  /// In ar, this message translates to:
  /// **'شحن كهربائي'**
  String get placeCategoryEvCharging;

  /// No description provided for @placeClusterLabel.
  ///
  /// In ar, this message translates to:
  /// **'{count} × {category} — قرّب الخريطة لرؤيتها'**
  String placeClusterLabel(int count, String category);

  /// No description provided for @placesLoading.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ تحميل الأماكن…'**
  String get placesLoading;

  /// No description provided for @placesLoadFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذر تحميل الأماكن'**
  String get placesLoadFailed;

  /// No description provided for @placesNoneHere.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد {category} في هذه المنطقة'**
  String placesNoneHere(String category);

  /// No description provided for @placesTruncated.
  ///
  /// In ar, this message translates to:
  /// **'تظهر الأقرب فقط — قرّب الخريطة لرؤية المزيد'**
  String get placesTruncated;

  /// No description provided for @placeDistanceMetres.
  ///
  /// In ar, this message translates to:
  /// **'{value} م'**
  String placeDistanceMetres(int value);

  /// No description provided for @placeDistanceKm.
  ///
  /// In ar, this message translates to:
  /// **'{value} كم'**
  String placeDistanceKm(String value);

  /// No description provided for @placeOpenNow.
  ///
  /// In ar, this message translates to:
  /// **'مفتوح الآن'**
  String get placeOpenNow;

  /// No description provided for @placeClosedNow.
  ///
  /// In ar, this message translates to:
  /// **'مغلق الآن'**
  String get placeClosedNow;

  /// No description provided for @placeNavigate.
  ///
  /// In ar, this message translates to:
  /// **'الاتجاهات'**
  String get placeNavigate;

  /// No description provided for @placeNavigateFailed.
  ///
  /// In ar, this message translates to:
  /// **'لا يوجد تطبيق خرائط لفتح الاتجاهات'**
  String get placeNavigateFailed;

  /// No description provided for @placeShowOnMap.
  ///
  /// In ar, this message translates to:
  /// **'عرض على الخريطة'**
  String get placeShowOnMap;

  /// No description provided for @placeCall.
  ///
  /// In ar, this message translates to:
  /// **'اتصال'**
  String get placeCall;

  /// No description provided for @placeReport.
  ///
  /// In ar, this message translates to:
  /// **'الإبلاغ عن خطأ'**
  String get placeReport;

  /// No description provided for @placeReportTitle.
  ///
  /// In ar, this message translates to:
  /// **'ما المشكلة في هذا المكان؟'**
  String get placeReportTitle;

  /// No description provided for @placeReportClosed.
  ///
  /// In ar, this message translates to:
  /// **'مغلق نهائيًا'**
  String get placeReportClosed;

  /// No description provided for @placeReportWrongLocation.
  ///
  /// In ar, this message translates to:
  /// **'الموقع خاطئ'**
  String get placeReportWrongLocation;

  /// No description provided for @placeReportWrongInfo.
  ///
  /// In ar, this message translates to:
  /// **'معلومات خاطئة'**
  String get placeReportWrongInfo;

  /// No description provided for @placeReportNotExists.
  ///
  /// In ar, this message translates to:
  /// **'غير موجود'**
  String get placeReportNotExists;

  /// No description provided for @placeReportSent.
  ///
  /// In ar, this message translates to:
  /// **'شكرًا، سنراجع البلاغ'**
  String get placeReportSent;

  /// No description provided for @placeReportFailed.
  ///
  /// In ar, this message translates to:
  /// **'تعذر إرسال البلاغ. حاول لاحقًا'**
  String get placeReportFailed;

  /// No description provided for @placeDataAttribution.
  ///
  /// In ar, this message translates to:
  /// **'بيانات الأماكن © مساهمو OpenStreetMap'**
  String get placeDataAttribution;

  /// No description provided for @placeSuggestCafe.
  ///
  /// In ar, this message translates to:
  /// **'يوجد مقهى على طريقك — قهوة؟'**
  String get placeSuggestCafe;

  /// No description provided for @placeSuggestCafeNamed.
  ///
  /// In ar, this message translates to:
  /// **'على طريقك مقهى {name} — قهوة؟'**
  String placeSuggestCafeNamed(String name);

  /// No description provided for @placeSuggestRestaurant.
  ///
  /// In ar, this message translates to:
  /// **'يوجد مطعم على طريقك'**
  String get placeSuggestRestaurant;

  /// No description provided for @placeSuggestRestaurantNamed.
  ///
  /// In ar, this message translates to:
  /// **'على طريقك مطعم {name}'**
  String placeSuggestRestaurantNamed(String name);

  /// No description provided for @placeSuggestFuel.
  ///
  /// In ar, this message translates to:
  /// **'توجد محطة وقود على طريقك'**
  String get placeSuggestFuel;

  /// No description provided for @placeSuggestFuelNamed.
  ///
  /// In ar, this message translates to:
  /// **'على طريقك محطة وقود {name}'**
  String placeSuggestFuelNamed(String name);

  /// No description provided for @placeSuggestRestStop.
  ///
  /// In ar, this message translates to:
  /// **'توجد استراحة على طريقك'**
  String get placeSuggestRestStop;

  /// No description provided for @placeSuggestRestStopNamed.
  ///
  /// In ar, this message translates to:
  /// **'على طريقك استراحة {name}'**
  String placeSuggestRestStopNamed(String name);

  /// No description provided for @placeSuggestGeneric.
  ///
  /// In ar, this message translates to:
  /// **'يوجد {category} على طريقك'**
  String placeSuggestGeneric(String category);

  /// No description provided for @placeSuggestGenericNamed.
  ///
  /// In ar, this message translates to:
  /// **'على طريقك {category}: {name}'**
  String placeSuggestGenericNamed(String category, String name);

  /// No description provided for @placeSuggestNever.
  ///
  /// In ar, this message translates to:
  /// **'لا تقترح هذا مجددًا'**
  String get placeSuggestNever;

  /// No description provided for @placeSuggestDismiss.
  ///
  /// In ar, this message translates to:
  /// **'إغلاق'**
  String get placeSuggestDismiss;

  /// No description provided for @placeSuggestSettingTitle.
  ///
  /// In ar, this message translates to:
  /// **'اقتراحات على الطريق'**
  String get placeSuggestSettingTitle;

  /// No description provided for @placeSuggestSettingSubtitle.
  ///
  /// In ar, this message translates to:
  /// **'تنبيه هادئ عند وجود مقهى أو محطة وقود قريبة أثناء الرحلة'**
  String get placeSuggestSettingSubtitle;

  /// No description provided for @placeSuggestSettingMaster.
  ///
  /// In ar, this message translates to:
  /// **'إظهار الاقتراحات أثناء الرحلة'**
  String get placeSuggestSettingMaster;

  /// No description provided for @mapFilterCheckpoints.
  ///
  /// In ar, this message translates to:
  /// **'حواجز'**
  String get mapFilterCheckpoints;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return AppLocalizationsAr();
    case 'en':
      return AppLocalizationsEn();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
