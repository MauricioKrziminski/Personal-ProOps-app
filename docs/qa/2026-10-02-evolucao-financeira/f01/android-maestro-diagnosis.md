# F01 Android Maestro diagnosis (read-only, 2026-10-02)

Confirmed: ASCII input/erase on API36 is slowed by WindowManager animation synchronization, not UiAutomator idle waiting. Maestro cli-2.11.0 uses AndroidX UIAutomator2.3.0 and sets waitForIdleTimeout(0). ASCII inputText loops UiDevice.pressKeyCode (75ms intentional delay); eraseAllText loops pressDelete (50 default). UIAutomator injects DOWN/UP using UiAutomation.injectInputEvent(event,true); Android36 defaults waitForAnimations=true. UiAutomationConnection syncs WMS before DOWN and after UP. WMS animation timeout is5000ms. Logs show two ~5.2s waits per character, then hardcoded120s gRPC deadline.

Observed logcat at12:26 (buffer had12:17-12:20 events):
12:18:19.054 D/Maestro:81
12:18:24.134 W/WindowManager:Timed out waiting for animations to complete, animatingContainer=Window{b607037 u0 com.proops.personal.dev/com.proops.personal.dev.MainActivity} animationType=starting_reveal animateStarting=false
12:18:29.309 W/WindowManager:same starting_reveal timeout
12:18:29.506 D/Maestro:65
12:18:34.513 W/WindowManager:same starting_reveal timeout
12:18:39.706 W/WindowManager:same starting_reveal timeout
12:18:39.805 D/Maestro:32
The ring buffer subsequently rotated; these snippets were copied from inspected tool output, not a full preserved log.

CLI evidence: 2026-10-02_120842/maestro.log lines42-45 inputText failed after120s. 2026-10-02_121404/maestro.log lines30-34 eraseText failed before next inputText. DeviceServerDiedException is transport classification for DEADLINE_EXCEEDED; it does not alone establish process death.

Not established: why system starting_reveal remains registered, whether Expo splash lifecycle/Android emulator regression, or another system issue. No evidence identifies Gboard/cursor/product animation as root cause.

Minimal purpose-built test: normal UTF8 title 'QA F01 ANDROID Pix ação 20261002' switches Maestro to inputUnicodeText, IME commitText, avoiding per-character UiAutomation injection. Source captures original default_input_method and restores it in finally; restoration failure is logged (not guaranteed if external process forcibly killed). Money string with real NBSP is also UTF8. Avoid default eraseText50x in this diagnostic. No product changes or animation-disabling proposed.

Primary sources and local source evidence:
- https://github.com/mobile-dev-inc/Maestro/blob/cli-2.11.0/maestro-client/src/main/java/maestro/drivers/AndroidDriver.kt lines547-557,1447-1480
- https://github.com/mobile-dev-inc/Maestro/blob/cli-2.11.0/maestro-android/src/androidTest/java/dev/mobile/maestro/MaestroDriverService.kt lines87-90,295-325,516-546
- https://github.com/mobile-dev-inc/Maestro/blob/cli-2.11.0/maestro-client/src/main/java/maestro/android/AndroidDeviceConnection.kt line106
- https://dl.google.com/dl/android/maven2/androidx/test/uiautomator/uiautomator/2.3.0/uiautomator-2.3.0-sources.jar UiDevice.java508-513,InteractionController.java430-448,493-494
- https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r3/core/java/android/app/UiAutomation.java lines971-972
- https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r3/core/java/android/app/UiAutomationConnection.java lines138-169
- https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r3/services/core/java/com/android/server/wm/WindowManagerService.java lines463,9053-9112

Read-only investigation; no UI interactions, device settings mutations, repository edits, process kills, tests, or analytics. Downloaded source artifacts and wrote this note under/private/tmp only.

Lifecycle follow-up: Android 16 WindowState.removeIfPossible(), lines 2264-2291, explicitly cancels ANIMATION_TYPE_STARTING_REVEAL when removing the starting window or affected base app window. This supports removal/recreation of the window as a diagnostic experiment (normal Maestro stopApp/launchApp, no data clearing), not a guaranteed fix because the cold-launch state may recur. No primary evidence found establishes HOME + launchApp(stopApp:false) or orientation as clearing this state. WindowState.hide() itself does not explicitly cancel that animation. Source: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r3/services/core/java/com/android/server/wm/WindowState.java
