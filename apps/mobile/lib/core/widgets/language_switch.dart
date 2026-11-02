import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../i18n/domain_labels.dart';
import '../i18n/locale_controller.dart';

/// Marks pages whose surrounding shell already supplies the language control.
class ShellLanguageControl extends InheritedWidget {
  const ShellLanguageControl({required super.child, super.key});

  static bool isProvided(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<ShellLanguageControl>() !=
      null;

  @override
  bool updateShouldNotify(ShellLanguageControl oldWidget) => false;
}

class LanguageSwitch extends ConsumerWidget {
  const LanguageSwitch({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ShellLanguageControl.isProvided(context)) {
      return const SizedBox.shrink();
    }
    final locale =
        ref.watch(localeControllerProvider).value ?? DomainLabels.defaultLocale;
    final l10n = AppLocalizations.of(context);

    final nextLanguage = locale.languageCode == 'ar' ? 'en' : 'ar';
    return IconButton(
      tooltip: nextLanguage == 'ar' ? l10n.arabic : l10n.english,
      icon: const Icon(Icons.language_rounded, size: 22),
      onPressed: () {
        ref
            .read(localeControllerProvider.notifier)
            .setLocale(Locale(nextLanguage));
      },
    );
  }
}
