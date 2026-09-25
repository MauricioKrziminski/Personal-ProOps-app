import { useNavigation, useSegments } from 'expo-router';
import { useLayoutEffect } from 'react';

import AppTabs from '@/components/app-tabs';
import { useBuscarConversasAntes } from '@/hooks/use-agent-chat';
import { tituloDaAba } from '@/lib/abas';

export default function TabsLayout() {
  // A rota `(tabs)` leva o nome da aba ativa: é o título que o "voltar" das telas empurradas lê
  // (VoiceOver e o menu do toque longo nele). Sem ele o iOS dizia "(tabs)" — `lib/abas.ts`.
  const navigation = useNavigation();
  const titulo = tituloDaAba(useSegments());
  useLayoutEffect(() => {
    navigation.setOptions({ title: titulo });
  }, [navigation, titulo]);
  // As abas só existem com sessão: é o lugar de adiantar o que a aba Agente vai pedir.
  useBuscarConversasAntes();
  return <AppTabs />;
}
