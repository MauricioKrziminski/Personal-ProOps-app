'use no memo';
// O React Compiler NÃO pode tocar aqui: widget é função crua renderizada fora da árvore do
// app (Android: RemoteViews; iOS: runtime isolado). Compilado, o componente vira hook e quebra
// com "Invalid Hook Call" — medido no emulador em 22/09/2026.

import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget';

import type { PropsDoWidget } from '@/widgets/props';

/**
 * Os dois widgets do Android — mesmo retrato e mesma paleta do iOS (`widgets/props.ts`).
 *
 * `react-native-android-widget` desenha JSX em RemoteViews: só Flex e Text, estilo por prop, sem
 * sombra nem blur. O desenho é o do herói da Hoje: bloco de tinta com canto generoso, Plus Jakarta
 * Sans (embutida pelo plugin), número grande em 500, vermelho só para o que está atrasado.
 */

/**
 * O tamanho do número que CABE na largura, em vez de reticências: identificador nunca trunca
 * (`design.md` §7). Medido no emulador (22/09/2026): a 2×2 o "R$ 28.859,36" em 28sp virava
 * "R$ 28.859…". Plus Jakarta em 600 tem ~0,62 em de largura média por dígito.
 */
export function tamanhoQueCabe(texto: string, largura: number, teto = 30): number {
  return Math.max(14, Math.min(teto, Math.floor(largura / (Math.max(texto.length, 1) * 0.62))));
}

const SANS = 'PlusJakartaSans_500Medium';
const SANS_FORTE = 'PlusJakartaSans_600SemiBold';
const RAIO = 24;

function Texto(p: { texto: string; tamanho: number; cor: `#${string}`; forte?: boolean; linhas?: number }) {
  return (
    <TextWidget
      text={p.texto}
      maxLines={p.linhas ?? 1}
      // Nome de conta quebra em até 2 linhas antes de cortar; valor nunca corta — o número grande
      // passa por `tamanhoQueCabe`.
      truncate="END"
      style={{ fontSize: p.tamanho, color: p.cor, fontFamily: p.forte ? SANS_FORTE : SANS }}
    />
  );
}

/** O selo de data de uma conta: o dia grande, o mês embaixo. Hoje inverte. */
function Selo({ p, dia, mes, hoje }: { p: PropsDoWidget; dia: string; mes: string; hoje: boolean }) {
  return (
    <FlexWidget
      style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: hoje ? p.cor.texto : p.cor.faixa,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Texto texto={dia} tamanho={13} forte cor={hoje ? p.cor.fundo : p.cor.texto} />
      <Texto texto={mes} tamanho={9} cor={hoje ? p.cor.fundo : p.cor.apagado} />
    </FlexWidget>
  );
}

