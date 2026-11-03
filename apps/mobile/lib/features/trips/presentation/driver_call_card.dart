import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

/// Opens the phone's dialer on [number]; false when the device has none.
typedef PhoneDialer = Future<bool> Function(String number);

/// The `tel:` launcher, replaceable in tests.
final phoneDialerProvider = Provider<PhoneDialer>((ref) => dialPhone);

/// The number as a `tel:` URI: digits and a leading `+` only, since a contact
/// number is stored as the driver typed it. Null when nothing dialable is left.
Uri? phoneDialUri(String number) {
  final trimmed = number.trim();
  final digits = trimmed.replaceAll(RegExp(r'\D'), '');
  if (digits.isEmpty) return null;
  return Uri(
    scheme: 'tel',
    path: trimmed.startsWith('+') ? '+$digits' : digits,
  );
}

Future<bool> dialPhone(String number) async {
  final uri = phoneDialUri(number);
  if (uri == null) return false;
  try {
    return await launchUrl(uri);
  } on PlatformException {
    return false;
  }
}

/// The driver's phone on a running trip: the number as text, which works on
/// any device, and a "Call driver" action that opens the dialer.
///
/// The server sends the phone only from the driver's acceptance until drop-off,
/// so callers show this card only when the trip carries one.
class DriverCallCard extends ConsumerWidget {
  const DriverCallCard({
    required this.phone,
    required this.accent,
    this.background,
    this.border,
    super.key,
  });

  final String phone;
  final Color accent;
  final Color? background;
  final Color? border;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final dialable = phoneDialUri(phone) != null;
    return Container(
      key: const ValueKey('driverCallCard'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: background ?? theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: border ?? theme.dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.phone_rounded, size: 20, color: accent),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.driverPhoneLabel,
                      style: theme.textTheme.labelSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    // Numbers read left to right in Arabic too.
                    Directionality(
                      textDirection: TextDirection.ltr,
                      child: SelectableText(
                        phone,
                        key: const ValueKey('driverPhoneText'),
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (dialable) ...[
            const SizedBox(height: 8),
            FilledButton.icon(
              key: const ValueKey('callDriverButton'),
              style: FilledButton.styleFrom(
                backgroundColor: accent,
                minimumSize: const Size.fromHeight(44),
              ),
              onPressed: () async {
                final messenger = ScaffoldMessenger.maybeOf(context);
                final opened = await ref.read(phoneDialerProvider)(phone);
                if (!opened) {
                  messenger?.showSnackBar(
                    SnackBar(content: Text(l10n.callDriverUnavailable)),
                  );
                }
              },
              icon: const Icon(Icons.call_rounded, size: 18),
              label: Text(l10n.callDriver),
            ),
          ],
        ],
      ),
    );
  }
}
