import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens a publisher or background page in the phone's browser. Returning to the app keeps the current screen.
Future<void> openLink(BuildContext context, String url) async {
  final uri = Uri.tryParse(url);
  var opened = false;
  if (uri != null && (uri.scheme == 'https' || uri.scheme == 'http')) {
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
  }
  if (!opened && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text("Couldn't open the page. Check that a web browser is installed.")),
    );
  }
}
