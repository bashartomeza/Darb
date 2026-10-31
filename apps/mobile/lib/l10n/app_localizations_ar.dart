// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class AppLocalizationsAr extends AppLocalizations {
  AppLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appTitle => 'مساري';

  @override
  String get tagline => 'لوجستيات ذكية لتشارك المسار';

  @override
  String get welcomeTitle => 'مرحباً بك في مساري';

  @override
  String get welcomeBody =>
      'هذا تطبيق أندرويد التجريبي المخصص للمسافر والسائق والتاجر. تم تجهيز الهيكل الأساسي فقط في هذه المرحلة.';

  @override
  String get arabic => 'العربية';

  @override
  String get english => 'English';

  @override
  String get mobileDemoPreparation => 'تحضير العرض التجريبي للهاتف';

  @override
  String get apiEnvironment => 'بيئة واجهة API';

  @override
  String get continueAction => 'متابعة';

  @override
  String get shellStatusTitle => 'حالة هيكل التطبيق';

  @override
  String get shellStatusBody =>
      'العربية هي اللغة الافتراضية، واتجاه الواجهة من اليمين إلى اليسار، وتبديل اللغة محفوظ بعد إعادة التشغيل.';

  @override
  String get language => 'اللغة';

  @override
  String get configuredApiBaseUrl => 'رابط API المضبوط';

  @override
  String get androidOnly => 'هدف أندرويد فقط';

  @override
  String get businessFlowsPending =>
      'تدفقات المسافر والسائق والتاجر ستضاف في مراحل لاحقة.';

  @override
  String get lockedCorridor =>
      'الخليل / جامعة بوليتكنك فلسطين / باب الزاوية ← بيت لحم';

  @override
  String get diagnostics => 'تشخيصات تقنية';

  @override
  String get loadingSession => 'جارٍ استعادة الجلسة...';

  @override
  String get sessionRestoreFailed =>
      'تعذرت استعادة الجلسة. يرجى إعادة المحاولة.';

  @override
  String get retry => 'إعادة المحاولة';

  @override
  String get signInWelcome => 'سجل الدخول للمتابعة إلى مساحة عمل دورك.';

  @override
  String get signIn => 'تسجيل الدخول';

  @override
  String get phone => 'رقم الهاتف';

  @override
  String get email => 'البريد الإلكتروني';

  @override
  String get fullName => 'الاسم الكامل';

  @override
  String get password => 'كلمة المرور';

  @override
  String get showPassword => 'إظهار كلمة المرور';

  @override
  String get hidePassword => 'إخفاء كلمة المرور';

  @override
  String get signUp => 'إنشاء الحساب';

  @override
  String get createAccount => 'إنشاء الحساب';

  @override
  String get createAccountSubtitle => 'أنشئ حساب مسافر للبدء.';

  @override
  String get newToMasari => 'جديد في مساري؟ أنشئ حساباً';

  @override
  String get alreadyHaveAccount => 'لديك حساب؟ سجّل الدخول';

  @override
  String get continueWithGoogle => 'المتابعة عبر Google';

  @override
  String get orSeparator => 'أو';

  @override
  String get emailRequired => 'أدخل بريدك الإلكتروني.';

  @override
  String get emailInvalid => 'أدخل بريداً إلكترونياً صحيحاً.';

  @override
  String get nameRequired => 'أدخل اسمك.';

  @override
  String get passwordRequired => 'أدخل كلمة المرور.';

  @override
  String get passwordTooShort =>
      'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.';

  @override
  String get emailAlreadyRegistered =>
      'هذا البريد الإلكتروني مسجّل بالفعل. حاول تسجيل الدخول.';

  @override
  String get googleSignInFailed =>
      'فشل تسجيل الدخول عبر Google. حاول مرة أخرى.';

  @override
  String get googleSignInUnavailable =>
      'تسجيل الدخول عبر Google غير متاح حالياً.';

  @override
  String get demoAccounts => 'حسابات تجريبية';

  @override
  String get passenger => 'مسافر';

  @override
  String get driver => 'سائق';

  @override
  String get merchant => 'تاجر';

  @override
  String get admin => 'مسؤول';

  @override
  String get unsupportedRole => 'دور غير مدعوم';

  @override
  String get logout => 'تسجيل الخروج';

  @override
  String get sessionExpired => 'انتهت جلستك، يرجى تسجيل الدخول مرة أخرى';

  @override
  String get invalidCredentials =>
      'البريد الإلكتروني أو كلمة المرور غير صحيحة.';

  @override
  String get networkUnavailable =>
      'الشبكة غير متاحة. تحقق من اتصال واجهة API ثم أعد المحاولة.';

  @override
  String get requestTimedOut => 'انتهت مهلة الطلب. يرجى إعادة المحاولة.';

  @override
  String get validationError => 'يرجى التحقق من البيانات المدخلة.';

  @override
  String get forbidden => 'هذا الحساب غير مسموح له بتنفيذ هذا الإجراء.';

  @override
  String get serverError => 'حدث خطأ في الخادم. يرجى المحاولة لاحقاً.';

  @override
  String get requestFailed => 'فشل الطلب. يرجى إعادة المحاولة.';

  @override
  String get roleWorkspace => 'مساحة عمل الدور';

  @override
  String get currentUser => 'المستخدم الحالي';

  @override
  String get role => 'الدور';

  @override
  String get lockedCorridorLabel => 'المسار المثبت';

  @override
  String get workspaceReadyMessage =>
      'مساحة عمل هذا الدور جاهزة للمرحلة التالية.';

  @override
  String get comingNext => 'قريباً';

  @override
  String get businessFeaturesComingNext =>
      'ستضاف إجراءات الدور التجارية في مراحل لاحقة. لا توجد حالياً تدفقات طلبات أو مسارات أو طلبات تاجر أو مطابقات أو رحلات أو تتبع.';

  @override
  String get unsupportedRoleTitle => 'الدور غير مدعوم على الهاتف';

  @override
  String get adminWebConsoleMessage =>
      'لوحة تحكم المسؤول متاحة عبر تطبيق الويب.';

  @override
  String get passengerDashboard => 'لوحة المسافر';

  @override
  String get activeRequest => 'الطلب النشط';

  @override
  String get noActiveRequest => 'لا يوجد طلب نشط حالياً.';

  @override
  String get createRequest => 'إنشاء طلب';

  @override
  String get pickup => 'نقطة الانطلاق';

  @override
  String get ppu => 'بوابة جامعة بوليتكنك فلسطين';

  @override
  String get babAlZawiya => 'باب الزاوية';

  @override
  String get destination => 'الوجهة';

  @override
  String get bethlehem => 'بيت لحم';

  @override
  String get preferredTime => 'الوقت المفضل';

  @override
  String get passengerCount => 'عدد الركاب';

  @override
  String get submitRequest => 'إرسال الطلب';

  @override
  String get requestCreated => 'تم إنشاء الطلب';

  @override
  String get requestDetails => 'تفاصيل الطلب';

  @override
  String get cancelRequest => 'إلغاء الطلب';

  @override
  String get requestCancelled => 'تم إلغاء الطلب';

  @override
  String get requestCannotBeCancelled => 'لا يمكن إلغاء هذا الطلب الآن.';

  @override
  String get findCompatibleRoute => 'البحث عن مسار متوافق';

  @override
  String get retryMatching => 'إعادة محاولة المطابقة';

  @override
  String get noCompatibleDriverFound =>
      'لم يتم العثور على سائق متوافق. يمكنك إعادة المحاولة لاحقاً.';

  @override
  String get createdTime => 'وقت الإنشاء';

  @override
  String get currentStatus => 'الحالة الحالية';

  @override
  String get noConnectedTrip => 'لا توجد رحلة مرتبطة بعد.';

  @override
  String get matchResult => 'نتيجة المطابقة';

  @override
  String get selectedDriver => 'السائق المختار';

  @override
  String get selectedDriverUnavailable =>
      'مسار السائق المختار لم يعد متاحاً. اختر رحلة أخرى.';

  @override
  String get selectedRoute => 'المسار المختار';

  @override
  String get matchScore => 'درجة المطابقة';

  @override
  String get scoringBreakdown => 'تفصيل الدرجات';

  @override
  String get corridorOverlap => 'تطابق المسار';

  @override
  String get pickupDistance => 'قرب نقطة الانطلاق';

  @override
  String get timingFit => 'ملاءمة الوقت';

  @override
  String get trustScore => 'درجة الثقة';

  @override
  String get capacityFit => 'ملاءمة السعة';

  @override
  String get matchExplanation => 'شرح المطابقة';

  @override
  String get routeMatchExplanation =>
      'اختار مساري هذا السائق لأن المسار يطابق الممر النشط، ونقطة الالتقاط قريبة من المسار، والسعة متاحة، ودرجة الثقة مرتفعة.';

  @override
  String get passengerTrip => 'رحلة المسافر';

  @override
  String get tripTimeline => 'خط الرحلة الزمني';

  @override
  String get latestLocation => 'آخر موقع';

  @override
  String get waitingForDriver => 'بانتظار السائق';

  @override
  String get noLocationYet => 'لا يوجد موقع بعد.';

  @override
  String get locationIsStale => 'الموقع قديم.';

  @override
  String get latitude => 'خط العرض';

  @override
  String get longitude => 'خط الطول';

  @override
  String get sequence => 'التسلسل';

  @override
  String get source => 'المصدر';

  @override
  String get sourceSimulated => 'محاكى';

  @override
  String get recordedTime => 'وقت التسجيل';

  @override
  String get refresh => 'تحديث';

  @override
  String get statusPending => 'قيد الانتظار';

  @override
  String get statusMatched => 'تمت المطابقة';

  @override
  String get statusAccepted => 'مقبول';

  @override
  String get statusPickupStarted => 'بدأ التوجه للاستلام';

  @override
  String get statusPickedUp => 'تم الاستلام';

  @override
  String get statusInTransit => 'قيد النقل';

  @override
  String get statusDelivered => 'تم التسليم';

  @override
  String get statusCompleted => 'مكتملة';

  @override
  String get statusCancelled => 'ملغاة';

  @override
  String get driverDashboard => 'لوحة السائق';

  @override
  String get activeRoute => 'المسار النشط';

  @override
  String get noActiveRoute => 'لا يوجد مسار نشط حالياً.';

  @override
  String get createRoute => 'إنشاء مسار';

  @override
  String get viewRoute => 'عرض المسار';

  @override
  String get routeDetails => 'تفاصيل المسار';

  @override
  String get origin => 'نقطة الانطلاق';

  @override
  String get seatsAvailable => 'المقاعد المتاحة';

  @override
  String get parcelCapacity => 'سعة الطرود';

  @override
  String get activateRoute => 'تفعيل المسار';

  @override
  String get deactivateRoute => 'إيقاف المسار';

  @override
  String get routeActivated => 'تم تفعيل المسار';

  @override
  String get routeDeactivated => 'تم إلغاء تفعيل المسار';

  @override
  String get routeStatus => 'حالة المسار';

  @override
  String get activationTime => 'وقت التفعيل';

  @override
  String get routeAlreadyActive => 'يوجد مسار تشغيلي بالفعل.';

  @override
  String get routeCannotDeactivate =>
      'لا يمكن إلغاء تفعيل هذا المسار في حالته الحالية.';

  @override
  String get matchInbox => 'صندوق المطابقات';

  @override
  String get noAvailableMatches => 'لا توجد مطابقات متاحة.';

  @override
  String get passengerRequest => 'طلب مسافر';

  @override
  String get merchantOrder => 'طلب تاجر';

  @override
  String get combinedAssignment => 'مهمة مشتركة';

  @override
  String get requestType => 'نوع الطلب';

  @override
  String get parcelCount => 'عدد الطرود';

  @override
  String get parcelBatch => 'دفعة الطرود';

  @override
  String get estimatedDistanceSaved => 'المسافة المقدرة الموفرة';

  @override
  String get acceptMatch => 'قبول المطابقة';

  @override
  String get rejectMatch => 'رفض المطابقة';

  @override
  String get matchAccepted => 'تم قبول المطابقة';

  @override
  String get matchRejected => 'تم رفض المطابقة';

  @override
  String get matchCannotChange =>
      'تغيرت هذه المطابقة مسبقاً. تم تحميل أحدث حالة.';

  @override
  String get allMatches => 'كل المطابقات';

  @override
  String get proposedMatches => 'المطابقات المقترحة';

  @override
  String get viewDetails => 'عرض التفاصيل';

  @override
  String get activeTrip => 'الرحلة النشطة';

  @override
  String get noActiveTrip => 'لا توجد رحلة نشطة حالياً.';

  @override
  String get openActiveTrip => 'فتح الرحلة النشطة';

  @override
  String get driverTrip => 'رحلة السائق';

  @override
  String get statusTimeline => 'الخط الزمني للحالة';

  @override
  String get startPickup => 'بدء التوجه للاستلام';

  @override
  String get pickedUpAction => 'تم الاستلام';

  @override
  String get startTrip => 'بدء الرحلة';

  @override
  String get deliver => 'تسليم';

  @override
  String get completeTrip => 'إكمال الرحلة';

  @override
  String get tripTransitionConflict => 'تغيرت حالة الرحلة. تم تحميل أحدث حالة.';

  @override
  String get trackingSimulation => 'محاكاة التتبع';

  @override
  String get simulateNextPoint => 'محاكاة النقطة التالية';

  @override
  String get resetSimulation => 'إعادة ضبط المحاكاة';

  @override
  String get simulationReset => 'تمت إعادة ضبط المحاكاة';

  @override
  String get routeProgress => 'تقدم المسار';

  @override
  String get statusProposed => 'مقترحة';

  @override
  String get statusSentToDriver => 'أرسلت إلى السائق';

  @override
  String get statusRejected => 'مرفوضة';

  @override
  String get statusExpired => 'منتهية';

  @override
  String get statusActive => 'نشطة';

  @override
  String get statusInactive => 'غير نشط';

  @override
  String get statusAssigned => 'مخصص';

  @override
  String get statusOnTrip => 'في رحلة';

  @override
  String get statusCreated => 'منشأ';

  @override
  String get merchantDashboard => 'لوحة التاجر';

  @override
  String get orders => 'الطلبات';

  @override
  String get noOrders => 'لا توجد طلبات بعد.';

  @override
  String get createOrder => 'إنشاء طلب';

  @override
  String get latestOrder => 'أحدث طلب';

  @override
  String get latestBatch => 'أحدث دفعة طرود';

  @override
  String get orderDetails => 'تفاصيل الطلب';

  @override
  String get fixedPickup => 'نقطة الاستلام الثابتة';

  @override
  String get parcel => 'طرد';

  @override
  String get parcelSize => 'حجم الطرد';

  @override
  String get priority => 'الأولوية';

  @override
  String get priorityLow => 'منخفضة';

  @override
  String get priorityNormal => 'عادية';

  @override
  String get priorityHigh => 'مرتفعة';

  @override
  String get addParcel => 'إضافة طرد';

  @override
  String get removeParcel => 'إزالة الطرد';

  @override
  String get parcelLimit => 'يجب أن يحتوي الطلب على 1 إلى 10 طرود.';

  @override
  String get submitOrder => 'إرسال الطلب';

  @override
  String get orderCreated => 'تم إنشاء الطلب';

  @override
  String get createBatch => 'إنشاء دفعة طرود';

  @override
  String get batchCreated => 'تم إنشاء دفعة الطرود';

  @override
  String get batchExplanation => 'شرح الدفعة';

  @override
  String parcelBatchExplanationDemo(int parcelCount) {
    return 'يمكن تجميع $parcelCount طرود متوافقة في رحلة واحدة على ممر مساري بدلاً من رحلات منفصلة، مما يقلل المسافة والتكلفة.';
  }

  @override
  String get runMatching => 'البحث عن مسار سائق متوافق';

  @override
  String get matchingStarted => 'أُرسلت المطابقة المقترحة إلى السائق';

  @override
  String get merchantMatchInbox => 'صندوق مطابقات التاجر';

  @override
  String get waitingReadOnly =>
      'يقرر السائق القبول أو الرفض. هذه الشاشة للقراءة فقط.';

  @override
  String get openTrip => 'فتح الرحلة المرتبطة';

  @override
  String get merchantTrip => 'رحلة التاجر';

  @override
  String get orderStatus => 'حالة الطلب';

  @override
  String get parcelStatus => 'حالة الطرد';

  @override
  String get statusDraft => 'مسودة';

  @override
  String get statusSubmitted => 'مُرسل';

  @override
  String get statusBatched => 'مُجمّع';

  @override
  String get orderAlreadyBatched => 'يحتوي هذا الطلب على دفعة طرود بالفعل.';

  @override
  String get matchingUnavailable =>
      'أنشئ دفعة أولاً أو انتظر المطابقة الحالية.';

  @override
  String get deliveryProgress => 'تقدم التوصيل';

  @override
  String get securityAndSessions => 'الأمان والجلسات';

  @override
  String get activeSessions => 'الجلسات النشطة';

  @override
  String get currentDevice => 'الجهاز الحالي';

  @override
  String get otherDevice => 'جهاز آخر';

  @override
  String get mobileSession => 'تطبيق الهاتف';

  @override
  String get adminSession => 'متصفح المسؤول';

  @override
  String get created => 'تاريخ الإنشاء';

  @override
  String get lastActive => 'آخر نشاط';

  @override
  String get expires => 'تنتهي في';

  @override
  String get revokeSession => 'إلغاء الجلسة';

  @override
  String get revokeThisDevice => 'إلغاء جلسة هذا الجهاز';

  @override
  String get logoutAllDevices => 'تسجيل الخروج من جميع الأجهزة';

  @override
  String get confirmLogout => 'تأكيد تسجيل الخروج';

  @override
  String get confirmLogoutMessage => 'هل تريد تسجيل الخروج من هذا الجهاز؟';

  @override
  String get confirmLogoutAll => 'تأكيد تسجيل الخروج من جميع الأجهزة';

  @override
  String get confirmLogoutAllMessage =>
      'ستنتهي جميع الجلسات النشطة، وستحتاج إلى تسجيل الدخول مجدداً على كل جهاز.';

  @override
  String get confirmRevokeSession => 'هل تريد إلغاء هذه الجلسة؟';

  @override
  String get cancel => 'إلغاء';

  @override
  String get sessionRevoked => 'تم إلغاء الجلسة';

  @override
  String get sessionEnded => 'انتهت جلستك، يرجى تسجيل الدخول مرة أخرى';

  @override
  String get accountUnavailable =>
      'هذا الحساب غير متاح. تواصل مع المسؤول إذا كنت بحاجة إلى مساعدة.';

  @override
  String get refreshingSession => 'جارٍ تحديث الجلسة...';

  @override
  String get unableToRefresh =>
      'تعذر تحديث الجلسة. تحقق من الاتصال ثم أعد المحاولة.';

  @override
  String get localLogout => 'تسجيل الخروج من هذا الجهاز';

  @override
  String get noActiveSessions => 'لم يتم إرجاع جلسات نشطة.';

  @override
  String get sessionActionFailed =>
      'تعذر إكمال إجراء الجلسة. يرجى إعادة المحاولة.';

  @override
  String get createInvitedAccount => 'إنشاء حساب بدعوة';

  @override
  String get selectAccountType => 'اختر نوع الحساب';

  @override
  String get passengerActiveAfterRegistration =>
      'يصبح الحساب نشطاً بعد التسجيل';

  @override
  String get pendingAfterRegistration =>
      'يبقى الحساب قيد المراجعة حتى الموافقة';

  @override
  String get registerChooseTitle => 'كيف ستستخدم مساري؟';

  @override
  String get registerChooseSubtitle =>
      'اختر ما يناسبك وسنأخذك عبر الخطوات الصحيحة.';

  @override
  String get registerPassengerTitle => 'مستخدم عادي';

  @override
  String get registerPassengerHelp =>
      'اطلب رحلات وتوصيلات. يصبح حسابك جاهزاً مباشرة بعد التسجيل.';

  @override
  String get registerDriverTitle => 'سائق';

  @override
  String get registerDriverHelp =>
      'انقل الرحلات والتوصيلات. ترفع مستنداتك ويوافق المشرف على حسابك.';

  @override
  String get registerMerchantTitle => 'صاحب متجر';

  @override
  String get registerMerchantHelp =>
      'أرسل طلبات من متجرك. ترفع مستنداتك ويوافق المشرف على حسابك.';

  @override
  String get invitationCode => 'رمز الدعوة';

  @override
  String get phoneNumber => 'رقم الهاتف';

  @override
  String get sendVerificationCode => 'إرسال رمز التحقق';

  @override
  String get emailForCode => 'البريد الإلكتروني (نرسل الرمز إليه)';

  @override
  String get codeSentToEmail =>
      'أرسلنا رمزاً من ستة أرقام إلى بريدك الإلكتروني. تحقق من بريدك، بما في ذلك مجلد الرسائل غير المرغوبة.';

  @override
  String get enterVerificationCode => 'أدخل رمز التحقق';

  @override
  String get resendCode => 'إعادة إرسال الرمز';

  @override
  String get resendAvailableIn => 'تتوفر إعادة الإرسال خلال';

  @override
  String get verify => 'تحقق';

  @override
  String get accountInformation => 'معلومات الحساب';

  @override
  String get displayName => 'الاسم الظاهر';

  @override
  String get confirmPassword => 'تأكيد كلمة المرور';

  @override
  String get terms => 'الشروط';

  @override
  String get privacyNotice => 'إشعار الخصوصية';

  @override
  String get confirmAdult => 'أؤكد أن عمري 18 عاماً أو أكثر';

  @override
  String get acceptAndContinue => 'قبول ومتابعة';

  @override
  String get accountCreated => 'تم إنشاء الحساب';

  @override
  String get signInToContinue => 'تم إنشاء حسابك. سجّل الدخول للمتابعة.';

  @override
  String get applicationUnderReview => 'الطلب قيد المراجعة';

  @override
  String get pendingReviewBody =>
      'تم إنشاء حسابك وهو الآن قيد الانتظار. سيراجعه المشرف وغالباً يستغرق ذلك حتى 24 ساعة. يمكنك تسجيل الدخول بعد الموافقة عليه.';

  @override
  String get merchantDocumentsHint =>
      'للحصول على الموافقة، ارفع صوراً واضحة أو ملفات PDF للسجل التجاري (أو رخصة المتجر) والهوية الوطنية وصورة للمتجر. تُحفظ الملفات على خادمنا ولا يفتحها إلا فريق المراجعة.';

  @override
  String get documentKindCommercialRegister => 'السجل التجاري';

  @override
  String get documentKindShopPhoto => 'صورة المتجر';

  @override
  String get checkApplicationStatus => 'متابعة حالة طلب سابق';

  @override
  String get registrationUnavailable => 'التسجيل غير متاح مؤقتاً.';

  @override
  String get unableToStartRegistration =>
      'تعذر بدء التسجيل. تحقق من بيانات الدعوة وحاول مرة أخرى.';

  @override
  String get incorrectVerificationCode => 'رمز التحقق غير صحيح.';

  @override
  String get codeExpired => 'انتهت صلاحية الرمز.';

  @override
  String get tooManyAttempts => 'محاولات كثيرة جداً. يرجى المحاولة لاحقاً.';

  @override
  String get consentDocumentsChanged =>
      'تغيرت مستندات الموافقة. يرجى مراجعتها مرة أخرى.';

  @override
  String get requestReference => 'مرجع الطلب';

  @override
  String get leaveRegistration => 'مغادرة التسجيل';

  @override
  String get continueRegistration => 'متابعة التسجيل';

  @override
  String get leaveRegistrationWarning =>
      'سيؤدي الخروج إلى مسح حالة التسجيل المحفوظة على هذا الجهاز. هل تريد المتابعة؟';

  @override
  String get secondsShort => 'ثانية';

  @override
  String get consentVersion => 'الإصدار';

  @override
  String get accountApproved => 'تمت الموافقة على الحساب';

  @override
  String get signInAfterApproval =>
      'تمت الموافقة على حسابك. سجّل الدخول للمتابعة.';

  @override
  String get canonicalRoutes => 'خدمات المسارات المتعددة';

  @override
  String get canonicalRoutesBody =>
      'اختر من المسارات الحالية والمحطات المعتمدة.';

  @override
  String get featureUnavailable => 'هذه الخدمة غير متاحة في هذه البيئة.';

  @override
  String get routeCatalogUnavailable =>
      'المسارات غير متاحة مؤقتاً. حدّثها قبل الإرسال.';

  @override
  String get noPublishedRoutes => 'لا توجد مسارات منشورة ومؤهلة حالياً.';

  @override
  String get selectRoute => 'اختر المسار';

  @override
  String get routeDirection => 'الاتجاه';

  @override
  String get directionOutbound => 'ذهاب';

  @override
  String get directionInbound => 'عودة';

  @override
  String get directionLoop => 'دائري';

  @override
  String get orderedStops => 'المحطات بالترتيب';

  @override
  String stopSequence(int sequence) {
    return 'المحطة $sequence';
  }

  @override
  String get driverAvailabilities => 'إتاحة المسار';

  @override
  String get newAvailability => 'إنشاء إتاحة لمسار';

  @override
  String get noAvailabilities => 'لم تُنشأ إتاحة لمسار بعد.';

  @override
  String get departureTime => 'وقت الانطلاق';

  @override
  String get availabilityWindowEnd => 'نهاية نافذة الإتاحة (اختياري)';

  @override
  String get seatCapacity => 'سعة المقاعد';

  @override
  String get reviewAndConfirm => 'مراجعة وتأكيد';

  @override
  String get availabilityRecorded => 'تم تسجيل الإتاحة';

  @override
  String remainingCapacity(int seats, int parcels) {
    return 'المتبقي: $seats مقاعد، $parcels طرود';
  }

  @override
  String get activateAvailability => 'تفعيل الإتاحة';

  @override
  String get pauseAvailability => 'إيقاف الإتاحة مؤقتاً';

  @override
  String get resumeAvailability => 'استئناف الإتاحة';

  @override
  String get cancelAvailability => 'إلغاء الإتاحة';

  @override
  String get editAvailability => 'تعديل الإتاحة';

  @override
  String get canonicalPassengerRequest => 'طلب مسار';

  @override
  String get canonicalPassengerRequestBody =>
      'اطلب التنقل عبر مسار ومحطات معتمدة.';

  @override
  String get pickupStop => 'محطة الصعود';

  @override
  String get dropoffStop => 'محطة النزول';

  @override
  String get departureFrom => 'بداية وقت الانطلاق';

  @override
  String get departureUntil => 'نهاية وقت الانطلاق';

  @override
  String get requestRecorded => 'تم تسجيل طلب المسار.';

  @override
  String get matchingDisabledNotice =>
      'المطابقة غير مفعلة في هذه المرحلة. لم يُعيَّن سائق ولم تُنشأ رحلة.';

  @override
  String get canonicalMerchantOrder => 'طلب طرود عبر مسار';

  @override
  String get canonicalMerchantOrderBody =>
      'أنشئ طلباً واحداً متكاملاً على مسار معتمد.';

  @override
  String get parcelPickupStop => 'محطة استلام الطرود';

  @override
  String get parcelDestination => 'وجهة الطرد';

  @override
  String get parcelPriority => 'أولوية الطرد';

  @override
  String get orderRecorded => 'تم تسجيل طلب الطرود عبر المسار.';

  @override
  String get batchingMatchingDisabledNotice =>
      'التجميع والمطابقة غير مفعلين في هذه المرحلة. لم يُعيَّن سائق ولم تُنشأ رحلة توصيل.';

  @override
  String get submitAvailability => 'إرسال الإتاحة';

  @override
  String get selectDateTime => 'اختر التاريخ والوقت';

  @override
  String get invalidDepartureWindow => 'اختر نافذة انطلاق مستقبلية وصحيحة.';

  @override
  String get availabilityDepartureTooSoon =>
      'وقت الانطلاق قريب جداً. اختر وقتاً بعد 10 دقائق على الأقل من الآن.';

  @override
  String get availabilityDepartureTooFar =>
      'وقت الانطلاق بعيد جداً. اختر وقتاً خلال الـ30 يوماً القادمة.';

  @override
  String get availabilityInvalidWindow =>
      'نهاية نافذة الإتاحة يجب أن تكون بعد الانطلاق بساعتين كحد أقصى.';

  @override
  String get availabilityExceedsVehicleCapacity =>
      'سعة المقاعد أو الطرود التي اخترتها تتجاوز سعة مركبتك المسجلة.';

  @override
  String get availabilityDriverNotApproved =>
      'حسابك كسائق لم يُعتمد بعد. تواصل مع الدعم لإتمام التحقق.';

  @override
  String get availabilityRouteNoLongerEligible =>
      'لم يعد هذا المسار متاحاً. اختر مساراً آخر.';

  @override
  String get availabilityDuplicate =>
      'لديك بالفعل إتاحة مطابقة لهذا المسار والوقت.';

  @override
  String get invalidStopOrder => 'اختر محطة معتمدة لاحقة في المسار.';

  @override
  String get operationTemporaryFailure =>
      'نتيجة العملية غير مؤكدة. أعد محاولة العملية نفسها عند توفر الاتصال.';

  @override
  String get canonicalRecoveryRequired =>
      'توجد عملية سابقة غير محسومة. سجّل الدخول بالحساب الأصلي وأعد العملية نفسها، أو تواصل مع الدعم إذا انتهت مهلة الاسترداد.';

  @override
  String get transactionRetryRequired =>
      'حدث تعارض مؤقت في المعاملة. أعد محاولة هذه العملية.';

  @override
  String get refreshRoutes => 'تحديث المسارات';

  @override
  String get statusPaused => 'متوقفة مؤقتاً';

  @override
  String get statusFilled => 'ممتلئة';

  @override
  String get statusDeparted => 'انطلقت';

  @override
  String get returnToDashboard => 'العودة إلى لوحة التحكم';

  @override
  String get canonicalDriverOffers => 'عروض المسار';

  @override
  String get canonicalDriverOffersBody =>
      'راجع طلبات الركاب والطرود الحالية المرتبطة بإتاحة مسارك.';

  @override
  String get noCanonicalOffers => 'لا توجد عروض مسار حالياً.';

  @override
  String get loadMore => 'تحميل المزيد';

  @override
  String get offerDetails => 'تفاصيل العرض';

  @override
  String get offerExpires => 'ينتهي العرض';

  @override
  String get offerExpired => 'انتهت صلاحية هذا العرض.';

  @override
  String get demandPassenger => 'طلب راكب';

  @override
  String get demandMerchant => 'طلب طرود';

  @override
  String get acceptOffer => 'قبول العرض';

  @override
  String get rejectOffer => 'رفض العرض';

  @override
  String get rejectReason => 'سبب الرفض';

  @override
  String get rejectDriverDeclined => 'لا أستطيع تنفيذ هذه المهمة';

  @override
  String get rejectScheduleConflict => 'تعارض في الموعد';

  @override
  String get rejectCapacityUnavailable => 'السعة غير متوفرة';

  @override
  String get confirmAcceptOffer => 'هل تريد قبول مهمة المسار هذه؟';

  @override
  String get confirmRejectOffer => 'هل تريد رفض مهمة المسار هذه؟';

  @override
  String get offerAccepted => 'تم قبول المهمة.';

  @override
  String get offerRejected => 'تم رفض المهمة.';

  @override
  String get operationResultUncertain =>
      'نتيجة العملية غير مؤكدة. احتفظ بهذه العملية وقم بمطابقتها قبل محاولة عملية أخرى.';

  @override
  String get recoverOperation => 'مطابقة نتيجة العملية';

  @override
  String get canonicalAssignmentStatus => 'حالة إسناد المسار';

  @override
  String get canonicalAssignments => 'طلبات المسار والإسناد';

  @override
  String get noCanonicalAssignments => 'لم تُسجل إسنادات مسار بعد.';

  @override
  String get statusOffered => 'معروض على سائق';

  @override
  String get statusUnavailable => 'لا يوجد إسناد متاح';

  @override
  String get canonicalTrip => 'الرحلة المسندة';

  @override
  String get vehicleType => 'نوع المركبة';

  @override
  String get trackingNotAvailable =>
      'التتبع المباشر والخرائط وتقديرات الوصول غير متوفرة في هذه المرحلة.';

  @override
  String get manualRefreshNotice =>
      'اسحب للأسفل أو استخدم زر التحديث للتحقق من المستجدات.';

  @override
  String get assignmentPendingBody => 'طلبك بانتظار المطابقة.';

  @override
  String get assignmentOfferedBody => 'العرض بانتظار قرار السائق.';

  @override
  String get assignmentAssignedBody => 'قبل السائق وتم إنشاء رحلة.';

  @override
  String get assignmentUnavailableBody => 'لا يوجد إسناد نشط لسائق.';

  @override
  String get assignmentCancelledBody => 'تم إلغاء هذا الطلب.';

  @override
  String get leaveRejectionWarning =>
      'لم يتم إرسال سبب الرفض المحدد. هل تريد مغادرة الشاشة؟';

  @override
  String get routeStops => 'محطات المسار';

  @override
  String get navNewRequest => 'طلب جديد';

  @override
  String get navHome => 'الرئيسية';

  @override
  String get navAccount => 'الحساب';

  @override
  String get navTrips => 'رحلاتي';

  @override
  String greetingMorning(String name) {
    return 'صباح الخير، $name';
  }

  @override
  String greetingAfternoon(String name) {
    return 'مساء الخير، $name';
  }

  @override
  String greetingEvening(String name) {
    return 'مساء الخير، $name';
  }

  @override
  String get whereToGo => 'إلى أين تريد الذهاب؟';

  @override
  String get smartSearch => 'بحث ذكي';

  @override
  String get destinationSearchHint => 'مثال: من البوليتكنك إلى بيت لحم';

  @override
  String get quickDestinations => 'الوجهات السريعة';

  @override
  String availableTripsTo(String destination) {
    return 'رحلات متاحة إلى $destination';
  }

  @override
  String get searchForTrip => 'ابحث عن رحلة';

  @override
  String get perPassenger => 'للراكب';

  @override
  String get departure => 'المغادرة';

  @override
  String get bookSeat => 'احجز';

  @override
  String get noAvailableTrips => 'لا توجد رحلات متاحة حالياً';

  @override
  String get noAvailableTripsBody =>
      'أنشئ طلباً وسيقوم مساري بمطابقتك مع سائق على المسار.';

  @override
  String seatsRemaining(int count) {
    return '$count مقاعد متاحة';
  }

  @override
  String completedTripsCount(int count) {
    return '$count رحلة';
  }

  @override
  String get notifications => 'الإشعارات';

  @override
  String get noNotifications => 'لا توجد إشعارات بعد.';

  @override
  String get sampleDataNotice =>
      'بيانات تجريبية للعرض فقط، غير مرتبطة بالخادم.';

  @override
  String get driverOnline => 'متصل';

  @override
  String get driverOffline => 'غير متصل';

  @override
  String get trustPoints => 'نقاط الثقة';

  @override
  String get trustExcellent => 'ممتاز';

  @override
  String get trustGood => 'جيد';

  @override
  String get trustFair => 'مقبول';

  @override
  String get trustWeak => 'ضعيف';

  @override
  String get trustScoreUnavailable => 'غير متاح بعد';

  @override
  String get todayEarnings => 'أرباح اليوم';

  @override
  String get earningsUnavailable => 'غير متاحة';

  @override
  String completedTripsToday(int count) {
    return '$count رحلات مكتملة';
  }

  @override
  String get activateYourRoute => 'فعّل مسارك';

  @override
  String get activateRouteHint => 'قم بتحديد وجهتك لاستقبال الطلبات على طريقك';

  @override
  String get mapNoLocation => 'لا توجد بيانات موقع بعد.';

  @override
  String get batchSavings => 'توفير التجميع';

  @override
  String get batchSavingsCaption => 'تم توفيرها عبر دمج الشحنات';

  @override
  String distanceSavedKm(String km) {
    return '$km كم';
  }

  @override
  String get noSavingsYet => 'لا يوجد توفير بعد';

  @override
  String get inDelivery => 'قيد التوصيل';

  @override
  String activeShipmentsCount(int count) {
    return '$count شحنات نشطة';
  }

  @override
  String get createShipment => 'إنشاء شحنة جديدة';

  @override
  String get smartBatchingTitle => 'توصيات التجميع الذكية';

  @override
  String batchSuggestionTitle(int count, String destination) {
    return '$count طرود إلى $destination';
  }

  @override
  String get batchSuggestionBody => 'يمكن دمجها في دفعة واحدة على المسار.';

  @override
  String get mergeAndSend => 'دمج وإرسال';

  @override
  String get noBatchSuggestions => 'لا توجد طلبات جاهزة للتجميع.';

  @override
  String get liveTracking => 'التتبع المباشر';

  @override
  String get recentOrders => 'الطلبات الأخيرة';

  @override
  String orderReference(String reference) {
    return 'طلب #$reference';
  }

  @override
  String get navRequests => 'الطلبات';

  @override
  String get navMyTrip => 'رحلتي';

  @override
  String get navPerformance => 'الأرباح والأداء';

  @override
  String get navNotifications => 'الإشعارات';

  @override
  String get navMapAlerts => 'الخرائط والبلاغات';

  @override
  String get navShipments => 'الشحنات';

  @override
  String get navReports => 'التقارير';

  @override
  String get myTrips => 'رحلاتي';

  @override
  String get tripsActiveSection => 'الرحلة النشطة';

  @override
  String get tripsUpcomingSection => 'الرحلات القادمة';

  @override
  String get tripsPastSection => 'الرحلات السابقة';

  @override
  String get tripsCancelledSection => 'الرحلات الملغاة';

  @override
  String get noTripsYet => 'لا توجد رحلات بعد';

  @override
  String get noTripsYetBody => 'ستظهر رحلاتك هنا بعد إنشاء أول طلب.';

  @override
  String get tripHistoryFailed => 'تعذّر تحميل سجل الرحلات.';

  @override
  String get mapsUnavailable => 'الخريطة غير متاحة';

  @override
  String get mapsUnavailableBody =>
      'لم يتم تفعيل خدمة الخرائط في هذه النسخة، لذلك لا يمكن عرض موقع مباشر.';

  @override
  String get incidentReports => 'البلاغات';

  @override
  String get incidentReportingUnavailable => 'الإبلاغ عن حادث غير متاح';

  @override
  String get incidentReportingUnavailableBody =>
      'لا يوجد حتى الآن نظام خلفي لاستقبال البلاغات، ولن يتم إرسال أي بلاغ من هنا.';

  @override
  String get notificationsUnavailableBody =>
      'لا يوجد نظام إشعارات في هذه النسخة. ستصلك التحديثات داخل شاشة الرحلة.';

  @override
  String get performanceTitle => 'الأرباح والأداء';

  @override
  String get earningsNotTracked => 'لا يتم احتساب الأرباح';

  @override
  String get earningsNotTrackedBody =>
      'لا تحتوي قاعدة البيانات على أي بيانات أسعار أو أجرة، لذلك لا يمكن عرض رقم أرباح حقيقي.';

  @override
  String get completedTripsTotal => 'إجمالي الرحلات المكتملة';

  @override
  String get acceptanceRateUnavailable => 'نسبة القبول غير متاحة';

  @override
  String destinationCount(int count) {
    return '$count وجهات';
  }

  @override
  String get shipmentsTitle => 'الشحنات';

  @override
  String get noShipments => 'لا توجد شحنات';

  @override
  String get noShipmentsBody => 'أنشئ شحنة جديدة لتظهر هنا.';

  @override
  String get shipmentsFailed => 'تعذّر تحميل الشحنات.';

  @override
  String get reportsUnavailable => 'التقارير غير متاحة';

  @override
  String get reportsUnavailableBody =>
      'لا يوجد نظام خلفي لتوليد التقارير أو تصديرها بصيغة PDF أو Excel.';

  @override
  String get accountProfile => 'الملف الشخصي';

  @override
  String get accountSupport => 'الدعم';

  @override
  String get supportUnavailable => 'الدعم داخل التطبيق غير متاح';

  @override
  String get supportUnavailableBody =>
      'لا توجد قناة دعم متصلة بالنظام الخلفي في هذه النسخة.';

  @override
  String get accountSettings => 'الإعدادات';

  @override
  String get featureNotBackedNotice =>
      'هذا القسم غير مدعوم من النظام الخلفي بعد.';

  @override
  String get offers => 'العروض';

  @override
  String get individualOffers => 'العروض الفردية';

  @override
  String get sharedOffers => 'عروض الرحلات المشتركة';

  @override
  String get sharedOffersBody =>
      'راجع عروض المسار المجمّعة. تتغير الحالة فقط عند التحديث.';

  @override
  String get noSharedOffers => 'لا توجد عروض رحلات مشتركة حالياً.';

  @override
  String get sharedTrip => 'رحلة مشتركة';

  @override
  String get sharedOfferDetails => 'تفاصيل العرض المشترك';

  @override
  String get compositionPassengerOnly => 'ركاب فقط';

  @override
  String get compositionMerchantOnly => 'طرود فقط';

  @override
  String get compositionMixed => 'رحلة مختلطة';

  @override
  String get passengerRequests => 'طلبات الركاب';

  @override
  String get passengerSeats => 'مقاعد الركاب';

  @override
  String get merchantOrders => 'طلبات التجار';

  @override
  String get parcels => 'الطرود';

  @override
  String get entireGroup => 'المجموعة كاملة';

  @override
  String get acceptEntireSharedTrip => 'قبول الرحلة المشتركة كاملة';

  @override
  String get rejectEntireSharedTrip => 'رفض الرحلة المشتركة كاملة';

  @override
  String get confirmAcceptSharedTrip =>
      'هل تريد قبول جميع طلبات الركاب والتجار المجمّعة معاً في رحلة مشتركة واحدة؟';

  @override
  String get confirmRejectSharedTrip =>
      'هل تريد رفض المجموعة كاملة وتحرير جميع الطلبات المجمّعة؟';

  @override
  String get sharedGroupDecisionNotice =>
      'ينطبق القبول أو الرفض على المجموعة كاملة.';

  @override
  String get sharedAcceptedNotice =>
      'تم إسناد رحلة مشتركة واحدة. لم تبدأ الرحلة.';

  @override
  String get sharedRejectedNotice => 'تم رفض العرض المشترك كاملاً.';

  @override
  String get sharedInvalidatedNotice =>
      'لم يعد هذا العرض المشترك صالحاً. حدّث الشاشة لمعرفة الحالة الحالية.';

  @override
  String get sharedCapacityNotice =>
      'هذه المجاميع محجوزة للمسار كاملاً. لا تُعرض السعة المتبقية مجدداً لهذا الانطلاق، وإعادة استخدام السعة بين المحطات غير مفعلة.';

  @override
  String get stopEventTimeline => 'أحداث المحطات المشتركة';

  @override
  String get passengerPickups => 'ركاب يصعدون';

  @override
  String get passengerDropoffs => 'ركاب ينزلون';

  @override
  String get parcelPickups => 'طرود تُستلم';

  @override
  String get parcelDestinations => 'وجهات الطرود';

  @override
  String get sharedAssignmentIndicator => 'مُسند إلى رحلة مشتركة';

  @override
  String get sharedAssignmentPrivacyNotice =>
      'يظهر طلبك فقط. معلومات أعضاء الرحلة الآخرين خاصة.';

  @override
  String get statusUnsupported => 'الحالة غير متاحة';

  @override
  String get unsupportedDataNotice =>
      'هذه الحالة غير مدعومة في إصدار التطبيق الحالي. حدّث الشاشة أو تواصل مع الدعم.';

  @override
  String get vehicleSedan => 'سيارة سيدان';

  @override
  String get vehicleVan => 'مركبة فان';

  @override
  String get vehicleUnavailable => 'نوع المركبة غير متاح';

  @override
  String get actionDisabledExpired =>
      'الإجراء غير متاح لأن صلاحية العرض انتهت.';

  @override
  String get actionDisabledUncertain =>
      'الإجراء غير متاح حتى تتم مطابقة نتيجة العملية السابقة.';

  @override
  String get sharedFeatureUnavailable =>
      'عروض الرحلات المشتركة غير متاحة في هذه البيئة.';

  @override
  String get sharedAssignmentUnavailable =>
      'تفاصيل إسناد الرحلة المشتركة غير متاحة في هذه البيئة.';

  @override
  String get notLiveNotice =>
      'هذه الشاشة ليست مباشرة. استخدم التحديث للتحقق من المستجدات.';

  @override
  String get assistantTitle => 'مساعد مساري';

  @override
  String get assistantHomeTitle => 'اسأل مساعد مساري';

  @override
  String get assistantHomeBody => 'استفسر عن رحلاتك والمسارات المتاحة.';

  @override
  String get assistantWelcomeTitle => 'كيف يمكنني مساعدتك؟';

  @override
  String get assistantWelcomeBody =>
      'اسأل عن بيانات رحلاتك أو المسارات المتاحة في مساري. إذا كانت التفاصيل ناقصة، سأطلب منك توضيحها.';

  @override
  String get assistantTryAsking => 'جرّب أن تسأل';

  @override
  String get assistantExampleTripTime => 'متى موعد رحلتي القادمة؟';

  @override
  String get assistantExampleAvailableTrip => 'هل توجد رحلة إلى بيت لحم؟';

  @override
  String get assistantInputHint => 'اكتب سؤالك هنا';

  @override
  String get assistantSend => 'إرسال';

  @override
  String get assistantProcessing => 'جارٍ التحقق من بيانات مساري…';

  @override
  String get assistantErrorTitle => 'تعذّر إكمال الطلب';

  @override
  String get assistantErrorBody =>
      'لم يتمكن المساعد من إكمال طلبك. حاول مرة أخرى.';

  @override
  String get assistantUnavailable =>
      'خدمة المساعد غير متاحة في هذا الإصدار. لم يتم إنشاء أي نتيجة.';

  @override
  String get assistantClarificationLabel => 'يحتاج مساعد مساري إلى توضيح';

  @override
  String get assistantResultLabel => 'رد مساعد مساري';

  @override
  String get assistantPassengerMessage => 'رسالتك';

  @override
  String get assistantExampleFindTrip =>
      'ابحث لي عن رحلة من باب الزاوية إلى بيت لحم الساعة 3 لشخص واحد';

  @override
  String get assistantReviewTitle => 'راجع معلومات الرحلة';

  @override
  String get assistantReviewBody =>
      'تأكد من المعلومات وعدّلها قبل بدء البحث الحقيقي.';

  @override
  String get assistantConfirmSearch => 'تأكيد وبدء البحث';

  @override
  String get assistantSearching => 'جارٍ البحث عن رحلة…';

  @override
  String get assistantSearchError =>
      'تعذّر إنشاء الطلب أو العثور على مسار مناسب. لم يتم إنشاء نتيجة وهمية.';

  @override
  String get assistantFutureTimeRequired => 'اختر وقتاً قادماً قبل بدء البحث.';

  @override
  String get mapAttribution => '© مساهمو OpenStreetMap';

  @override
  String get mapLoading => 'جارٍ تحميل الخريطة...';

  @override
  String get mapLoadFailed => 'تعذّر تحميل الخريطة';

  @override
  String get mapLoadFailedBody =>
      'تعذّر جلب بيانات المسار. تحقق من اتصالك ثم أعد المحاولة.';

  @override
  String get mapYourLocation => 'موقعك الحالي';

  @override
  String get mapRequestedRoute => 'المسار المطلوب';

  @override
  String get mapDriverRoute => 'مسار السائق المتاح';

  @override
  String mapOriginLabel(String name) {
    return 'نقطة الانطلاق: $name';
  }

  @override
  String mapDestinationLabel(String name) {
    return 'الوجهة: $name';
  }

  @override
  String mapStopLabel(String name) {
    return 'محطة: $name';
  }

  @override
  String get mapLegend => 'دليل الرموز';

  @override
  String get locationServiceDisabled =>
      'خدمة الموقع متوقفة على الجهاز. فعّلها لعرض موقعك على الخريطة.';

  @override
  String get locationPermissionDenied =>
      'لم يُسمح بالوصول إلى الموقع. اسمح بالوصول لعرض موقعك.';

  @override
  String get locationPermanentlyDenied =>
      'الوصول إلى الموقع مرفوض نهائياً. فعّله من إعدادات النظام.';

  @override
  String get locationUnavailable => 'تعذّر تحديد موقعك الآن.';

  @override
  String get locationEnable => 'تفعيل الموقع';

  @override
  String get checkpoints => 'الحواجز';

  @override
  String get checkpointsUnavailable => 'بيانات الحواجز غير متاحة';

  @override
  String get checkpointsUnavailableBody =>
      'تعذّر جلب حالة الحواجز. المسار معروض بدونها.';

  @override
  String get checkpointsDisabled => 'خدمة الحواجز غير مفعّلة في هذا الإصدار.';

  @override
  String get checkpointsStale =>
      'هذه آخر حالة مؤكدة للحواجز، وقد لا تكون محدّثة الآن.';

  @override
  String get checkpointsEmpty => 'لا توجد حواجز مسجّلة على هذا المسار.';

  @override
  String checkpointCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count حاجزاً',
      few: '$count حواجز',
      two: 'حاجزان',
      one: 'حاجز واحد',
      zero: 'لا حواجز',
    );
    return '$_temp0';
  }

  @override
  String get checkpointOpen => 'مفتوح';

  @override
  String get checkpointCongested => 'ازدحام';

  @override
  String get checkpointClosed => 'مغلق';

  @override
  String get checkpointUnknown => 'الحالة غير معروفة';

  @override
  String checkpointLabel(String name, String status) {
    return '$name — $status';
  }

  @override
  String get checkpointUnnamed => 'حاجز';

  @override
  String get mapRouteMissingCoordinates =>
      'لا توجد إحداثيات لهذا المسار، لذلك لا يمكن رسمه على الخريطة.';

  @override
  String get mapSelectRoute => 'اختر مساراً لعرضه على الخريطة.';

  @override
  String get recoverMerchantOrder => 'استعادة الطلب';

  @override
  String get merchantOrderUncertain =>
      'قد يكون الطلب قد حُفظ. استعده قبل إنشاء طلب آخر.';

  @override
  String get merchantOrderRecoveryExpired =>
      'انتهت مهلة إعادة المحاولة. يُسمح فقط بالتحقق من الطلب المحفوظ. تواصل مع الدعم إذا لم تُحسم نتيجة الطلب.';

  @override
  String get merchantOrderRecoveryUnavailable =>
      'استعادة الطلب غير متاحة. سجّل الدخول إلى حساب التاجر الأصلي أو تواصل مع الدعم. لا ترسل طلباً بديلاً.';

  @override
  String get bookingTimePassed => 'وقت المغادرة هذا قد مضى. اختر وقتاً قادماً.';

  @override
  String get bookingOutcomeUnknown =>
      'قد يكون الحجز محفوظًا بالفعل. سنتحقق منه عند عودة الاتصال. لا تنشئ حجزًا آخر.';

  @override
  String get verifyBooking => 'التحقق من الحجز';

  @override
  String get checkpointDirectoryTitle => 'دليل الحواجز';

  @override
  String get checkpointDirectoryDisabled => 'دليل الحواجز غير مفعّل.';

  @override
  String get checkpointDirectoryLoadFailed => 'تعذر تحميل دليل الحواجز.';

  @override
  String get checkpointDirectorySearch => 'ابحث عن حاجز أو مدينة';

  @override
  String get checkpointDirectoryNoResults => 'لا توجد حواجز مطابقة';

  @override
  String get checkpointDirectoryTrafficUnavailable => 'حالة المرور غير متاحة';

  @override
  String get checkpointDirectoryLimitedNotice =>
      'بيانات محدودة من المزود: حتى سبع نقاط في كل مدينة. هذه ليست القائمة الكاملة.';

  @override
  String get checkpointDirectoryGenerated => 'وقت إنشاء استجابة المزود';

  @override
  String get checkpointDirectoryEnteringUpdated =>
      'آخر تغيير لحالة الدخول (الحالة غير متاحة)';

  @override
  String get checkpointDirectoryLeavingUpdated =>
      'آخر تغيير لحالة الخروج (الحالة غير متاحة)';

  @override
  String get checkpointDirectoryTimezoneUnspecified =>
      'المنطقة الزمنية غير محددة';

  @override
  String get notifMatchOfferedTitle => 'عرض مطابقة جديد';

  @override
  String get notifMatchOfferedBody => 'لديك طلب جديد بانتظار ردّك.';

  @override
  String get notifMatchAcceptedTitle => 'تم قبول طلبك';

  @override
  String get notifMatchAcceptedBody => 'قَبِل أحد السائقين طلبك.';

  @override
  String get notifMatchRejectedTitle => 'اعتذر السائق';

  @override
  String get notifMatchRejectedBody =>
      'اعتذر السائق عن الطلب. يمكنك البحث عن مطابقة أخرى.';

  @override
  String get notifTripStatusTitle => 'تحديث على الرحلة';

  @override
  String notifTripStatusBody(String status) {
    return 'حالة الرحلة الآن: $status';
  }

  @override
  String get notifVerificationApprovedTitle => 'تمت الموافقة على حسابك';

  @override
  String get notifVerificationApprovedBody =>
      'تمت الموافقة على حساب السائق. يمكنك الآن البدء بالعمل.';

  @override
  String get notifVerificationRejectedTitle => 'تم رفض طلب التحقق';

  @override
  String get notifVerificationRejectedBody =>
      'لم تتم الموافقة على طلب التحقق من حسابك.';

  @override
  String notifVerificationRejectedReason(String reason) {
    return 'السبب: $reason';
  }

  @override
  String get notifUnknownTitle => 'إشعار جديد';

  @override
  String get notificationsMarkAllRead => 'تعليم الكل كمقروء';

  @override
  String get notificationsLoadError => 'تعذّر تحميل الإشعارات.';

  @override
  String notificationsUnreadCount(int count) {
    return '$count غير مقروءة';
  }

  @override
  String get reportsDeliveries => 'التوصيلات';

  @override
  String get reportsLoadError => 'تعذّر تحميل التقرير.';

  @override
  String get reportsOrdersByStatus => 'الطلبات حسب الحالة';

  @override
  String get reportsDeliveriesByStatus => 'التوصيلات حسب الحالة';

  @override
  String get reportsNoRecords => 'لا توجد سجلات بعد.';

  @override
  String get incidentReportAction => 'الإبلاغ عن مشكلة';

  @override
  String get incidentReportTitle => 'الإبلاغ عن مشكلة';

  @override
  String get incidentReportNotice =>
      'يُسجَّل بلاغك لتراجعه الإدارة. هذه ليست خدمة طوارئ؛ في حال الخطر اتصل بالجهات المختصة مباشرة.';

  @override
  String get incidentDescriptionLabel => 'صف المشكلة';

  @override
  String get incidentSubmit => 'إرسال البلاغ';

  @override
  String get incidentSubmitted => 'تم إرسال البلاغ.';

  @override
  String get incidentSubmitFailed => 'تعذّر إرسال البلاغ. حاول مرة أخرى.';

  @override
  String get incidentTooMany =>
      'لديك عدة بلاغات قيد المراجعة. انتظر معالجتها قبل إرسال بلاغ جديد.';

  @override
  String get incidentCategorySafety => 'السلامة';

  @override
  String get incidentCategoryDelay => 'تأخير';

  @override
  String get incidentCategoryParcelDamage => 'تلف طرد';

  @override
  String get incidentCategoryBehavior => 'سلوك';

  @override
  String get incidentCategoryOther => 'أخرى';

  @override
  String get notifIncidentUpdatedTitle => 'تحديث على بلاغك';

  @override
  String get notifIncidentReviewingBody => 'بلاغك قيد المراجعة.';

  @override
  String get notifIncidentResolvedBody => 'تمت معالجة بلاغك.';

  @override
  String get verificationDocuments => 'مستندات التوثيق';

  @override
  String get verificationDocumentsHint =>
      'للحصول على الموافقة، ارفع صوراً واضحة أو ملفات PDF لرخصة القيادة وتسجيل المركبة والهوية الوطنية. تُحفظ الملفات على خادمنا ولا يفتحها إلا فريق المراجعة.';

  @override
  String get documentKind => 'نوع المستند';

  @override
  String get documentKindDriverLicence => 'رخصة القيادة';

  @override
  String get documentKindVehicleRegistration => 'ترخيص المركبة';

  @override
  String get documentKindNationalId => 'الهوية الوطنية';

  @override
  String get documentKindInsurance => 'التأمين';

  @override
  String get documentKindOther => 'مستند آخر';

  @override
  String get addDocument => 'إضافة مستند';

  @override
  String get removeDocument => 'إزالة المستند';

  @override
  String get documentTooLarge => 'الملف كبير جدًا. الحد الأقصى 5 ميغابايت.';

  @override
  String get documentTypeUnsupported =>
      'يمكن رفع ملفات JPEG أو PNG أو PDF فقط.';

  @override
  String get documentLimitReached => 'وصلت إلى الحد الأقصى لعدد المستندات.';

  @override
  String get acceptanceRateTitle => 'نسبة القبول';

  @override
  String acceptanceRateValue(int percent) {
    return '$percent%';
  }

  @override
  String acceptanceRateDetail(int accepted, int responded) {
    return 'تم قبول $accepted من $responded عرضًا أجبت عنها. العروض التي انتهت دون رد لا تُحتسب.';
  }

  @override
  String acceptanceRateNeedMore(int needed, int responded) {
    return 'تظهر نسبتك بعد $needed عروض تم الرد عليها ($responded حتى الآن).';
  }

  @override
  String get emailOrPhone => 'البريد الإلكتروني أو رقم الهاتف';

  @override
  String get emailOrPhoneRequired => 'أدخل بريدك الإلكتروني أو رقم هاتفك.';

  @override
  String get emailOrPhoneInvalid =>
      'أدخل بريدًا إلكترونيًا صحيحًا، أو رقم هاتف يبدأ بـ + ورمز الدولة.';

  @override
  String get mapLegendStart => 'البداية';

  @override
  String get mapLegendDestination => 'الوصول';

  @override
  String get sendParcelTitle => 'إرسال طرد';

  @override
  String get sendParcelEntryBody =>
      'أرسل طردًا صغيرًا مع سائق يسير أصلًا على مسار معتمد.';

  @override
  String get sendParcelIntro =>
      'اختر المسار والمحطتين ثم أخبرنا من سيستلم الطرد. سيحمله سائق متجه في هذا الاتجاه.';

  @override
  String get sendParcelPickupHint => 'سلّم الطرد للسائق عند هذه المحطة.';

  @override
  String get parcelSizeSmallHint => 'S - صغير، يكفي لحقيبة';

  @override
  String get parcelSizeMediumHint => 'M - متوسط، بحجم علبة حذاء تقريبًا';

  @override
  String get parcelSizeLargeNotAllowed =>
      'الطرود الكبيرة مخصصة للمتاجر ولا يمكن إرسالها من حساب شخصي.';

  @override
  String get receiverNameLabel => 'اسم المستلم';

  @override
  String get receiverPhoneLabel => 'هاتف المستلم';

  @override
  String get receiverPrivacyNote =>
      'المستلم لا يحتاج إلى التطبيق. يُستخدم اسمه ورقمه لهذا التوصيل فقط، ولا يظهران لأي مستخدم آخر، ويُمسحان بعد انتهاء المدة.';

  @override
  String get parcelNoteLabel => 'ملاحظة للسائق (اختياري)';

  @override
  String get forbiddenItemsAck =>
      'أقرّ بأن الطرد لا يحتوي على نقود أو أشياء ثمينة أو أدوية أو أسلحة أو مواد قابلة للاشتعال أو ممنوعة أو سريعة التلف.';

  @override
  String get sendParcelSubmit => 'إرسال الطرد';

  @override
  String get sendParcelRecorded => 'تم تسجيل طلب الطرد.';

  @override
  String get sendParcelRecordedBody =>
      'نبحث عن سائق على هذا المسار. يمكنك الإلغاء ما لم يُعرض الطرد على سائق.';

  @override
  String get myParcelsTitle => 'طرودي';

  @override
  String get myParcelsEmpty => 'لم ترسل أي طرد بعد.';

  @override
  String get parcelTrackSearching => 'جارٍ البحث عن سائق';

  @override
  String get parcelTrackAssigned => 'تم تعيين سائق';

  @override
  String get parcelTrackPickedUp => 'تم استلامه منك';

  @override
  String get parcelTrackInTransit => 'في الطريق';

  @override
  String get parcelTrackDelivered => 'تم التسليم';

  @override
  String get parcelTrackCancelled => 'ملغى';

  @override
  String get parcelTrackFailed => 'تعذّر التوصيل';

  @override
  String get parcelTrackExpired => 'انتهت المهلة';

  @override
  String get parcelCancelAction => 'إلغاء الطرد';

  @override
  String get parcelCancelConfirm =>
      'هل تريد إلغاء هذا الطرد؟ سيتم مسح بيانات المستلم.';

  @override
  String get parcelCancelledNotice => 'تم إلغاء الطرد.';

  @override
  String get parcelCannotCancel =>
      'عُرض الطرد على سائق بالفعل، لذلك لم يعد الإلغاء ممكنًا.';

  @override
  String parcelReceiverLine(String name, String phone) {
    return 'المستلم: $name ($phone)';
  }

  @override
  String get parcelReceiverRemoved => 'تم مسح بيانات المستلم.';

  @override
  String get parcelLimitReached =>
      'لديك الحد الأقصى من الطرود قيد التوصيل. انتظر انتهاء أحدها أو ألغِ واحدًا.';

  @override
  String get parcelDailyLimit => 'تم بلوغ حد الطرود اليومي. حاول غدًا.';

  @override
  String get invalidReceiverPhone => 'أدخل رقم هاتف صحيحًا للمستلم.';

  @override
  String get receiverNameInvalid => 'أدخل اسم المستلم.';

  @override
  String get parcelAckRequired =>
      'أكّد الإقرار الخاص بالمواد الممنوعة للمتابعة.';

  @override
  String get keepParcel => 'إبقاء الطرد';

  @override
  String get mapOfflineSaved => 'بدون اتصال - تُعرض الخريطة المحفوظة';

  @override
  String get clearMapCache => 'مسح الخريطة المحفوظة';

  @override
  String get clearMapCacheHint =>
      'يحذف مربعات الخريطة المحفوظة على هذا الجهاز. تُحفظ من جديد أثناء التصفح.';

  @override
  String get mapCacheCleared => 'تم مسح الخريطة المحفوظة';

  @override
  String get mapCacheClearFailed => 'تعذّر مسح الخريطة المحفوظة';

  @override
  String get notifDocsExpiringTitle => 'مستند على وشك الانتهاء';

  @override
  String notifDocsExpiringBody(String document, String date) {
    return 'ينتهي $document بتاريخ $date. أرسل مستندات مجددة قبل ذلك لتواصل العمل دون انقطاع.';
  }

  @override
  String get notifDocsExpiredTitle => 'انتهت صلاحية مستنداتك';

  @override
  String get notifDocsExpiredBody =>
      'تم تقييد حسابك ولا يمكنك الاتصال أو قبول رحلات جديدة حتى تُرسل مستندات مجددة وتتم الموافقة عليها. رحلاتك المقبولة سابقاً لا تتأثر.';

  @override
  String get notifDocsRenewalSubmittedTitle => 'تم إرسال مستندات التجديد';

  @override
  String get notifDocsRenewalSubmittedBody =>
      'سيراجعها فريقنا وتصلك رسالة عند اتخاذ القرار.';

  @override
  String get documentKindContract => 'العقد';

  @override
  String get availabilityDocumentsExpired =>
      'انتهت صلاحية مستنداتك. أرسل مستندات مجددة لاستعادة الوصول.';

  @override
  String get applicationDocumentsRequiredTitle => 'ارفع مستنداتك';

  @override
  String get applicationDocumentsRequiredBody =>
      'تم إنشاء حسابك لكنه ليس قيد المراجعة بعد. ارفع كل المستندات المطلوبة ثم أرسل طلبك. تستغرق المراجعة عادةً حتى 24 ساعة.';

  @override
  String documentsStillNeeded(String documents) {
    return 'ما زال مطلوباً: $documents';
  }

  @override
  String get submitApplication => 'إرسال للمراجعة';

  @override
  String get documentsRequiredError =>
      'ارفع كل المستندات المطلوبة قبل إرسال طلبك.';

  @override
  String get invitationCodeOptional => 'رمز الدعوة (اختياري)';

  @override
  String get fareEstimatedTitle => 'الأجرة التقديرية';

  @override
  String get fareBookedTitle => 'الأجرة التقديرية عند الطلب';

  @override
  String get fareDisclaimer =>
      'تقديرية، وتُدفع مباشرة إلى السائق. لا تتم معالجة أي مدفوعات داخل التطبيق.';

  @override
  String get fareNotSet => 'لم تُحدَّد أجرة تقديرية لهذا المسار بعد.';

  @override
  String get farePerSeat => 'للمقعد الواحد';

  @override
  String fareSeatsLine(int count) {
    return 'المقاعد × $count';
  }

  @override
  String fareParcelLine(String size) {
    return 'طرد $size';
  }

  @override
  String get fareTotal => 'الإجمالي';

  @override
  String get notifDriverApproachingTitle => 'سائقك يقترب';

  @override
  String get notifDriverApproachingBody =>
      'سائقك قريب من نقطة الانطلاق. يرجى الاستعداد.';

  @override
  String get ratingPromptTitle => 'كيف كانت رحلتك؟';

  @override
  String get ratingPromptBody =>
      'قيّم السائق من 1 إلى 5 نجوم. تقييمك سري: لا يرى السائق التقييم ولا من قدّمه.';

  @override
  String ratingStarLabel(int count) {
    return '$count نجوم';
  }

  @override
  String get ratingSubmit => 'إرسال التقييم';

  @override
  String get ratingThanks => 'شكرًا لتقييمك الرحلة.';

  @override
  String get ratingFailed => 'تعذّر إرسال التقييم. حاول مرة أخرى.';

  @override
  String get ratingAlreadyRated => 'لقد قيّمت هذه الرحلة من قبل.';

  @override
  String get renewalTitle => 'جدّد مستنداتك';

  @override
  String get renewalOpen => 'تجديد المستندات';

  @override
  String get renewalBannerTitle => 'انتهت صلاحية مستنداتك';

  @override
  String get renewalBannerBody =>
      'لا يمكنك الاتصال بالإنترنت أو قبول رحلات جديدة حتى ترسل مستنداتك المجدَّدة وتتم الموافقة عليها.';

  @override
  String get renewalBannerSubmittedTitle => 'التجديد قيد المراجعة';

  @override
  String get renewalBannerSubmittedBody =>
      'مستنداتك المجدَّدة بانتظار المراجعة.';

  @override
  String get renewalIntro =>
      'ارفع صوراً واضحة أو ملفات PDF لرخصة القيادة وترخيص المركبة والتأمين المجدَّدة، ثم أرسلها للمراجعة. الرحلات التي قبلتها سابقاً لا تتأثر.';

  @override
  String get renewalUploaded => 'المستندات المرفوعة';

  @override
  String get renewalNoDocuments => 'لم يتم رفع أي مستندات مجدَّدة بعد.';

  @override
  String get renewalSubmit => 'إرسال للمراجعة';

  @override
  String get renewalSubmittedTitle => 'بانتظار المراجعة';

  @override
  String get renewalSubmittedBody =>
      'استلمنا مستنداتك المجدَّدة. سيتم إشعارك عندما يوافق فريق المراجعة عليها.';

  @override
  String get renewalDocumentsRequired =>
      'ارفع مستنداً مجدَّداً واحداً على الأقل قبل الإرسال.';

  @override
  String get renewalStateConflict =>
      'تغيّرت حالة التجديد. اسحب للتحديث وحاول مرة أخرى.';

  @override
  String get renewalLoadError => 'تعذّر تحميل حالة التجديد.';

  @override
  String get renewalNothingToRenew =>
      'مستنداتك محدّثة. لا يوجد ما يتطلب التجديد.';
}
