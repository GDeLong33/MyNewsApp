// Data returned by the My News server (see docs/api.md). Plain Dart, no Flutter imports.

DateTime _date(Object? value) => DateTime.parse(value as String).toLocal();
DateTime? _dateOrNull(Object? value) => value == null ? null : _date(value);
List<T> _list<T>(Object? value, T Function(Map<String, dynamic>) parse) =>
    (value as List<dynamic>? ?? const []).map((e) => parse(e as Map<String, dynamic>)).toList();
List<String> _strings(Object? value) => (value as List<dynamic>? ?? const []).cast<String>();

class StoryListResponse {
  StoryListResponse({required this.generatedAt, required this.lastSuccessfulCollectionAt, required this.stories});

  final DateTime generatedAt;
  final DateTime? lastSuccessfulCollectionAt;
  final List<StorySummary> stories;

  factory StoryListResponse.fromJson(Map<String, dynamic> json) => StoryListResponse(
        generatedAt: _date(json['generatedAt']),
        lastSuccessfulCollectionAt: _dateOrNull(json['lastSuccessfulCollectionAt']),
        stories: _list(json['stories'], StorySummary.fromJson),
      );
}

class StorySummary {
  StorySummary({
    required this.id,
    required this.headline,
    required this.updatedAt,
    required this.articleCount,
    required this.publisherCount,
    required this.publishers,
  });

  final String id;
  final String headline;
  final DateTime updatedAt;
  final int articleCount;
  final int publisherCount;
  final List<String> publishers;

  factory StorySummary.fromJson(Map<String, dynamic> json) => StorySummary(
        id: json['id'] as String,
        headline: json['headline'] as String,
        updatedAt: _date(json['updatedAt']),
        articleCount: json['articleCount'] as int,
        publisherCount: json['publisherCount'] as int,
        publishers: _strings(json['publishers']),
      );
}

class StoryDetail {
  StoryDetail({
    required this.id,
    required this.headline,
    required this.updatedAt,
    required this.articleCount,
    required this.publisherCount,
    required this.lastSuccessfulCollectionAt,
    required this.sources,
    required this.background,
    required this.ai,
  });

  final String id;
  final String headline;
  final DateTime updatedAt;
  final int articleCount;
  final int publisherCount;
  final DateTime? lastSuccessfulCollectionAt;

  /// Only publishers that actually covered the story.
  final List<Source> sources;

  /// Background resources chosen by the server; empty when none were found.
  final List<BackgroundLink> background;
  final AiAnalysis ai;

  factory StoryDetail.fromJson(Map<String, dynamic> json) => StoryDetail(
        id: json['id'] as String,
        headline: json['headline'] as String,
        updatedAt: _date(json['updatedAt']),
        articleCount: json['articleCount'] as int,
        publisherCount: json['publisherCount'] as int,
        lastSuccessfulCollectionAt: _dateOrNull(json['lastSuccessfulCollectionAt']),
        sources: _list(json['sources'], Source.fromJson),
        background: _list(json['background'], BackgroundLink.fromJson),
        ai: AiAnalysis.fromJson(json['ai'] as Map<String, dynamic>),
      );

  List<Article> get allArticles => [for (final s in sources) ...s.articles];

  Article? articleById(String id) {
    for (final a in allArticles) {
      if (a.id == id) return a;
    }
    return null;
  }

  String? publisherOf(String articleId) {
    for (final s in sources) {
      if (s.articles.any((a) => a.id == articleId)) return s.publisher;
    }
    return null;
  }

  /// The newest article, used for the non-AI overview when no AI text is available.
  Article get latestArticle => allArticles.reduce((a, b) => a.publishedAt.isAfter(b.publishedAt) ? a : b);
}

class Source {
  Source({required this.publisher, required this.articles});

  final String publisher;
  final List<Article> articles;

  factory Source.fromJson(Map<String, dynamic> json) => Source(
        publisher: json['publisher'] as String,
        articles: _list(json['articles'], Article.fromJson),
      );
}

class Article {
  Article({
    required this.id,
    required this.title,
    required this.url,
    required this.excerpt,
    required this.publishedAt,
    required this.publishedAtEstimated,
  });

  final String id;
  final String title;
  final String url;

  /// The publisher's feed description: an excerpt in the original wording, not the full article.
  final String? excerpt;
  final DateTime publishedAt;

