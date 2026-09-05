/**
 * O runtime version do `expo-updates` é `policy: "fingerprint"`, e o fingerprint precisa dar o
 * MESMO hash na minha máquina e no builder do EAS. Se der diferente, o build morre na fase
 * "Configure expo-updates" com:
 *
 *     Runtime version calculated on local machine not equal to
 *     runtime version calculated during build.
 *
 * Foi o que aconteceu em 04/09/2026, **sete builds seguidos**, incluindo o perfil que tinha
 * funcionado horas antes. A mensagem só aparece na página do build; o CLI e a API devolvem
 * `UNKNOWN_ERROR`, e é por isso que dá para perder muito tempo adivinhando.
 *
 * A causa: as três variantes de `app.config.js` mudam `name`, `android.package` e
 * `ios.bundleIdentifier` conforme `APP_VARIANT` — e esses três campos entram no fingerprint.
 * Medido:
 *
 *     APP_VARIANT=<vazio>|development  →  ee7ebe26…
 *     APP_VARIANT=preview              →  a4eef2ca…
 *     APP_VARIANT=production           →  459273fb…
 *
 * O builder avalia a config com o `APP_VARIANT` do perfil; o CLI, ao calcular o hash local, nem
 * sempre. Um lado dizia `preview`, o outro `development`, e os hashes divergiam.
 *
 * A correção é dizer que **identidade não é runtime**: um APK de staging e um de produção rodam
 * o MESMO código nativo, então devem ter o mesmo runtime version. O que separa os dois é o
 * CANAL do EAS Update (`staging` / `production`), não o hash — um update publicado no canal
 * `staging` nunca chega ao app de produção, mesmo com runtime igual.
 *
 * A lista abaixo é o preset `balanced` (o default) MAIS os três campos de identidade. Não uso o
 * preset `relaxed` porque ele também ignora `scheme` e os assets, e esses dois eu QUERO no
 * hash: trocar o ícone ou o scheme muda o binário e tem que invalidar o runtime.
 */
module.exports = {
  sourceSkips: [
    // ── preset `balanced`, que é o default e eu não quero perder ──────────────
    'PackageJsonAndroidAndIosScriptsIfNotContainRun',
    'ExpoConfigVersions',
    'ExpoConfigRuntimeVersionIfString',
    'EasJson',
    'Easignore',

    // ── identidade da variante: muda com APP_VARIANT, não muda o runtime ──────
    'ExpoConfigNames',
    'ExpoConfigAndroidPackage',
    'ExpoConfigIosBundleIdentifier',
  ],
};
