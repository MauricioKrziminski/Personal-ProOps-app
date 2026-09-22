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
      // Só NOME de conta pode ficar pela metade (a lista inteira está a um toque); valor não —
      // o número grande passa por `tamanhoQueCabe`.
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
        flexGap: 16,
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
        <FlexWidget style={{ flex: 1, height: 'match_parent', flexDirection: 'column', justifyContent: 'center', flexGap: 10 }}>
          {p.contas.slice(0, 3).map((c, i) => (
            <FlexWidget key={i} style={{ width: 'match_parent', flexDirection: 'column' }}>
              <Texto texto={c.titulo} tamanho={13} cor={p.cor.texto} />
              {/* O VALOR não divide texto com o "quando": juntos, o fim truncava no valor. */}
              <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between' }}>
                <FlexWidget style={{ flex: 1 }}>
                  <Texto texto={c.quando} tamanho={11} cor={c.atrasada ? p.cor.perigo : p.cor.apagado} />
                </FlexWidget>
                <Texto texto={c.valor} tamanho={11} forte cor={c.atrasada ? p.cor.perigo : p.cor.texto} />
              </FlexWidget>
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

/** "O que vence": as próximas contas, atrasadas primeiro. Cabe o que a altura deixar. */
export function VenceWidget({ p, altura }: { p: PropsDoWidget; altura: number }) {
  // Cabeçalho (~40dp) + a linha do "+N" (~20dp) ficam reservados: sem isso o rodapé sumia
  // embaixo da última conta (medido no emulador, 4×2).
  const total = p.contas.length + p.maisContas;
  const cabem = Math.floor((altura - 40 - 32) / 44);
  const quantas = Math.max(1, Math.min(p.contas.length, total > cabem ? cabem - 1 : cabem));
  const contas = p.contas.slice(0, quantas);
  const resto = total - contas.length;
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
