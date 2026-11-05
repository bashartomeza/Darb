import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../features/canonical_routes/domain/canonical_route_models.dart';
import '../../features/checkpoints/domain/checkpoint_models.dart';
import '../maps/map_tile_cache.dart';
import '../maps/service_area.dart';
import '../theme/app_theme.dart';
import '../theme/app_tokens.dart';
import '../theme/semantic_colors.dart';

/// Defines the visual purpose of a Darb map marker.
enum DarbMapMarkerType {
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

  /// Unverified community report.
  report,

  /// A place of interest (cafe, pharmacy, fuel station, ...). A background
  /// layer: it never moves the camera.
  place,
}

/// What a line in a marker's callout describes. The callout picks the line's
/// icon from this, never from the wording, so every language works the same.
enum DarbMapDetailKind { info, entering, leaving }

/// One line under a marker callout's title.
@immutable
class DarbMapDetail {
  const DarbMapDetail(
    this.text, {
    this.kind = DarbMapDetailKind.info,
    this.status,
  });

  final String text;
  final DarbMapDetailKind kind;

  /// The traffic state the line reports, which colours it. When null the
  /// line's own text is read as a state.
  final CheckpointStatus? status;

  @override
  bool operator ==(Object other) =>
      other is DarbMapDetail &&
      other.text == text &&
      other.kind == kind &&
      other.status == status;

  @override
  int get hashCode => Object.hash(text, kind, status);
}

/// Asks the map to centre on [point]. A new [request] number repeats the move
/// for the same point (e.g. tapping "my location" twice).
@immutable
class DarbMapFocus {
  const DarbMapFocus(this.point, this.request);

  final GeoPoint point;
  final int request;

  @override
  bool operator ==(Object other) =>
      other is DarbMapFocus && other.point == point && other.request == request;

  @override
  int get hashCode => Object.hash(point, request);
}

/// A pin the map can draw.
@immutable
class DarbMapMarker {
  const DarbMapMarker({
    required this.position,
    required this.icon,
    required this.color,
    required this.label,
    this.foreground = Colors.white,
    this.size = 34,
    this.type = DarbMapMarkerType.normal,
    this.fit,
    this.ringColor,
    this.badgeIcon,
    this.dimmed = false,
    this.details,
    this.onTap,
  });

  final GeoPoint position;
  final IconData icon;
  final Color color;

  /// Announced to screen readers and shown when the marker is tapped.
  final String label;

  final Color foreground;
  final double size;

  /// Controls the visual treatment of the marker.
  final DarbMapMarkerType type;

  /// Whether the camera frames this marker. Defaults to true for the trip's
  /// own points and false for background layers (checkpoints, reports), so a
  /// city-wide layer never zooms the map out away from the trip.
  final bool? fit;

  /// Outer ring colour, e.g. what the community reports about a checkpoint
  /// (kept separate from [color], which is the official state).
  final Color? ringColor;

  /// Small corner badge (e.g. a community or well-supported mark).
  final IconData? badgeIcon;

  /// Drawn faded, e.g. a disputed community report.
  final bool dimmed;

  /// Lines shown under the title when the marker is tapped. When null, the
  /// lines of [label] after the first are shown.
  final List<DarbMapDetail>? details;

  /// When set, tapping the pin calls this instead of opening the callout
  /// (e.g. a place's own sheet). Not part of equality: a new closure on every
  /// build must not rebuild every pin.
  final VoidCallback? onTap;

  bool get fitsCamera =>
      fit ??
      (type != DarbMapMarkerType.checkpoint &&
          type != DarbMapMarkerType.report &&
          type != DarbMapMarkerType.place);

  @override
  bool operator ==(Object other) =>
      other is DarbMapMarker &&
      other.position == position &&
      other.icon == icon &&
      other.color == color &&
      other.label == label &&
      other.foreground == foreground &&
      other.size == size &&
      other.type == type &&
      other.fit == fit &&
      other.ringColor == ringColor &&
      other.badgeIcon == badgeIcon &&
      other.dimmed == dimmed &&
      listEquals(other.details, details);

