// Checks the app's API client and models against the deployed server (no mock data).
// Run from flutter_application_1/:  dart run tool/live_check.dart
// ignore_for_file: avoid_print
import 'package:flutter_application_1/api/news_api.dart';
import 'package:flutter_application_1/config.dart';

Future<void> main() async {
  final api = NewsApi();
  print('API: ${AppConfig.apiBaseUrl}');
  final list = await api.fetchStories();
  print('stories: ${list.stories.length}, last collection: ${list.lastSuccessfulCollectionAt}');

  final statuses = <String, int>{};
  var parsed = 0;
  for (final summary in list.stories) {
    final story = await api.fetchStory(summary.id);
    parsed++;
    statuses.update(story.ai.status, (n) => n + 1, ifAbsent: () => 1);
    if (story.sources.length != story.publisherCount) {
      throw StateError('publisher count mismatch for ${story.id}');
    }
    if (story.ai.hasContent) {
      for (final id in story.ai.overview!.citations) {
        if (story.articleById(id) == null) throw StateError('citation $id not in story ${story.id}');
      }
    }
  }
  print('parsed $parsed story details; AI status counts: $statuses');

  final multi = list.stories.where((s) => s.publisherCount > 1).toList();
  if (multi.isNotEmpty) {
    final story = await api.fetchStory(multi.first.id);
    print('example: "${story.headline}" -> buttons: ${story.sources.map((s) => '${s.publisher} (${s.articles.length})').join(', ')}');
  }

  try {
    await api.fetchStory('does-not-exist');
  } on ApiException catch (e) {
    print('404 handled: notFound=${e.notFound} message="${e.message}"');
  }
}
