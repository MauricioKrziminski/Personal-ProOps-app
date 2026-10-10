import * as Application from 'expo-application';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { abrirLegal, URL_APAGAR_CONTA, URL_PRIVACIDADE, URL_TERMOS } from '@/lib/links-legais';
import { EMAIL_SUPORTE } from '@/lib/suporte';
import { abrirSuporte } from '@/lib/suporte-abrir';

/** Ajuda e suporte: o caminho até uma pessoa, os guias e a versão/build sempre à vista. */
export default function AjudaScreen() {
  const versao = Application.nativeApplicationVersion ?? '—';
  const build = Application.nativeBuildVersion;
  return (
    <Screen grouped>
      <Section>
        <Row title="Falar com o suporte" subtitle={EMAIL_SUPORTE} icon="envelope" onPress={() => { void abrirSuporte(); }} />
        <Row title="Como usar o ProOps" icon="questionmark.circle" onPress={() => router.push('/guia')} />
      </Section>
      <Section title="Legal">
        <Row title="Termos de Uso" icon="doc.text" onPress={() => abrirLegal(URL_TERMOS)} />
        <Row title="Política de Privacidade" icon="lock" onPress={() => abrirLegal(URL_PRIVACIDADE)} />
        <Row title="Como apagar a conta" icon="trash" onPress={() => abrirLegal(URL_APAGAR_CONTA)} />
      </Section>
      <Section>
        <Row
          title="Versão"
          icon="info.circle"
          chevron={false}
          trailing={
            <ThemedText type="default" themeColor="textSecondary">
              {`${versao}${build ? ` (${build})` : ''} · ${Platform.OS === 'ios' ? 'iOS' : 'Android'}`}
            </ThemedText>
          }
        />
      </Section>
    </Screen>
  );
}
