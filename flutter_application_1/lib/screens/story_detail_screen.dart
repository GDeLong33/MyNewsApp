import 'package:flutter/material.dart';

import '../api/models.dart';
import '../api/news_api.dart';
import '../util/open_link.dart';
import '../util/time_format.dart';
import '../widgets/common.dart';
import 'ai_overview_screen.dart';
import 'perspectives_screen.dart';

/// One story: an overview, then separate button groups for original coverage, background, AI overview and
/// AI perspectives. Everything shown here is read from the server; nothing triggers news collection or AI.
class StoryDetailScreen extends StatefulWidget {
  const StoryDetailScreen({super.key, required this.api, required this.storyId, required this.initialHeadline});

  final NewsApi api;
  final String storyId;
  final String initialHeadline;

  @override
  State<StoryDetailScreen> createState() => _StoryDetailScreenState();
}

class _StoryDetailScreenState extends State<StoryDetailScreen> {
  StoryDetail? _story;
  ApiException? _error;
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
      final story = await widget.api.fetchStory(widget.storyId);
      if (!mounted) return;
      setState(() {
        _story = story;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Story')),
      body: _body(),
    );
  }

  Widget _body() {
    final story = _story;
    if (story == null) {
      if (_loading) return const LoadingView(message: 'Loading story…');
      final notFound = _error?.notFound ?? false;
      return MessageView(
        icon: notFound ? Icons.history_toggle_off : Icons.cloud_off,
        title: notFound ? 'Story no longer available' : "Couldn't load this story",
        message: _error?.message ?? 'Something went wrong.',
        actionLabel: notFound ? null : 'Try again',
        onAction: notFound ? null : _load,
      );
    }
    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Text(story.headline, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(
            '${story.publisherCount} ${story.publisherCount == 1 ? 'publisher' : 'publishers'} · '
            '${story.articleCount} ${story.articleCount == 1 ? 'article' : 'articles'} · '
            'Updated ${formatWhen(story.updatedAt)}',
            style: theme.textTheme.bodyMedium,
          ),
          const SectionHeader('Story overview'),
          _OverviewCard(story: story),
          const SectionHeader('Original coverage', subtitle: "Each publisher's own reporting, opened in your browser"),
          for (final source in story.sources) _publisherButton(source),
          const SectionHeader('Background', subtitle: 'Context chosen by the server for this story'),
          if (story.background.isEmpty)
            const _Note(icon: Icons.info_outline, text: 'No background resource available')
          else
            for (final link in story.background)
              RowButton(
                label: link.title,
                detail: link.description,
                action: 'Open',
                icon: Icons.menu_book_outlined,
                onTap: () => openLink(context, link.url),
              ),
          const SectionHeader('AI overview'),
          _aiOverviewButton(story),
          const SectionHeader('AI perspectives'),
          _aiPerspectivesButton(story),
          const SizedBox(height: 24),
          Text(
            'Publisher and background pages open in your browser and need an internet connection. '
            'AI text is written by the server from feed excerpts and is always labeled "AI-generated".',
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }

  Widget _publisherButton(Source source) {
    final count = source.articles.length;
    final latest = source.articles.first;
    return RowButton(
      label: source.publisher,
      detail: count == 1 ? latest.title : '$count articles · latest: ${latest.title}',
      action: count == 1 ? 'Open' : 'Choose',
      icon: Icons.newspaper,
      onTap: count == 1 ? () => openLink(context, latest.url) : () => _chooseArticle(source),
    );
  }

  /// Several articles from one publisher: let the reader pick which one to open.
  void _chooseArticle(Source source) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          children: [
            Text('${source.publisher} articles', style: Theme.of(sheetContext).textTheme.titleLarge),
            const SizedBox(height: 12),
            for (final article in source.articles)
              RowButton(
                label: article.title,
                detail: '${formatWhen(article.publishedAt)}${article.publishedAtEstimated ? ' (time estimated)' : ''}',
                action: 'Open',
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  openLink(context, article.url);
                },
              ),
          ],
        ),
      ),
    );
  }

  Widget _aiOverviewButton(StoryDetail story) {
    final ai = story.ai;
    if (!ai.hasContent) return _Note(icon: Icons.auto_awesome_outlined, text: ai.message);
    return RowButton(
      label: 'AI overview',
      detail: 'What happened, where sources agree and differ, and what is uncertain'
          '${ai.generatedAt == null ? '' : ' · Generated ${formatWhen(ai.generatedAt!)}'}',
      action: 'View',
      icon: Icons.auto_awesome,
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => AiOverviewScreen(story: story))),
    );
  }

  Widget _aiPerspectivesButton(StoryDetail story) {
    final ai = story.ai;
    final perspectives = ai.perspectives;
    if (!ai.hasContent || perspectives == null) return _Note(icon: Icons.forum_outlined, text: ai.message);
    if (!perspectives.supported) {
      return _Note(
        icon: Icons.forum_outlined,
        text: perspectives.message ?? 'Insufficient evidence for distinct perspectives.',
      );
    }
    return RowButton(
      label: 'AI perspectives',
      detail: '${perspectives.items.length} viewpoints: ${perspectives.items.map((p) => p.name).join(' · ')}',
      action: 'View',
      icon: Icons.forum,
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => PerspectivesScreen(story: story))),
    );
  }
}

/// AI overview when available (labeled), otherwise the newest report's own feed excerpt (labeled as original wording).
class _OverviewCard extends StatelessWidget {
  const _OverviewCard({required this.story});

  final StoryDetail story;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ai = story.ai;
    final overview = ai.overview;
    if (overview != null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            AiBadge(ai: ai),
            const SizedBox(height: 12),
            Text('${overview.text} ${ai.citationLabel(overview.citations)}', style: theme.textTheme.bodyLarge),
            AiNotices(ai: ai),
          ]),
        ),
      );
    }
    final latest = story.latestArticle;
    final publisher = story.publisherOf(latest.id) ?? '';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Latest report · $publisher · original wording', style: theme.textTheme.labelLarge),
          const SizedBox(height: 8),
          Text(latest.title, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
          if (latest.excerpt != null) ...[
            const SizedBox(height: 6),
            Text(latest.excerpt!, style: theme.textTheme.bodyLarge),
            const SizedBox(height: 4),
            Text('Feed excerpt, not the full article', style: theme.textTheme.bodySmall),
          ],
        ]),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 20, color: theme.colorScheme.outline),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: theme.textTheme.bodyMedium)),
      ]),
    );
  }
}