/** "Livre": pequeno = o número e a frase do dia; largo (≥ 250dp) = + compromissos e a próxima conta. */
export function LivreWidget({ p, largura }: { p: PropsDoWidget; largura: number }) {
  const semSessao = p.estado !== 'ok';
  const proxima = p.proximas[0];
  const largo = largura >= 250 && !semSessao && Boolean(p.compromissos || proxima);
  return (
    <FlexWidget
      // `OPEN_APP`, não `OPEN_URI`: o scheme `appproops` é o MESMO nas três variantes, e com mais
      // de uma instalada o Android abria o seletor de app (medido no emulador, 22/09/2026). O
      // widget pertence a um pacote e abre esse pacote — na Hoje, que é onde os dois números moram.
      clickAction="OPEN_APP"
      accessibilityLabel={semSessao ? 'ProOps. Entre no app.' : `${p.rotulo}: ${p.livre}. ${p.veredito.texto}`}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: p.cor.fundo,
        borderRadius: RAIO,
        padding: 16,
        flexDirection: 'row',
        flexGap: 14,
      }}>
      <FlexWidget style={{ flex: 1, height: 'match_parent', flexDirection: 'column', justifyContent: 'space-between' }}>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Texto texto={p.rotulo} tamanho={13} cor={p.cor.apagado} />
          <ImageWidget image={require('@/assets/images/brand/mark-white.png')} imageWidth={16} imageHeight={16} />
        </FlexWidget>
        <FlexWidget style={{ flexDirection: 'column', flexGap: 2 }}>
          <Texto
            texto={semSessao ? 'ProOps' : p.livre}
            tamanho={tamanhoQueCabe(semSessao ? 'ProOps' : p.livre, (largo ? largura / 2 : largura) - 40)}
            forte
            cor={p.livreNegativo ? p.cor.perigo : p.cor.texto}
          />
          <Texto texto={p.veredito.texto} tamanho={12} linhas={2} cor={p.veredito.tom === 'perigo' ? p.cor.perigo : p.cor.apagado} />
        </FlexWidget>
        <Texto texto={semSessao ? '' : `atualizado às ${p.atualizado}`} tamanho={11} cor={p.cor.apagado} />
      </FlexWidget>
      {largo ? (
        <FlexWidget style={{ width: 1, height: 'match_parent', backgroundColor: p.cor.faixa }} />
      ) : null}
      {largo ? (
        // Dois números, não uma lista (a lista é o "O que vence"): o que pesa até o fim do ciclo
        // e a próxima conta.
        <FlexWidget style={{ flex: 1, height: 'match_parent', flexDirection: 'column', justifyContent: 'center', flexGap: 14 }}>
          {p.compromissos ? (
            <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', flexGap: 1 }}>
              <Texto texto={`Compromissos ${p.compromissos.ate}`} tamanho={11} cor={p.cor.apagado} />
              <Texto texto={p.compromissos.valor} tamanho={17} forte cor={p.cor.texto} />
            </FlexWidget>
          ) : null}
          {proxima ? (
            <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 10 }}>
              <Selo p={p} dia={proxima.dia} mes={proxima.mes} hoje={proxima.hoje} />
              <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
                <Texto texto={proxima.titulo} tamanho={13} linhas={2} cor={p.cor.texto} />
                <Texto texto={proxima.valor} tamanho={12} forte cor={proxima.hoje ? p.cor.perigo : p.cor.apagado} />
              </FlexWidget>
            </FlexWidget>
          ) : null}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

/**
 * "O que vence": o total, o atrasado como UMA faixa e as próximas com o selo de data — o mesmo
 * desenho do iOS (`widgets/ios/vence.tsx`). Cabe o que a altura deixar.
 */
export function VenceWidget({ p, altura }: { p: PropsDoWidget; altura: number }) {
  // Cabeçalho (~24dp), a faixa do atrasado (~30dp) e o "+N" (~20dp) ficam reservados; cada conta
  // é um selo de 34dp + 8 de respiro.
  const reservado = 32 + 24 + (p.atrasado ? 38 : 0) + 22;
  const cabem = Math.max(1, Math.floor((altura - reservado) / 42));
  const lista = p.proximas.slice(0, cabem);
  const resto = p.proximas.length + p.maisProximas - lista.length;
  return (
    <FlexWidget
      clickAction="OPEN_APP"
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
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Texto texto="O que vence" tamanho={13} cor={p.cor.apagado} />
        <Texto texto={p.totalContas} tamanho={15} forte cor={p.cor.texto} />
      </FlexWidget>
      {p.estado !== 'ok' ? (
        <Texto texto={p.veredito.texto} tamanho={13} cor={p.cor.apagado} />
      ) : (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', flexGap: 8 }}>
          {p.atrasado ? (
            <FlexWidget
              style={{
                width: 'match_parent',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: p.cor.faixa,
                borderRadius: 15,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}>
              <Texto texto={`${p.atrasado.qtd} ${p.atrasado.qtd === 1 ? 'atrasada' : 'atrasadas'}`} tamanho={12} forte cor={p.cor.perigo} />
              <Texto texto={p.atrasado.valor} tamanho={12} forte cor={p.cor.perigo} />
            </FlexWidget>
          ) : null}
          {lista.length === 0 ? (
            <Texto texto="Nada mais vence nos próximos 30 dias." tamanho={13} cor={p.cor.apagado} linhas={2} />
          ) : (
            lista.map((c, i) => (
              <FlexWidget key={i} style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 10 }}>
                <Selo p={p} dia={c.dia} mes={c.mes} hoje={c.hoje} />
                <FlexWidget style={{ flex: 1 }}>
                  <Texto texto={c.titulo} tamanho={14} linhas={2} cor={p.cor.texto} />
                </FlexWidget>
                <Texto texto={c.valor} tamanho={14} forte cor={p.cor.texto} />
              </FlexWidget>
            ))
          )}
        </FlexWidget>
      )}
      {resto > 0 && p.estado === 'ok' ? <Texto texto={`+${resto} a vencer`} tamanho={11} cor={p.cor.apagado} /> : null}
    </FlexWidget>
  );
}