  /// True when the feed gave no valid date and the server used the time it first saw the article.
  final bool publishedAtEstimated;

  factory Article.fromJson(Map<String, dynamic> json) => Article(
        id: json['id'] as String,
        title: json['title'] as String,
        url: json['url'] as String,
        excerpt: json['excerpt'] as String?,
        publishedAt: _date(json['publishedAt']),
        publishedAtEstimated: json['publishedAtEstimated'] as bool? ?? false,
      );
}

class BackgroundLink {
  BackgroundLink({required this.title, required this.url, required this.description});

  final String title;
  final String url;
  final String? description;

  factory BackgroundLink.fromJson(Map<String, dynamic> json) => BackgroundLink(
        title: (json['title'] ?? json['label']) as String,
        url: json['url'] as String,
        description: json['description'] as String?,
      );
}

class CitedText {
  CitedText({required this.text, required this.citations});

  final String text;

  /// Article IDs that support this text.
  final List<String> citations;

  factory CitedText.fromJson(Map<String, dynamic> json) =>
      CitedText(text: json['text'] as String, citations: _strings(json['citations']));
}

class Perspective {
  Perspective({required this.name, required this.summary, required this.evidenceLimits, required this.citations});

  final String name;
  final String summary;
  final String evidenceLimits;
  final List<String> citations;

  factory Perspective.fromJson(Map<String, dynamic> json) => Perspective(
        name: json['name'] as String,
        summary: json['summary'] as String,
        evidenceLimits: json['evidenceLimits'] as String? ?? '',
        citations: _strings(json['citations']),
      );
}

class Perspectives {
  Perspectives({required this.supported, required this.message, required this.items});

  final bool supported;
  final String? message;
  final List<Perspective> items;

  factory Perspectives.fromJson(Map<String, dynamic> json) => Perspectives(
        supported: json['status'] == 'supported',
        message: json['message'] as String?,
        items: _list(json['items'], Perspective.fromJson),
      );
}

/// Stored AI analysis. Status is one of ready, outdated, pending, failed, not_available.
class AiAnalysis {
  AiAnalysis({
    required this.status,
    required this.message,
    required this.label,
    required this.generatedAt,
    required this.model,
    required this.inputScope,
    required this.inputArticleIds,
    required this.overview,
    required this.agreement,
    required this.disagreement,
    required this.uncertainties,
    required this.perspectives,
  });

  final String status;
  final String message;
  final String label;
  final DateTime? generatedAt;
  final String? model;
  final String? inputScope;
  final List<String> inputArticleIds;
  final CitedText? overview;
  final List<CitedText> agreement;
  final List<CitedText> disagreement;
  final List<CitedText> uncertainties;
  final Perspectives? perspectives;

  /// True when there is AI text the app may show (ready, or outdated but still valid).
  bool get hasContent => overview != null;
  bool get isOutdated => status == 'outdated';

  factory AiAnalysis.fromJson(Map<String, dynamic> json) => AiAnalysis(
        status: json['status'] as String,
        message: json['message'] as String? ?? '',
        label: json['label'] as String? ?? 'AI-generated',
        generatedAt: _dateOrNull(json['generatedAt']),
        model: json['model'] as String?,
        inputScope: json['inputScope'] as String?,
        inputArticleIds: _strings(json['inputArticleIds']),
        overview: json['overview'] == null ? null : CitedText.fromJson(json['overview'] as Map<String, dynamic>),
        agreement: _list(json['agreement'], CitedText.fromJson),
        disagreement: _list(json['disagreement'], CitedText.fromJson),
        uncertainties: _list(json['uncertainties'], CitedText.fromJson),
        perspectives:
            json['perspectives'] == null ? null : Perspectives.fromJson(json['perspectives'] as Map<String, dynamic>),
      );

  /// Citation number ([1], [2]…) for an article: its position in the AI input list.
  int? citationNumber(String articleId) {
    final i = inputArticleIds.indexOf(articleId);
    return i < 0 ? null : i + 1;
  }

  String citationLabel(List<String> articleIds) {
    final numbers = articleIds.map(citationNumber).whereType<int>().toList()..sort();
    return numbers.isEmpty ? '' : '[${numbers.join(', ')}]';
  }
}
