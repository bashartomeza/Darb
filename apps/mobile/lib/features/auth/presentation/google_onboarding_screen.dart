import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/darb_card.dart';
import '../application/auth_controller.dart';
import '../data/auth_repository.dart';
import 'auth_completion_screen.dart' show authFailure, authText;
import 'widgets/auth_style.dart';

enum GoogleOnboardingRole { passenger, driver, merchant }

enum _Step {
  role,
  about,
  location,
  identity,
  vehicle,
  store,
  storeContact,
  terms,
}

const _vehicleTypes = ['sedan', 'suv', 'van', 'minibus'];
const _storeTypes = [
  'grocery',
  'restaurant',
  'pharmacy',
  'clothing',
  'electronics',
  'bakery',
  'other',
];
const _phonePattern = r'^\+[1-9]\d{6,14}$';

/// After a first Google sign-in: choose a role, then a few short steps that
/// collect only what that role needs, then accept the terms.
///
/// Passengers and shop owners go straight into the app. Drivers continue to
/// document upload and wait for Admin approval on `/onboarding`.
class GoogleOnboardingScreen extends ConsumerStatefulWidget {
  const GoogleOnboardingScreen({super.key});

  @override
  ConsumerState<GoogleOnboardingScreen> createState() =>
      _GoogleOnboardingScreenState();
}