  @override
  int get hashCode => Object.hash(
    position,
    icon,
    color,
    label,
    foreground,
    size,
    type,
    fit,
    ringColor,
    badgeIcon,
    dimmed,
    details == null ? null : Object.hashAll(details!),
  );
}

/// A line the map can draw.
@immutable
class DarbMapPath {
  const DarbMapPath({
    required this.points,
    required this.color,
    this.width = 5,
    this.dashed = false,
  });

  final List<GeoPoint> points;
  final Color color;
  final double width;

  /// Used for a leg that is planned rather than confirmed, and for the
  /// straight fallback when no road route is available.
  final bool dashed;

  @override
  bool operator ==(Object other) =>
      other is DarbMapPath &&
      other.color == color &&
      other.width == width &&
      other.dashed == dashed &&
      (identical(other.points, points) || listEquals(other.points, points));

  @override
  int get hashCode => Object.hash(color, width, dashed, points.length);
}

/// Load state of the map's base tiles, shown so a blank map is never silent.
enum MapTileLoadState { loading, loaded, failed }

/// Follows tile loads of one map: `loaded` once any tile arrived, `failed`
/// when tiles keep failing and none arrived.
class MapTileLoadTracker extends ValueNotifier<MapTileLoadState> {
  MapTileLoadTracker() : super(MapTileLoadState.loading);

  /// Failures with no success before the map reports itself as failed.
  static const failuresBeforeFailed = 3;

  int _failures = 0;
  bool _disposed = false;

  ImageProvider watch(ImageProvider provider) {
    final stream = provider.resolve(ImageConfiguration.empty);
    late final ImageStreamListener listener;
    listener = ImageStreamListener(
      (_, _) {
        stream.removeListener(listener);
        _later(() => value = MapTileLoadState.loaded);
      },
      onError: (_, _) {
        stream.removeListener(listener);
        _later(() {
          if (value == MapTileLoadState.loaded) return;
          if (++_failures >= failuresBeforeFailed) {
            value = MapTileLoadState.failed;
          }
        });
      },
    );
    stream.addListener(listener);
    return provider;
  }

  /// Starts counting again after the user asked to retry.
  void reset() {
    _failures = 0;
    value = MapTileLoadState.loading;
  }

  // Tiles may resolve synchronously while the tile layer builds; notifying
  // listeners then would rebuild widgets mid-build.
  void _later(VoidCallback change) => scheduleMicrotask(() {
    if (!_disposed) change();
  });

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// Wraps the real tile provider to observe loads. It shares the inner
/// provider's headers (the tile layer adds the User-Agent there).
class _TrackingTileProvider extends TileProvider {
  _TrackingTileProvider(this.inner, this.tracker)
    : super(headers: inner.headers);

  final TileProvider inner;
  final MapTileLoadTracker tracker;

  @override
  bool get supportsCancelLoading => inner.supportsCancelLoading;

  @override
  ImageProvider getImage(TileCoordinates coordinates, TileLayer options) =>
      tracker.watch(inner.getImage(coordinates, options));

  @override
  ImageProvider getImageWithCancelLoadingSupport(
    TileCoordinates coordinates,
    TileLayer options,
    Future<void> cancelLoading,
  ) => tracker.watch(
    inner.getImageWithCancelLoadingSupport(coordinates, options, cancelLoading),
  );

  @override
  void dispose() => inner.dispose();
}

/// Modern Darb map surface.
///
/// Supports route paths, custom markers, checkpoint traffic markers, marker
/// callouts, zoom controls, fit-to-content, map tapping and short status notes.
///
/// The camera always stays on Darb's service area ([DarbServiceArea]): points
/// outside it (an emulator's default GPS in California, a bad record) are
/// drawn if visible but never move the camera, and the view cannot be panned
/// away. With nothing in the area to show, the map opens on Hebron.
///
/// One tile layer and one tile provider live as long as the map: content
/// changes and camera fits move the camera through [MapController] and the
/// tile layer loads the new view from the camera events.
class DarbMap extends StatefulWidget {
  const DarbMap({
    required this.emptyLabel,
    required this.attributionLabel,
    this.paths = const [],
    this.markers = const [],
    this.height = 420,
    this.overlay,
    this.banner,
    this.notes = const [],
    this.bannerElevation = 3,
    this.interactive = true,
    this.onTap,
    this.controlsTop,
    this.tileProvider,
    this.tileCache,
    this.focus,
    this.onViewportChanged,
    super.key,
  });

