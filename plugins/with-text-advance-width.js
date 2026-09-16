const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins');

/**
 * O texto do Android quebra a linha pelo AVANÇO dos glifos, como o React Native mede.
 *
 * O que isto resolve: a partir do Android 15, com `targetSdk` 35+, a `TextView` passou a usar a
 * CAIXA DE TINTA do glifo para quebrar a linha (`useBoundsForWidth = true`), enquanto o React
 * Native continua medindo pela soma dos avanços. Quando a tinta passa do avanço, a caixa que o
 * Yoga deu é estreita demais para a própria `TextView`: ela quebra a linha, a altura fixa da
 * linha esconde o resto, e **a última palavra some sem erro nenhum**.
 *
 * Medido em 16/09/2026 (Jost SemiBold, 12sp × fonte 1,3 = 55px): "já aconteceu" soma 312,8px de
 * avanço — o Yoga dá 313 —, mas o gancho do "j" desce 4,6px à esquerda da origem e a tinta
 * ocupa 317,5px. Na tela, "já aconteceu" virava "já". "nada ainda", com 0,3px de folga e sem
 * glifo saliente, desenhava inteiro na mesma linha.
 *
 * É a correção do próprio React Native (facebook/react-native#58280, `setUseBoundsForWidth(false)`
 * na `ReactTextView`), que entrou na `main` e **não** está na 0.86.3. Aqui ela vem pelo TEMA:
 * `ReactTextView` estende `AppCompatTextView`, que lê `android:textViewStyle`, então toda view
 * de texto nasce com a régua certa — inclusive as reaproveitadas, porque o valor não depende de
 * quem usou a view antes. Remover quando o React Native do projeto trouxer a correção.
 *
 * `TextInput` (`editTextStyle`) fica de fora: campo não encolhe até o conteúdo, então a
 * divergência não aparece ali. Android 14 e anteriores ignoram o atributo.
 */
const ESTILO = 'TextoPorAvanco';

function configureStyles(xml) {
  const { Styles } = AndroidConfig;
  let styles = Styles.assignStylesValue(xml, {
    add: true,
    parent: Styles.getAppThemeGroup(),
    name: 'android:textViewStyle',
    value: `@style/${ESTILO}`,
  });
  styles = Styles.assignStylesValue(styles, {
    add: true,
    parent: { name: ESTILO, parent: 'Widget.AppCompat.TextView' },
    name: 'android:useBoundsForWidth',
    value: 'false',
    targetApi: '35',
  });
  return styles;
}

const withTextAdvanceWidth = (config) =>
  withAndroidStyles(config, (modConfig) => {
    modConfig.modResults = configureStyles(modConfig.modResults);
    return modConfig;
  });

module.exports = withTextAdvanceWidth;
module.exports.configureStyles = configureStyles;
module.exports.ESTILO = ESTILO;
