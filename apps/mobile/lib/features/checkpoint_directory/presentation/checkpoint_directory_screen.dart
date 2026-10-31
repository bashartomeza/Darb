import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/widgets/masari_card.dart';
import '../../../core/widgets/masari_section.dart';
import '../../../core/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../application/checkpoint_directory_controller.dart';
import '../domain/limited_checkpoint_directory.dart';
import '../application/limited_checkpoint_directory_controller.dart';

class CheckpointDirectoryAction extends ConsumerWidget {
  const CheckpointDirectoryAction({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final owner = ref.watch(checkpointDirectoryOwnerProvider);
    final source = owner == null
        ? null
        : ref.watch(checkpointDirectorySourceProvider(owner)).asData?.value;
    if (source == null) {
      return const SizedBox.shrink();
    }
    return IconButton(
      tooltip: AppLocalizations.of(context).checkpointDirectoryTitle,
      icon: const Icon(Icons.list_alt_rounded),
      onPressed: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => CheckpointDirectoryScreen(source: source),
        ),
      ),
    );
  }
}

class CheckpointDirectoryScreen extends ConsumerWidget {
  const CheckpointDirectoryScreen({
    super.key,
    this.source = DirectorySource.research,
  });
  final DirectorySource source;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context),
        owner = ref.watch(checkpointDirectoryOwnerProvider);
    Widget disabled() => EmptyState(title: l10n.checkpointDirectoryDisabled);
    final catalog = owner == null
        ? const AsyncData<DirectoryDisplayCatalog?>(null)
        : source == DirectorySource.limitedProvider
        ? ref.watch(limitedCheckpointDirectoryProvider(owner))
        : ref
              .watch(checkpointDirectoryProvider(owner))
              .whenData(
                (value) => value == null
                    ? null
                    : DirectoryDisplayCatalog.research(value),
              );
    return Scaffold(
      appBar: AppBar(title: Text(l10n.checkpointDirectoryTitle)),
      body: SafeArea(
        child: owner == null
            ? disabled()
            : catalog.when(
                skipLoadingOnReload: false,
                skipLoadingOnRefresh: false,
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (_, _) => ErrorStateView(
                  title: l10n.checkpointDirectoryLoadFailed,
                  retryLabel: l10n.retry,
                  onRetry: () {
                    ref.invalidate(
                      checkpointDirectoryCapabilityProvider(owner),
                    );
                    ref.invalidate(checkpointDirectoryProvider(owner));
                    ref.invalidate(
                      limitedCheckpointDirectoryCapabilityProvider(owner),
                    );
                    ref.invalidate(limitedCheckpointDirectoryProvider(owner));
                  },
                ),
                data: (value) => value == null
                    ? disabled()
                    : _DirectoryList(
                        key: ValueKey((owner, source)),
                        directory: value,
                      ),
              ),
      ),
    );
  }
}

class _DirectoryList extends StatefulWidget {
  const _DirectoryList({required this.directory, super.key});
  final DirectoryDisplayCatalog directory;
  @override
  State<_DirectoryList> createState() => _DirectoryListState();
}

class _DirectoryListState extends State<_DirectoryList> {
  final search = TextEditingController();
  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final groups = <String, List<DirectoryDisplayRow>>{};
    for (final row in widget.directory.rows.where(
      (row) => row.matches(search.text),
    )) {
      groups.putIfAbsent(row.cityAr, () => []).add(row);
    }
    return Column(
      children: [
        if (widget.directory.limited)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.checkpointDirectoryLimitedNotice),
                Text(
                  '${l10n.checkpointDirectoryGenerated}: ${stamp(widget.directory.generated!, l10n)}',
                ),
              ],
            ),
          ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: TextField(
            controller: search,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: l10n.checkpointDirectorySearch,
              prefixIcon: const Icon(Icons.search),
            ),
          ),
        ),
        Expanded(
          child: groups.isEmpty
              ? EmptyState(title: l10n.checkpointDirectoryNoResults)
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    for (final group in groups.entries)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: MasariSection(
                          title: group.key,
                          child: Column(
                            children: [
                              for (final row in group.value)
                                MasariCard(
                                  key: ValueKey(row.key),
                                  child: ListTile(
                                    title: Text(row.nameAr),
                                    subtitle: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(row.cityAr),
                                        if (row.entering != null)
                                          Text(
                                            '${l10n.checkpointDirectoryEnteringUpdated}: ${stamp(row.entering!, l10n)}',
                                          ),
                                        if (row.leaving != null)
                                          Text(
                                            '${l10n.checkpointDirectoryLeavingUpdated}: ${stamp(row.leaving!, l10n)}',
                                          ),
                                        Text(
                                          l10n.checkpointDirectoryTrafficUnavailable,
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

String stamp(DirectoryTimestamp value, AppLocalizations l10n) =>
    value.timezoneSpecified
    ? value.raw
    : "${value.raw} (${l10n.checkpointDirectoryTimezoneUnspecified})";
