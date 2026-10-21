# My News: Flutter app

The Android client for My News. It only reads stored results from the My News server (`GET /stories`, `GET /stories/{id}`). It never fetches news feeds, groups articles or calls an AI service. Publisher and background links open in the phone's browser.

## Screens

- **Top stories**
  - one entry per story: headline, latest article time, number of publishers;
  - refresh (button or pull down);
  - loading, empty and error states, with a retry.
- **Story detail**
  - an overview: the stored AI overview, labeled "AI-generated" with its generation time, or the newest report's own feed excerpt, labeled as original wording;
  - separate button groups for **Original coverage** (only publishers that covered the story, with a chooser when one publisher has several articles), **Background** ("No background resource available" when the server has none), **AI overview** and **AI perspectives**.
- **AI overview:** overview, agreement, disagreement and uncertainty, each with numbered citations; the supporting articles with Open buttons; the input-scope disclosure.
- **AI perspectives:** each supported viewpoint, with its evidence limits, supporting coverage and switching between viewpoints. Shows "Insufficient evidence for distinct perspectives" when the evidence doesn't support distinct viewpoints.

## Configuration

The API base URL is a build-time setting in [lib/config.dart](lib/config.dart). It defaults to the deployed server, `https://163-192-125-189.sslip.io`. To point at another server:

```
flutter run --dart-define=API_BASE_URL=https://your-server.example
flutter build apk --release --dart-define=API_BASE_URL=https://your-server.example
```

## One-time setup on Windows

1. **Turn on Windows Developer Mode.** Flutter needs it to build apps with plugins. Run `start ms-settings:developers` and switch **Developer Mode** on.
2. **Install Android Studio** from https://developer.android.com/studio. Open it and finish the *Standard* setup wizard, which installs the Android SDK.
   - In Android Studio, go to **More Actions → SDK Manager → SDK Tools**.
   - Tick **Android SDK Command-line Tools (latest)** and click Apply.
3. In a new terminal:
   ```
   flutter doctor --android-licenses     (press y to accept each license)
   flutter doctor                        (Android toolchain should now show ✓)
   ```

## Run on an Android phone

1. **Turn on USB debugging on the phone.**
   - Settings → About phone → tap **Build number** 7 times, which unlocks Developer options.
   - Settings → System → Developer options → turn on **USB debugging**. The menu location varies by brand; search Settings for "USB debugging".
2. **Connect the phone to the PC by USB.** On the phone, tap **Allow** on the "Allow USB debugging?" prompt, and tick "Always allow from this computer".
3. **Check that Flutter sees it:**
   ```
   cd flutter_application_1
   flutter devices
   ```
   Your phone should be listed with an ID, for example `R58N123ABC`.
4. **Run a development build** (supports hot reload with `r`, quit with `q`):
   ```
   flutter run -d <device-id>
   ```
5. **Build and install the release build** used for the demo and submission:
   ```
   flutter build apk --release
   flutter install -d <device-id> --release
   ```
   The APK is at `build/app/outputs/flutter-apk/app-release.apk`.
   - *Without a cable:* copy that file to the phone, open it, and allow "Install unknown apps" for your file manager when asked.
   - It's signed with Flutter's debug key, which is fine for installing it yourself and for the class submission, but not for the Play Store.

## Troubleshooting

**`AccessDeniedException` or "Unable to delete directory" under `build\` during `flutter build apk`:** the project is inside OneDrive, which syncs and locks files in the `build` folder after the first build. To fix it:

1. Pause OneDrive (cloud icon → ⚙ → **Pause syncing**).
2. Stop Gradle:
   ```
   $env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"; android\gradlew.bat --stop
   ```
3. Delete `build`: `Remove-Item build -Recurse -Force`
4. Build again.

Resume OneDrive afterwards.

**Gradle asks for NDK 28.2.13676358 and fails to install it:** install it with Android's CLI:
```
& "$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin\android.exe" sdk install ndk/28.2.13676358
```

**The emulator says hardware acceleration isn't available:** enable virtualization (SVM Mode on AMD) in the PC's BIOS, and turn on **Windows Hypervisor Platform** in Windows Features.

## Show it through Phone Link

- Install **Link to Windows** on the phone, which is preinstalled on many Samsung phones. Pair it with the **Phone Link** app on Windows.
- Open the phone screen or **Apps** view in Phone Link to mirror the app. Screen mirroring only works on supported Android phones (many Samsung models and a few other brands), so test it before presentation day.

## Develop on Windows desktop (optional)

The same code also runs as a Windows app, which is handy for quick UI checks:

```
flutter run -d windows
```

## Checks

- `flutter analyze`: static analysis.
- `flutter test`: unit tests.
- `dart run tool/live_check.dart`: fetches the live story list and every story detail through the app's own API client, and checks that they parse. Publisher buttons should match publisher counts, and AI citations should point to articles in the story.
