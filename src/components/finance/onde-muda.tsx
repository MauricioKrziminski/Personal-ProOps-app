import { View, StyleSheet } from 'react-native';

import { useBRL } from '@/components/ui/conceal';
import { Row, Section } from '@/components/ui/row';
import { Space } from '@/design/tokens';
import { isoToBR } from '@/lib/dates';
import type { MudancaNaConta, MudancaNoCartao } from '@/lib/onde-muda';

const ddmm = (iso: string) => isoToBR(iso).slice(0, 5);

/**
 * "Onde muda" (spec 2026-09-29, §4): uma linha por conta ou cartão em que as hipóteses mudam
 * alguma coisa — o antes → depois que importa e o aviso, quando há. Tocar abre o detalhe.
 * Nada muda, o bloco não aparece.
 */
export function OndeMuda({
  mudancas,
  onAbrir,
}: {
  mudancas: (MudancaNaConta | MudancaNoCartao)[];
  onAbrir: (accountId: string) => void;
}) {
  const brl = useBRL();
  if (mudancas.length === 0) return null;

  const linha = (m: MudancaNaConta | MudancaNoCartao) => {
    if (m.tipo === 'conta') {
      const partes = [`No fim: ${brl(m.antes?.saldo_fim ?? 0)} → ${brl(m.depois.saldo_fim)}`];
      if (m.ficaNegativaEm) partes.push(`Fica negativa em ${ddmm(m.ficaNegativaEm)}`);
      return { subtitle: partes.join(' · '), alerta: m.ficaNegativaEm !== null };
    }
    const partes: string[] = [];
    const primeira = m.faturas[0];
    if (primeira) partes.push(`Fatura de ${ddmm(primeira.vencimento)}: ${brl(primeira.antes)} → ${brl(primeira.depois)}`);
    if (m.semLimite) partes.push('Sem limite cadastrado');
    else if (m.passaDoLimiteEm !== null) partes.push(`Passa do limite em ${brl(m.passaDoLimiteEm)}`);
    else if (m.livreAntes !== m.livreDepois && m.livreDepois !== null) partes.push(`Limite livre: ${brl(m.livreAntes ?? 0)} → ${brl(m.livreDepois)}`);
    return { subtitle: partes.join(' · '), alerta: m.passaDoLimiteEm !== null };
  };

  return (
    <View style={styles.bloco}>
      <Section title="Onde muda">
        {mudancas.map((m) => {
          const { subtitle, alerta } = linha(m);
          return (
            <Row
              key={`${m.tipo}:${m.account_id}`}
              icon={m.tipo === 'cartao' ? 'creditcard' : 'building.columns'}
              title={m.nome}
              subtitle={subtitle}
              destructive={alerta}
              onPress={() => onAbrir(m.account_id)}
              accessibilityLabel={`${m.nome}. ${subtitle}. Abrir o detalhe.`}
            />
          );
        })}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  bloco: { gap: Space.md },
});
