import 'package:flutter/material.dart';

import '../api/models.dart';
import '../widgets/common.dart';
import 'perspectives_screen.dart';

/// Stored AI analysis for a story: overview, agreement, disagreement, uncertainty, and the articles behind it.
class AiOverviewScreen extends StatelessWidget {
  const AiOverviewScreen({super.key, required this.story});

  final StoryDetail story;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ai = story.ai;
    final overview = ai.overview!;
    final perspectives = ai.perspectives;
    return Scaffold(
      appBar: AppBar(title: const Text('AI overview')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Text(story.headline, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          AiBadge(ai: ai, extra: ai.model),
          AiNotices(ai: ai),
          const SectionHeader('Overview'),
          _CitedCard(ai: ai, item: overview),
          if (ai.agreement.isNotEmpty) ...[
            const SectionHeader('Where sources agree', subtitle: 'Agreement among sources is not proof that a claim is true'),
            for (final item in ai.agreement) _CitedCard(ai: ai, item: item),
          ],
          if (ai.disagreement.isNotEmpty) ...[
            const SectionHeader('Where sources differ'),
            for (final item in ai.disagreement) _CitedCard(ai: ai, item: item),
          ],
          if (ai.uncertainties.isNotEmpty) ...[
            const SectionHeader('Uncertain or unconfirmed'),
            for (final item in ai.uncertainties) _CitedCard(ai: ai, item: item),
          ],
          const SectionHeader('Explore perspectives'),
          if (perspectives != null && perspectives.supported)
            RowButton(
              label: 'AI perspectives',
              detail: perspectives.items.map((p) => p.name).join(' · '),
              action: 'View',
              icon: Icons.forum,
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => PerspectivesScreen(story: story))),
            )
          else
            Text(perspectives?.message ?? 'Insufficient evidence for distinct perspectives.', style: theme.textTheme.bodyLarge),
          const SectionHeader('Supporting articles', subtitle: 'The numbers in brackets refer to these reports'),
          SupportingArticles(story: story, articleIds: ai.inputArticleIds),
        ],
      ),
    );
  }
}

class _CitedCard extends StatelessWidget {
  const _CitedCard({required this.ai, required this.item});

  final AiAnalysis ai;
  final CitedText item;

  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Text('${item.text} ${ai.citationLabel(item.citations)}', style: Theme.of(context).textTheme.bodyLarge),
        ),
      );
}