  final String emptyLabel;

  /// OpenStreetMap's required credit.
  final String attributionLabel;

  final List<DarbMapPath> paths;

  /// All markers displayed on the map.
  ///
  /// Checkpoint markers can be supplied here using
  /// [DarbMapMarkerType.checkpoint].
  final List<DarbMapMarker> markers;

  /// Map height.
  final double height;

  /// Optional widget pinned near the bottom of the map.
  final Widget? overlay;

  /// Optional status banner shown near the top.
  final Widget? banner;
  final double bannerElevation;

  /// Short, honest status lines shown as small chips under the banner, e.g.
  /// "checkpoint data unavailable" or "road route unavailable: straight line".
  final List<String> notes;

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

  /// When this changes the camera centres on its point (if it is inside the
  /// service area) and stops following content updates until reset.
  final DarbMapFocus? focus;

  /// Called with the visible area once the map is ready and whenever a pan,
  /// fling or zoom has finished (not on every frame of a gesture). Used to load
  /// the places of interest for the view.
  final ValueChanged<LatLngBounds>? onViewportChanged;

  @override
  State<DarbMap> createState() => _DarbMapState();
}

class _DarbMapState extends State<DarbMap> {
  final MapController _controller = MapController();
  final MapTileLoadTracker _tiles = MapTileLoadTracker();
  final StreamController<void> _resetTiles = StreamController<void>.broadcast();

  late TileProvider _tileProvider;
  late MapOptions _options;
  late List<Polyline> _polylines;
  late List<Marker> _markers;

  String? _selectedLabel;

  /// The framed points the camera was last fitted to.
  String _fittedSignature = '';
  bool _mapReady = false;

  /// Set once the user pans or zooms: content updates (a 5-second refresh, a
  /// moving driver) then no longer yank the camera. The reset button clears it.
  bool _userMovedCamera = false;

  MapTileCache get _tileCache => widget.tileCache ?? MapTileCache.shared;

  @override
  void initState() {
    super.initState();
    _tileProvider = _TrackingTileProvider(
      widget.tileProvider ?? NetworkTileProvider(cachingProvider: _tileCache),
      _tiles,
    );
    _polylines = _buildPolylines();
    _markers = _buildMarkers();
    final fit = _fitPoints();
    _fittedSignature = _signature(fit);
    _options = _buildOptions(fit);
  }

