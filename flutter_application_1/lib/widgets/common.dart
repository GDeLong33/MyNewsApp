import 'package:flutter/material.dart';

import '../api/models.dart';
import '../util/open_link.dart';
import '../util/time_format.dart';

/// Full-screen loading indicator with a caption, so the reader knows what is happening.
class LoadingView extends StatelessWidget {
  const LoadingView({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(message, style: Theme.of(context).textTheme.bodyLarge),
        ]),
      );
}

/// Message + action for errors and empty results.
class MessageView extends StatelessWidget {
  const MessageView({super.key, required this.icon, required this.title, required this.message, this.actionLabel, this.onAction});

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 56, color: theme.colorScheme.outline),
          const SizedBox(height: 16),
          Text(title, style: theme.textTheme.titleLarge, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(message, style: theme.textTheme.bodyLarge, textAlign: TextAlign.center),
          if (actionLabel != null) ...[
            const SizedBox(height: 24),
            FilledButton.icon(onPressed: onAction, icon: const Icon(Icons.refresh), label: Text(actionLabel!)),
          ],
        ]),
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.subtitle});

  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 24, bottom: 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: theme.textTheme.titleMedium?.copyWith(color: theme.colorScheme.primary, fontWeight: FontWeight.w700)),
        if (subtitle != null) ...[
          const SizedBox(height: 2),
          Text(subtitle!, style: theme.textTheme.bodySmall),
        ],
      ]),
    );
  }
}

/// The "AI-generated" label shown on every piece of AI text, with when it was generated.
class AiBadge extends StatelessWidget {
  const AiBadge({super.key, required this.ai, this.extra});

  final AiAnalysis ai;
  final String? extra;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final when = ai.generatedAt == null ? '' : ' · Generated ${formatWhen(ai.generatedAt!)}';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: scheme.tertiaryContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.auto_awesome, size: 16, color: scheme.onTertiaryContainer),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            '${ai.label}$when${extra == null ? '' : ' · $extra'}',
            style: TextStyle(color: scheme.onTertiaryContainer, fontWeight: FontWeight.w600),
          ),
        ),
      ]),
    );
  }
}

/// Explains what the AI saw, and flags analysis that predates newer coverage.
class AiNotices extends StatelessWidget {
  const AiNotices({super.key, required this.ai});

  final AiAnalysis ai;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (ai.isOutdated)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(Icons.update, size: 18, color: theme.colorScheme.error),
            const SizedBox(width: 6),
            Expanded(child: Text(ai.message, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error))),
          ]),
        ),
      if (ai.inputScope != null)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(ai.inputScope!, style: theme.textTheme.bodySmall?.copyWith(fontStyle: FontStyle.italic)),
        ),
    ]);
  }
}

/// A large, easy-to-tap row button: label on the left, action word on the right.
class RowButton extends StatelessWidget {
  const RowButton({super.key, required this.label, this.detail, required this.action, required this.onTap, this.icon});

  final String label;
  final String? detail;
  final String action;
  final VoidCallback? onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: OutlinedButton(
        onPressed: onTap,
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          alignment: Alignment.centerLeft,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
        child: Row(children: [
          if (icon != null) ...[Icon(icon, size: 20), const SizedBox(width: 12)],
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
              if (detail != null) ...[
                const SizedBox(height: 2),
                Text(detail!, style: theme.textTheme.bodySmall),
              ],
            ]),
          ),
          const SizedBox(width: 8),
          Text(action, style: theme.textTheme.labelLarge),
        ]),
      ),
    );
  }
}

/// Numbered list of the articles that support AI text, each opening the original page.
class SupportingArticles extends StatelessWidget {
  const SupportingArticles({super.key, required this.story, required this.articleIds});

  final StoryDetail story;
  final List<String> articleIds;

  @override
  Widget build(BuildContext context) {
    final ordered = [...articleIds]
      ..sort((a, b) => (story.ai.citationNumber(a) ?? 999).compareTo(story.ai.citationNumber(b) ?? 999));
    return Column(children: [
      for (final id in ordered)
        if (story.articleById(id) case final article?)
          RowButton(
            label: '[${story.ai.citationNumber(id) ?? '?'}] ${story.publisherOf(id) ?? ''}',
            detail: article.title,
            action: 'Open',
            icon: Icons.open_in_new,
            onTap: () => openLink(context, article.url),
          ),
    ]);
  }
}
