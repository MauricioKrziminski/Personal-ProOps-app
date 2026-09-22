import { FlexWidget, TextWidget } from 'react-native-android-widget';

import type { PropsDoWidget } from '@/widgets/props';

/**
 * Os dois widgets do Android — mesmo retrato e mesma paleta do iOS (`widgets/props.ts`).
 *
 * `react-native-android-widget` desenha JSX em RemoteViews: só Flex e Text, estilo por prop, sem
 * sombra nem blur. O desenho é o do herói da Hoje: bloco de tinta com canto generoso, Plus Jakarta
 * Sans (embutida pelo plugin), número grande em 500, vermelho só para o que está atrasado.
 */

const SANS = 'PlusJakartaSans_500Medium';
const SANS_FORTE = 'PlusJakartaSans_600SemiBold';
const RAIO = 24;

function Texto(p: { texto: string; tamanho: number; cor: `#${string}`; forte?: boolean; linhas?: number }) {
  return (
    <TextWidget
      text={p.texto}
      maxLines={p.linhas ?? 1}
      truncate="END"
      style={{ fontSize: p.tamanho, color: p.cor, fontFamily: p.forte ? SANS_FORTE : SANS }}
    />
  );
}

/** "Livre": pequeno = o número e a frase do dia; largo (≥ 250dp) = + as próximas contas. */
export function LivreWidget({ p, largura }: { p: PropsDoWidget; largura: number }) {
  const semSessao = p.estado !== 'ok';
  const largo = largura >= 250 && !semSessao && p.contas.length > 0;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'appproops:///' }}
      accessibilityLabel={semSessao ? 'ProOps. Entre no app.' : `${p.rotulo}: ${p.livre}. ${p.veredito.texto}`}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: p.cor.fundo,
        borderRadius: RAIO,
        padding: 16,
        flexDirection: 'row',
        flexGap: 16,
      }}>
      <FlexWidget style={{ flex: 1, height: 'match_parent', flexDirection: 'column', justifyContent: 'space-between' }}>
        <Texto texto={p.rotulo} tamanho={13} cor={p.cor.apagado} />
        <FlexWidget style={{ flexDirection: 'column', flexGap: 2 }}>
          <Texto texto={semSessao ? 'ProOps' : p.livre} tamanho={28} forte cor={p.livreNegativo ? p.cor.perigo : p.cor.texto} />
          <Texto texto={p.veredito.texto} tamanho={12} linhas={2} cor={p.veredito.tom === 'perigo' ? p.cor.perigo : p.cor.apagado} />
        </FlexWidget>
        <Texto texto={semSessao ? '' : `atualizado às ${p.atualizado}`} tamanho={11} cor={p.cor.apagado} />
      </FlexWidget>
      {largo ? (
        <FlexWidget style={{ flex: 1, height: 'match_parent', flexDirection: 'column', justifyContent: 'center', flexGap: 10 }}>
          {p.contas.slice(0, 3).map((c, i) => (
            <FlexWidget key={i} style={{ flexDirection: 'column' }}>
              <Texto texto={c.titulo} tamanho={13} cor={p.cor.texto} />
              <Texto texto={`${c.quando} · ${c.valor}`} tamanho={11} cor={c.atrasada ? p.cor.perigo : p.cor.apagado} />
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

/** "O que vence": as próximas contas, atrasadas primeiro. Cabe o que a altura deixar. */
export function VenceWidget({ p, altura }: { p: PropsDoWidget; altura: number }) {
  const quantas = Math.max(2, Math.min(6, Math.floor((altura - 60) / 44)));
  const contas = p.contas.slice(0, quantas);
  const resto = p.contas.length - contas.length + p.maisContas;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'appproops:///finance/cycle' }}
      accessibilityLabel={`O que vence: ${p.totalContas}`}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: p.cor.fundo,
        borderRadius: RAIO,
        padding: 16,
        flexDirection: 'column',
        flexGap: 10,
      }}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between' }}>
        <Texto texto="O que vence" tamanho={13} forte cor={p.cor.texto} />
        <Texto texto={p.totalContas} tamanho={13} cor={p.cor.apagado} />
      </FlexWidget>
      {p.estado !== 'ok' ? (
        <Texto texto={p.veredito.texto} tamanho={13} cor={p.cor.apagado} />
      ) : contas.length === 0 ? (
        <Texto texto="Nada vencendo nos próximos 30 dias." tamanho={13} cor={p.cor.apagado} linhas={2} />
      ) : (
        contas.map((c, i) => (
          <FlexWidget key={i} style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
              <Texto texto={c.titulo} tamanho={14} cor={p.cor.texto} />
              <Texto texto={c.quando} tamanho={11} cor={c.atrasada ? p.cor.perigo : p.cor.apagado} />
            </FlexWidget>
            <Texto texto={c.valor} tamanho={14} forte cor={c.atrasada ? p.cor.perigo : p.cor.texto} />
          </FlexWidget>
        ))
      )}
      {resto > 0 ? <Texto texto={`+${resto} no ciclo`} tamanho={11} cor={p.cor.apagado} /> : null}
    </FlexWidget>
  );
}
