/// A small reader for the common shapes of OpenStreetMap `opening_hours`.
///
/// It understands `24/7`, day lists and ranges (`Mo-Fr`, `Sa,Su`), time ranges
/// (`08:00-20:00`, several separated by commas, ranges past midnight), `off` /
/// `closed`, and rules separated by `;` where a later rule replaces an earlier
/// one for the days it names. Anything else (public holidays, sunrise/sunset,
/// weeks, months) makes the whole text "unknown": the app then shows the text
/// as written instead of guessing open or closed.
class OpeningHours {
  const OpeningHours._(this._days, {required this.always});

  /// Parses [text]; null when it uses syntax this reader does not handle.
  static OpeningHours? parse(String? text) {
    if (text == null) return null;
    final value = text.trim();
    if (value.isEmpty) return null;
    if (value == '24/7') return const OpeningHours._({}, always: true);

    // Per weekday (1 = Monday ... 7 = Sunday): the intervals in minutes of the
    // day the weekday is open. A day absent from the map is closed.
    final days = <int, List<_Interval>>{};
    for (final rawRule in value.split(';')) {
      final rule = rawRule.trim();
      if (rule.isEmpty) continue;
      // Public / school holiday rules are ignored: the weekly pattern decides.
      if (RegExp(r'^(PH|SH)\b').hasMatch(rule)) continue;
      final parsed = _parseRule(rule);
      if (parsed == null) return null;
      for (final day in parsed.days) {
        if (parsed.intervals.isEmpty) {
          days.remove(day);
        } else {
          days[day] = parsed.intervals;
        }
      }
    }
    return OpeningHours._(days, always: false);
  }

  final Map<int, List<_Interval>> _days;
  final bool always;

  /// Whether the place is open at [moment] (local time of the place).
  bool isOpenAt(DateTime moment) {
    if (always) return true;
    final minute = moment.hour * 60 + moment.minute;
    final today = _days[moment.weekday] ?? const [];
    for (final interval in today) {
      if (interval.end > interval.start) {
        if (minute >= interval.start && minute < interval.end) return true;
      } else if (minute >= interval.start) {
        return true; // runs past midnight
      }
    }
    // The tail of yesterday's range past midnight.
    final yesterday = _days[moment.weekday == 1 ? 7 : moment.weekday - 1];
    for (final interval in yesterday ?? const <_Interval>[]) {
      if (interval.end <= interval.start && minute < interval.end) return true;
    }
    return false;
  }

  static const _dayNames = {
    'Mo': 1,
    'Tu': 2,
    'We': 3,
    'Th': 4,
    'Fr': 5,
    'Sa': 6,
    'Su': 7,
  };

  static _Rule? _parseRule(String rule) {
    final match = RegExp(
      r'^([A-Za-z,\- ]*?)\s*([0-9:,\- ]+|off|closed)?$',
    ).firstMatch(rule);
    if (match == null) return null;
    final dayPart = (match.group(1) ?? '').trim();
    final timePart = (match.group(2) ?? '').trim();
    if (dayPart.isEmpty && timePart.isEmpty) return null;

    final days = dayPart.isEmpty
        ? <int>{1, 2, 3, 4, 5, 6, 7}
        : _parseDays(dayPart);
    if (days == null) return null;

    if (timePart == 'off' || timePart == 'closed') {
      return _Rule(days, const []);
    }
    if (timePart.isEmpty) return null;
    final intervals = <_Interval>[];
    for (final range in timePart.split(',')) {
      final m = RegExp(
        r'^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$',
      ).firstMatch(range);
      if (m == null) return null;
      final start = int.parse(m.group(1)!) * 60 + int.parse(m.group(2)!);
      final end = int.parse(m.group(3)!) * 60 + int.parse(m.group(4)!);
      if (start > 24 * 60 || end > 24 * 60) return null;
      intervals.add(_Interval(start, end == 24 * 60 ? 0 : end));
    }
    return _Rule(days, intervals);
  }

  static Set<int>? _parseDays(String text) {
    final days = <int>{};
    for (final part in text.split(',')) {
      final bounds = part.trim().split('-');
      if (bounds.length == 1) {
        final day = _dayNames[bounds[0].trim()];
        if (day == null) return null;
        days.add(day);
      } else if (bounds.length == 2) {
        final from = _dayNames[bounds[0].trim()];
        final to = _dayNames[bounds[1].trim()];
        if (from == null || to == null) return null;
        var day = from;
        for (var i = 0; i < 7; i++) {
          days.add(day);
          if (day == to) break;
          day = day == 7 ? 1 : day + 1;
        }
      } else {
        return null;
      }
    }
    return days.isEmpty ? null : days;
  }
}

class _Interval {
  const _Interval(this.start, this.end);
  final int start;
  final int end;
}

class _Rule {
  const _Rule(this.days, this.intervals);
  final Set<int> days;
  final List<_Interval> intervals;
}
