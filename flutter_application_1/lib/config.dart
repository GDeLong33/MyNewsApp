/// App configuration.
///
/// The API base URL is a build-time value. Override it with
/// `flutter run --dart-define=API_BASE_URL=https://example.com` (no trailing slash).
class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://163-192-125-189.sslip.io',
  );

  /// How long to wait for the server before showing a retry message.
  static const Duration requestTimeout = Duration(seconds: 20);
}
