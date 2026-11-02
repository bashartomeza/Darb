import 'dart:async';

import 'package:flutter/widgets.dart';

/// Read-only synchronization for the visible foreground route. TickerMode also
/// covers retained, inactive StatefulShellRoute branches.
class ForegroundRefresh extends StatefulWidget {
  const ForegroundRefresh({
    required this.refresh,
    required this.child,
    super.key,
  });
  final Future<void> Function() refresh;
  final Widget child;

  @override
  State<ForegroundRefresh> createState() => _ForegroundRefreshState();
}

class _ForegroundRefreshState extends State<ForegroundRefresh>
    with WidgetsBindingObserver {
  Timer? _timer;
  bool _running = false;
  bool _foreground = true;
  bool _visible = false;
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _foreground =
        WidgetsBinding.instance.lifecycleState == null ||
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _visible =
        TickerMode.valuesOf(context).enabled &&
        (ModalRoute.isCurrentOf(context) ?? true);
    _sync();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _sync();
  }

  void _sync() {
    if (!_visible || !_foreground) {
      _timer?.cancel();
      _timer = null;
    } else if (_timer == null) {
      _timer = Timer.periodic(
        const Duration(seconds: 5),
        (_) => unawaited(_refresh()),
      );
      if (_initialized) unawaited(_refresh());
    }
    _initialized = true;
  }

  Future<void> _refresh() async {
    if (_running || !mounted || !_visible || !_foreground) return;
    _running = true;
    try {
      await widget.refresh();
    } catch (_) {
      // A background read cannot erase the last authoritative records or claim
      // that a mutation succeeded. Explicit actions retain their error handling.
    } finally {
      _running = false;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