  @override
  void didUpdateWidget(covariant DarbMap oldWidget) {
    super.didUpdateWidget(oldWidget);

    if (!listEquals(oldWidget.paths, widget.paths)) {
      _polylines = _buildPolylines();
    }
    if (!listEquals(oldWidget.markers, widget.markers)) {
      _markers = _buildMarkers();
    }
    if (oldWidget.interactive != widget.interactive) {
      _options = _buildOptions(_fitPoints());
    }

    _fitIfContentMoved();

    final focus = widget.focus;
    if (focus != null && focus != oldWidget.focus) _focusOn(focus.point);

    // Clear an old marker callout if the selected marker no longer exists.
    if (_selectedLabel != null &&
        !widget.markers.any((marker) => marker.label == _selectedLabel)) {
      _selectedLabel = null;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _tiles.dispose();
    _resetTiles.close();
    super.dispose();
  }

  // ===========================================================================
  // MAP CONTENT
  // ===========================================================================

  static LatLng _toLatLng(GeoPoint point) {
    return LatLng(point.latitude, point.longitude);
  }

  List<Polyline> _buildPolylines() => [
    for (final path in widget.paths)
      if (path.points.length >= 2 &&
          path.points.every((p) => p.latitude.isFinite && p.longitude.isFinite))
        Polyline(
          points: path.points.map(_toLatLng).toList(growable: false),
          color: path.color,
          strokeWidth: path.width,
          borderColor: Colors.white.withValues(alpha: 0.85),
          borderStrokeWidth: path.dashed ? 0 : 2.0,
          pattern: path.dashed
              ? StrokePattern.dashed(segments: const [10, 7])
              : const StrokePattern.solid(),
        ),
  ];

  List<Marker> _buildMarkers() => [
    for (final marker in widget.markers)
      if (marker.position.latitude.isFinite &&
          marker.position.longitude.isFinite)
        _pin(marker),
  ];

  /// Points that place the camera, inside the service area only: the trip's
  /// own paths and markers; when there are none, the background layers
  /// (checkpoints, reports) so an overview map shows them; when nothing is in
  /// the area, none (the map then opens on Hebron).
  List<LatLng> _fitPoints() {
    final own = DarbServiceArea.inArea([
      for (final path in widget.paths) ...path.points.map(_toLatLng),
      for (final marker in widget.markers)
        if (marker.fitsCamera) _toLatLng(marker.position),
    ]);
    if (own.isNotEmpty) return own;
    return DarbServiceArea.inArea([
      for (final marker in widget.markers)
        if (marker.type != DarbMapMarkerType.place) _toLatLng(marker.position),
    ]);
  }

  /// Cheap identity of the framed area, rounded to ~10 m so jitter does not
  /// refit the camera.
  static String _signature(List<LatLng> points) {
    if (points.isEmpty) return '';
    if (points.length == 1) {
      return '${points.first.latitude.toStringAsFixed(4)},'
          '${points.first.longitude.toStringAsFixed(4)}';
    }
    final bounds = LatLngBounds.fromPoints(points);
    return [
      bounds.south,
      bounds.west,
      bounds.north,
      bounds.east,
    ].map((v) => v.toStringAsFixed(4)).join(',');
  }

  // ===========================================================================
  // CAMERA
  // ===========================================================================

  MapOptions _buildOptions(List<LatLng> fit) {
    return MapOptions(
      initialCenter: fit.length == 1
          ? fit.first
          : DarbServiceArea.fallbackCenter,
      initialZoom: fit.length == 1
          ? DarbServiceArea.singlePointZoom
          : DarbServiceArea.fallbackZoom,
      // Start already framed: the first tiles requested are the right ones.
      initialCameraFit: fit.length >= 2 ? _cameraFit(fit) : null,
      cameraConstraint: DarbServiceArea.cameraConstraint,
      minZoom: DarbServiceArea.minZoom,
      maxZoom: DarbServiceArea.maxZoom,
      interactionOptions: InteractionOptions(
        flags: widget.interactive
            ? InteractiveFlag.all & ~InteractiveFlag.rotate
            : InteractiveFlag.none,
      ),
      onMapReady: () {
        _mapReady = true;
        // Content may have changed between the first build and now.
        _fitIfContentMoved();
        _reportViewport();
      },
      onMapEvent: (event) {
        if (event is MapEventMoveEnd ||
            event is MapEventFlingAnimationEnd ||
            event is MapEventDoubleTapZoomEnd ||
            event is MapEventScrollWheelZoom ||
            (event is MapEventMove &&
                event.source == MapEventSource.fitCamera)) {
          _reportViewport();
        }
      },
      onPositionChanged: (_, hasGesture) {
        if (hasGesture) _userMovedCamera = true;
      },
      onTap: (_, point) {
        widget.onTap?.call(point);

        if (_selectedLabel != null) {
          setState(() {
            _selectedLabel = null;
          });
        }
      },
    );
  }

  void _reportViewport() {
    final callback = widget.onViewportChanged;
    if (callback == null || !_mapReady) return;
    // Never from inside a build or layout pass: the callback updates providers.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_mapReady) return;
      callback(_controller.camera.visibleBounds);
    });
  }

  void _fitIfContentMoved() {
    final fit = _fitPoints();
    final signature = _signature(fit);
    if (signature == _fittedSignature) return;
    if (!_mapReady || _userMovedCamera) return;
    _fittedSignature = signature;
    _moveCamera(fit);
  }

