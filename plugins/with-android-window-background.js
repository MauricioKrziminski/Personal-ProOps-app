const {
  AndroidConfig,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidStyles,
} = require('expo/config-plugins');

/**
 * O fundo da JANELA e da TAREFA do Android na cor do papel do app (claro) e da tinta (escuro).
 *
 * O que isto resolve: com a trava ligada o app sai da foto dos recentes
 * (`modules/proops-privacidade`), e na volta o sistema mostra o fundo da janela enquanto ela
 * abre. O padrão do `Theme.AppCompat.DayNight` é `#303030` no escuro: a volta dentro da espera
 * piscava um cinza antes da Hoje (medido em 17/09/2026). Nas cores do `background` do
 * `theme.ts`, o quadro é o próprio papel do app. `with-android-window-background.test.js`
 * prende as duas cores às do tema.
 *
 * ⚠️ **São DOIS atributos.** O quadro da volta sem foto não usa o `windowBackground`: ele é a cor
 * de fundo da TAREFA, que a Activity tira do `android:colorBackground` do tema. Só com o primeiro
 * o cinza continuou (medido).
 *
 * Segue o modo noturno do SISTEMA (`values-night`); a escolha de tema dentro do app não chega
 * aqui.
 */
const COR = 'fundoDaJanela';
const CLARO = '#F2F1EE';
const ESCURO = '#0B0B0C';

const { assignColorValue } = AndroidConfig.Colors;
const { assignStylesValue, getAppThemeGroup } = AndroidConfig.Styles;

const ATRIBUTOS = ['android:windowBackground', 'android:colorBackground'];

function configureStyles(xml) {
  return ATRIBUTOS.reduce(
    (atual, name) =>
      assignStylesValue(atual, {
        add: true,
        parent: getAppThemeGroup(),
        name,
        value: `@color/${COR}`,
      }),
    xml
  );
}

const withAndroidWindowBackground = (config) => {
  config = withAndroidColors(config, (mod) => {
    mod.modResults = assignColorValue(mod.modResults, { name: COR, value: CLARO });
    return mod;
  });
  config = withAndroidColorsNight(config, (mod) => {
    mod.modResults = assignColorValue(mod.modResults, { name: COR, value: ESCURO });
    return mod;
  });
  return withAndroidStyles(config, (mod) => {
    mod.modResults = configureStyles(mod.modResults);
    return mod;
  });
};

module.exports = withAndroidWindowBackground;
module.exports.configureStyles = configureStyles;
module.exports.COR = COR;
module.exports.CLARO = CLARO;
module.exports.ESCURO = ESCURO;
