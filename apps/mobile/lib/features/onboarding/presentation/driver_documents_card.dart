import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/masari_card.dart';
import '../application/onboarding_controller.dart';
import '../data/onboarding_repository.dart';
import '../domain/onboarding_models.dart';

/// Lets a driver whose application is under review add the documents the
/// reviewer asks for. Shows nothing when the server has uploads switched off.
class DriverDocumentsCard extends ConsumerStatefulWidget {
  const DriverDocumentsCard({
    super.key,
    this.merchant = false,
    this.pickFile = pickDocumentWithFilePicker,
    this.onKindsChanged,
  });

  /// A shop owner uploads different papers than a driver.
  final bool merchant;

  /// Returns the chosen file's bytes, or null when the person cancelled.
  final Future<List<int>?> Function() pickFile;

  /// Called with the kinds on file each time the list is (re)loaded.
  final ValueChanged<Set<String>>? onKindsChanged;

  @override
  ConsumerState<DriverDocumentsCard> createState() =>
      _DriverDocumentsCardState();
}

Future<List<int>?> pickDocumentWithFilePicker() async {
  final file = await FilePicker.pickFile(
    type: FileType.custom,
    allowedExtensions: const ['jpg', 'jpeg', 'png', 'pdf'],
  );
  return file?.readAsBytes();
}

class _DriverDocumentsCardState extends ConsumerState<DriverDocumentsCard> {
  DriverDocumentList? _list;
  bool _unavailable = false;
  bool _busy = false;
  String? _error;
  late String _kind = widget.merchant
      ? merchantDocumentKinds.first
      : driverDocumentKinds.first;

  String? get _token =>
      ref.read(onboardingControllerProvider.notifier).pendingStatusToken;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final token = _token;
    if (token == null) {
      setState(() => _unavailable = true);
      return;
    }
    try {
      final list = await ref
          .read(onboardingRepositoryProvider)
          .driverDocuments(token, merchant: widget.merchant);
      if (!mounted) return;
      setState(() => _list = list);
      widget.onKindsChanged?.call(list.documents.map((d) => d.kind).toSet());
    } on ApiException catch (error) {
      if (!mounted) return;
      // Uploads switched off or no longer allowed: stay out of the way.
      if (error.statusCode == 404 || error.statusCode == 403) {
        setState(() => _unavailable = true);
      } else {
        setState(() => _error = 'request_failed');
      }
    }
  }

  Future<void> _add() async {
    final token = _token;
    final list = _list;
    if (token == null || list == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final bytes = await widget.pickFile();
      if (bytes == null) return;
      if (bytes.length > list.maxBytes) {
        setState(() => _error = 'document_too_large');
        return;
      }
      await ref
          .read(onboardingRepositoryProvider)
          .uploadDriverDocument(
            token,
            kind: _kind,
            bytes: bytes,
            merchant: widget.merchant,
          );
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = switch (error.statusCode) {
          413 => 'document_too_large',
          415 => 'document_type_unsupported',
          409 => 'document_limit',
          _ => 'request_failed',
        };
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove(DriverDocument document) async {
    final token = _token;
    if (token == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(onboardingRepositoryProvider)
          .deleteDriverDocument(token, document.id, merchant: widget.merchant);
      await _load();
    } on ApiException {
      if (mounted) setState(() => _error = 'request_failed');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _kindLabel(AppLocalizations l10n, String kind) =>
      documentKindLabel(l10n, kind);

  String _errorLabel(AppLocalizations l10n, String code) => switch (code) {
    'document_too_large' => l10n.documentTooLarge,
    'document_type_unsupported' => l10n.documentTypeUnsupported,
    'document_limit' => l10n.documentLimitReached,
    _ => l10n.requestFailed,
  };

  @override
  Widget build(BuildContext context) {
    if (_unavailable) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final list = _list;
    final atLimit = list != null && list.documents.length >= list.maxDocuments;
    return MasariCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.verificationDocuments,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: AppTokens.spaceSmall),
          Text(
            widget.merchant
                ? l10n.merchantDocumentsHint
                : l10n.verificationDocumentsHint,
          ),
          const SizedBox(height: AppTokens.spaceMedium),
          if (list == null && _error == null)
            const Center(child: CircularProgressIndicator())
          else ...[
            for (final document in list?.documents ?? const <DriverDocument>[])
              ListTile(
                key: ValueKey('driverDocument-${document.id}'),
                contentPadding: EdgeInsets.zero,
                title: Text(_kindLabel(l10n, document.kind)),
                // The embedding keeps "1 KB" in reading order inside right-to-left text.
                subtitle: Text(
                  '\u202A${(document.sizeBytes / 1024).ceil()} KB\u202C',
                ),
                trailing: IconButton(
                  tooltip: l10n.removeDocument,
                  icon: const Icon(Icons.delete_outline),
                  onPressed: _busy ? null : () => _remove(document),
                ),
              ),
            if (list != null) ...[
              DropdownButtonFormField<String>(
                key: const ValueKey('driverDocumentKind'),
                initialValue: _kind,
                decoration: InputDecoration(labelText: l10n.documentKind),
                items: [
                  for (final kind
                      in widget.merchant
                          ? merchantDocumentKinds
                          : driverDocumentKinds)
                    DropdownMenuItem(
                      value: kind,
                      child: Text(_kindLabel(l10n, kind)),
                    ),
                ],
                onChanged: _busy
                    ? null
                    : (value) => setState(() => _kind = value ?? _kind),
              ),
              const SizedBox(height: AppTokens.spaceMedium),
              FilledButton.icon(
                key: const ValueKey('driverDocumentAdd'),
                onPressed: _busy || atLimit ? null : _add,
                icon: const Icon(Icons.upload_file),
                label: Text(l10n.addDocument),
              ),
            ],
          ],
          if (_error != null) ...[
            const SizedBox(height: AppTokens.spaceSmall),
            Text(
              _errorLabel(l10n, _error!),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
        ],
      ),
    );
  }
}

/// The localized name of a document kind.
String documentKindLabel(AppLocalizations l10n, String kind) => switch (kind) {
  'driver_licence' => l10n.documentKindDriverLicence,
  'commercial_register' => l10n.documentKindCommercialRegister,
  'shop_photo' => l10n.documentKindShopPhoto,
  'vehicle_registration' => l10n.documentKindVehicleRegistration,
  'national_id' => l10n.documentKindNationalId,
  'insurance' => l10n.documentKindInsurance,
  _ => l10n.documentKindOther,
};