  void _focusOn(GeoPoint point) {
    final target = LatLng(point.latitude, point.longitude);
    if (!_mapReady || !DarbServiceArea.containsLatLng(target)) return;
    _userMovedCamera = true;
    _controller.move(target, DarbServiceArea.singlePointZoom);
  }

  void _resetCamera() {
    _userMovedCamera = false;
    final fit = _fitPoints();
    _fittedSignature = _signature(fit);
    _moveCamera(fit);
  }

  /// Moves the camera with the controller; the tile layer follows the camera
  /// events, so no layer is rebuilt.
  void _moveCamera(List<LatLng> fit) {
    if (!_mapReady) return;
    if (fit.length >= 2) {
      _controller.fitCamera(_cameraFit(fit));
    } else if (fit.length == 1) {
      _controller.move(fit.first, DarbServiceArea.singlePointZoom);
    } else {
      _controller.move(
        DarbServiceArea.fallbackCenter,
        DarbServiceArea.fallbackZoom,
      );
    }
  }

  CameraFit _cameraFit(List<LatLng> points) {
    return CameraFit.bounds(
      bounds: LatLngBounds.fromPoints(points),
      padding: const EdgeInsets.all(55),
      maxZoom: 15,
    );
  }

  void _retryTiles() {
    _tiles.reset();
    _resetTiles.add(null);
  }

