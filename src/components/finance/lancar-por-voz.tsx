import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, Linking, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';

import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Note } from '@/components/ui/note';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Radius, Space } from '@/design/tokens';
import { apagarGravacao, useGravadorDeVoz } from '@/hooks/use-gravador-de-voz';
import { AgentApiError, createFinanceDraft, transcribeAudio } from '@/lib/agent-api';
import { localISODate } from '@/lib/dates';
import { hrefDoRascunho } from '@/lib/voice-draft';
import { useTheme } from '@/hooks/use-theme';

type Fase = 'parado' | 'iniciando' | 'gravando' | 'transcrevendo' | 'montando';

/** dB do medidor (-160..0) → 0..1. Abaixo de -55 é silêncio (a mesma régua de `audioPossuiSinal`). */
const nivelDe = (db: number | undefined) => (typeof db === 'number' ? Math.max(0, Math.min(1, (db + 55) / 55)) : 0);
const PESOS = [0.5, 0.8, 1, 0.8, 0.5];
const ALTURA = 56;

function Barra({ nivel, peso }: { nivel: number; peso: number }) {
  const theme = useTheme();
  const estilo = useAnimatedStyle(() => ({ height: withTiming(6 + (ALTURA - 6) * nivel * peso, { duration: 90 }) }));
  return <Animated.View style={[styles.barra, { backgroundColor: theme.tintFill }, estilo]} />;
}

/** A onda responde ao áudio real; com Reduzir movimento é uma barra de nível parada. */
function NivelDaGravacao({ nivel }: { nivel: number }) {
  const theme = useTheme();
  const reduzir = useReducedMotion();
  if (reduzir) {
    return (
      <View style={[styles.trilho, { backgroundColor: theme.surface }]} accessibilityLabel="Gravando">
        <View style={[styles.nivel, { backgroundColor: theme.tintFill, width: `${Math.round(nivel * 100)}%` }]} />
      </View>
    );
  }
  return (
    <View style={styles.onda} accessibilityLabel="Gravando">
      {PESOS.map((peso, i) => <Barra key={i} nivel={nivel} peso={peso} />)}
    </View>
  );
}

function FolhaPorVoz({ onClose }: { onClose: () => void }) {
  const gravador = useGravadorDeVoz();
  const [fase, setFase] = useState<Fase>('iniciando');
  const faseAtual = useRef<Fase>('iniciando');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [semMicrofone, setSemMicrofone] = useState(false);

  const mudar = (f: Fase) => { faseAtual.current = f; setFase(f); };

  // App em segundo plano: a gravação para e é descartada; o que já foi transcrito fica no campo.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado !== 'active' && faseAtual.current === 'gravando') {
        void gravador.cancelar();
        mudar('parado');
        setErro('A gravação parou porque o app saiu da tela. Grave de novo.');
      }
    });
    return () => sub.remove();
  }, [gravador]);

  const gravar = async () => {
    Keyboard.dismiss();
    setErro(null);
    setSemMicrofone(false);
    // Permissão e preparo do microfone levam ~1 s: o botão espera em vez de oferecer "Gravar".
    mudar('iniciando');
    const inicio = await gravador.iniciar();
    if (inicio !== 'gravando') mudar('parado');
    if (inicio === 'negada') return setSemMicrofone(true);
    if (inicio === 'falhou') return setErro('Não consegui iniciar a gravação.');
    mudar('gravando');
  };

  // Tocar em "Por voz" já é o pedido de gravar: a folha abre ouvindo. A ref segura o StrictMode,
  // que monta duas vezes em desenvolvimento.
  const abriuGravando = useRef(false);
  useEffect(() => {
    if (abriuGravando.current) return;
    abriuGravando.current = true;
    void gravar();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na abertura da folha
  }, []);

  const parar = async () => {
    mudar('transcrevendo');
    let uri: string | null = null;
    try {
      uri = await gravador.parar();
      const { text } = await transcribeAudio(uri);
      setTexto((antes) => [antes.trim(), text.trim()].filter(Boolean).join(' '));
    } catch (e) {
      setErro(e instanceof AgentApiError ? e.message : 'Não consegui transcrever o áudio. Tente novamente.');
    } finally {
      if (uri) apagarGravacao(uri);
      mudar('parado');
    }
  };

  const montar = async () => {
    const fala = texto.trim();
    if (!fala || faseAtual.current !== 'parado') return;
    Keyboard.dismiss();
    setErro(null);
    mudar('montando');
    try {
      const rascunho = await createFinanceDraft(fala, localISODate(), Intl.DateTimeFormat().resolvedOptions().timeZone);
      onClose();
      router.push(hrefDoRascunho(rascunho));
    } catch (e) {
      // o texto fica: a pessoa tenta de novo sem falar tudo outra vez
      setErro(e instanceof AgentApiError ? e.message : 'Não consegui montar o lançamento. Tente de novo.');
      mudar('parado');
    }
  };

  const gravando = fase === 'gravando';
  const ocupado = fase === 'iniciando' || fase === 'transcrevendo' || fase === 'montando';
  return (
    <Sheet visible onClose={onClose}>
      <TaskHeader title="Lançar por voz" onClose={onClose} />
      <SheetScroll contentContainerStyle={styles.corpo}>
        {gravando ? <NivelDaGravacao nivel={nivelDe(gravador.metering)} /> : null}
        <Button
          label={gravando ? 'Parar' : texto ? 'Gravar de novo' : 'Gravar'}
          icon={gravando ? 'stop.fill' : 'mic'}
          variant={texto && !gravando ? 'secondary' : 'primary'}
          loading={fase === 'iniciando' || fase === 'transcrevendo'}
          disabled={ocupado}
          onPress={gravando ? parar : gravar}
          block
        />
        {semMicrofone ? (
          <>
            <Note icon="exclamationmark.triangle" tone="warning">Permita o microfone nos ajustes do aparelho para gravar.</Note>
            <Button label="Abrir ajustes" variant="secondary" onPress={() => { void Linking.openSettings(); }} />
          </>
        ) : null}
        {erro ? <Note icon="exclamationmark.triangle" tone="danger">{erro}</Note> : null}
        {!gravando && (texto || erro || fase === 'montando') ? (
          <>
            <Field label="O que você falou" obrigatorio>
              <TextField
                value={texto}
                onChangeText={setTexto}
                editable={!ocupado}
                multiline
                maxLength={4000}
                placeholder="Ex.: gastei 45 no mercado ontem"
              />
            </Field>
            <Button label="Montar lançamento" loading={fase === 'montando'} disabled={!texto.trim() || ocupado} onPress={montar} block />
          </>
        ) : null}
      </SheetScroll>
    </Sheet>
  );
}

/** O "Por voz" dos atalhos de lançar: `abrir()` e desenhe `folha` no fim da tela. */
export function useLancarPorVoz() {
  const [aberta, setAberta] = useState(false);
  return {
    abrir: () => setAberta(true),
    folha: aberta ? <FolhaPorVoz onClose={() => setAberta(false)} /> : null,
  };
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
  onda: { height: ALTURA, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm },
  barra: { width: 8, borderRadius: Radius.pill },
  trilho: { height: 8, borderRadius: Radius.pill, overflow: 'hidden' },
  nivel: { height: 8, borderRadius: Radius.pill },
});
