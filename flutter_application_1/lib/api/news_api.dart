import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';
import 'models.dart';

/// A failure the app can explain to the reader in plain words.
class ApiException implements Exception {
  ApiException(this.message, {this.notFound = false});

  final String message;
  final bool notFound;

  @override
  String toString() => message;
}

/// Reads stored results from the My News server. It never fetches news feeds or calls an AI service.
class NewsApi {
  NewsApi({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        baseUrl = baseUrl ?? AppConfig.apiBaseUrl;

  final http.Client _client;
  final String baseUrl;

  Future<StoryListResponse> fetchStories() async =>
      StoryListResponse.fromJson(await _get('/stories?limit=100'));

  Future<StoryDetail> fetchStory(String id) async =>
      StoryDetail.fromJson(await _get('/stories/${Uri.encodeComponent(id)}'));

  Future<Map<String, dynamic>> _get(String path) async {
    final http.Response res;
    try {
      res = await _client
          .get(Uri.parse('$baseUrl$path'), headers: {'accept': 'application/json'})
          .timeout(AppConfig.requestTimeout);
    } on TimeoutException {
      throw ApiException('The My News server is taking too long to respond. Check your connection and try again.');
    } catch (_) {
      throw ApiException("Can't reach the My News server. Check that you're online and try again.");
    }

    if (res.statusCode == 404) {
      throw ApiException('This story is no longer available. Its articles may have passed the 7-day limit.',
          notFound: true);
    }
    if (res.statusCode != 200) {
      throw ApiException('The My News server had a problem (error ${res.statusCode}). Please try again in a moment.');
    }
    try {
      return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException('The server sent a response the app could not read. Please try again later.');
    }
  }
}
