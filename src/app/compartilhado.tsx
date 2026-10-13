import { Image } from 'expo-image';
import { router, useNavigation } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { AutorizarIa, IA_SEM_CONSENTIMENTO } from '@/components/agent/autorizar-ia';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/ui/note';
import { Screen } from '@/components/ui/screen';
import { Radius } from '@/design/tokens';
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

  const proporcao = arquivo?.width && arquivo?.height ? arquivo.width / arquivo.height : 0.6;
  return (
    <Screen>
      {arquivo ? (
        <Image
          source={{ uri: arquivo.path }}
          style={[styles.imagem, { aspectRatio: proporcao }]}
          contentFit="contain"
          accessibilityLabel="Imagem compartilhada"
        />
      ) : null}
      {texto && !arquivo ? <ThemedText selectable>{texto}</ThemedText> : null}
      {nada ? <Note icon="exclamationmark.triangle" tone="warning">Compartilhe uma imagem ou um texto.</Note> : null}
      {semConsentimento ? <AutorizarIa aoAutorizar={() => setSemConsentimento(false)} /> : null}
      {erro ? <Note icon="exclamationmark.triangle" tone="danger">{erro}</Note> : null}
      <Button label="Montar lançamento" loading={montando} disabled={nada || montando} onPress={montar} block />
    </Screen>
  );
}

const styles = StyleSheet.create({ imagem: { width: '100%', maxHeight: 420, alignSelf: 'center', borderRadius: Radius.md, borderCurve: 'continuous' } });
