/**
 * Ponto de entrada: o do expo-router, mais o handler dos widgets do Android.
 *
 * O handler precisa estar registrado no ARRANQUE do JS: o sistema acorda o app em segundo plano
 * (widget adicionado, redimensionado, a cada 30 min) só para desenhar, sem abrir tela nenhuma.
 */
import { Platform } from 'react-native';
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { widgetTaskHandler } from './src/widgets/android/task-handler';

if (Platform.OS === 'android') {
  registerWidgetTaskHandler(widgetTaskHandler);
}

import 'expo-router/entry';
