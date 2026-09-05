/**
 * Três variantes que convivem NO MESMO APARELHO.
 *
 * O que isto resolve: até 04/09/2026 existia um `package` só (`com.proops.personal`), então
 * instalar um build de staging **substituía** o de produção no celular — mesmo ícone, mesmo
 * nome, e a única forma de saber em qual banco você estava escrevendo era lembrar de qual
 * APK tinha sido instalado por último. Num app de dinheiro isso é um jeito de gravar
 * lançamento no lugar errado sem perceber.
 *
 * | variante      | package                       | banco      | agente          |
 * |---------------|-------------------------------|------------|-----------------|
 * | `development` | `com.proops.personal.dev`     | o do .env  | o do .env       |
 * | `preview`     | `com.proops.personal.staging` | staging    | agente-staging  |
 * | (sem variável)| `com.proops.personal`         | produção   | agente          |
 *
 * ⚠️ **O default de `APP_VARIANT` é `development`, não produção.** Mesmo motivo do
 * `agent/.env` ser o staging: "sem variável" quer dizer "alguém rodou `expo run:android` na
 * própria máquina", e isso nunca pode sobrescrever o app de produção que está no celular do
 * dono. Produção exige `APP_VARIANT=production` escrito com todas as letras — é o que o
 * perfil `production`/`distribution` do `eas.json` faz.
 *
 * O `scheme` continua **um só** de propósito: ele não é chave de dado nenhum (o login é por
 * código, e deep link aqui é ferramenta de desenvolvimento). Com dois apps instalados o
 * Android mostra um seletor, que é o comportamento certo — inventar `appproops-staging`
 * quebraria os links que já estão nos testes e nas notas.
 *
 * ⚠️ `android/` e `ios/` são saída de `prebuild` (gitignorados) e têm o package ANTIGO
 * gravado. Depois de mudar de variante, `npx expo prebuild --clean` antes de `run:android`.
 *
 * ⚠️ **É `.js`, não `.ts`, de propósito.** Como `app.config.ts`, o build no EAS morria na fase
 * "Configure expo-updates" em ~45s, com `UNKNOWN_ERROR`, duas vezes seguidas — enquanto
 * `expo config` e `expo prebuild` passavam local. A config é lida por várias ferramentas em
 * momentos diferentes do build, e nem todas carregam TypeScript; JS puro não tem esse risco e
 * o arquivo não perde nada (as anotações eram três).
 */
const VARIANTE = process.env.APP_VARIANT || 'development';

const IDENTIDADE = {
  development: { id: 'com.proops.personal.dev', nome: 'ProOps (dev)' },
  preview: { id: 'com.proops.personal.staging', nome: 'ProOps (staging)' },
  production: { id: 'com.proops.personal', nome: 'Personal ProOps app' },
};

module.exports = ({ config }) => {
  const { id, nome } = IDENTIDADE[VARIANTE] || IDENTIDADE.development;

  return {
    ...config,
    name: nome,
    ios: { ...config.ios, bundleIdentifier: id },
    android: { ...config.android, package: id },
  };
};
