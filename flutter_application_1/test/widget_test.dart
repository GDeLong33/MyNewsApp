import 'package:flutter_application_1/util/time_format.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final now = DateTime(2026, 10, 20, 15, 0);

  test('formats today, yesterday and older dates in local time', () {
    expect(formatWhen(DateTime(2026, 10, 20, 9, 40), now: now), 'Today, 9:40 a.m.');
    expect(formatWhen(DateTime(2026, 10, 19, 21, 5), now: now), 'Yesterday, 9:05 p.m.');
    expect(formatWhen(DateTime(2026, 10, 14, 0, 30), now: now), 'Oct 14, 12:30 a.m.');
    expect(formatClock(DateTime(2026, 10, 20, 12, 0)), '12:00 p.m.');
  });
}
