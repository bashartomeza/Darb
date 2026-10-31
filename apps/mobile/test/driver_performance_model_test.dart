import 'package:flutter_test/flutter_test.dart';
import 'package:masari_mobile/features/driver/data/driver_repository.dart';

void main() {
  test('parses a reported acceptance rate', () {
    final result = DriverPerformance.fromJson({
      'offers_responded': 10,
      'offers_accepted': 7,
      'acceptance_rate': 70,
      'min_sample': 5,
    });
    expect(result.acceptanceRate, 70);
    expect(result.responded, 10);
    expect(result.accepted, 7);
  });

  test('keeps the rate empty while the sample is too small', () {
    final result = DriverPerformance.fromJson({
      'offers_responded': 1,
      'offers_accepted': 1,
      'acceptance_rate': null,
      'min_sample': 5,
    });
    expect(result.acceptanceRate, isNull);
    expect(result.minSample, 5);
  });

  test('rejects a malformed response instead of guessing', () {
    expect(
      () => DriverPerformance.fromJson({
        'offers_responded': '10',
        'offers_accepted': 7,
        'min_sample': 5,
      }),
      throwsFormatException,
    );
  });
}