  // ===========================================================================
  // BUILD
  // ===========================================================================

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppTokens.radiusLarge),
      child: SizedBox(
        height: widget.height,
        width: double.infinity,
        child: _map(context),
      ),
    );
  }

  Widget _map(BuildContext context) {
    final hasContent =
        widget.paths.any((p) => p.points.length >= 2) ||
        widget.markers.any((m) => m.fitsCamera);

    return Stack(
      children: [
        // ====================================================================
        // MAP
        // ====================================================================
        Directionality(
          textDirection: TextDirection.ltr,
          child: FlutterMap(
            mapController: _controller,
            options: _options,
            children: [
              // ==============================================================
              // MAP TILES
              // ==============================================================
              TileLayer(
                urlTemplate: MapTileConfig.tileUrlTemplate,
                userAgentPackageName: MapTileConfig.userAgentPackageName,
                tileProvider: _tileProvider,
                errorTileCallback: (tile, error, stackTrace) =>
                    _tileCache.reportTileError(),
                maxNativeZoom: 19,
                // Tiles appear as soon as they arrive (no fade), and a ring of
                // neighbours is kept and preloaded so panning is not blank.
                tileDisplay: const TileDisplay.instantaneous(),
                keepBuffer: 3,
                panBuffer: 1,
                reset: _resetTiles.stream,
                // A tile that failed once is retried when it scrolls back into view.
                evictErrorTileStrategy:
                    EvictErrorTileStrategy.notVisibleRespectMargin,
              ),

              // ==============================================================
              // ROUTES
              // ==============================================================
              if (_polylines.isNotEmpty) PolylineLayer(polylines: _polylines),

              // ==============================================================
              // MARKERS
              // ==============================================================
              if (_markers.isNotEmpty) MarkerLayer(markers: _markers),
            ],
          ),
        ),

        // ====================================================================
        // TOP STATUS AREA
        // ====================================================================
        Positioned(
          top: 12,
          left: 12,
          right: 64,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.banner != null)
                _FloatingBanner(
                  elevation: widget.bannerElevation,
                  child: widget.banner!,
                ),

              if (!hasContent && widget.banner == null)
                _EmptyMapMessage(label: widget.emptyLabel),

              for (var i = 0; i < widget.notes.length; i++)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: _MapNote(
                    key: ValueKey('mapNote-$i'),
                    label: widget.notes[i],
                  ),
                ),

              if (_selectedLabel != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: _Callout(
                    label: _selectedLabel!,
                    marker: widget.markers
                        .where((m) => m.label == _selectedLabel)
                        .firstOrNull,
                  ),
                ),
            ],
          ),
        ),

        // ====================================================================
        // TILE LOADING / FAILURE
        // ====================================================================
        Positioned.fill(
          child: ValueListenableBuilder<MapTileLoadState>(
            valueListenable: _tiles,
            builder: (context, state, _) => switch (state) {
              MapTileLoadState.loaded => const SizedBox.shrink(),
              MapTileLoadState.loading => const Align(
                alignment: Alignment.bottomCenter,
                child: Padding(
                  padding: EdgeInsets.only(bottom: 30),
                  child: _TileLoadingChip(),
                ),
              ),
              MapTileLoadState.failed => Center(
                child: _TileFailedCard(onRetry: _retryTiles),
              ),
            },
          ),
        ),

        // ====================================================================
        // MAP CONTROLS
        // ====================================================================
        Positioned(
          top:
              widget.controlsTop ??
              (widget.banner != null || !hasContent ? 72 : 14),
          right: 12,
          child: _MapControls(
            enabled: widget.interactive,
            onZoomIn: () {
              final camera = _controller.camera;
              _controller.move(camera.center, camera.zoom + 1);
            },
            onZoomOut: () {
              final camera = _controller.camera;
              _controller.move(camera.center, camera.zoom - 1);
            },
            onReset: _resetCamera,
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

  Marker _pin(DarbMapMarker marker) {
    return Marker(
      point: _toLatLng(marker.position),
      width: marker.size + 22,
      height: marker.size + 22,
      alignment: Alignment.center,
      child: Semantics(
        label: marker.label,
        button: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () {
            final onTap = marker.onTap;
            if (onTap != null) {
              onTap();
              return;
            }
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

  final DarbMapMarker marker;

  @override
  Widget build(BuildContext context) {
    final isLocation =
        marker.type == DarbMapMarkerType.location ||
        marker.icon == Icons.my_location_rounded;

    final isDriver =
        marker.type == DarbMapMarkerType.driver ||
        marker.icon == Icons.local_shipping_rounded;

    final isDestination =
        marker.type == DarbMapMarkerType.destination ||
        marker.icon == Icons.flag_rounded;

    final isCheckpoint = marker.type == DarbMapMarkerType.checkpoint;

    final isClosure = marker.type == DarbMapMarkerType.closure;

    final pinSize = isLocation
        ? marker.size + 6
        : isCheckpoint || isClosure
        ? marker.size + 2
        : marker.size;

    final pin = Stack(
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
              color: (marker.ringColor ?? marker.color).withValues(
                alpha: marker.ringColor == null ? 0.14 : 0.32,
              ),
              border: marker.ringColor == null
                  ? null
                  : Border.all(color: marker.ringColor!, width: 2.5),
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

        // ================================================================
        // CORNER BADGE (e.g. community information)
        // ================================================================
        if (marker.badgeIcon != null)
          Positioned(
            top: 0,
            right: 0,
            child: Container(
              width: 18,
              height: 18,
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                border: Border.all(
                  color: marker.ringColor ?? marker.color,
                  width: 1.5,
                ),
              ),
              child: Icon(
                marker.badgeIcon,
                size: 11,
                color: marker.ringColor ?? marker.color,
              ),
            ),
          ),
      ],
    );
    return marker.dimmed ? Opacity(opacity: 0.55, child: pin) : pin;
  }
}

/// Small note on the map, e.g. "checkpoint data unavailable".
class _MapNote extends StatelessWidget {
  const _MapNote({required this.label, super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Align(
      alignment: AlignmentDirectional.topStart,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.94),
          borderRadius: BorderRadius.circular(AppTokens.radiusFull),
          border: Border.all(color: SemanticColors.pendingContainer),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.info_outline_rounded,
              size: 14,
              color: SemanticColors.pending,
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                label,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: AppTheme.onSurface,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Map surfaces are also embedded in hosts without app localizations.
AppLocalizations? _maybeL10n(BuildContext context) =>
    Localizations.of<AppLocalizations>(context, AppLocalizations);

class _TileLoadingChip extends StatelessWidget {
  const _TileLoadingChip();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      key: const ValueKey('mapTilesLoading'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(AppTokens.radiusFull),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Static on purpose: an endless spinner over every map would keep
          // the frame scheduler busy while tiles are slow.
          const Icon(
            Icons.downloading_rounded,
            size: 14,
            color: SemanticColors.pending,
          ),
          const SizedBox(width: 6),
          Text(
            _maybeL10n(context)?.mapLoading ?? '',
            style: theme.textTheme.labelSmall,
          ),
        ],
      ),
    );
  }
}

class _TileFailedCard extends StatelessWidget {
  const _TileFailedCard({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = _maybeL10n(context);
    final theme = Theme.of(context);
    return Material(
      key: const ValueKey('mapTilesFailed'),
      color: Colors.white,
      elevation: AppTokens.elevationFloating,
      borderRadius: BorderRadius.circular(AppTokens.radiusDefault),
      child: Padding(
        padding: const EdgeInsets.all(AppTokens.spaceMedium),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_rounded, color: SemanticColors.pending),
            const SizedBox(height: AppTokens.spaceSmall),
            if (l10n != null)
              Text(l10n.mapLoadFailed, style: theme.textTheme.titleSmall),
            const SizedBox(height: AppTokens.spaceSmall),
            FilledButton.icon(
              key: const ValueKey('mapTilesRetry'),
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: Text(
                l10n?.retry ?? MaterialLocalizations.of(context).okButtonLabel,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ============================================================================
// MAP CONTROLS
// ============================================================================

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
            tooltip: AppLocalizations.of(context).mapZoomIn,
            onPressed: enabled ? onZoomIn : null,
          ),
          const Divider(height: 1, thickness: 1),
          _MapControlButton(
            icon: Icons.remove_rounded,
            tooltip: AppLocalizations.of(context).mapZoomOut,
            onPressed: enabled ? onZoomOut : null,
          ),
          const Divider(height: 1, thickness: 1),
          _MapControlButton(
            icon: Icons.center_focus_strong_rounded,
            tooltip: AppLocalizations.of(context).mapShowRoute,
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
  const _FloatingBanner({required this.child, required this.elevation});

  final Widget child;
  final double elevation;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      elevation: elevation,
      borderRadius: BorderRadius.circular(14),
      child: ClipRRect(borderRadius: BorderRadius.circular(14), child: child),
    );
  }
}

// ============================================================================
// CALLOUT
// ============================================================================

class _Callout extends StatelessWidget {
  const _Callout({required this.label, this.marker});

  final String label;
  final DarbMapMarker? marker;

  @override
  Widget build(BuildContext context) {
    final lines = label
        .split('\n')
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList();
    final title = lines.isNotEmpty
        ? lines.first
        : AppLocalizations.of(context).mapMarkerDetails;
    final details =
        marker?.details ??
        [for (final line in lines.skip(1)) DarbMapDetail(line)];

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
                    color: (marker?.color ?? SemanticColors.action).withValues(
                      alpha: 0.12,
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    marker == null ||
                            marker!.type == DarbMapMarkerType.checkpoint
                        ? Icons.local_police_rounded
                        : marker!.icon,
                    color: marker?.color ?? SemanticColors.action,
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
                  child: _CalloutDetail(detail: detail),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _CalloutDetail extends StatelessWidget {
  const _CalloutDetail({required this.detail});

  final DarbMapDetail detail;

  @override
  Widget build(BuildContext context) {
    final text = detail.text;
    final color = switch (detail.status ?? parseCheckpointStatus(text)) {
      CheckpointStatus.open => const Color(0xFF16A34A),
      CheckpointStatus.congested => const Color(0xFFF59E0B),
      CheckpointStatus.closed => const Color(0xFFDC2626),
      CheckpointStatus.unknown => const Color(0xFF64748B),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(
            switch (detail.kind) {
              DarbMapDetailKind.entering => Icons.login_rounded,
              DarbMapDetailKind.leaving => Icons.logout_rounded,
              DarbMapDetailKind.info => Icons.info_outline_rounded,
            },
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
