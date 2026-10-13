import { Image } from 'expo-image';
import { router, useNavigation } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AutorizarIa, IA_SEM_CONSENTIMENTO } from '@/components/agent/autorizar-ia';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/ui/note';
import { IOS_26_OU_MAIS } from '@/constants/platform';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { AgentApiError, createFinanceDraft, rascunhoDaImagem } from '@/lib/agent-api';
import { localISODate } from '@/lib/dates';
import { hrefDoRascunho } from '@/lib/voice-draft';

/** O teto do agente (MAX_CONTENT): acima dele a rota recusa com 422. */
const MAX_TEXTO = 4000;

/**
 * "Compartilhar" de outro app (comprovante, print, texto do Pix) → o rascunho do lançamento.
 * Nada é gravado aqui: "Montar lançamento" abre o formulário preenchido, e salvar é lá.
 */
export default function Compartilhado() {
  const { shareIntent, resetShareIntent } = useShareIntentContext();
  const [montando, setMontando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [semConsentimento, setSemConsentimento] = useState(false);
  const theme = useTheme();
  const alturaDoHeader = useHeaderHeight();
  const insets = useSafeAreaInsets();
  // O que a tela mostra é o ÚLTIMO compartilhado: o reset da saída não pisca "nada" na transição.
  const [atual, setAtual] = useState(shareIntent);
  if (shareIntent !== atual && (shareIntent.text || shareIntent.files)) setAtual(shareIntent);
  const arquivo = atual.files?.find((f) => f.mimeType?.startsWith('image/'));
  const texto = (atual.text ?? '').trim();
  const nada = !arquivo && !texto;

  // Saiu da tela (montou ou voltou): o compartilhado acabou. Sem isto o iOS o relê a cada volta
  // ao app. `beforeRemove`, e não o desmontar, porque o StrictMode desmonta de mentira em dev.
  const navigation = useNavigation();
  useEffect(() => navigation.addListener('beforeRemove', () => resetShareIntent()), [navigation, resetShareIntent]);

  const montar = async () => {
    setMontando(true);
    setErro(null);
    setSemConsentimento(false);
    const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const r = arquivo
        ? await rascunhoDaImagem(arquivo.path, localISODate(), fuso)
        : await createFinanceDraft(texto.slice(0, MAX_TEXTO), localISODate(), fuso);
      router.replace(hrefDoRascunho(r));
    } catch (e) {
      // Sem consentimento: o mesmo aviso da voz, e só a pessoa tenta de novo (Apple 5.1.2(i)).
      if (e instanceof AgentApiError && e.code === IA_SEM_CONSENTIMENTO) setSemConsentimento(true);
      else setErro(e instanceof AgentApiError ? e.message : 'Não consegui montar o lançamento. Tente de novo.');
    } finally {
      setMontando(false);
    }
  };

  /*
    A tela não rola: a prévia ocupa o espaço que sobra e o botão fica embaixo. Sem scroll na raiz,
    o recuo do header translúcido do iOS 26 é somado à mão (como em `ConversationWorkspace`); com o
    `Screen`, vindo de outro app pelo Compartilhar, o iOS às vezes não aplicava o recuo e o topo do
    comprovante ficava debaixo da barra. Uma prévia de altura fixa sobrava vazia embaixo.
  */
  return (
    <View
      style={[styles.tela, {
        backgroundColor: theme.background,
        paddingTop: (IOS_26_OU_MAIS ? alturaDoHeader : 0) + Space.lg,
        paddingBottom: insets.bottom + Space.lg,
        paddingLeft: insets.left + Space.lg,
        paddingRight: insets.right + Space.lg,
      }]}>
      {arquivo ? (
        <View style={[styles.moldura, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
          <Image source={{ uri: arquivo.path }} style={styles.imagem} contentFit="contain" accessibilityLabel="Imagem compartilhada" />
        </View>
      ) : texto ? (
        <ScrollView style={[styles.moldura, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]} contentContainerStyle={styles.texto} keyboardShouldPersistTaps="handled">
          <ThemedText selectable>{texto}</ThemedText>
        </ScrollView>
      ) : (
        <View style={styles.vazio}><Note icon="exclamationmark.triangle" tone="warning">Compartilhe uma imagem ou um texto.</Note></View>
      )}
      {semConsentimento ? <AutorizarIa aoAutorizar={() => setSemConsentimento(false)} /> : null}
      {erro ? <Note icon="exclamationmark.triangle" tone="danger">{erro}</Note> : null}
      <Button label="Montar lançamento" size="lg" loading={montando} disabled={nada || montando} onPress={montar} block />
    </View>
  );
}

const styles = StyleSheet.create({
  tela: { flex: 1, gap: Space.lg },
  moldura: { flex: 1, borderWidth: 1, borderRadius: Radius.md, borderCurve: 'continuous', overflow: 'hidden' },
  imagem: { flex: 1, margin: Space.md },
  texto: { padding: Space.lg },
  vazio: { flex: 1, justifyContent: 'center' },
});
