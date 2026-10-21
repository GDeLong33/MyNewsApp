import 'package:flutter/material.dart';

import 'api/news_api.dart';
import 'screens/story_list_screen.dart';

void main() {
  runApp(MyNewsApp(api: NewsApi()));
}

class MyNewsApp extends StatelessWidget {
  const MyNewsApp({super.key, required this.api});

  final NewsApi api;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'My News',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1F3A5F)),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1F3A5F), brightness: Brightness.dark),
        useMaterial3: true,
      ),
      home: StoryListScreen(api: api),
    );
  }
}
