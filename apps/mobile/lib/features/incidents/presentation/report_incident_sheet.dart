import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/api/api_error.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/darb_bottom_nav.dart';
import '../data/incident_repository.dart';

/// A "Report a problem" control for a trip screen, next to the reporter's
/// own saved reports.
///
/// Reports are records for Admin follow-up, not an emergency channel, and the
/// sheet says so rather than implying anyone is dispatched.
class ReportIncidentButton extends StatelessWidget {
  const ReportIncidentButton({required this.tripId, super.key});

  final String tripId;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: Wrap(
        spacing: AppTokens.spaceSmall,
        children: [
          TextButton.icon(
            key: const ValueKey('reportIncidentButton'),
            onPressed: () => showDarbBottomSheet<void>(
              context: context,
              child: ReportIncidentForm(tripId: tripId),
            ),
            icon: const Icon(Icons.flag_outlined),
            label: Text(l10n.incidentReportAction),
          ),
          TextButton.icon(
            key: const ValueKey('myIncidentReportsButton'),
            onPressed: () => showDarbBottomSheet<void>(
              context: context,
              child: const MyIncidentReportsList(),
            ),
            icon: const Icon(Icons.history_rounded),
            label: Text(l10n.myIncidentReports),
          ),
        ],
      ),
    );
  }
}

String incidentCategoryLabel(
  AppLocalizations l10n,
  IncidentCategory category,
) => switch (category) {
  IncidentCategory.safety => l10n.incidentCategorySafety,
  IncidentCategory.delay => l10n.incidentCategoryDelay,
  IncidentCategory.parcelDamage => l10n.incidentCategoryParcelDamage,
  IncidentCategory.behavior => l10n.incidentCategoryBehavior,
  IncidentCategory.other => l10n.incidentCategoryOther,
};

String incidentStatusLabel(AppLocalizations l10n, IncidentStatus status) =>
    switch (status) {
      IncidentStatus.open => l10n.incidentStatusOpen,
      IncidentStatus.reviewing => l10n.incidentStatusReviewing,
      IncidentStatus.resolved => l10n.incidentStatusResolved,
    };

/// The reporter's own reports as saved on the server, with their status.
class MyIncidentReportsList extends ConsumerWidget {
  const MyIncidentReportsList({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final labels = MaterialLocalizations.of(context);
    final reports = ref.watch(myIncidentReportsProvider);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.myIncidentReports, style: theme.textTheme.titleLarge),
        const SizedBox(height: AppTokens.spaceMedium),
        reports.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(AppTokens.spaceLarge),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (_, _) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.myIncidentReportsFailed,
                key: const ValueKey('myIncidentReportsError'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
              TextButton(
                onPressed: () => ref.invalidate(myIncidentReportsProvider),
                child: Text(l10n.retry),
              ),
            ],
          ),
          data: (items) => items.isEmpty
              ? Text(
                  l10n.myIncidentReportsEmpty,
                  key: const ValueKey('myIncidentReportsEmpty'),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final report in items)
                      ListTile(
                        key: ValueKey('incidentReport-${report.id}'),
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          incidentCategoryLabel(l10n, report.category),
                        ),
                        subtitle: Text(
                          '${report.description}\n'
                          '${labels.formatMediumDate(report.createdAt)}',
                          maxLines: 4,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: Text(
                          incidentStatusLabel(l10n, report.status),
                        ),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

class ReportIncidentForm extends ConsumerStatefulWidget {
  const ReportIncidentForm({this.tripId, super.key});

  final String? tripId;

  @override
  ConsumerState<ReportIncidentForm> createState() => _ReportIncidentFormState();
}

class _ReportIncidentFormState extends ConsumerState<ReportIncidentForm> {
  final _description = TextEditingController();
  IncidentCategory _category = IncidentCategory.other;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  bool get _valid =>
      _description.text.trim().length >= incidentDescriptionMinLength;

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ref
          .read(incidentRepositoryProvider)
          .report(
            category: _category,
            description: _description.text,
            tripId: widget.tripId,
          );
      // The new report is saved; "My reports" must list it next time it opens.
      ref.invalidate(myIncidentReportsProvider);
      messenger.showSnackBar(SnackBar(content: Text(l10n.incidentSubmitted)));
      navigator.pop();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = _errorText(l10n, error);
      });
    }
  }

  static String _errorText(AppLocalizations l10n, Object error) {
    if (error is ApiException) {
      if (error.statusCode == 429) return l10n.incidentTooMany;
      if (error.type == ApiErrorType.network) return l10n.networkUnavailable;
    }
    return l10n.incidentSubmitFailed;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l10n.incidentReportTitle, style: theme.textTheme.titleLarge),
        const SizedBox(height: AppTokens.spaceSmall),
        Text(l10n.incidentReportNotice, style: theme.textTheme.bodySmall),
        const SizedBox(height: AppTokens.spaceMedium),
        Wrap(
          spacing: AppTokens.spaceSmall,
          children: [
            for (final category in IncidentCategory.values)
              ChoiceChip(
                key: ValueKey('incidentCategory-${category.apiValue}'),
                label: Text(incidentCategoryLabel(l10n, category)),
                selected: _category == category,
                onSelected: _submitting
                    ? null
                    : (_) => setState(() => _category = category),
              ),
          ],
        ),
        const SizedBox(height: AppTokens.spaceMedium),
        TextField(
          key: const ValueKey('incidentDescription'),
          controller: _description,
          enabled: !_submitting,
          maxLines: 4,
          maxLength: incidentDescriptionMaxLength,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            labelText: l10n.incidentDescriptionLabel,
            border: const OutlineInputBorder(),
          ),
        ),
        if (_error != null) ...[
          Text(
            _error!,
            key: const ValueKey('incidentError'),
            style: TextStyle(color: theme.colorScheme.error),
          ),
          const SizedBox(height: AppTokens.spaceSmall),
        ],
        const SizedBox(height: AppTokens.spaceSmall),
        FilledButton(
          key: const ValueKey('incidentSubmit'),
          onPressed: _valid && !_submitting ? _submit : null,
          child: _submitting
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(l10n.incidentSubmit),
        ),
      ],
    );
  }
}
