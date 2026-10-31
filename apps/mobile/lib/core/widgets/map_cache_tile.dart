import 'package:flutter/material.dart';
import 'package:masari_mobile/l10n/app_localizations.dart';

import '../maps/map_tile_cache.dart';

/// Settings row that deletes the map tiles saved on the device.
class MapCacheTile extends StatefulWidget {
  const MapCacheTile({this.cache, super.key});

  /// Defaults to [MapTileCache.shared].
  final MapTileCache? cache;

  @override
  State<MapCacheTile> createState() => _MapCacheTileState();
}

class _MapCacheTileState extends State<MapCacheTile> {
  bool _busy = false;

  Future<void> _clear() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    String message;
    try {
      await (widget.cache ?? MapTileCache.shared).clear();
      message = l10n.mapCacheCleared;
    } catch (_) {
      message = l10n.mapCacheClearFailed;
    }
    if (mounted) setState(() => _busy = false);
    messenger.showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return ListTile(
      key: const ValueKey('clearMapCache'),
      leading: const Icon(Icons.map_outlined),
      title: Text(l10n.clearMapCache),
      subtitle: Text(l10n.clearMapCacheHint),
      enabled: !_busy,
      onTap: _busy ? null : _clear,
    );
  }
}
