import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { CONCEAL_KEY } from '@/components/ui/conceal';
import { localISODate, timeBR } from '@/lib/dates';
import { montarRetrato, retratoSemSessao, type Retrato } from '@/lib/widget-snapshot';
import { LivreWidget, VenceWidget } from '@/widgets/android/widgets';
import { CHAVE_DO_RETRATO } from '@/widgets/chave';
import { propsDoWidget, type PropsDoWidget } from '@/widgets/props';

/** O último retrato publicado. Retrato de versão desconhecida vira "entre no app". */
export async function lerRetrato(): Promise<PropsDoWidget> {
  try {
    const cru = await AsyncStorage.getItem(CHAVE_DO_RETRATO);
    const r = cru ? JSON.parse(cru) : null;
    if (r?.versao === 1) return r as PropsDoWidget;
  } catch {
    // retrato ilegível desenha o estado neutro — nunca dinheiro velho de formato errado
  }
  return propsDoWidget(retratoSemSessao('—'));
}

/**
 * O retrato FRESCO, buscado com a sessão guardada — o que faz o widget andar com o app fechado
 * (o lançamento que chegou pelo WhatsApp aparece no próximo ciclo de 30 min, sem abrir o app).
 * As mesmas três leituras da Hoje. `null` = não deu (sem rede, erro): desenha o último retrato.
 */
async function retratoDoServidor(): Promise<Retrato | null> {
  const { supabase } = await import('@/lib/supabase');
  const { data } = await supabase.auth.getSession();
  if (!data.session) return retratoSemSessao(timeBR(new Date()));
  const [gasto, ciclo, contas, oculto] = await Promise.all([
    supabase.rpc('spendable', {}),
    supabase.rpc('cycle_now', {}),
    supabase.rpc('upcoming_bills', { days: 30 }),
    AsyncStorage.getItem(CONCEAL_KEY),
  ]);
  const linha = (gasto.data as unknown[] | null)?.[0];
  if (gasto.error || contas.error || !linha) return null;
  return montarRetrato({
    spendable: linha as Parameters<typeof montarRetrato>[0]['spendable'],
    cicloAte: (ciclo.data as { ate?: string } | null)?.ate ?? null,
    contas: (contas.data ?? []) as Parameters<typeof montarRetrato>[0]['contas'],
    hoje: localISODate(),
    agora: timeBR(new Date()),
    oculto: oculto === '1',
  });
}

async function comPrazo<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((ok) => setTimeout(() => ok(null), ms))]);
}

/**
 * O sistema chama isto com o app FECHADO (adicionar, redimensionar, a cada 30 min). Tenta o
 * retrato fresco (8 s no máximo — o Android mata tarefa de widget lenta) e cai no último guardado.
 */
export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }: WidgetTaskHandlerProps) {
  if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return;
  let p: PropsDoWidget | null = null;
  try {
    const fresco = await comPrazo(retratoDoServidor(), 8000);
    if (fresco) {
      p = propsDoWidget(fresco);
      await AsyncStorage.setItem(CHAVE_DO_RETRATO, JSON.stringify(p));
    }
  } catch {
    // sem rede, sessão vencida: o último retrato continua valendo
  }
  p ??= await lerRetrato();
  if (widgetInfo.widgetName === 'Vence') renderWidget(<VenceWidget p={p} altura={widgetInfo.height} />);
  else renderWidget(<LivreWidget p={p} largura={widgetInfo.width} />);
}
