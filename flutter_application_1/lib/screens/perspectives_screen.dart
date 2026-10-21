import 'package:flutter/material.dart';

import '../api/models.dart';
import '../widgets/common.dart';

/// The viewpoints the stored AI analysis found support for, or an honest "insufficient evidence" message.
class PerspectivesScreen extends StatelessWidget {
  const PerspectivesScreen({super.key, required this.story});

  final StoryDetail story;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ai = story.ai;
    final perspectives = ai.perspectives;
    final supported = perspectives != null && perspectives.supported;
    return Scaffold(
      appBar: AppBar(title: const Text('AI perspectives')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Text(story.headline, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          AiBadge(ai: ai),
          AiNotices(ai: ai),
          const SectionHeader('Viewpoints in the coverage',
              subtitle: 'Views held by people in the reporting, not views of the news outlets'),
          if (!supported)
            Text(perspectives?.message ?? 'Insufficient evidence for distinct perspectives.', style: theme.textTheme.bodyLarge)
          else
            for (final (i, p) in perspectives.items.indexed)
              RowButton(
                label: p.name,
                detail: p.summary,
                action: 'View',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => PerspectiveDetailScreen(story: story, index: i)),
                ),
              ),
        ],
      ),
    );
  }
}

/// One viewpoint: what supporters of it say, the limits of the evidence, and the articles it comes from.
class PerspectiveDetailScreen extends StatelessWidget {
  const PerspectiveDetailScreen({super.key, required this.story, required this.index});

  final StoryDetail story;
  final int index;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ai = story.ai;
    final items = ai.perspectives!.items;
    final p = items[index];
    return Scaffold(
      appBar: AppBar(title: Text(p.name)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          AiBadge(ai: ai, extra: 'Viewpoint'),
          AiNotices(ai: ai),
          const SizedBox(height: 16),
          Text(p.name, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text('${p.summary} ${ai.citationLabel(p.citations)}', style: theme.textTheme.bodyLarge),
          if (p.evidenceLimits.isNotEmpty) ...[
            const SectionHeader('Evidence and limits'),
            Text(
              'This is an attributed viewpoint, not a verified fact. ${p.evidenceLimits}',
              style: theme.textTheme.bodyLarge,
            ),
          ],
          const SectionHeader('Supporting coverage'),
          SupportingArticles(story: story, articleIds: p.citations),
          if (items.length > 1) ...[
            const SectionHeader('Other viewpoints'),
            for (final (i, other) in items.indexed)
              if (i != index)
                RowButton(
                  label: other.name,
                  action: 'Switch',
                  onTap: () => Navigator.of(context).pushReplacement(
                    MaterialPageRoute(builder: (_) => PerspectiveDetailScreen(story: story, index: i)),
                  ),
                ),
          ],
        ],
      ),
    );
  }
}
