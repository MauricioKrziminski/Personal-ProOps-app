/**
 * Parsers de extrato bancário — TS puro, sem nada de Deno.
 * Separado da Edge Function de propósito: assim `node --test` consegue importar
 * e testar as regras de formato (é a lógica de maior risco da importação).
 */

export interface ParsedLine {
  kind: "expense" | "income";
  amount_cents: number;
  occurred_at: string; // YYYY-MM-DD
  description: string;
}

/** "1.234,56" | "1234.56" | "-45,90" -> centavos inteiros (sempre positivo). */
export function toCents(raw: string): number | null {
  const limpo = raw.replace(/[^\d,.-]/g, "").trim();
  if (!limpo) return null;
  // formato BR (1.234,56) vs US (1,234.56): manda quem vem por último
  const ultimaVirgula = limpo.lastIndexOf(",");
  const ultimoPonto = limpo.lastIndexOf(".");
  let normalizado = limpo;
  if (ultimaVirgula > ultimoPonto) {
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else {
    normalizado = limpo.replace(/,/g, "");
  }
  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) return null;
  return Math.round(Math.abs(valor) * 100);
}

function isNegative(raw: string): boolean {
  return raw.trim().startsWith("-");
}

/** OFX: DTPOSTED é YYYYMMDD (com hora opcional colada). */
export function ofxDate(raw: string): string | null {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** dd/mm/aaaa, aaaa-mm-dd ou dd-mm-aaaa -> ISO. */
export function anyDate(raw: string): string | null {
  const t = raw.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/**
 * OFX é XML-ish com tags não fechadas — regex por bloco <STMTTRN> é o caminho
 * pragmático (o mesmo que os apps de finanças usam). Sem dependência externa.
 */
export function parseOFX(conteudo: string): ParsedLine[] {
  const linhas: ParsedLine[] = [];
  const blocos = conteudo.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi) ?? [];
  for (const bloco of blocos) {
    const tag = (nome: string) => {
      const m = bloco.match(new RegExp(`<${nome}>([^<\r\n]*)`, "i"));
      return m?.[1]?.trim() ?? "";
    };
    const valorRaw = tag("TRNAMT");
    const cents = toCents(valorRaw);
    const data = ofxDate(tag("DTPOSTED"));
    if (!cents || !data) continue;
    const tipo = tag("TRNTYPE").toUpperCase();
    const negativo = isNegative(valorRaw) || tipo === "DEBIT";
    linhas.push({
      kind: negativo ? "expense" : "income",
      amount_cents: cents,
      occurred_at: data,
      description: tag("MEMO") || tag("NAME") || "Lançamento importado",
    });
  }
  return linhas;
}

/** Divide uma linha de CSV respeitando aspas. */
function splitCsvLine(linha: string, sep: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let dentroDeAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroDeAspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else {
        dentroDeAspas = !dentroDeAspas;
      }
    } else if (c === sep && !dentroDeAspas) {
      campos.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

/**
 * CSV de banco brasileiro não tem padrão: descobre as colunas pelo cabeçalho
 * (data / descrição / valor) e cai para posicional (0,1,2) se não achar.
 */
export function parseCSV(conteudo: string): ParsedLine[] {
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return [];

  const sep = (linhas[0].match(/;/g)?.length ?? 0) > (linhas[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const cabecalho = splitCsvLine(linhas[0], sep).map((c) => c.toLowerCase());
  const acha = (...nomes: string[]) =>
    cabecalho.findIndex((c) => nomes.some((n) => c.includes(n)));

  let iData = acha("data", "date");
  let iDescr = acha("descri", "histórico", "historico", "memo", "lançamento", "lancamento", "estabelecimento");
  let iValor = acha("valor", "amount", "montante");
  const temCabecalho = iData >= 0 && iValor >= 0;
  if (!temCabecalho) {
    iData = 0;
    iDescr = 1;
    iValor = 2;
  }

  const resultado: ParsedLine[] = [];
  for (const linha of linhas.slice(temCabecalho ? 1 : 0)) {
    const campos = splitCsvLine(linha, sep);
    const data = anyDate(campos[iData] ?? "");
    const valorRaw = campos[iValor] ?? "";
    const cents = toCents(valorRaw);
    if (!data || !cents) continue;
    resultado.push({
      kind: isNegative(valorRaw) ? "expense" : "income",
      amount_cents: cents,
      occurred_at: data,
      description: (campos[iDescr] ?? "").trim() || "Lançamento importado",
    });
  }
  return resultado;
}

