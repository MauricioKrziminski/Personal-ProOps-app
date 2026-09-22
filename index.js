/**
 * Ponto de entrada: o do expo-router, mais o handler dos widgets do Android.
 *
 * O handler precisa estar registrado no ARRANQUE do JS: o sistema acorda o app em segundo plano
 * (widget adicionado, redimensionado, a cada 30 min) só para desenhar, sem abrir tela nenhuma.
 *
 * `require` dentro do `if`, e não `import` no topo: com import, o iOS carregava a lib de widget
 * do Android (e o handler inteiro) na abertura sem nunca usá-los.
 *
 * ⚠️ E só com o módulo NATIVO presente: a lib o exige na importação (`getEnforcing`), e um JS novo
 * sobre um binário de antes dos widgets (um OTA para a nativa errada) derrubaria o app na
 * abertura. `try` em volta não serve — o Metro manda o erro para o `reportFatalError`.
 */
import { Platform, TurboModuleRegistry } from 'react-native';

if (Platform.OS === 'android' && TurboModuleRegistry.get('AndroidWidget')) {
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./src/widgets/android/task-handler');
  registerWidgetTaskHandler(widgetTaskHandler);
}

require('expo-router/entry');
