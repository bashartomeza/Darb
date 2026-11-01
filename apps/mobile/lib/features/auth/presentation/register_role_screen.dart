import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/masari_card.dart';
import '../../onboarding/application/onboarding_controller.dart';
import '../../onboarding/domain/onboarding_models.dart';
import 'widgets/auth_style.dart';

/// The first step of registration: who is signing up.
///
/// A normal user continues to the email / Google sign-up and is active at once.
/// A driver or shop owner registers on their own, with no invitation: they verify
/// an emailed code, fill in the registration form, upload their documents and wait
/// for admin approval, with that role already chosen.
class RegisterRoleScreen extends ConsumerStatefulWidget {
  const RegisterRoleScreen({super.key});

  @override
  ConsumerState<RegisterRoleScreen> createState() => _RegisterRoleScreenState();
}

class _RegisterRoleScreenState extends ConsumerState<RegisterRoleScreen> {
  bool _opening = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        scrolledUnderElevation: 0,
        actions: const [LanguageSwitch()],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: ListView(
              padding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: AppTokens.spaceMedium,
              ),
              children: [
                const Center(child: AuthLogo()),
                const SizedBox(height: 26),
                AuthHeader(
                  title: l10n.registerChooseTitle,
                  subtitle: l10n.registerChooseSubtitle,
                ),
                const SizedBox(height: 32),
                _RoleCard(
                  key: const ValueKey('register-role-passenger'),
                  icon: Icons.person_outline,
                  title: l10n.registerPassengerTitle,
                  help: l10n.registerPassengerHelp,
                  onTap: _opening ? null : _openPassenger,
                ),
                _RoleCard(
                  key: const ValueKey('register-role-driver'),
                  icon: Icons.directions_car_outlined,
                  title: l10n.registerDriverTitle,
                  help: l10n.registerDriverHelp,
                  onTap: _opening
                      ? null
                      : () => _openApplication(OnboardingRole.driver),
                ),
                _RoleCard(
                  key: const ValueKey('register-role-merchant'),
                  icon: Icons.storefront_outlined,
                  title: l10n.registerMerchantTitle,
                  help: l10n.registerMerchantHelp,
                  onTap: _opening
                      ? null
                      : () => _openApplication(OnboardingRole.merchant),
                ),
                const SizedBox(height: 8),
                AuthSwitchPrompt(
                  actionKey: const ValueKey('registerBackToSignIn'),
                  prompt: l10n.haveAccountPrompt,
                  action: l10n.login,
                  onPressed: () => context.pop(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _openPassenger() {
    context.pushReplacement('/signup');
  }

  Future<void> _openApplication(OnboardingRole role) async {
    setState(() => _opening = true);
    final controller = ref.read(onboardingControllerProvider.notifier);
    await controller.refreshAvailability();
    final state = ref.read(onboardingControllerProvider).value;
    if (!mounted) return;
    setState(() => _opening = false);
    if (state?.enabled != true ||
        state?.config?.registrationRoles.contains(role) != true) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context).registrationUnavailable),
        ),
      );
      return;
    }
    controller.chooseRole(role);
    context.pushReplacement('/onboarding');
  }
}

class _RoleCard extends StatelessWidget {
  const _RoleCard({
    required this.icon,
    required this.title,
    required this.help,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String title;
  final String help;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTokens.gutterMobile),
      child: MasariCard(
        onTap: onTap,
        background: Colors.white,
        border: const BorderSide(color: AuthStyle.border),
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
            const Icon(Icons.chevron_right, color: AuthStyle.hint),
          ],
        ),
      ),
    );
  }
}
