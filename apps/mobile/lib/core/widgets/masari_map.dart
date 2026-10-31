import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'package:masari_mobile/l10n/app_localizations.dart';

import '../../features/canonical_routes/domain/canonical_route_models.dart';
import '../maps/map_tile_cache.dart';
import '../theme/app_tokens.dart';

/// Defines the visual purpose of a Masari map marker.
enum MasariMapMarkerType {
  /// Generic map marker.
  normal,

  /// Passenger's current location.
  location,

  /// Driver's current location.
  driver,

  /// Trip destination.
  destination,

  /// Traffic/checkpoint marker.
  checkpoint,

  /// Closed entrance or road access.
  closure,
}

/// A pin the map can draw.
class MasariMapMarker {
  const MasariMapMarker({
    required this.position,
    required this.icon,
    required this.color,
    required this.label,
    this.foreground = Colors.white,
    this.size = 34,
    this.type = MasariMapMarkerType.normal,
  });

  final GeoPoint position;
  final IconData icon;
  final Color color;

  /// Announced to screen readers and shown when the marker is tapped.
  final String label;

  final Color foreground;
  final double size;

  /// Controls the visual treatment of the marker.
  final MasariMapMarkerType type;
}

/// A line the map can draw.
class MasariMapPath {
  const MasariMapPath({
    required this.points,
    required this.color,
    this.width = 5,
    this.dashed = false,
  });

  final List<GeoPoint> points;
  final Color color;
  final double width;

  /// Used for a leg that is planned rather than confirmed.
  final bool dashed;
}

/// Modern Masari map surface.
///
/// Supports:
/// - Route paths
/// - Custom markers
/// - Checkpoint traffic markers
/// - Marker callouts
/// - Zoom controls
/// - Fit-to-content
/// - Map tapping
class MasariMap extends StatefulWidget {
  const MasariMap({
    required this.emptyLabel,
    required this.attributionLabel,
    this.paths = const [],
    this.markers = const [],
    this.height = 420,
    this.overlay,
    this.banner,
    this.interactive = true,
    this.onTap,
    this.controlsTop,
    this.tileProvider,
    this.tileCache,
    super.key,
  });

  final String emptyLabel;

  /// OpenStreetMap's required credit.
  final String attributionLabel;

  final List<MasariMapPath> paths;

  /// All markers displayed on the map.
  ///
  /// Checkpoint markers can be supplied here using
  /// [MasariMapMarkerType.checkpoint].
  final List<MasariMapMarker> markers;

  /// Map height.
  final double height;

  /// Optional widget pinned near the bottom of the map.
  final Widget? overlay;

  /// Optional status banner shown near the top.
  final Widget? banner;

  final bool interactive;

  /// Called whenever the user taps the map.
  ///
  /// The callback receives the exact [LatLng] selected by the user.
  final ValueChanged<LatLng>? onTap;

  /// Distance of the zoom buttons from the top edge, when a screen overlays
  /// its own controls there. Defaults to a small inset.
  final double? controlsTop;

  /// Replaces the tile source (widget tests pass a fake). By default tiles come
  /// from [MapTileConfig.tileUrlTemplate] through the on-device [tileCache].
  final TileProvider? tileProvider;

  /// The cache whose "showing saved map" state the indicator follows.
  /// Defaults to [MapTileCache.shared].
  final MapTileCache? tileCache;

  @override
  State<MasariMap> createState() => _MasariMapState();
}

class _MasariMapState extends State<MasariMap> {
  final MapController _controller = MapController();

  String? _selectedLabel;

  MapTileCache get _tileCache => widget.tileCache ?? MapTileCache.shared;

  // The tile layer disposes its provider with itself, so a rebuilt layer
  // (see _reloadTiles) needs a fresh one.
  TileProvider? _ownedProvider;
  int _ownedProviderEpoch = -1;

  TileProvider _provider() {
    final injected = widget.tileProvider;
    if (injected != null) return injected;
    if (_ownedProviderEpoch != _tileEpoch || _ownedProvider == null) {
      _ownedProviderEpoch = _tileEpoch;
      _ownedProvider = NetworkTileProvider(cachingProvider: _tileCache);
    }
    return _ownedProvider!;
  }

