# Expo Router initial linking

`expo-router+57.0.22.patch` fixes initial URL bookkeeping before the navigation
container commits, after disposal, and when an older initial URL races a newer
link. It preserves initial route state, warm navigation, query parameters, and
unhandled protected-route targets. Upstream report:
[Expo issue #49378](https://github.com/expo/expo/issues/49378).

The patch changes only `build/fork/NavigationContainer.js` and
`build/fork/useLinking.native.js`. Expo, React Native, and native SDK versions stay
unchanged. `patch-package` is an exact runtime dependency so the install lifecycle
also works with `npm ci --omit=dev`; the app does not import it.

The `postinstall` checks Router's exact version, then runs
`patch-package --error-on-fail`. Unexpected versions and incompatible source fail
installation visibly. Standard application is safe to repeat. If dependencies
were installed with `--ignore-scripts`, apply the patch explicitly:

```sh
EXPO_NO_DOTENV=1 npm run postinstall
node --test src/lib/expo-router-linking.test.cjs
```

The 16 regression cases VM-load the installed Router code with controlled hook
and native doubles. They cover initial and warm links, abandoned renders,
cleanup, StrictMode effect replay, protected targets, and exact query matching.
They do not prove native rendering, the real React warning detector, or device
navigation; those require separate app validation.

When an upstream release fixes this behavior, remove the patch and its
`postinstall` version guard, and remove `patch-package` if no other patches use
it. Reinstall clean dependencies, migrate the regression harness/version guard
to the new Router implementation, and run the behavioral cases plus native
cold/warm-link and protected-route checks before accepting the upgrade. If the
upstream fix is incomplete, regenerate a reviewed patch with the
[standard patch-package workflow](https://github.com/ds300/patch-package#making-patches)
instead of relaxing the version guard.

# React Native: RCTTiming on the timers thread (iOS)

`react-native+0.86.3.patch` changes only `React/CoreModules/RCTTiming.mm`. App
lifecycle notifications (resign/become active, background/foreground) and
proximity changes used to be handled on the main thread, while the rest of
`RCTTiming` runs on the thread that creates timers (the JS thread). The
background `NSTimer` was then installed on the main run loop in the default
mode only: measured on an iPhone behind Face ID, it fired 0.85–1.03 s late and
every JS timer stalled meanwhile. The patch forwards those handlers to the
timers thread (`-performOnTimingThread:`), so all timer state and the sleep
timer live on one thread.

It takes effect only because `app.config.js` sets
`expo-build-properties` → `ios.buildReactNativeFromSource: true`; the
precompiled React Native core would not contain it (and Expo modules are then
built from source too, so iOS builds are slower). `patch-package
--error-on-fail` makes a React Native upgrade fail installation visibly if the
file changed.

When a React Native release contains this fix, remove the patch and
`buildReactNativeFromSource`, then repeat cold launches behind Face ID on a
device before accepting the upgrade.

# expo-share-intent: shared file from device storage (Android)

`expo-share-intent+8.0.1.patch` changes only `ExpoShareIntentModule.kt`
(`getAbsolutePath`). For a document of `com.android.externalstorage.documents`
on the `primary` volume (sharing from the Files app), the module returned the raw
`/storage/emulated/0/...` path, which the app cannot read under scoped storage:
the "Compartilhar" screen showed an empty image and the upload had no file. The
patch copies that document to the app cache through the content resolver (the
same `getDataColumn` path the other providers already use), so `path` is a
readable `file://` in the cache. The version is pinned exactly in `package.json`
so `patch-package --error-on-fail` fails visibly on an upgrade.

When upstream stops returning raw external-storage paths, remove the patch,
rebuild Android and share an image from Files → ProOps again.
