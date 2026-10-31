import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/masari_card.dart';
import '../../../core/widgets/state_views.dart';
import '../../onboarding/domain/onboarding_models.dart';
import '../../onboarding/presentation/driver_documents_card.dart';
import '../application/driver_renewal_provider.dart';
import '../data/driver_renewal_repository.dart';

/// Lets an active driver whose documents expired upload renewed ones and send
/// them for review. After sending it shows a "waiting for review" state.
class DriverRenewalScreen extends ConsumerStatefulWidget {
  const DriverRenewalScreen({
    super.key,
    this.pickFile = pickDocumentWithFilePicker,
  });

  /// Returns the chosen file's bytes, or null when the person cancelled.
  final Future<List<int>?> Function() pickFile;

  @override
  ConsumerState<DriverRenewalScreen> createState() =>
      _DriverRenewalScreenState();
}

class _DriverRenewalScreenState extends ConsumerState<DriverRenewalScreen> {
  bool _busy = false;
  String? _error;
  String _kind = driverDocumentKinds.first;

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      ref.invalidate(driverRenewalProvider);
      await ref.read(driverRenewalProvider.future).catchError((_) => null);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = switch ((error.statusCode, error.message)) {
          (413, _) => 'document_too_large',
          (415, _) => 'document_type_unsupported',
          (409, 'driver_document_limit') => 'document_limit',
          (409, 'renewal_documents_required') => 'documents_required',
          (409, _) => 'state_conflict',
          _ => 'request_failed',
        };
      });
      if (error.statusCode == 409) ref.invalidate(driverRenewalProvider);
    } on FormatException {
      if (mounted) setState(() => _error = 'request_failed');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add(DriverRenewalState state) => _run(() async {
    final bytes = await widget.pickFile();
    if (bytes == null) return;
    if (bytes.length > state.maxBytes) {
      setState(() => _error = 'document_too_large');
      return;
    }
    await ref
        .read(driverRenewalRepositoryProvider)
        .upload(kind: _kind, bytes: bytes);
  });

  Future<void> _remove(DriverDocument document) =>
      _run(() => ref.read(driverRenewalRepositoryProvider).delete(document.id));

  Future<void> _submit() =>
      _run(() => ref.read(driverRenewalRepositoryProvider).submit());

  String _errorLabel(AppLocalizations l10n, String code) => switch (code) {
    'document_too_large' => l10n.documentTooLarge,
    'document_type_unsupported' => l10n.documentTypeUnsupported,
    'document_limit' => l10n.documentLimitReached,
    'documents_required' => l10n.renewalDocumentsRequired,
    'state_conflict' => l10n.renewalStateConflict,
    _ => l10n.requestFailed,
  };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final renewal = ref.watch(driverRenewalProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.renewalTitle)),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(driverRenewalProvider);
            await ref
                .read(driverRenewalProvider.future)
                .catchError((_) => null);
          },
          child: ListView(
            padding: const EdgeInsets.all(AppTokens.marginMobile),
            children: [
              // Keep showing the last state while a refresh is in flight.
              if (renewal.value == null && renewal.isLoading)
                const Center(child: CircularProgressIndicator())
              else if (renewal.hasError && renewal.value == null)
                ErrorStateView(
                  title: l10n.renewalLoadError,
                  retryLabel: l10n.retry,
                  onRetry: () => ref.invalidate(driverRenewalProvider),
                )
              else if (renewal.value == null)
                EmptyState(
                  title: l10n.renewalNothingToRenew,
                  icon: Icons.verified_outlined,
                )
              else
                ..._content(context, l10n, renewal.value!),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _content(
    BuildContext context,
    AppLocalizations l10n,
    DriverRenewalState state,
  ) {
    if (state.submitted) {
      return [
        MasariCard(
          key: const ValueKey('renewalSubmitted'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.hourglass_top_outlined, size: 32),
              const SizedBox(height: AppTokens.spaceSmall),
              Text(
                l10n.renewalSubmittedTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: AppTokens.spaceSmall),
              Text(l10n.renewalSubmittedBody),
            ],
          ),
        ),
      ];
    }
    if (!state.canUpload) {
      return [
        EmptyState(
          title: l10n.renewalNothingToRenew,
          icon: Icons.verified_outlined,
        ),
      ];
    }
    final kinds = state.kinds.isEmpty
        ? driverDocumentKinds
        : driverDocumentKinds.where(state.kinds.contains).toList();
    final kind = kinds.contains(_kind) ? _kind : kinds.first;
    final atLimit = state.documents.length >= state.maxDocuments;
    return [
      Text(l10n.renewalIntro),
      const SizedBox(height: AppTokens.spaceMedium),
      MasariCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.renewalUploaded,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: AppTokens.spaceSmall),
            if (state.documents.isEmpty)
              Text(
                l10n.renewalNoDocuments,
                key: const ValueKey('renewalNoDocuments'),
              ),
            for (final document in state.documents)
              ListTile(
                key: ValueKey('renewalDocument-${document.id}'),
                contentPadding: EdgeInsets.zero,
                title: Text(documentKindLabel(l10n, document.kind)),
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
            const SizedBox(height: AppTokens.spaceMedium),
            DropdownButtonFormField<String>(
              key: const ValueKey('renewalKind'),
              initialValue: kind,
              decoration: InputDecoration(labelText: l10n.documentKind),
              items: [
                for (final value in kinds)
                  DropdownMenuItem(
                    value: value,
                    child: Text(documentKindLabel(l10n, value)),
                  ),
              ],
              onChanged: _busy
                  ? null
                  : (value) => setState(() => _kind = value ?? _kind),
            ),
            const SizedBox(height: AppTokens.spaceMedium),
            OutlinedButton.icon(
              key: const ValueKey('renewalAdd'),
              onPressed: _busy || atLimit ? null : () => _add(state),
              icon: const Icon(Icons.upload_file),
              label: Text(l10n.addDocument),
            ),
          ],
        ),
      ),
      if (_error != null) ...[
        const SizedBox(height: AppTokens.spaceSmall),
        Text(
          _errorLabel(l10n, _error!),
          key: const ValueKey('renewalError'),
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      ],
      const SizedBox(height: AppTokens.spaceLarge),
      FilledButton(
        key: const ValueKey('renewalSubmit'),
        onPressed: _busy || state.documents.isEmpty ? null : _submit,
        child: Text(l10n.renewalSubmit),
      ),
    ];
  }
}