  /// Default Masari geographic area.
  static const LatLng _defaultCenter = LatLng(31.6, 35.15);

  static const double _defaultZoom = 11;

  @override
  void initState() {
    super.initState();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;

      _fitToContent();
    });
  }

  @override
  void didUpdateWidget(covariant MasariMap oldWidget) {
    super.didUpdateWidget(oldWidget);

    if (!_sameMapContent(oldWidget)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;

        _fitToContent();
      });
    }

    // Clear an old marker callout if the selected marker no longer exists.
    if (_selectedLabel != null &&
        !widget.markers.any((marker) => marker.label == _selectedLabel)) {
      _selectedLabel = null;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  // ===========================================================================
  // MAP CONTENT
  // ===========================================================================

  /// All coordinates currently displayed on the map.
  ///
  /// Route geometry comes directly from [widget.paths].
  /// Markers, including checkpoints, are also included so the camera
  /// can automatically fit around the complete visible content.
  List<LatLng> get _allPoints => [
    for (final path in widget.paths) ...path.points.map(_toLatLng),
    for (final marker in widget.markers) _toLatLng(marker.position),
  ];

  static LatLng _toLatLng(GeoPoint point) {
    return LatLng(point.latitude, point.longitude);
  }

  /// Checks whether route/marker content changed.
  ///
  /// Marker visual properties are included here because a checkpoint can
  /// keep the same coordinates while its traffic state changes from:
  /// Salek -> Medium congestion -> Congestion.
  bool _sameMapContent(MasariMap oldWidget) {
    if (oldWidget.paths.length != widget.paths.length) {
      return false;
    }

    for (var i = 0; i < oldWidget.paths.length; i++) {
      final oldPath = oldWidget.paths[i];
      final newPath = widget.paths[i];

      if (oldPath.points.length != newPath.points.length) {
        return false;
      }

      if (oldPath.color != newPath.color ||
          oldPath.width != newPath.width ||
          oldPath.dashed != newPath.dashed) {
        return false;
      }

      for (var j = 0; j < oldPath.points.length; j++) {
        final oldPoint = oldPath.points[j];
        final newPoint = newPath.points[j];

        if (oldPoint.latitude != newPoint.latitude ||
            oldPoint.longitude != newPoint.longitude) {
          return false;
        }
      }
    }

    if (oldWidget.markers.length != widget.markers.length) {
      return false;
    }

    for (var i = 0; i < oldWidget.markers.length; i++) {
      final oldMarker = oldWidget.markers[i];
      final newMarker = widget.markers[i];

      if (oldMarker.position.latitude != newMarker.position.latitude ||
          oldMarker.position.longitude != newMarker.position.longitude) {
        return false;
      }

      if (oldMarker.icon != newMarker.icon ||
          oldMarker.color != newMarker.color ||
          oldMarker.foreground != newMarker.foreground ||
          oldMarker.size != newMarker.size ||
          oldMarker.type != newMarker.type ||
          oldMarker.label != newMarker.label) {
        return false;
      }
    }

    return true;
  }

  // ===========================================================================
  // CAMERA
  // ===========================================================================

  void _fitToContent() {
    final points = _allPoints;

    if (points.length < 2) {
      if (points.length == 1) {
        _controller.move(points.first, 14);
      } else {
        _controller.move(_defaultCenter, _defaultZoom);
      }

      return;
    }

    _controller.fitCamera(_cameraFit(points));
    _reloadTiles();
  }

  /// Incremented to rebuild the tile layer after the camera was moved by code.
  int _tileEpoch = 0;

  /// A programmatic camera move (fitting the route) is not picked up by an
  /// already-running tile layer: it keeps the tiles of the starting view and
  /// the map stays blank until the user touches it. Recreating the layer makes
  /// it load the tiles for the camera as it is now.
  void _reloadTiles() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      setState(() => _tileEpoch++);
    });
  }

  CameraFit _cameraFit(List<LatLng> points) {
    return CameraFit.bounds(
      bounds: LatLngBounds.fromPoints(points),
      padding: const EdgeInsets.all(55),
      maxZoom: 13,
    );
  }

  // ===========================================================================
  // BUILD
  // ===========================================================================

  @override
  Widget build(BuildContext context) {
    final points = _allPoints;

    return ClipRRect(
      borderRadius: BorderRadius.circular(AppTokens.radiusLarge),
      child: SizedBox(
        height: widget.height,
        width: double.infinity,
        child: _map(context, points),
      ),
    );
  }

  Widget _map(BuildContext context, List<LatLng> points) {
    final single = points.length == 1;
    final hasPoints = points.isNotEmpty;

    return Stack(
      children: [
        // ====================================================================
        // MAP
        // ====================================================================
        Directionality(
          textDirection: TextDirection.ltr,
          child: FlutterMap(
            mapController: _controller,
            options: MapOptions(
              initialCenter: single ? points.first : _defaultCenter,
              initialZoom: single ? 14 : _defaultZoom,
              // Start already fitted to the route: fitting only after the first
              // frame left the tile layer blank until the user touched the map.
              initialCameraFit: points.length >= 2 ? _cameraFit(points) : null,

              interactionOptions: InteractionOptions(
                flags: widget.interactive
                    ? InteractiveFlag.all & ~InteractiveFlag.rotate
                    : InteractiveFlag.none,
              ),

              onMapReady: () {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (!mounted) return;

                  _fitToContent();
                });
              },

              // ==============================================================
              // MAP TAP
              // ==============================================================
              onTap: (_, point) {
                widget.onTap?.call(point);

                if (_selectedLabel != null) {
                  setState(() {
                    _selectedLabel = null;
                  });
                }
              },
            ),

            children: [
              // ==============================================================
              // MAP TILES
              // ==============================================================
              TileLayer(
                key: ValueKey('tiles-$_tileEpoch'),
                urlTemplate: MapTileConfig.tileUrlTemplate,
                userAgentPackageName: MapTileConfig.userAgentPackageName,
                tileProvider: _provider(),
                errorTileCallback: (tile, error, stackTrace) =>
                    _tileCache.reportTileError(),
                maxNativeZoom: 19,
                // A tile that failed once is retried when it scrolls back into view.
                evictErrorTileStrategy:
                    EvictErrorTileStrategy.notVisibleRespectMargin,
              ),

              // ==============================================================
              // ROUTES
              // ==============================================================
              if (widget.paths.any((path) => path.points.length >= 2))
                PolylineLayer(
                  polylines: [
                    for (var i = 0; i < widget.paths.length; i++)
                      if (widget.paths[i].points.length >= 2)
                        Polyline(
                          points: widget.paths[i].points
                              .map(_toLatLng)
                              .toList(),
                          color: widget.paths[i].color,
                          strokeWidth: widget.paths[i].width,
                          borderColor: Colors.white.withValues(alpha: 0.85),
                          borderStrokeWidth: widget.paths[i].dashed ? 0 : 2.0,
                          pattern: widget.paths[i].dashed
                              ? StrokePattern.dashed(segments: const [10, 7])
                              : const StrokePattern.solid(),
                        ),
                  ],
                ),

              // ==============================================================
              // MARKERS
              // ==============================================================
              if (widget.markers.isNotEmpty)
                MarkerLayer(
                  markers: [for (final marker in widget.markers) _pin(marker)],
                ),
            ],
          ),
        ),

        // ====================================================================
        // TOP STATUS AREA
        // ====================================================================
        Positioned(
          top: 12,
          left: 12,
          right: 12,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.banner != null) _FloatingBanner(child: widget.banner!),

              if (!hasPoints && widget.banner == null)
                _EmptyMapMessage(label: widget.emptyLabel),

              if (_selectedLabel != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: _Callout(label: _selectedLabel!),
                ),
            ],
          ),
        ),

        // ====================================================================
        // MAP CONTROLS
        // ====================================================================
        Positioned(
          top:
              widget.controlsTop ??
              (widget.banner != null || !hasPoints ? 72 : 14),
          right: 12,
          child: _MapControls(
            enabled: widget.interactive,
            onZoomIn: () {
              final currentZoom = _controller.camera.zoom;

              _controller.move(_controller.camera.center, currentZoom + 1);
            },
            onZoomOut: () {
              final currentZoom = _controller.camera.zoom;

              _controller.move(_controller.camera.center, currentZoom - 1);
            },
            onReset: _fitToContent,
          ),
        ),

        // ====================================================================
        // OPTIONAL OVERLAY
        // ====================================================================
        if (widget.overlay != null)
          PositionedDirectional(
            start: 12,
            end: 12,
            bottom: 40,
            child: widget.overlay!,
          ),

        // ====================================================================
        // ATTRIBUTION
        // ====================================================================
        PositionedDirectional(
          start: 6,
          bottom: 5,
          child: _Attribution(label: widget.attributionLabel),
        ),

        // ====================================================================
        // OFFLINE INDICATOR
        // ====================================================================
        PositionedDirectional(
          start: 6,
          bottom: 26,
          child: ValueListenableBuilder<bool>(
            valueListenable: _tileCache.showingSavedMap,
            builder: (context, offline, _) =>
                offline ? const _OfflineMapChip() : const SizedBox.shrink(),
          ),
        ),
      ],
    );
  }

  // ===========================================================================
  // MARKER
  // ===========================================================================

  Marker _pin(MasariMapMarker marker) {
    return Marker(
      point: _toLatLng(marker.position),
      width: marker.size + 18,
      height: marker.size + 18,
      alignment: Alignment.center,
      child: Semantics(
        label: marker.label,
        button: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () {
            setState(() {
              _selectedLabel = marker.label;
            });
          },
          child: _ModernPin(marker: marker),
        ),
      ),
    );
  }
}

