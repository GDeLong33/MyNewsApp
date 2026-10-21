// Readable local times, e.g. "Today, 9:40 p.m.", "Yesterday, 6:05 a.m.", "Oct 18, 11:20 a.m.".

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

String formatClock(DateTime time) {
  final t = time.toLocal();
  final hour = t.hour % 12 == 0 ? 12 : t.hour % 12;
  final minute = t.minute.toString().padLeft(2, '0');
  return '$hour:$minute ${t.hour < 12 ? 'a.m.' : 'p.m.'}';
}

String formatWhen(DateTime time, {DateTime? now}) {
  final t = time.toLocal();
  final n = (now ?? DateTime.now()).toLocal();
  final dayDiff = DateTime(n.year, n.month, n.day).difference(DateTime(t.year, t.month, t.day)).inDays;
  final clock = formatClock(t);
  if (dayDiff == 0) return 'Today, $clock';
  if (dayDiff == 1) return 'Yesterday, $clock';
  return '${_months[t.month - 1]} ${t.day}, $clock';
}
