import 'package:flutter/material.dart';

import '../api/models.dart';
import '../api/news_api.dart';
import '../util/time_format.dart';
import '../widgets/common.dart';
import 'story_detail_screen.dart';

/// Top stories: one entry per story, newest coverage first. Refresh reads the server's stored results only.
class StoryListScreen extends StatefulWidget {
  const StoryListScreen({super.key, required this.api});

  final NewsApi api;

  @override
  State<StoryListScreen> createState() => _StoryListScreenState();
}

class _StoryListScreenState extends State<StoryListScreen> {
  StoryListResponse? _data;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await widget.api.fetchStories();
      if (!mounted) return;
      setState(() {
        _data = data;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
      // With stories already on screen, keep them and say the refresh failed.
      if (_data != null) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Couldn't refresh. ${e.message}")));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My News'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      body: _body(),
    );
  }

  Widget _body() {
    final data = _data;
    if (data == null) {
      if (_loading) return const LoadingView(message: 'Loading top stories…');
      return MessageView(
        icon: Icons.cloud_off,
        title: "Couldn't load stories",
        message: _error ?? 'Something went wrong.',
        actionLabel: 'Try again',
        onAction: _load,
      );
    }
    if (data.stories.isEmpty) {
      return MessageView(
        icon: Icons.inbox_outlined,
        title: 'No stories right now',
        message: 'The server has no news from the last 7 days yet. It collects new articles every hour.',
        actionLabel: 'Refresh',
        onAction: _load,
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        itemCount: data.stories.length + 2,
        itemBuilder: (context, i) {
          if (i == 0) return _header(data);
          if (i == data.stories.length + 1) return _footer();
          return _StoryCard(story: data.stories[i - 1], onTap: () => _open(data.stories[i - 1]));
        },
      ),
    );
  }

  Widget _header(StoryListResponse data) {
    final theme = Theme.of(context);
    final collected = data.lastSuccessfulCollectionAt;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12, top: 4),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Top stories', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text(
          collected == null ? 'News has not been collected yet' : 'News collected ${formatWhen(collected)}',
          style: theme.textTheme.bodyMedium,
        ),
        if (_loading) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator()),
      ]),
    );
  }

  Widget _footer() => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Text(
          'Newest first · last 7 days · one entry per story, with reports from different publishers grouped together',
          style: Theme.of(context).textTheme.bodySmall,
          textAlign: TextAlign.center,
        ),
      );

  void _open(StorySummary story) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => StoryDetailScreen(api: widget.api, storyId: story.id, initialHeadline: story.headline),
    ));
  }
}

class _StoryCard extends StatelessWidget {
  const _StoryCard({required this.story, required this.onTap});

  final StorySummary story;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final publishers = '${story.publisherCount} ${story.publisherCount == 1 ? 'publisher' : 'publishers'}';
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(story.headline, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Text('$publishers · ${formatWhen(story.updatedAt)}', style: theme.textTheme.bodyMedium),
            const SizedBox(height: 2),
            Text(story.publishers.join(', '), style: theme.textTheme.bodySmall),
          ]),
        ),
      ),
    );
  }
}