// ============================================================================
// MODERN MARKER
// ============================================================================

class _ModernPin extends StatelessWidget {
  const _ModernPin({required this.marker});

  final MasariMapMarker marker;

  @override
  Widget build(BuildContext context) {
    final isLocation =
        marker.type == MasariMapMarkerType.location ||
        marker.icon == Icons.my_location_rounded;

    final isDriver =
        marker.type == MasariMapMarkerType.driver ||
        marker.icon == Icons.local_shipping_rounded;

    final isDestination =
        marker.type == MasariMapMarkerType.destination ||
        marker.icon == Icons.flag_rounded;

    final isCheckpoint = marker.type == MasariMapMarkerType.checkpoint;

    final isClosure = marker.type == MasariMapMarkerType.closure;

    final pinSize = isLocation
        ? marker.size + 6
        : isCheckpoint || isClosure
        ? marker.size + 2
        : marker.size;

    return Stack(
      alignment: Alignment.center,
      children: [
        // ================================================================
        // CURRENT LOCATION PULSE
        // ================================================================
        if (isLocation)
          Container(
            width: pinSize + 14,
            height: pinSize + 14,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: marker.color.withValues(alpha: 0.18),
            ),
          ),

        // ================================================================
        // CHECKPOINT / CLOSURE OUTER RING
        // ================================================================
        if (isCheckpoint || isClosure)
          Container(
            width: pinSize + 10,
            height: pinSize + 10,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: marker.color.withValues(alpha: 0.14),
            ),
          ),

        // ================================================================
        // MAIN PIN
        // ================================================================
        Container(
          width: pinSize,
          height: pinSize,
          decoration: BoxDecoration(
            color: marker.color,
            shape: BoxShape.circle,
            border: Border.all(
              color: Colors.white,
              width: isDriver || isDestination || isCheckpoint || isClosure
                  ? 3
                  : 2.5,
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.22),
                blurRadius: 7,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Icon(
            marker.icon,
            size: isCheckpoint || isClosure ? pinSize * 0.52 : pinSize * 0.48,
            color: marker.foreground,
          ),
        ),
      ],
    );
  }
}

