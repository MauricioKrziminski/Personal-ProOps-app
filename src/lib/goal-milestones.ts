/**
 * F19 — marcos de uma meta. Tudo aqui é puro: a ETAPA é derivada do guardado (o ledger) e nunca
 * gravada, e "celebrar uma vez" é uma função da memória do aparelho (maior marco já celebrado).
 *
 * Marco é valor em centavos; o percentual digitado vira centavos AO SALVAR. 100% é o próprio
 * alvo, nunca marco.
 */

/** `33,3` / `33.3` / `25` → número em (0, 100) com uma casa; null se não for um percentual válido. */
export function lerPercentual(texto: string): number | null {
  const limpo = texto.trim().replace('%', '').replace(',', '.');
  if (!/^\d{1,2}(\.\d)?$/.test(limpo)) return null;
  const n = Number(limpo);
  return n > 0 && n < 100 ? n : null;
}

/** Percentual do alvo em centavos, arredondado ao centavo (meio para cima). */
export function percentualParaCentavos(pct: number, targetCents: number): number {
  if (!(targetCents > 0) || !(pct > 0)) return 0;
  const decimos = BigInt(Math.round(pct * 10));
  return Number((BigInt(targetCents) * decimos + 500n) / 1000n);
}

/** O inverso, para mostrar: uma casa decimal (33,3), sem zero sobrando (25). */
export function centavosParaPercentual(cents: number, targetCents: number): number {
  if (!(targetCents > 0)) return 0;
  return Math.round((cents / targetCents) * 1000) / 10;
}

/** Marcos que a tela mostra (abaixo do alvo, crescentes) e os que ficaram guardados acima dele. */
export function separarMarcos(marcos: readonly number[], targetCents: number) {
  const ordenados = [...new Set(marcos)].filter((m) => m > 0).sort((a, b) => a - b);
  return {
    visiveis: ordenados.filter((m) => m < targetCents),
    acima: ordenados.filter((m) => m >= targetCents),
  };
}

export interface EtapaDaMeta {
  /** Marcos já alcançados (`amount ≤ guardado`), crescentes. */
  atingidos: number[];
  /** O maior atingido, 0 se nenhum. */
  maiorAtingido: number;
  /** O próximo marco abaixo do alvo, ou null (sem marcos, ou todos passados). */
  proximo: number | null;
  /** Falta para o próximo marco (0 sem próximo). */
  faltaProximo: number;
  /** Falta para o alvo. */
  faltaAlvo: number;
  concluida: boolean;
}

export function etapaDaMeta(savedCents: number, targetCents: number, marcos: readonly number[]): EtapaDaMeta {
  const { visiveis } = separarMarcos(marcos, targetCents);
  const atingidos = visiveis.filter((m) => m <= savedCents);
  const proximo = visiveis.find((m) => m > savedCents) ?? null;
  return {
    atingidos,
    maiorAtingido: atingidos.at(-1) ?? 0,
    proximo,
    faltaProximo: proximo === null ? 0 : proximo - savedCents,
    faltaAlvo: Math.max(0, targetCents - savedCents),
    concluida: targetCents > 0 && savedCents >= targetCents,
  };
}

export interface Celebracao {
  /** O marco celebrado (o maior atravessado), ou null. */
  marco: number | null;
  /** A memória nova (maior marco já celebrado). */
  gravado: number;
}

/**
 * Decide a celebração de um aporte/alocação CONFIRMADO. Só celebra se houve travessia real
 * (o maior marco atingido subiu) E o maior de agora passa o que já foi celebrado; vários marcos
 * de uma vez são UMA celebração, do maior. Descer abaixo de um marco baixa a memória, e subir de
 * novo é outra travessia, que celebra de novo. Quem NÃO é uma ação confirmada (abrir a tela,
 * puxar para atualizar, Realtime) não chama isto — e `ajustarMemoria` só sabe baixar.
 */
export function celebracao(
  antesCents: number,
  depoisCents: number,
  targetCents: number,
  marcos: readonly number[],
  gravado: number,
): Celebracao {
  const antes = etapaDaMeta(antesCents, targetCents, marcos).maiorAtingido;
  const agora = etapaDaMeta(depoisCents, targetCents, marcos).maiorAtingido;
  if (agora > antes && agora > gravado) return { marco: agora, gravado: agora };
  return { marco: null, gravado: Math.min(gravado, agora) };
}

/** A memória só desce sozinha: o que já passou de volta de um marco deixa de estar "celebrado". */
export function ajustarMemoria(gravado: number, maiorAtingido: number): number {
  return Math.min(gravado, maiorAtingido);
}

/** O que impede de salvar a lista de marcos do formulário (centavos, já calculados), ou null. */
export function recusaDosMarcos(marcosNovos: readonly number[], todos: readonly number[], targetCents: number): string | null {
  if (new Set(todos).size !== todos.length) return 'Tem marco repetido.';
  if (marcosNovos.some((m) => m >= targetCents)) return 'O marco precisa ficar abaixo do alvo.';
  return null;
}

/** Uma linha do formulário: o valor em centavos e, se foi digitada em %, o texto (recalcula com o alvo). */
export interface LinhaDeMarco {
  key: string;
  cents: number;
  pct: string | null;
}

/** O que o formulário grava: percentual vira centavos AGORA, com o alvo final; linha vazia sai. */
export function centavosDaLinha(l: LinhaDeMarco, targetCents: number): number {
  if (l.pct === null) return l.cents;
  const p = lerPercentual(l.pct);
  return p === null ? 0 : percentualParaCentavos(p, targetCents);
}

/** Sugestão ao criar a meta: 25%, 50% e 75% (a pessoa apaga ou muda). */
export function sugestaoDeMarcos(): LinhaDeMarco[] {
  return ['25', '50', '75'].map((pct) => ({ key: `s${pct}`, cents: 0, pct }));
}

export function linhasDosMarcos(marcos: readonly number[]): LinhaDeMarco[] {
  return [...marcos].sort((a, b) => a - b).map((cents) => ({ key: `m${cents}`, cents, pct: null }));
}

/** A diferença entre os marcos gravados e os do formulário: o que apagar e o que inserir. */
export function diferencaDosMarcos(gravados: readonly number[], desejados: readonly number[]) {
  const quer = new Set(desejados);
  const tem = new Set(gravados);
  return {
    apagar: gravados.filter((m) => !quer.has(m)),
    inserir: [...quer].filter((m) => !tem.has(m)),
  };
}

/** A linha do card: "Próximo marco: R$ X · faltam R$ Y", ou quanto falta para o alvo; sem marcos, nada. */
export function textoDoProximoMarco(
  saved: number,
  target: number,
  marcos: number[] | undefined,
  brl: (cents: number) => string,
): string | null {
  if (!marcos || separarMarcos(marcos, target).visiveis.length === 0) return null;
  const e = etapaDaMeta(saved, target, marcos);
  if (e.concluida) return null;
  return e.proximo === null
    ? `Faltam ${brl(e.faltaAlvo)} para o alvo`
    : `Próximo marco: ${brl(e.proximo)} · faltam ${brl(e.faltaProximo)}`;
}
