const {
  AndroidConfig,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidStyles,
} = require('expo/config-plugins');

/**
 * As cores do TEMA NATIVO do Android nas cores do app, com variante noturna.
 *
 * O React desenha quase tudo, mas três coisas saem do tema nativo e estavam no padrão do template:
 *
 * - **O quadro da volta sem foto** (fundo da janela e da tarefa). Com a trava ligada o app sai da
 *   foto dos recentes (`modules/proops-privacidade`), e na volta o sistema pinta esse quadro: era
 *   um cinza `#303030` no escuro antes da Hoje (medido em 17/09/2026). Agora é o papel e a tinta.
 *   ⚠️ São DOIS atributos: o quadro é a cor de fundo da TAREFA, que a Activity tira do
 *   `android:colorBackground`; só com o `windowBackground` o cinza continuou (medido).
 * - **O acento** (`colorAccent`): os botões dos diálogos do sistema ("Sair da conta?") e o
 *   `Switch` ligado saíam em verde-azulado, o padrão do AppCompat. A ação do app é TINTA.
 *
 * `with-android-theme-colors.test.js` prende as cores às do `theme.ts`. Segue o modo noturno
 * nativo, que o `ThemeProvider` sincroniza com a escolha do usuário (`Appearance.setColorScheme`).
 */
const CORES = {
  fundoDaJanela: { claro: '#F2F1EE', escuro: '#0B0B0C' },
  acento: { claro: '#0B0B0C', escuro: '#F4F4F2' },
};

const ITENS = [
  ['android:windowBackground', 'fundoDaJanela'],
  ['android:colorBackground', 'fundoDaJanela'],
  ['colorAccent', 'acento'],
];

const { assignColorValue } = AndroidConfig.Colors;
const { assignStylesValue, getAppThemeGroup } = AndroidConfig.Styles;

function configureStyles(xml) {
  return ITENS.reduce(
    (atual, [name, cor]) =>
      assignStylesValue(atual, { add: true, parent: getAppThemeGroup(), name, value: `@color/${cor}` }),
    xml
  );
}

const pintar = (tom) => (mod) => {
  for (const [name, par] of Object.entries(CORES)) {
    mod.modResults = assignColorValue(mod.modResults, { name, value: par[tom] });
  }
  return mod;
};

const withAndroidThemeColors = (config) => {
  config = withAndroidColors(config, pintar('claro'));
  config = withAndroidColorsNight(config, pintar('escuro'));
  return withAndroidStyles(config, (mod) => {
    mod.modResults = configureStyles(mod.modResults);
    return mod;
  });
};

module.exports = withAndroidThemeColors;
module.exports.configureStyles = configureStyles;
module.exports.CORES = CORES;
