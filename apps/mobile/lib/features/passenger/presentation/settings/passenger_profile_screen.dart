import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/validation/phone_rule.dart';
import '../../../../core/theme/passenger_theme.dart';
import '../../../../core/widgets/darb_text_field.dart';
import '../../../auth/application/auth_controller.dart';
import '../../../auth/domain/auth_models.dart';
import '../../../auth/presentation/auth_completion_screen.dart'
    show authFailure;
import 'settings_widgets.dart';
import '../../../../l10n/app_localizations.dart';

/// The passenger's profile: name, email, phone and city, with an edit mode.
///
/// Email is the sign-in credential and is never editable here. A verified phone
/// is an identity and is read-only too; only an unverified contact number can be
/// changed.
class PassengerProfileScreen extends ConsumerStatefulWidget {
  const PassengerProfileScreen({super.key});

  @override
  ConsumerState<PassengerProfileScreen> createState() =>
      _PassengerProfileScreenState();
}

class _PassengerProfileScreenState
    extends ConsumerState<PassengerProfileScreen> {
  final _name = TextEditingController();
  final _city = TextEditingController();
  final _phone = TextEditingController();
  bool _editing = false;
  bool _saving = false;
  bool _submitted = false;
  Object? _error;

  AuthUser? get _user => ref.read(authControllerProvider).value?.user;

  /// A verified number cannot be replaced from here.
  bool get _phoneEditable => _user?.phone == null;

  @override
  void dispose() {
    _name.dispose();
    _city.dispose();
    _phone.dispose();
    super.dispose();
  }

  void _startEditing() {
    final user = _user;
    _name.text = user?.name ?? '';
    _city.text = user?.city ?? '';
    _phone.text = user?.contactPhone ?? '';
    setState(() {
      _editing = true;
      _submitted = false;
      _error = null;
    });
  }

  String? _nameError(BuildContext context) =>
      _submitted && _name.text.trim().isEmpty
      ? AppLocalizations.of(context).nameRequired
      : null;

  String? _phoneError(BuildContext context) {
    final value = _phone.text.trim();
    if (!_submitted || !_phoneEditable || value.isEmpty) return null;
    return isValidMobileNumber(value)
        ? null
        : AppLocalizations.of(context).profileEnterValidPhoneNumber;
  }

  Future<void> _save() async {
    setState(() => _submitted = true);
    if (_name.text.trim().isEmpty || _phoneError(context) != null) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(authControllerProvider.notifier)
          .updateProfile(
            name: _name.text.trim(),
            city: _city.text.trim(),
            contactPhone: _phoneEditable ? _phone.text.trim() : null,
          );
      if (!mounted) return;
      setState(() => _editing = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context).profileProfileUpdated),
        ),
      );
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authControllerProvider).value?.user;
    final title = AppLocalizations.of(context).settingsMyProfile;

    return SettingsPage(
      title: title,
      actions: [
        if (!_editing)
          TextButton.icon(
            key: const ValueKey('profileEdit'),
            onPressed: user == null ? null : _startEditing,
            icon: const Icon(Icons.edit_outlined, size: 18),
            label: Text(AppLocalizations.of(context).profileEdit),
          ),
        const SizedBox(width: 8),
      ],
      children: [
        Center(child: SettingsAvatar(name: user?.name ?? '', size: 88)),
        const SizedBox(height: 24),
        if (_editing) ..._editForm(context) else ..._details(context, user),
      ],
    );
  }

  List<Widget> _details(BuildContext context, AuthUser? user) {
    final dash = AppLocalizations.of(context).profileNotAdded;
    final phone = user?.phone ?? user?.contactPhone;
    return [
      _DetailTile(
        icon: Icons.person_outline_rounded,
        label: AppLocalizations.of(context).profileName,
        value: user?.name ?? dash,
      ),
      _DetailTile(
        icon: Icons.mail_outline_rounded,
        label: AppLocalizations.of(context).email,
        value: user?.email ?? dash,
        ltr: true,
      ),
      _DetailTile(
        icon: Icons.phone_outlined,
        label: AppLocalizations.of(context).phoneNumber,
        value: phone ?? dash,
        ltr: phone != null,
      ),
      _DetailTile(
        icon: Icons.location_city_rounded,
        label: AppLocalizations.of(context).onboardingCity,
        value: user?.city ?? dash,
      ),
    ];
  }

  List<Widget> _editForm(BuildContext context) {
    final email = _user?.email;
    return [
      DarbTextField(
        key: const ValueKey('profileName'),
        controller: _name,
        label: AppLocalizations.of(context).profileName,
        prefixIcon: Icons.person_outline_rounded,
        textInputAction: TextInputAction.next,
        errorText: _nameError(context),
        onChanged: (_) => setState(() {}),
      ),
      const SizedBox(height: 16),
      if (email != null) ...[
        _DetailTile(
          icon: Icons.mail_outline_rounded,
          label: AppLocalizations.of(context).email,
          value: email,
          ltr: true,
        ),
        const SizedBox(height: 4),
      ],
      DarbTextField(
        key: const ValueKey('profilePhone'),
        controller: _phone,
        label: AppLocalizations.of(context).phoneNumber,
        prefixIcon: Icons.phone_outlined,
        keyboardType: TextInputType.phone,
        textInputAction: TextInputAction.next,
        enabled: _phoneEditable,
        helper: _phoneEditable
            ? null
            : AppLocalizations.of(context).profileVerifiedNumberCannotChanged,
        errorText: _phoneError(context),
        onChanged: (_) => setState(() {}),
      ),
      const SizedBox(height: 16),
      DarbTextField(
        key: const ValueKey('profileCity'),
        controller: _city,
        label: AppLocalizations.of(context).onboardingCity,
        prefixIcon: Icons.location_city_rounded,
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => _save(),
      ),
      if (_error != null) ...[
        const SizedBox(height: 16),
        Semantics(
          liveRegion: true,
          child: Text(
            authFailure(context, _error),
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
      ],
      const SizedBox(height: 24),
      FilledButton(
        key: const ValueKey('profileSave'),
        onPressed: _saving ? null : _save,
        child: _saving
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: Colors.white,
                ),
              )
            : Text(AppLocalizations.of(context).profileSaveChanges),
      ),
      const SizedBox(height: 8),
      TextButton(
        key: const ValueKey('profileCancel'),
        onPressed: _saving ? null : () => setState(() => _editing = false),
        child: Text(AppLocalizations.of(context).cancel),
      ),
    ];
  }
}

/// A read-only profile field: icon badge, small label, value beneath it.
class _DetailTile extends StatelessWidget {
  const _DetailTile({
    required this.icon,
    required this.label,
    required this.value,
    this.ltr = false,
  });

  final IconData icon;
  final String label;
  final String value;

  /// Emails and phone numbers read left-to-right even inside Arabic text.
  final bool ltr;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: PassengerStyle.panel,
          borderRadius: BorderRadius.circular(PassengerStyle.radiusTile),
        ),
        child: Row(
          children: [
            SettingsIconBadge(icon: icon),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: PassengerStyle.inter(
                      size: 12,
                      height: 15,
                      color: PassengerStyle.muted,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: Text(
                      value,
                      textDirection: ltr ? TextDirection.ltr : null,
                      style: PassengerStyle.inter(
                        size: 16,
                        height: 20,
                        weight: 560,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