class _GoogleOnboardingScreenState
    extends ConsumerState<GoogleOnboardingScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _city = TextEditingController();
  final _nationalId = TextEditingController();
  final _licenceNumber = TextEditingController();
  final _makeModel = TextEditingController();
  final _color = TextEditingController();
  final _plate = TextEditingController();
  final _storeName = TextEditingController();
  final _address = TextEditingController();

  GoogleOnboardingRole? _role;
  int _index = 0;
  DateTime? _licenceExpiry;
  String _vehicleType = _vehicleTypes.first;
  int _seats = 4;
  int _parcels = 2;
  String? _storeType;
  String _salesChannel = 'physical';

  List<Map<String, dynamic>>? _documents;
  String? _locale;
  final Set<String> _accepted = {};
  bool _busy = false;
  Object? _error;
  bool _showErrors = false;

  @override
  void initState() {
    super.initState();
    final grant = ref.read(authControllerProvider).value?.registrationGrant;
    final suggested = grant?['suggested_name'];
    if (suggested is String) _name.text = suggested;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final locale = Localizations.localeOf(context).languageCode;
    if (locale != _locale) {
      _locale = locale;
      _documents = null;
      _accepted.clear();
      _loadConsents(locale);
    }
  }

  @override
  void dispose() {
    for (final controller in [
      _name,
      _phone,
      _city,
      _nationalId,
      _licenceNumber,
      _makeModel,
      _color,
      _plate,
      _storeName,
      _address,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _loadConsents(String locale) async {
    try {
      final documents = await ref.read(authRepositoryProvider).consents(locale);
      if (mounted && _locale == locale) {
        setState(() => _documents = documents);
      }
    } catch (error) {
      if (mounted && _locale == locale) setState(() => _error = error);
    }
  }

  List<_Step> get _steps => switch (_role) {
    null => const [_Step.role],
    GoogleOnboardingRole.passenger => const [
      _Step.role,
      _Step.about,
      _Step.location,
      _Step.terms,
    ],
    GoogleOnboardingRole.driver => const [
      _Step.role,
      _Step.about,
      _Step.identity,
      _Step.vehicle,
      _Step.terms,
    ],
    GoogleOnboardingRole.merchant => const [
      _Step.role,
      _Step.store,
      _Step.storeContact,
      _Step.terms,
    ],
  };

  _Step get _step => _steps[_index];

  String _t(String en, String ar) => authText(context, en, ar);

  void _back() {
    if (_busy) return;
    if (_index == 0) {
      ref.read(authControllerProvider.notifier).cancelRegistration();
      return;
    }
    setState(() {
      _index -= 1;
      _error = null;
      _showErrors = false;
    });
  }

  void _continue() {
    if (_busy) return;
    setState(() => _error = null);
    if (_step == _Step.role) {
      if (_role == null) return;
    } else if (_step == _Step.terms) {
      _submit();
      return;
    } else {
      final validForm = _formKey.currentState?.validate() ?? false;
      final validExtras = _extrasValid();
      if (!validForm || !validExtras) {
        setState(() => _showErrors = true);
        return;
      }
    }
    setState(() {
      _index += 1;
      _showErrors = false;
    });
  }

  /// Choices that are not text fields: a chip selection or a picked date.
  bool _extrasValid() => switch (_step) {
    _Step.identity => _licenceExpiry != null,
    _Step.store => _storeType != null,
    _ => true,
  };

  Map<String, dynamic> _profile() {
    final phone = _phone.text.trim();
    final city = _city.text.trim();
    return switch (_role!) {
      GoogleOnboardingRole.passenger => {'phone': phone, 'city': city},
      GoogleOnboardingRole.driver => {
        'phone': phone,
        'city': city,
        'national_id_number': _nationalId.text.trim(),
        'licence_number': _licenceNumber.text.trim(),
        'licence_expires_at': _isoDate(_licenceExpiry!),
        'vehicle_type': _vehicleType,
        'vehicle_make_model': _makeModel.text.trim(),
        'vehicle_color': _color.text.trim(),
        'plate_number': _plate.text.trim().toUpperCase(),
        'seats_total': _seats,
        'parcel_capacity': _parcels,
      },
      GoogleOnboardingRole.merchant => {
        'phone': phone,
        'store_name': _storeName.text.trim(),
        'store_type': _storeType,
        'sales_channel': _salesChannel,
        'city': city,
        if (_salesChannel != 'online' && _address.text.trim().isNotEmpty)
          'address': _address.text.trim(),
      },
    };
  }

  Future<void> _submit() async {
    final documents = _documents;
    if (documents == null || _accepted.length != documents.length) return;
    final router = GoRouter.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final pending = await ref
          .read(authControllerProvider.notifier)
          .completeGoogleOnboarding(
            locale: _locale!,
            documents: documents,
            name: _name.text.trim(),
            role: _role!.name,
            profile: _profile(),
          );
      // Passengers and shop owners are signed in now; the router opens their
      // home. A driver has no session yet and continues to document upload.
      if (pending) router.go('/onboarding');
      final failure = ref.read(authControllerProvider).value?.error;
      if (!pending && failure != null && mounted) {
        setState(() => _error = failure);
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
      if (error is ApiException && error.message == 'consent_version_changed') {
        _accepted.clear();
        await _loadConsents(_locale!);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final steps = _steps;
    final progress = _role == null ? 0.0 : _index / (steps.length - 1);
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        key: const ValueKey('googleOnboardingScreen'),
        backgroundColor: Colors.white,
        appBar: AppBar(
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.transparent,
          scrolledUnderElevation: 0,
          leading: BackButton(onPressed: _busy ? null : _back),
          title: Text(_t('Set up your account', 'إعداد حسابك')),
          actions: const [LanguageSwitch()],
        ),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _ProgressHeader(
                    label: _role == null
                        ? _t('Get started', 'لنبدأ')
                        : _t(
                            'Step ${_index + 1} of ${steps.length}',
                            'الخطوة ${_index + 1} من ${steps.length}',
                          ),
                    progress: progress,
                  ),
                  Expanded(
                    child: Form(
                      key: _formKey,
                      autovalidateMode: _showErrors
                          ? AutovalidateMode.onUserInteraction
                          : AutovalidateMode.disabled,
                      child: ListView(
                        key: ValueKey('googleOnboardingStep-${_step.name}'),
                        padding: const EdgeInsets.fromLTRB(
                          AppTokens.marginMobile,
                          AppTokens.spaceSmall,
                          AppTokens.marginMobile,
                          AppTokens.spaceLarge,
                        ),
                        children: _stepBody(),
                      ),
                    ),
                  ),
                  _navigation(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _navigation() {
    final last = _step == _Step.terms;
    final canContinue = switch (_step) {
      _Step.role => _role != null,
      _Step.terms =>
        _documents != null && _accepted.length == _documents!.length,
      _ => true,
    };
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppTokens.marginMobile,
        AppTokens.spaceSmall,
        AppTokens.marginMobile,
        AppTokens.spaceMedium,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTokens.spaceSmall),
              child: Semantics(
                liveRegion: true,
                child: Text(
                  _failure(_error),
                  key: const ValueKey('googleOnboardingError'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ),
          Row(
            children: [
              Expanded(
                child: SizedBox(
                  height: AuthStyle.buttonHeight,
                  child: OutlinedButton(
                    key: const ValueKey('googleOnboardingBack'),
                    onPressed: _busy ? null : _back,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AuthStyle.text,
                      side: const BorderSide(color: AuthStyle.border),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AuthStyle.radius),
                      ),
                    ),
                    child: Text(
                      _index == 0 ? _t('Cancel', 'إلغاء') : _t('Back', 'رجوع'),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: AppTokens.gutterMobile),
              Expanded(
                flex: 2,
                child: AuthPrimaryButton(
                  buttonKey: const ValueKey('googleOnboardingContinue'),
                  label: last
                      ? (_role == GoogleOnboardingRole.driver
                            ? _t('Submit application', 'إرسال الطلب')
                            : _t('Create account', 'إنشاء الحساب'))
                      : _t('Continue', 'متابعة'),
                  loading: _busy,
                  onPressed: _busy || !canContinue ? null : _continue,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  List<Widget> _stepBody() => switch (_step) {
    _Step.role => _roleStep(),
    _Step.about => _aboutStep(),
    _Step.location => _locationStep(),
    _Step.identity => _identityStep(),
    _Step.vehicle => _vehicleStep(),
    _Step.store => _storeStep(),
    _Step.storeContact => _storeContactStep(),
    _Step.terms => _termsStep(),
  };

  List<Widget> _roleStep() {
    final capabilities = ref.watch(authCapabilitiesProvider).value;
    final driverAvailable =
        capabilities?['google_driver_signup_available'] != false;
    return [
      _StepTitle(
        title: _t('How will you use Darb?', 'كيف ستستخدم درب؟'),
        subtitle: _t(
          'Choose one. It sets up the right experience for you.',
          'اختر واحداً، وسنجهز لك التجربة المناسبة.',
        ),
      ),
      _RoleOption(
        key: const ValueKey('googleRole-passenger'),
        icon: Icons.person_outline,
        title: _t('Passenger', 'راكب'),
        help: _t(
          'Book rides and send parcels. Ready right away.',
          'احجز رحلات وأرسل طروداً. جاهز فوراً.',
        ),
        selected: _role == GoogleOnboardingRole.passenger,
        onTap: () => _chooseRole(GoogleOnboardingRole.passenger),
      ),
      _RoleOption(
        key: const ValueKey('googleRole-driver'),
        icon: Icons.directions_car_outlined,
        title: _t('Driver', 'سائق'),
        help: driverAvailable
            ? _t(
                'Drive on Darb routes. Needs Admin approval first.',
                'قُد على مسارات درب. يتطلب موافقة الإدارة أولاً.',
              )
            : _t(
                'Driver applications are not open right now.',
                'طلبات السائقين غير متاحة حالياً.',
              ),
        selected: _role == GoogleOnboardingRole.driver,
        onTap: driverAvailable
            ? () => _chooseRole(GoogleOnboardingRole.driver)
            : null,
      ),
      _RoleOption(
        key: const ValueKey('googleRole-merchant'),
        icon: Icons.storefront_outlined,
        title: _t('Shop owner', 'صاحب متجر'),
        help: _t(
          'Send orders to your customers. Ready right away.',
          'أرسل الطلبات إلى زبائنك. جاهز فوراً.',
        ),
        selected: _role == GoogleOnboardingRole.merchant,
        onTap: () => _chooseRole(GoogleOnboardingRole.merchant),
      ),
    ];
  }

  void _chooseRole(GoogleOnboardingRole role) {
    if (_busy) return;
    setState(() {
      _role = role;
      _error = null;
    });
  }

  List<Widget> _aboutStep() => [
    _StepTitle(
      title: _t('About you', 'معلوماتك'),
      subtitle: _t(
        'We filled in your name from Google. You can change it.',
        'أخذنا اسمك من Google، ويمكنك تعديله.',
      ),
    ),
    _nameField(_t('Full name', 'الاسم الكامل')),
    _gap,
    _phoneField(),
    if (_role == GoogleOnboardingRole.driver) ...[_gap, _cityField()],
  ];

  List<Widget> _locationStep() => [
    _StepTitle(
      title: _t('Where are you?', 'أين أنت؟'),
      subtitle: _t(
        'Your city helps us show routes near you.',
        'تساعدنا مدينتك على عرض المسارات القريبة منك.',
      ),
    ),
    _cityField(),
  ];

  List<Widget> _identityStep() => [
    _StepTitle(
      title: _t('Identity and licence', 'الهوية والرخصة'),
      subtitle: _t(
        'An Admin checks these against the documents you upload next.',
        'تطابق الإدارة هذه البيانات مع المستندات التي سترفعها لاحقاً.',
      ),
    ),
    AuthTextField(
      key: const ValueKey('googleNationalId'),
      controller: _nationalId,
      hint: _t('National ID number', 'رقم الهوية الوطنية'),
      icon: Icons.badge_outlined,
      textInputAction: TextInputAction.next,
      inputFormatters: [
        FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9-]')),
        LengthLimitingTextInputFormatter(40),
      ],
      validator: (value) =>
          RegExp(r'^[A-Za-z0-9-]{5,40}$').hasMatch(value ?? '')
          ? null
          : _t('Enter your ID number', 'أدخل رقم هويتك'),
    ),
    _gap,
    AuthTextField(
      key: const ValueKey('googleLicenceNumber'),
      controller: _licenceNumber,
      hint: _t('Driving licence number', 'رقم رخصة القيادة'),
      icon: Icons.credit_card_outlined,
      textInputAction: TextInputAction.done,
      inputFormatters: [
        FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9-]')),
        LengthLimitingTextInputFormatter(40),
      ],
      validator: (value) =>
          RegExp(r'^[A-Za-z0-9-]{4,40}$').hasMatch(value ?? '')
          ? null
          : _t('Enter your licence number', 'أدخل رقم الرخصة'),
    ),
    _gap,
    _PickerTile(
      key: const ValueKey('googleLicenceExpiry'),
      icon: Icons.event_outlined,
      label: _licenceExpiry == null
          ? _t('Licence expiry date', 'تاريخ انتهاء الرخصة')
          : _isoDate(_licenceExpiry!),
      filled: _licenceExpiry != null,
      error: _showErrors && _licenceExpiry == null
          ? _t('Pick the expiry date', 'اختر تاريخ الانتهاء')
          : null,
      onTap: _pickExpiry,
    ),
  ];

  Future<void> _pickExpiry() async {
    final today = DateUtils.dateOnly(DateTime.now());
    final picked = await showDatePicker(
      context: context,
      initialDate: _licenceExpiry ?? today.add(const Duration(days: 365)),
      firstDate: today,
      lastDate: DateTime(today.year + 20),
    );
    if (picked != null && mounted) setState(() => _licenceExpiry = picked);
  }

  List<Widget> _vehicleStep() => [
    _StepTitle(
      title: _t('Your vehicle', 'مركبتك'),
      subtitle: _t(
        'The car you will drive on Darb.',
        'السيارة التي ستقودها على درب.',
      ),
    ),
    _ChipGroup(
      label: _t('Vehicle type', 'نوع المركبة'),
      options: {
        for (final type in _vehicleTypes) type: _vehicleTypeLabel(type),
      },
      selected: _vehicleType,
      onSelected: (value) => setState(() {
        _vehicleType = value;
        if (_seats > _maxSeats) _seats = _maxSeats;
      }),
    ),
    _gap,
    AuthTextField(
      key: const ValueKey('googleMakeModel'),
      controller: _makeModel,
      hint: _t(
        'Make and model (e.g. Kia Optima)',
        'الشركة والطراز (مثل كيا أوبتيما)',
      ),
      icon: Icons.directions_car_outlined,
      textInputAction: TextInputAction.next,
      textCapitalization: TextCapitalization.words,
      validator: _required(
        2,
        80,
        _t('Enter make and model', 'أدخل الشركة والطراز'),
      ),
    ),
    _gap,
    Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: AuthTextField(
            key: const ValueKey('googleVehicleColor'),
            controller: _color,
            hint: _t('Colour', 'اللون'),
            icon: Icons.palette_outlined,
            textInputAction: TextInputAction.next,
            validator: _required(2, 30, _t('Enter colour', 'أدخل اللون')),
          ),
        ),
        const SizedBox(width: AppTokens.gutterMobile),
        Expanded(
          child: AuthTextField(
            key: const ValueKey('googlePlate'),
            controller: _plate,
            hint: _t('Plate number', 'رقم اللوحة'),
            icon: Icons.pin_outlined,
            textCapitalization: TextCapitalization.characters,
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9 -]')),
              LengthLimitingTextInputFormatter(20),
            ],
            validator: (value) =>
                RegExp(r'^[A-Za-z0-9 -]{2,20}$').hasMatch(value?.trim() ?? '')
                ? null
                : _t('Enter plate', 'أدخل اللوحة'),
          ),
        ),
      ],
    ),
    _gap,
    _Stepper(
      label: _t('Passenger seats', 'مقاعد الركاب'),
      value: _seats,
      min: 1,
      max: _maxSeats,
      onChanged: (value) => setState(() => _seats = value),
    ),
    _Stepper(
      label: _t('Parcels you can carry', 'الطرود التي يمكنك حملها'),
      value: _parcels,
      min: 0,
      max: 20,
      onChanged: (value) => setState(() => _parcels = value),
    ),
  ];

  int get _maxSeats => switch (_vehicleType) {
    'sedan' => 4,
    'suv' => 6,
    _ => 8,
  };

  String _vehicleTypeLabel(String type) => switch (type) {
    'sedan' => _t('Sedan', 'سيدان'),
    'suv' => _t('SUV', 'دفع رباعي'),
    'van' => _t('Van', 'فان'),
    _ => _t('Minibus', 'ميني باص'),
  };

  List<Widget> _storeStep() => [
    _StepTitle(
      title: _t('Your store', 'متجرك'),
      subtitle: _t('Tell customers who you are.', 'عرّف زبائنك بمتجرك.'),
    ),
    AuthTextField(
      key: const ValueKey('googleStoreName'),
      controller: _storeName,
      hint: _t('Store name', 'اسم المتجر'),
      icon: Icons.storefront_outlined,
      textInputAction: TextInputAction.next,
      textCapitalization: TextCapitalization.words,
      validator: _required(
        2,
        120,
        _t('Enter the store name', 'أدخل اسم المتجر'),
      ),
    ),
    _gap,
    _nameField(_t('Owner full name', 'اسم المالك الكامل')),
    _gap,
    _ChipGroup(
      label: _t('Store type', 'نوع المتجر'),
      options: {for (final type in _storeTypes) type: _storeTypeLabel(type)},
      selected: _storeType,
      error: _showErrors && _storeType == null
          ? _t('Choose a store type', 'اختر نوع المتجر')
          : null,
      onSelected: (value) => setState(() => _storeType = value),
    ),
  ];

  String _storeTypeLabel(String type) => switch (type) {
    'grocery' => _t('Grocery', 'بقالة'),
    'restaurant' => _t('Restaurant', 'مطعم'),
    'pharmacy' => _t('Pharmacy', 'صيدلية'),
    'clothing' => _t('Clothing', 'ملابس'),
    'electronics' => _t('Electronics', 'إلكترونيات'),
    'bakery' => _t('Bakery', 'مخبز'),
    _ => _t('Other', 'أخرى'),
  };

  List<Widget> _storeContactStep() => [
    _StepTitle(
      title: _t('Contact and location', 'التواصل والموقع'),
      subtitle: _t(
        'How customers and drivers reach you.',
        'كيف يصل إليك الزبائن والسائقون.',
      ),
    ),
    _phoneField(),
    _gap,
    _ChipGroup(
      label: _t('Where do you sell?', 'أين تبيع؟'),
      options: {
        'physical': _t('In a shop', 'في محل'),
        'online': _t('Online', 'عبر الإنترنت'),
        'both': _t('Both', 'كلاهما'),
      },
      selected: _salesChannel,
      onSelected: (value) => setState(() => _salesChannel = value),
    ),
    _gap,
    _cityField(),
    if (_salesChannel != 'online') ...[
      _gap,
      AuthTextField(
        key: const ValueKey('googleStoreAddress'),
        controller: _address,
        hint: _t('Shop address', 'عنوان المحل'),
        icon: Icons.place_outlined,
        textCapitalization: TextCapitalization.sentences,
        validator: _required(
          3,
          200,
          _t('Enter the shop address', 'أدخل عنوان المحل'),
        ),
      ),
    ],
  ];

  List<Widget> _termsStep() {
    final documents = _documents;
    return [
      _StepTitle(
        title: _t('Almost done', 'اقتربت من الانتهاء'),
        subtitle: _role == GoogleOnboardingRole.driver
            ? _t(
                'Accept the terms to send your details. Next you upload your driving licence, vehicle registration and ID for Admin review.',
                'وافق على الشروط لإرسال بياناتك. بعدها ترفع رخصة القيادة ورخصة المركبة والهوية لمراجعة الإدارة.',
              )
            : _t(
                'Read and accept these to create your account.',
                'اقرأ هذه المستندات ووافق عليها لإنشاء حسابك.',
              ),
      ),
      if (documents == null && _error == null)
        const Padding(
          padding: EdgeInsets.all(AppTokens.spaceLarge),
          child: Center(child: CircularProgressIndicator()),
        ),
      if (documents == null && _error != null)
        TextButton(
          onPressed: () {
            setState(() => _error = null);
            _loadConsents(_locale!);
          },
          child: Text(_t('Retry', 'إعادة المحاولة')),
        ),
      for (final document in documents ?? <Map<String, dynamic>>[])
        Padding(
          padding: const EdgeInsets.only(bottom: AppTokens.spaceSmall),
          child: DarbCard(
            padding: EdgeInsets.zero,
            background: Colors.white,
            border: const BorderSide(color: AuthStyle.border),
            child: Column(
              children: [
                ExpansionTile(
                  shape: const Border(),
                  title: Text(_consentTitle(document['type'])),
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                      child: SelectableText(document['content'] as String),
                    ),
                  ],
                ),
                CheckboxListTile(
                  key: ValueKey('googleConsent-${document['type']}'),
                  value: _accepted.contains(document['id']),
                  activeColor: AuthStyle.orange,
                  onChanged: _busy
                      ? null
                      : (checked) => setState(() {
                          checked == true
                              ? _accepted.add(document['id'] as String)
                              : _accepted.remove(document['id']);
                        }),
                  title: Text(
                    _t('I have read and accept this', 'قرأت هذا وأوافق عليه'),
                  ),
                ),
              ],
            ),
          ),
        ),
    ];
  }

  String _consentTitle(Object? type) => switch (type) {
    'terms' => _t('Terms of service', 'شروط الخدمة'),
    'privacy' => _t('Privacy policy', 'سياسة الخصوصية'),
    _ => _t('I am 18 or older', 'عمري 18 عاماً أو أكثر'),
  };

  Widget get _gap => const SizedBox(height: AppTokens.gutterMobile);

  Widget _nameField(String hint) => AuthTextField(
    key: const ValueKey('googleName'),
    controller: _name,
    hint: hint,
    icon: Icons.person_outline,
    textInputAction: TextInputAction.next,
    textCapitalization: TextCapitalization.words,
    autofillHints: const [AutofillHints.name],
    validator: _required(2, 80, _t('Enter your full name', 'أدخل اسمك الكامل')),
  );

  Widget _phoneField() => AuthTextField(
    key: const ValueKey('googlePhone'),
    controller: _phone,
    hint: _t('Phone, e.g. +970599123456', 'الهاتف، مثل ‎+970599123456'),
    icon: Icons.phone_outlined,
    keyboardType: TextInputType.phone,
    textInputAction: TextInputAction.next,
    autofillHints: const [AutofillHints.telephoneNumber],
    inputFormatters: [
      FilteringTextInputFormatter.allow(RegExp(r'[0-9+]')),
      LengthLimitingTextInputFormatter(16),
    ],
    validator: (value) => RegExp(_phonePattern).hasMatch(value?.trim() ?? '')
        ? null
        : _t(
            'Use international format starting with +',
            'استخدم الصيغة الدولية التي تبدأ بـ +',
          ),
  );

  Widget _cityField() => AuthTextField(
    key: const ValueKey('googleCity'),
    controller: _city,
    hint: _t('City', 'المدينة'),
    icon: Icons.location_city_outlined,
    textInputAction: TextInputAction.done,
    textCapitalization: TextCapitalization.words,
    autofillHints: const [AutofillHints.addressCity],
    validator: _required(2, 100, _t('Enter your city', 'أدخل مدينتك')),
  );

  FormFieldValidator<String> _required(int min, int max, String message) =>
      (value) {
        final text = value?.trim() ?? '';
        return text.length < min || text.length > max ? message : null;
      };

  String _failure(Object? error) {
    final code = error is ApiException ? error.message : '';
    return switch (code) {
      'licence_expired' => _t(
        'Your driving licence has expired. Renew it before applying.',
        'رخصة القيادة منتهية. جددها قبل التقديم.',
      ),
      'google_driver_signup_unavailable' => _t(
        'Driver applications are not open right now. Choose another role or try later.',
        'طلبات السائقين غير متاحة حالياً. اختر دوراً آخر أو حاول لاحقاً.',
      ),
      'validation_error' => _t(
        'Some details are not valid. Go back and check them.',
        'بعض البيانات غير صحيحة. ارجع وتحقق منها.',
      ),
      _ => authFailure(context, error),
    };
  }
}

String _isoDate(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-'
    '${date.month.toString().padLeft(2, '0')}-'
    '${date.day.toString().padLeft(2, '0')}';

class _ProgressHeader extends StatelessWidget {
  const _ProgressHeader({required this.label, required this.progress});

  final String label;
  final double progress;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppTokens.marginMobile,
        AppTokens.spaceSmall,
        AppTokens.marginMobile,
        AppTokens.spaceSmall,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            key: const ValueKey('googleOnboardingProgressLabel'),
            style: const TextStyle(
              color: AuthStyle.muted,
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppTokens.radiusFull),
            child: TweenAnimationBuilder<double>(
              tween: Tween(end: progress),
              duration: const Duration(milliseconds: 250),
              builder: (context, value, _) => LinearProgressIndicator(
                value: value,
                minHeight: 6,
                color: AuthStyle.orange,
                backgroundColor: AuthStyle.orange.withValues(alpha: 0.12),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StepTitle extends StatelessWidget {
  const _StepTitle({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(
        top: AppTokens.spaceMedium,
        bottom: AppTokens.spaceLarge,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: AuthStyle.ink,
              fontSize: 22,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: AppTokens.spaceExtraSmall),
          Text(
            subtitle,
            style: TextStyle(
              color: AuthStyle.text.withValues(alpha: 0.8),
              fontSize: 14,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

class _RoleOption extends StatelessWidget {
  const _RoleOption({
    required this.icon,
    required this.title,
    required this.help,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String title;
  final String help;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final enabled = onTap != null;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.gutterMobile),
      child: Semantics(
        selected: selected,
        button: true,
        child: Opacity(
          opacity: enabled ? 1 : 0.5,
          child: DarbCard(
            onTap: onTap,
            background: selected
                ? AuthStyle.orange.withValues(alpha: 0.06)
                : Colors.white,
            border: BorderSide(
              color: selected ? AuthStyle.orange : AuthStyle.border,
              width: selected ? 1.5 : 1,
            ),
            child: Row(
              children: [
                Container(
                  width: AppTokens.minTouchTarget,
                  height: AppTokens.minTouchTarget,
                  decoration: BoxDecoration(
                    color: AuthStyle.orange.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(AppTokens.radiusFull),
                  ),
                  child: Icon(icon, color: AuthStyle.orange, size: 22),
                ),
                const SizedBox(width: AppTokens.spaceMedium),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: theme.textTheme.titleMedium),
                      Text(
                        help,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: AppTheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  selected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  color: selected ? AuthStyle.orange : AuthStyle.hint,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ChipGroup extends StatelessWidget {
  const _ChipGroup({
    required this.label,
    required this.options,
    required this.selected,
    required this.onSelected,
    this.error,
  });

  final String label;
  final Map<String, String> options;
  final String? selected;
  final ValueChanged<String> onSelected;
  final String? error;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: AuthStyle.text,
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: AppTokens.spaceSmall),
        Wrap(
          spacing: AppTokens.spaceSmall,
          runSpacing: AppTokens.spaceSmall,
          children: [
            for (final entry in options.entries)
              ChoiceChip(
                key: ValueKey('googleChip-${entry.key}'),
                label: Text(entry.value),
                selected: selected == entry.key,
                onSelected: (_) => onSelected(entry.key),
                selectedColor: AuthStyle.orange.withValues(alpha: 0.14),
                checkmarkColor: AuthStyle.orange,
                side: BorderSide(
                  color: selected == entry.key
                      ? AuthStyle.orange
                      : AuthStyle.border,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTokens.radiusFull),
                ),
              ),
          ],
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(top: AppTokens.spaceExtraSmall),
            child: Text(
              error!,
              style: TextStyle(
                color: Theme.of(context).colorScheme.error,
                fontSize: 12,
              ),
            ),
          ),
      ],
    );
  }
}

class _PickerTile extends StatelessWidget {
  const _PickerTile({
    required this.icon,
    required this.label,
    required this.filled,
    required this.onTap,
    this.error,
    super.key,
  });

  final IconData icon;
  final String label;
  final bool filled;
  final VoidCallback onTap;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final errorColor = Theme.of(context).colorScheme.error;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AuthStyle.radius),
          child: Container(
            height: AuthStyle.fieldHeight + 4,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(AuthStyle.radius),
              border: Border.all(
                color: error != null ? errorColor : AuthStyle.border,
                width: 0.5,
              ),
            ),
            child: Row(
              children: [
                Icon(icon, color: AuthStyle.hint, size: 20),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(
                      color: filled ? AuthStyle.ink : AuthStyle.hint,
                      fontSize: 16,
                    ),
                  ),
                ),
                const Icon(Icons.expand_more, color: AuthStyle.hint),
              ],
            ),
          ),
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
            child: Text(
              error!,
              style: TextStyle(color: errorColor, fontSize: 12),
            ),
          ),
      ],
    );
  }
}

class _Stepper extends StatelessWidget {
  const _Stepper({
    required this.label,
    required this.value,
    required this.min,
    required this.max,
    required this.onChanged,
  });

  final String label;
  final int value;
  final int min;
  final int max;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppTokens.spaceExtraSmall),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(color: AuthStyle.text, fontSize: 15),
            ),
          ),
          IconButton(
            tooltip: '−',
            onPressed: value > min ? () => onChanged(value - 1) : null,
            icon: const Icon(Icons.remove_circle_outline),
            color: AuthStyle.orange,
          ),
          SizedBox(
            width: 32,
            child: Text(
              '$value',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AuthStyle.ink,
              ),
            ),
          ),
          IconButton(
            tooltip: '+',
            onPressed: value < max ? () => onChanged(value + 1) : null,
            icon: const Icon(Icons.add_circle_outline),
            color: AuthStyle.orange,
          ),
        ],
      ),
    );
  }
}
