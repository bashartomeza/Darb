import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:darb_mobile/features/passenger/data/passenger_models.dart';

import 'package:darb_mobile/l10n/app_localizations.dart';

import '../../../core/geo/reverse_geocoder.dart';
import '../../../core/maps/service_area.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/darb_map.dart';
import '../../canonical_routes/domain/canonical_route_models.dart';

class PassengerLocationPickerScreen extends StatefulWidget {
  const PassengerLocationPickerScreen({
    super.key,
    required this.title,
    this.initialLocation,
    this.reverseGeocoder,
  });

  final String title;
  final PassengerLocation? initialLocation;

  /// Names tapped points. Null keeps the neutral fallback label.
  final ReverseGeocoder? reverseGeocoder;

  @override
  State<PassengerLocationPickerScreen> createState() =>
      _PassengerLocationPickerScreenState();
}

class _PassengerLocationPickerScreenState
    extends State<PassengerLocationPickerScreen> {
  LatLng? _selectedPoint;

  late final TextEditingController _labelController;

  String? _error;

  /// True once the user typed a name; it is then never overwritten.
  bool _labelEdited = false;
  bool _resolving = false;
  int _lookupToken = 0;

  @override
  void initState() {
    super.initState();

    final initial = widget.initialLocation;

    if (initial != null) {
      _selectedPoint = LatLng(initial.latitude, initial.longitude);
    }

    _labelController = TextEditingController(text: initial?.label ?? '');
  }

  @override
  void dispose() {
    _labelController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final point = _selectedPoint;

    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: SafeArea(
        child: Column(
          children: [
            // ============================================================
            // MAP
            // ============================================================
            SizedBox(
              height: 430,
              width: double.infinity,
              child: DarbMap(
                height: 430,
                emptyLabel: 'اختاري موقعًا من الخريطة',
                attributionLabel:
                    Localizations.of<AppLocalizations>(
                      context,
                      AppLocalizations,
                    )?.mapAttribution ??
                    '© OpenStreetMap contributors',
                markers: [
                  if (point != null)
                    DarbMapMarker(
                      position: GeoPoint(point.latitude, point.longitude),
                      icon: Icons.location_on_rounded,
                      color: theme.colorScheme.primary,
                      label: _labelController.text.isEmpty
                          ? 'الموقع المحدد'
                          : _labelController.text,
                    ),
                ],
                onTap: _onMapTap,
              ),
            ),

            // ============================================================
            // BOTTOM PANEL
            // ============================================================
            Expanded(
              child: SingleChildScrollView(
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(AppTokens.spaceLarge),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surface,
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(24),
                    ),
                    boxShadow: [
                      BoxShadow(
                        blurRadius: 20,
                        offset: const Offset(0, -5),
                        color: Colors.black.withValues(alpha: 0.08),
                      ),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // ==================================================
                      // INSTRUCTION
                      // ==================================================
                      Row(
                        children: [
                          Container(
                            width: 40,
                            height: 40,
                            decoration: BoxDecoration(
                              color: theme.colorScheme.primary.withValues(
                                alpha: 0.10,
                              ),
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              Icons.touch_app_rounded,
                              color: theme.colorScheme.primary,
                            ),
                          ),

                          const SizedBox(width: AppTokens.spaceSmall),

                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  point == null
                                      ? 'حددي الموقع على الخريطة'
                                      : 'تم تحديد الموقع',
                                  style: theme.textTheme.titleSmall?.copyWith(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  point == null
                                      ? 'اضغطي على أي نقطة لاختيارها'
                                      : 'يمكنك تعديل الاسم قبل التأكيد',
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),

                      // ==================================================
                      // SELECTED LOCATION DETAILS
                      // ==================================================
                      if (point != null) ...[
                        const SizedBox(height: AppTokens.spaceMedium),

                        TextField(
                          controller: _labelController,
                          onChanged: (_) {
                            setState(() => _labelEdited = true);
                          },
                          decoration: InputDecoration(
                            labelText: 'اسم الموقع',
                            hintText: 'مثال: الجامعة، البيت، مكان العمل...',
                            prefixIcon: _resolving
                                ? const Padding(
                                    padding: EdgeInsets.all(12),
                                    child: SizedBox.square(
                                      dimension: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    ),
                                  )
                                : const Icon(Icons.place_outlined),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                        ),

                        const SizedBox(height: AppTokens.spaceSmall),

                        Container(
                          padding: const EdgeInsets.all(AppTokens.spaceSmall),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.my_location_rounded,
                                size: 18,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  '${point.latitude.toStringAsFixed(6)}, '
                                  '${point.longitude.toStringAsFixed(6)}',
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    fontFamily: 'monospace',
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],

                      // ==================================================
                      // ERROR
                      // ==================================================
                      if (_error != null) ...[
                        const SizedBox(height: AppTokens.spaceSmall),
                        Text(
                          _error!,
                          style: TextStyle(
                            color: theme.colorScheme.error,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],

                      const SizedBox(height: AppTokens.spaceMedium),

                      // ==================================================
                      // CONFIRM
                      // ==================================================
                      FilledButton.icon(
                        onPressed: point == null ? null : _confirm,
                        icon: const Icon(Icons.check_rounded),
                        label: const Text('تأكيد الموقع'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ========================================================================
  // MAP TAP
  // ========================================================================

  static const fallbackLabel = PassengerLocationPickerFallback.label;

  void _onMapTap(LatLng point) {
    // A place outside the service area can never be a Darb pickup/drop-off.
    if (!DarbServiceArea.containsLatLng(point)) {
      setState(() {
        _error =
            Localizations.of<AppLocalizations>(
              context,
              AppLocalizations,
            )?.communityLocationOutside ??
            'هذا المكان خارج منطقة خدمة درب.';
      });
      return;
    }
    final token = ++_lookupToken;
    setState(() {
      _selectedPoint = point;
      _error = null;

      // A name typed by the user is kept; any other name belonged to the
      // previous point and must not stay attached to this one.
      if (!_labelEdited || _labelController.text.trim().isEmpty) {
        _labelEdited = false;
        _labelController.text = fallbackLabel;
      }
      _resolving = !_labelEdited && widget.reverseGeocoder != null;
    });
    if (_resolving) _resolveName(point, token);
  }

  Future<void> _resolveName(LatLng point, int token) async {
    String? name;
    try {
      name = await widget.reverseGeocoder!.lookup(
        point.latitude,
        point.longitude,
      );
    } catch (_) {
      name = null;
    }
    // Ignore answers for a point that is no longer selected.
    if (!mounted || token != _lookupToken) return;
    setState(() {
      _resolving = false;
      final trimmed = name?.trim();
      if (!_labelEdited && trimmed != null && trimmed.isNotEmpty) {
        _labelController.text = trimmed;
      }
    });
  }

  // ========================================================================
  // CONFIRM
  // ========================================================================

  void _confirm() {
    final point = _selectedPoint;

    if (point == null) {
      return;
    }

    final label = _labelController.text.trim();

    if (label.isEmpty) {
      setState(() {
        _error = 'اكتبي اسم الموقع أولاً';
      });
      return;
    }

    Navigator.of(context).pop(
      PassengerLocation(
        label: label,
        latitude: point.latitude,
        longitude: point.longitude,
      ),
    );
  }
}

/// Neutral label kept with the coordinates when a point has no known name.
class PassengerLocationPickerFallback {
  const PassengerLocationPickerFallback._();
  static const label = 'الموقع المحدد';
}
