/// Coalesces reads into one flight plus the latest requested refresh. A read
/// overtaken by an explicit refresh/filter/action is never published.
class AuthoritativeRefresh<T> {
  Future<T>? _pending;
  Future<T> Function()? _load;
  int _requested = 0;
  bool _disposed = false;

  void dispose() => _disposed = true;

  Future<T> run({
    required Future<T> Function() load,
    required void Function(T) publish,
    required bool Function() isCurrent,
  }) {
    _load = load;
    _requested++;
    return _pending ??= _drain(
      publish,
      isCurrent,
    ).whenComplete(() => _pending = null);
  }

  Future<T> _drain(void Function(T) publish, bool Function() isCurrent) async {
    while (true) {
      final request = _requested;
      T value;
      try {
        value = await _load!();
      } catch (_) {
        if (!_disposed && isCurrent() && request != _requested) continue;
        rethrow;
      }
      if (_disposed || !isCurrent()) throw StateError('session_changed');
      if (request != _requested) continue;
      publish(value);
      return value;
    }
  }
}