// ============================================================================
// MAP CONTROLS
// ============================================================================

bool _ar(BuildContext context) =>
    Localizations.localeOf(context).languageCode == 'ar';

class _MapControls extends StatelessWidget {
  const _MapControls({
    required this.enabled,
    required this.onZoomIn,
    required this.onZoomOut,
    required this.onReset,
  });

  final bool enabled;
  final VoidCallback onZoomIn;
  final VoidCallback onZoomOut;
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      elevation: 4,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          _MapControlButton(
            icon: Icons.add_rounded,
            tooltip: _ar(context) ? 'تكبير الخريطة' : 'Zoom in',
            onPressed: enabled ? onZoomIn : null,
          ),
          const Divider(height: 1, thickness: 1),
          _MapControlButton(
            icon: Icons.remove_rounded,
            tooltip: _ar(context) ? 'تصغير الخريطة' : 'Zoom out',
            onPressed: enabled ? onZoomOut : null,
          ),
          const Divider(height: 1, thickness: 1),
          _MapControlButton(
            icon: Icons.center_focus_strong_rounded,
            tooltip: _ar(context) ? 'إظهار المسار' : 'Show route',
            onPressed: enabled ? onReset : null,
          ),
        ],
      ),
    );
  }
}

class _MapControlButton extends StatelessWidget {
  const _MapControlButton({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: SizedBox(
        width: 44,
        height: 44,
        child: IconButton(
          onPressed: onPressed,
          icon: Icon(icon, size: 21),
          splashRadius: 20,
          padding: EdgeInsets.zero,
        ),
      ),
    );
  }
}

