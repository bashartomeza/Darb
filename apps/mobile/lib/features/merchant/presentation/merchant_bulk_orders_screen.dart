import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/language_switch.dart';
import '../../../core/widgets/darb_back_button.dart';
import '../../../core/widgets/darb_card.dart';
import 'package:darb_mobile/l10n/app_localizations.dart';
import '../../canonical_routes/data/canonical_operation_storage.dart';
import '../../operating_routes/data/operating_route_models.dart';
import '../../operating_routes/data/operating_route_repository.dart';
import '../application/merchant_controller.dart';
import '../data/merchant_bulk_models.dart';
import '../data/merchant_repository.dart';

/// Bulk order entry: paste or edit a CSV, preview validation and grouping,
/// then submit. One idempotency key is held for the whole upload so a retry
/// after a lost response can never create an order twice.
class MerchantBulkOrdersScreen extends ConsumerStatefulWidget {
  const MerchantBulkOrdersScreen({super.key});

  @override
  ConsumerState<MerchantBulkOrdersScreen> createState() =>
      _MerchantBulkOrdersScreenState();
}

enum _Step { input, preview, result }

class _MerchantBulkOrdersScreenState
    extends ConsumerState<MerchantBulkOrdersScreen> {
  final _controller = TextEditingController();
  _Step _step = _Step.input;
  bool _busy = false;
  bool _skipInvalid = false;
  String? _error;
  BulkPreview? _preview;
  BulkSubmitResult? _result;
  String? _submittedCsv;
  String? _idempotencyKey;
  Map<String, int> _routeCounts = const {};

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String key) => (_arabic ? _ar : _en)[key]!;

  Future<void> _runPreview() async {
    final csv = _controller.text.trim();
    if (csv.isEmpty) {
      setState(() => _error = _t('empty'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // Route keys are checked here against the running routes, so a typo
      // gets an error that lists the right keys. Without the list (still
      // loading or unavailable) the server's check stands alone.
      final routes = ref.read(operatingRoutesProvider).value;
      final check = routes == null || routes.isEmpty
          ? null
          : checkBulkCsvRoutes(csv, routes);
      final BulkPreview preview;
      if (check != null && check.hasFileError) {
        preview = BulkPreview(
          totalRows: check.totalRows,
          validOrderCount: 0,
          errors: check.errors,
          batchCount: 0,
          maxRows: 50,
        );
      } else {
        final server = await ref
            .read(merchantRepositoryProvider)
            .previewBulkOrders(csv);
        preview = server.withRouteErrors(check?.errors ?? const []);
      }
      if (!mounted) return;
      setState(() {
        _routeCounts = check?.rowsByRoute ?? const {};
        _preview = preview;
        _skipInvalid = false;
        _step = _Step.preview;
        // New content means a new upload identity; the same content keeps its key.
        if (_submittedCsv != csv) {
          _idempotencyKey = null;
          _submittedCsv = null;
        }
      });
    } catch (_) {
      if (mounted) setState(() => _error = _t('failed'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    final csv = _controller.text.trim();
    final key = _idempotencyKey ??= newCanonicalIdempotencyKey();
    _submittedCsv = csv;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(merchantRepositoryProvider)
          .submitBulkOrders(
            csv,
            idempotencyKey: key,
            skipInvalid: _skipInvalid,
          );
      ref.invalidate(merchantDashboardProvider);
      if (!mounted) return;
      setState(() {
        _result = result;
        _step = _Step.result;
      });
    } catch (_) {
      // Keep the key: pressing submit again retries the same upload safely.
      if (mounted) setState(() => _error = _t('submitFailed'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Kept loaded on every step: the input lists the keys, the preview checks
    // and names them.
    ref.watch(operatingRoutesProvider);
    return Scaffold(
      key: const ValueKey('merchantBulkOrders'),
      appBar: AppBar(
        title: Text(_t('title')),
        leading: const DarbBackButton(fallback: '/merchant/order/new'),
        actions: const [LanguageSwitch()],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppTokens.spaceLarge),
          children: switch (_step) {
            _Step.input => _inputStep(),
            _Step.preview => _previewStep(),
            _Step.result => _resultStep(),
          },
        ),
      ),
    );
  }

  Widget _errorText() => _error == null
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(top: AppTokens.spaceMedium),
          child: Text(
            _error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        );

  List<Widget> _inputStep() => [
    Text(_t('hint')),
    const SizedBox(height: AppTokens.spaceMedium),
    _routeKeysCard(),
    const SizedBox(height: AppTokens.spaceMedium),
    TextField(
      key: const ValueKey('bulkCsvField'),
      controller: _controller,
      minLines: 8,
      maxLines: 16,
      enabled: !_busy,
      keyboardType: TextInputType.multiline,
      textDirection: TextDirection.ltr,
      decoration: InputDecoration(
        labelText: _t('csv'),
        alignLabelWithHint: true,
        border: const OutlineInputBorder(),
      ),
    ),
    const SizedBox(height: AppTokens.spaceMedium),
    OutlinedButton.icon(
      key: const ValueKey('bulkTemplateButton'),
      onPressed: _busy
          ? null
          : () {
              final first = ref
                  .read(operatingRoutesProvider)
                  .value
                  ?.firstOrNull;
              _controller.text = first == null
                  ? bulkCsvTemplate
                  : bulkCsvTemplateFor(first.key);
            },
      icon: const Icon(Icons.description_outlined),
      label: Text(_t('template')),
    ),
    _errorText(),
    const SizedBox(height: AppTokens.spaceLarge),
    FilledButton(
      key: const ValueKey('bulkPreviewButton'),
      onPressed: _busy ? null : _runPreview,
      child: Text(_t('preview')),
    ),
  ];

  /// The `route_key` values a row may use, with each route's name.
  Widget _routeKeysCard() {
    final routes = ref.watch(operatingRoutesProvider);
    return DarbCard(
      key: const ValueKey('bulkRouteKeys'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_t('routeKeys'), style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: AppTokens.spaceSmall),
          routes.when(
            skipLoadingOnRefresh: false,
            loading: () => const LinearProgressIndicator(),
            error: (_, _) => Row(
              children: [
                Expanded(
                  child: Text(
                    AppLocalizations.of(context).orderRoutesLoadFailed,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
                TextButton(
                  key: const ValueKey('bulkRoutesRetry'),
                  onPressed: () => ref.invalidate(operatingRoutesProvider),
                  child: Text(AppLocalizations.of(context).retry),
                ),
              ],
            ),
            data: (list) => list.isEmpty
                ? Text(AppLocalizations.of(context).orderRoutesEmpty)
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final route in list)
                        Text(
                          '${route.key} — ${route.displayName(arabic: _arabic)}',
                          key: ValueKey('bulkRouteKey-${route.key}'),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  List<Widget> _previewStep() {
    final preview = _preview!;
    final routes = {
      for (final route
          in ref.read(operatingRoutesProvider).value ??
              const <OperatingRoute>[])
        route.key: route,
    };
    final wholeFile = preview.errors.where((error) => error.row <= 1).toList();
    final canSubmit =
        preview.validOrderCount > 0 &&
        wholeFile.isEmpty &&
        (!preview.hasErrors || _skipInvalid);
    return [
      DarbCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _t('previewTitle'),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            Text('${_t('rows')}: ${preview.totalRows}'),
            Text('${_t('valid')}: ${preview.validOrderCount}'),
            Text('${_t('errors')}: ${preview.errors.length}'),
            Text('${_t('groups')}: ${preview.batchCount}'),
            if (_routeCounts.isNotEmpty) ...[
              const SizedBox(height: AppTokens.spaceSmall),
              Text(
                _t('byRoute'),
                style: Theme.of(context).textTheme.titleSmall,
              ),
              for (final entry in _routeCounts.entries)
                Text(
                  '${routes[entry.key]?.displayName(arabic: _arabic) ?? entry.key}'
                  ': ${entry.value}',
                  key: ValueKey('bulkRouteCount-${entry.key}'),
                ),
            ],
          ],
        ),
      ),
      if (preview.hasErrors) ...[
        const SizedBox(height: AppTokens.spaceMedium),
        ...preview.errors.map(
          (error) => ListTile(
            key: ValueKey('bulkError-${error.row}-${error.code}'),
            dense: true,
            leading: Icon(
              Icons.error_outline,
              color: Theme.of(context).colorScheme.error,
            ),
            title: Text(error.message(_arabic)),
            subtitle: Text(
              error.row == 0 ? _t('wholeFile') : '${_t('row')} ${error.row}',
            ),
          ),
        ),
        if (preview.validOrderCount > 0 && wholeFile.isEmpty)
          CheckboxListTile(
            key: const ValueKey('bulkSkipInvalid'),
            value: _skipInvalid,
            onChanged: _busy
                ? null
                : (value) => setState(() => _skipInvalid = value ?? false),
            title: Text(_t('skipInvalid')),
          ),
      ],
      _errorText(),
      const SizedBox(height: AppTokens.spaceLarge),
      FilledButton(
        key: const ValueKey('bulkSubmitButton'),
        onPressed: _busy || !canSubmit ? null : _submit,
        child: Text('${_t('submit')} (${preview.validOrderCount})'),
      ),
      TextButton(
        key: const ValueKey('bulkEditButton'),
        onPressed: _busy ? null : () => setState(() => _step = _Step.input),
        child: Text(_t('edit')),
      ),
    ];
  }

  List<Widget> _resultStep() {
    final result = _result!;
    return [
      DarbCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _t('resultTitle'),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            Text('${_t('created')}: ${result.created}'),
            Text('${_t('replayed')}: ${result.replayed}'),
            Text('${_t('failed2')}: ${result.failed}'),
          ],
        ),
      ),
      ...result.failures.map(
        (entry) => ListTile(
          dense: true,
          leading: Icon(
            Icons.error_outline,
            color: Theme.of(context).colorScheme.error,
          ),
          title: Text(entry.message(_arabic)),
          subtitle: Text('${_t('row')} ${entry.rows.join(', ')}'),
        ),
      ),
      const SizedBox(height: AppTokens.spaceLarge),
      FilledButton(
        key: const ValueKey('bulkDoneButton'),
        onPressed: () => context.go('/merchant/shipments'),
        child: Text(_t('done')),
      ),
    ];
  }
}

const _en = {
  'title': 'Bulk orders',
  'hint':
      'Paste or edit up to 50 rows. Columns: route_key, pickup_details (e.g. store name and street), dropoff_details (e.g. neighbourhood, street and a nearby landmark), size (S/M/L), priority (low/normal/high), and optionally receiver_name and receiver_phone. Rows with the same route and pickup become one order.',
  'routeKeys': 'Routes you can use in route_key',
  'byRoute': 'Rows per route',
  'csv': 'Orders (CSV)',
  'template': 'Insert example',
  'preview': 'Preview',
  'empty': 'Paste at least one row first.',
  'failed': 'Could not check the file. Try again.',
  'submitFailed':
      'The upload may not have finished. Submit again: it will not create duplicates.',
  'previewTitle': 'Preview',
  'rows': 'Rows',
  'valid': 'Valid orders',
  'errors': 'Errors',
  'groups': 'Suggested delivery groups',
  'row': 'Row',
  'wholeFile': 'Whole file',
  'skipInvalid': 'Skip rows with errors and submit the rest',
  'submit': 'Submit orders',
  'edit': 'Edit',
  'resultTitle': 'Upload result',
  'created': 'Created',
  'replayed': 'Already created',
  'failed2': 'Failed',
  'done': 'Done',
};

const _ar = {
  'title': 'طلبات بالجملة',
  'hint':
      'الصق أو عدّل حتى 50 صفاً. الأعمدة: route_key (المسار) و pickup_details (مكان الاستلام، مثل اسم المتجر والشارع) و dropoff_details (مكان التسليم، مثل الحي والشارع وأقرب معلم) و size (S/M/L) و priority (low/normal/high)، ويمكنك إضافة receiver_name و receiver_phone. الصفوف التي لها المسار ومكان الاستلام نفسهما تصبح طلباً واحداً.',
  'routeKeys': 'المسارات التي يمكنك كتابتها في route_key',
  'byRoute': 'عدد الصفوف لكل مسار',
  'csv': 'الطلبات (CSV)',
  'template': 'إدراج مثال',
  'preview': 'معاينة',
  'empty': 'الصق صفاً واحداً على الأقل أولاً.',
  'failed': 'تعذر فحص الملف. حاول مرة أخرى.',
  'submitFailed':
      'قد لا يكون الرفع قد اكتمل. أعد الإرسال: لن يتم إنشاء طلبات مكررة.',
  'previewTitle': 'معاينة',
  'rows': 'الصفوف',
  'valid': 'الطلبات الصالحة',
  'errors': 'الأخطاء',
  'groups': 'مجموعات التوصيل المقترحة',
  'row': 'الصف',
  'wholeFile': 'الملف كاملاً',
  'skipInvalid': 'تخطَّ الصفوف التي بها أخطاء وأرسل الباقي',
  'submit': 'إرسال الطلبات',
  'edit': 'تعديل',
  'resultTitle': 'نتيجة الرفع',
  'created': 'تم إنشاؤها',
  'replayed': 'أُنشئت سابقاً',
  'failed2': 'فشلت',
  'done': 'تم',
};
