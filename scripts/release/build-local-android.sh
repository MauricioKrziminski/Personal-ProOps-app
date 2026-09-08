#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?Runner temporário obrigatório}"
: "${GITHUB_SHA:?Commit do CI obrigatório}"
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]
[[ "${APP_VARIANT:-}" == production && "${EXPO_NO_DOTENV:-}" == 1 ]]
release_dir="$RUNNER_TEMP/personal-proops-release"
mkdir -p "$release_dir"
node scripts/release/create-native-compatibility.mjs "$RUNNER_TEMP/native-compatibility.json"
# EAS local does not provide cloud caching; Gradle uses the cache restored by setup-gradle.
gradle_home="${GRADLE_USER_HOME:-$HOME/.gradle}"
mkdir -p "$gradle_home"
printf '\norg.gradle.caching=true\n' >> "$gradle_home/gradle.properties"
started_at=$SECONDS
eas build --platform android --profile distribution --local --non-interactive --freeze-credentials --output "$release_dir/personal-proops.apk"
test -s "$release_dir/personal-proops.apk"
printf '### Android build\n\n- Builder: GitHub Actions (EAS local)\n- EAS remote queue: not used\n- Build duration: %s seconds\n' "$((SECONDS-started_at))" >> "$GITHUB_STEP_SUMMARY"
