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
  /// **'مساري'**
  String get appTitle;

  /// No description provided for @tagline.
  ///
  /// In ar, this message translates to:
  /// **'لوجستيات ذكية لتشارك المسار'**
  String get tagline;

  /// No description provided for @welcomeTitle.
  ///
  /// In ar, this message translates to:
  /// **'مرحباً بك في مساري'**
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

  /// No description provided for @lockedCorridor.
  ///
  /// In ar, this message translates to:
  /// **'الخليل / جامعة بوليتكنك فلسطين / باب الزاوية ← بيت لحم'**
  String get lockedCorridor;

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

  /// No description provided for @newToMasari.
  ///
  /// In ar, this message translates to:
  /// **'جديد في مساري؟ أنشئ حساباً'**
  String get newToMasari;

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

  /// No description provided for @passwordTooShort.
  ///
  /// In ar, this message translates to:
  /// **'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.'**
  String get passwordTooShort;

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
  /// **'اختار مساري هذا السائق لأن المسار يطابق الممر النشط، ونقطة الالتقاط قريبة من المسار، والسعة متاحة، ودرجة الثقة مرتفعة.'**
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
  /// **'يمكن تجميع {parcelCount} طرود متوافقة في رحلة واحدة على ممر مساري بدلاً من رحلات منفصلة، مما يقلل المسافة والتكلفة.'**
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

  /// No description provided for @createInvitedAccount.
  ///
  /// In ar, this message translates to:
  /// **'إنشاء حساب بدعوة'**
  String get createInvitedAccount;

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
  /// **'كيف ستستخدم مساري؟'**
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

  /// No description provided for @invitationCode.
  ///
  /// In ar, this message translates to:
  /// **'رمز الدعوة'**
  String get invitationCode;

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
  /// **'تم إنشاء حسابك وهو الآن قيد الانتظار. سيراجعه المشرف وغالباً يستغرق ذلك حتى 24 ساعة. يمكنك تسجيل الدخول بعد الموافقة عليه.'**
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
  /// **'تعذر بدء التسجيل. تحقق من بيانات الدعوة وحاول مرة أخرى.'**
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

  /// No description provided for @whereToGo.
  ///
  /// In ar, this message translates to:
  /// **'إلى أين تريد الذهاب؟'**
  String get whereToGo;

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
  /// **'أنشئ طلباً وسيقوم مساري بمطابقتك مع سائق على المسار.'**
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

  /// No description provided for @myTrips.
  ///
  /// In ar, this message translates to:
  /// **'رحلاتي'**
  String get myTrips;

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
  /// **'مساعد مساري'**
  String get assistantTitle;

  /// No description provided for @assistantHomeTitle.
  ///
  /// In ar, this message translates to:
  /// **'اسأل مساعد مساري'**
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
  /// **'اسأل عن بيانات رحلاتك أو المسارات المتاحة في مساري. إذا كانت التفاصيل ناقصة، سأطلب منك توضيحها.'**
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

  /// No description provided for @assistantSend.
  ///
  /// In ar, this message translates to:
  /// **'إرسال'**
  String get assistantSend;

  /// No description provided for @assistantProcessing.
  ///
  /// In ar, this message translates to:
  /// **'جارٍ التحقق من بيانات مساري…'**
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

  /// No description provided for @assistantClarificationLabel.
  ///
  /// In ar, this message translates to:
  /// **'يحتاج مساعد مساري إلى توضيح'**
  String get assistantClarificationLabel;

  /// No description provided for @assistantResultLabel.
  ///
  /// In ar, this message translates to:
  /// **'رد مساعد مساري'**
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

  /// No description provided for @invitationCodeOptional.
  ///
  /// In ar, this message translates to:
  /// **'رمز الدعوة (اختياري)'**
  String get invitationCodeOptional;

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