// ============================================================================
// EMPTY MAP MESSAGE
// ============================================================================

class _EmptyMapMessage extends StatelessWidget {
  const _EmptyMapMessage({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Align(
      alignment: AlignmentDirectional.topStart,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 270),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.94),
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.12),
              blurRadius: 10,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.map_outlined,
              size: 19,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ============================================================================
// FLOATING BANNER
// ============================================================================

class _FloatingBanner extends StatelessWidget {
  const _FloatingBanner({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      elevation: 3,
      borderRadius: BorderRadius.circular(14),
      child: ClipRRect(borderRadius: BorderRadius.circular(14), child: child),
    );
  }
}

// ============================================================================
// CALLOUT
// ============================================================================

class _Callout extends StatelessWidget {
  const _Callout({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final lines = label
        .split('\n')
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList();
    final title = lines.isNotEmpty ? lines.first : 'تفاصيل الحاجز';
    final details = lines.length > 1 ? lines.skip(1).toList() : <String>[];

    return Material(
      color: Colors.white,
      elevation: 7,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFE8EAED)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF2EA),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(
                    Icons.local_police_rounded,
                    color: Color(0xFFFF6B1A),
                    size: 22,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: const Color(0xFF111418),
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                const Icon(
                  Icons.info_outline_rounded,
                  size: 19,
                  color: Color(0xFF68707B),
                ),
              ],
            ),
            if (details.isNotEmpty) ...[
              const SizedBox(height: 10),
              for (final detail in details)
                Padding(
                  padding: const EdgeInsets.only(top: 5),
                  child: _CalloutDetail(text: detail),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _CalloutDetail extends StatelessWidget {
  const _CalloutDetail({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final isEntering = text.startsWith('دخول:');
    final isLeaving = text.startsWith('خروج:');
    final status = text.split(':').length > 1
        ? text.substring(text.indexOf(':') + 1).trim()
        : text;
    final color = status == 'سالك'
        ? const Color(0xFF16A34A)
        : status == 'أزمة'
        ? const Color(0xFFDC2626)
        : status == 'أزمة متوسطة'
        ? const Color(0xFFF59E0B)
        : const Color(0xFF64748B);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(
            isEntering
                ? Icons.login_rounded
                : isLeaving
                ? Icons.logout_rounded
                : Icons.info_outline_rounded,
            size: 16,
            color: color,
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: color,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ============================================================================
// ATTRIBUTION
// ============================================================================

class _Attribution extends StatelessWidget {
  const _Attribution({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.86),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
          fontSize: 9,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

/// Small, unobtrusive note that the map is drawn from tiles saved on the device.
class _OfflineMapChip extends StatelessWidget {
  const _OfflineMapChip();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = AppLocalizations.of(context).mapOfflineSaved;

    return Semantics(
      liveRegion: true,
      label: label,
      child: ExcludeSemantics(
        child: Container(
          key: const ValueKey('mapOfflineChip'),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.86),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.cloud_off_outlined,
                size: 11,
                color: theme.colorScheme.onSurfaceVariant,
              ),
              const SizedBox(width: 4),
              Text(
                label,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
