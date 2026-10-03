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
