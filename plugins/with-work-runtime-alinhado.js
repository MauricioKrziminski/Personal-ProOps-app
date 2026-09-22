const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Alinha `androidx.work:work-runtime-ktx` na 2.8.1.
 *
 * O que isto resolve: o build do Android morria em `checkDuplicateClasses` com
 * `Duplicate class androidx.work.OneTimeWorkRequestKt` — o Glance que o `expo-widgets` compila no
 * Android puxa `work-runtime-ktx:2.7.1`, e o `react-native-android-widget` puxa
 * `work-runtime:2.8.1`. A partir da 2.8 as classes do `-ktx` MUDARAM para o `work-runtime`, e o
 * artefato `-ktx` virou um repasse vazio: forçar o `-ktx` na 2.8.1 é o alinhamento que o próprio
 * AndroidX documenta, sem trocar nenhuma das duas bibliotecas de versão (22/09/2026).
 */
const MARCA = '// proops: work-runtime-ktx alinhado';
const BLOCO = `
${MARCA}
configurations.all {
    resolutionStrategy.force 'androidx.work:work-runtime-ktx:2.8.1'
}
`;

function alinhar(conteudo) {
  return conteudo.includes(MARCA) ? conteudo : `${conteudo}\n${BLOCO}`;
}

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    c.modResults.contents = alinhar(c.modResults.contents);
    return c;
  });
module.exports.alinhar = alinhar;
