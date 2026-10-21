import 'package:flutter/material.dart';

import '../api/models.dart';
import '../api/news_api.dart';
import '../util/time_format.dart';
import '../widgets/common.dart';
import 'story_detail_screen.dart';

/// Quick filters shown above the list.
enum _Show { all, withAi, multiPublisher }

/// Top stories: one entry per story, newest coverage first. Refresh reads the server's stored results only;
/// filtering happens on the stories already downloaded.
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
  _Show _show = _Show.all;
  final Set<String> _publishers = {};

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
        // Drop publisher filters for outlets no longer in the list.
        final available = data.stories.expand((s) => s.publishers).toSet();
        _publishers.removeWhere((p) => !available.contains(p));
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

  List<StorySummary> _filtered(List<StorySummary> stories) => stories.where((s) {
        if (_show == _Show.withAi && !s.hasAiAnalysis) return false;
        if (_show == _Show.multiPublisher && s.publisherCount < 2) return false;
        if (_publishers.isNotEmpty && !s.publishers.any(_publishers.contains)) return false;
        return true;
      }).toList();

  bool get _filtering => _show != _Show.all || _publishers.isNotEmpty;

  void _clearFilters() => setState(() {
        _show = _Show.all;
        _publishers.clear();
      });

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
    final stories = _filtered(data.stories);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        itemCount: stories.length + 2,
        itemBuilder: (context, i) {
          if (i == 0) return _header(data, stories.length);
          if (i == stories.length + 1) return stories.isEmpty ? _noMatches() : _footer();
          return _StoryCard(story: stories[i - 1], onTap: () => _open(stories[i - 1]));
        },
      ),
    );
  }

  Widget _header(StoryListResponse data, int shown) {
    final theme = Theme.of(context);
    final collected = data.lastSuccessfulCollectionAt;
    final publishers = data.stories.expand((s) => s.publishers).toSet().toList()..sort();
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
        const SizedBox(height: 12),
        _chipRow([
          for (final (value, label) in [
            (_Show.all, 'All'),
            (_Show.withAi, 'With AI analysis'),
            (_Show.multiPublisher, '2+ publishers'),
          ])
            ChoiceChip(
              label: Text(label),
              selected: _show == value,
              onSelected: (_) => setState(() => _show = value),
            ),
        ]),
        const SizedBox(height: 6),
        _chipRow([
          for (final p in publishers)
            FilterChip(
              label: Text(p),
              selected: _publishers.contains(p),
              onSelected: (on) => setState(() => on ? _publishers.add(p) : _publishers.remove(p)),
            ),
        ]),
        if (_filtering)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Row(children: [
              Text('Showing $shown of ${data.stories.length} stories', style: theme.textTheme.bodySmall),
              const Spacer(),
              TextButton(onPressed: _clearFilters, child: const Text('Clear filters')),
            ]),
          ),
      ]),
    );
  }

  Widget _chipRow(List<Widget> chips) => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (final chip in chips) Padding(padding: const EdgeInsets.only(right: 8), child: chip),
        ]),
      );

  Widget _noMatches() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 32),
        child: Column(children: [
          Icon(Icons.filter_alt_off_outlined, size: 48, color: Theme.of(context).colorScheme.outline),
          const SizedBox(height: 12),
          Text('No stories match these filters', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          FilledButton(onPressed: _clearFilters, child: const Text('Clear filters')),
        ]),
      );

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
    final scheme = theme.colorScheme;
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
            Wrap(
              spacing: 8,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text('$publishers · ${formatWhen(story.updatedAt)}', style: theme.textTheme.bodyMedium),
                if (story.hasAiAnalysis)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(color: scheme.tertiaryContainer, borderRadius: BorderRadius.circular(6)),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.auto_awesome, size: 14, color: scheme.onTertiaryContainer),
                      const SizedBox(width: 4),
                      Text('AI analysis',
                          style: theme.textTheme.labelMedium?.copyWith(color: scheme.onTertiaryContainer)),
                    ]),
                  ),
              ],
            ),
            const SizedBox(height: 2),
            Text(story.publishers.join(', '), style: theme.textTheme.bodySmall),
          ]),
        ),
      ),
    );
  }
}
