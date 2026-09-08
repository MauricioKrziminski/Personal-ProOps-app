const { withGradleProperties } = require('expo/config-plugins');

/**
 * Quais arquiteturas nativas entram no APK.
 *
 * O que isto resolve: o APK de release tinha **151,3 MB**, e **121 MB** eram
 * `lib/` com as QUATRO arquiteturas — arm64-v8a 31,8 MB, armeabi-v7a 21,8 MB,
 * x86 33,6 MB e x86_64 33,6 MB (medido no `personal-proops-1.3.4.apk`). Os
 * 67 MB de x86/x86_64 só servem para emulador: **nenhum celular consegue usar
 * essas bibliotecas**, e mesmo assim elas eram baixadas em toda atualização.
 * As `.so` ainda vão sem compressão (é o padrão do AGP, para o Android mapear
 * direto do APK), então cada byte aqui é um byte no download.
 *
 * O custo pesa três vezes no mesmo número: o download, o SHA-256 que o app
 * calcula em JS sobre o arquivo inteiro (`downloadAndVerifyApkStream`) e a
 * verificação do próprio Android na instalação.
 *
 * ⚠️ **Só arm64 significa que aparelho 32 bits não instala.** É a troca aceita:
 * 64 bits é obrigatório no Play desde 2019 e o app é Expo SDK 57 com a nova
 * arquitetura. Para voltar a aceitá-los, acrescente `armeabi-v7a` abaixo — são
 * ~22 MB de volta.
 *
 * `development` mantém as quatro de propósito: é a variante que roda em
 * emulador, e o emulador de quem desenvolve pode ser x86_64.
 */
const TODAS = 'armeabi-v7a,arm64-v8a,x86,x86_64';
const APARELHOS_REAIS = 'arm64-v8a';

function arquiteturasDaVariante(variante) {
  return (variante || 'development') === 'development' ? TODAS : APARELHOS_REAIS;
}

function configureGradleProperties(properties, variante) {
  const arquiteturas = arquiteturasDaVariante(variante);
  const entrada = properties.find(
    (item) => item.type === 'property' && item.key === 'reactNativeArchitectures'
  );
  if (entrada) entrada.value = arquiteturas;
  else
    properties.push({
      type: 'property',
      key: 'reactNativeArchitectures',
      value: arquiteturas,
    });
  return properties;
}

const withAndroidAbis = (config) =>
  withGradleProperties(config, (modConfig) => {
    configureGradleProperties(modConfig.modResults, process.env.APP_VARIANT);
    return modConfig;
  });

module.exports = withAndroidAbis;
module.exports.configureGradleProperties = configureGradleProperties;
module.exports.TODAS = TODAS;
module.exports.APARELHOS_REAIS = APARELHOS_REAIS;
