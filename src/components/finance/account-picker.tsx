import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Icon } from '@/components/ui/icon';
import { ThemedText } from '@/components/themed-text';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { Elevation, Radius, Space, Type } from '@/design/tokens';
import { accountTypeLabel } from '@/lib/accounts';
import type { IconName } from '@/components/ui/icon';

/** O mínimo que o seletor precisa saber. Aceita `Account` inteiro sem conversão. */
export type PickableAccount = {
  id: string;
  name: string;
  type?: string | null;
  closing_day?: number | null;
};

/** Cada tipo tem a sua forma — é o que separa cartão de conta antes de qualquer texto. */
const GLIFO: Record<string, IconName> = {
  checking: 'building.columns',
  savings: 'banknote',
  credit_card: 'creditcard',
  cash: 'wallet.bifold',
  investment: 'chart.line.uptrend.xyaxis',
};

/** A segunda linha: o tipo, e no cartão o dia que muda a decisão de onde lançar. */
function detalhe(conta: PickableAccount): string {
  const tipo = accountTypeLabel(conta);
  if (conta.type === 'credit_card' && conta.closing_day) {
    return `${tipo} · fecha dia ${conta.closing_day}`;
  }
  return tipo;
}

/**
 * Escolher a conta de um lançamento.
 *
 * ## Por que ele existe
 *
 * Eram QUATRO cópias de `<Row title={a.name} trailing={check}/>` — uma lista de
 * texto onde cartão e conta corrente têm exatamente a mesma cara. Foi assim que
 * um salário de R$ 4.000 foi parar dentro da fatura do cartão em 09/09/2026: a
 * pessoa procurou a conta do Nubank e tocou no cartão do Nubank.
 *
 * ## Como ele separa cartão de conta
 *
 * Por três caminhos ao mesmo tempo, porque o custo de errar aqui é um número
 * errado meses depois, sem erro nenhum na tela:
 *
 * 1. **Agrupamento** — "Contas" e "Cartões" são seções distintas. É o sinal mais
 *    forte e o mais barato de ler. Só aparece quando existem os dois grupos:
 *    com uma conta e nenhum cartão, o cabeçalho seria cerimônia.
 * 2. **Forma** — cada tipo tem o próprio glifo num ladrilho, então a coluna da
 *    esquerda é escaneável sem ler palavra nenhuma.
 * 3. **Palavra** — o tipo escrito embaixo do nome, e no cartão o dia de
 *    fechamento, que é o dado que decide em qual fatura a compra cai.
 *
 * ⚠️ **Sem cor de emissor.** A regra do projeto libera a cor da marca só DENTRO
 * da forma de um cartão de crédito (`card-brands.ts`); numa linha de lista ela
 * volta a ser cor de terceiro competindo com o único accent do app. A separação
 * aqui é forma e estrutura, não tinta.
 */
export function AccountPicker({
  accounts,
  value,
  onChange,
  emptyLabel,
}: {
  accounts: readonly PickableAccount[];
  value: string | null;
  onChange: (id: string | null) => void;
  /**
   * Rótulo da opção "sem conta". Omitido, a opção não existe — é o caso da
   * transferência, que precisa dos dois lados para significar alguma coisa.
   */
  emptyLabel?: string;
}) {
  const theme = useTheme();
  const scheme = useScheme();

  const [contas, cartoes] = useMemo(
    () => [
      accounts.filter((a) => a.type !== 'credit_card'),
      accounts.filter((a) => a.type === 'credit_card'),
    ],
    [accounts]
  );
  // Cabeçalho só vale quando há o que separar.
  const agrupado = contas.length > 0 && cartoes.length > 0;

  function escolher(id: string | null) {
    if (id !== value) Haptics.selectionAsync();
    onChange(id);
  }

  const opcao = (
    key: string,
    id: string | null,
    nome: string,
    meta: string,
    glifo: IconName,
    /** A opção "sem conta" não é uma conta: o glifo dela não vira accent. */
    neutra = false
  ) => {
    const escolhida = value === id;
    const ladrilhoAceso = escolhida && !neutra;
    return (
      <Pressable
        key={key}
        onPress={() => escolher(id)}
        accessibilityRole="radio"
        accessibilityState={{ selected: escolhida }}
        accessibilityLabel={meta ? `${nome}, ${meta}` : nome}>
        {({ pressed }) => (
          <View
            style={[
              styles.opcao,
              {
                backgroundColor: escolhida
                  ? theme.accentSoft
                  : pressed
                    ? theme.backgroundSelected
                    : 'transparent',
              },
            ]}>
            {/* O contorno não é enfeite: no escuro `backgroundElement` (#201F21) e
                `surface` (#1B1B1D) distam 5 pontos, e sem o fio o ladrilho não
                tem onde terminar. É a mesma razão pela qual todo card do app
                leva 1px em `cardBorder`. */}
            <View
              style={[
                styles.ladrilho,
                {
                  backgroundColor: ladrilhoAceso ? theme.tint : theme.backgroundElement,
                  borderColor: ladrilhoAceso ? 'transparent' : theme.cardBorder,
                },
              ]}>
              <Icon
                name={glifo}
                size="sm"
                color={ladrilhoAceso ? 'onTint' : 'textSecondary'}
              />
            </View>

            <View style={styles.textos}>
              <ThemedText>{nome}</ThemedText>
              {meta ? (
                <ThemedText type="caption" themeColor="textSecondary">
                  {meta}
                </ThemedText>
              ) : null}
            </View>

            {/* Só a escolhida desenha algo. Um círculo vazio em cada linha é
                ruído: a ausência já diz "não é esta". */}
            {escolhida ? (
              <View style={[styles.marca, { backgroundColor: theme.tint }]}>
                <Icon name="checkmark" size="xs" color="onTint" />
              </View>
            ) : null}
          </View>
        )}
      </Pressable>
    );
  };

  const divisor = (key: string) => (
    <View key={key} style={[styles.divisor, { backgroundColor: theme.separator }]} />
  );

  const cabecalho = (key: string, texto: string) => (
    <View key={key} style={styles.cabecalho}>
      <ThemedText type="caption" themeColor="textSecondary" style={styles.etiqueta}>
        {texto}
      </ThemedText>
    </View>
  );

  const filhos: React.ReactNode[] = [];
  if (emptyLabel) {
    filhos.push(opcao('vazio', null, emptyLabel, '', 'minus', true));
  }
  if (agrupado) filhos.push(cabecalho('h-contas', 'CONTAS'));
  contas.forEach((a, i) => {
    if (filhos.length && !(agrupado && i === 0)) filhos.push(divisor(`d-c-${a.id}`));
    filhos.push(opcao(a.id, a.id, a.name, detalhe(a), GLIFO[a.type ?? ''] ?? 'building.columns'));
  });
  if (agrupado) filhos.push(cabecalho('h-cartoes', 'CARTÕES'));
  cartoes.forEach((a, i) => {
    if (filhos.length && !(agrupado && i === 0)) filhos.push(divisor(`d-k-${a.id}`));
    filhos.push(opcao(a.id, a.id, a.name, detalhe(a), 'creditcard'));
  });

  return (
    <View
      style={[
        styles.grupo,
        {
          backgroundColor: theme.surface,
          borderColor: theme.cardBorder,
          boxShadow: Elevation[scheme].raised,
        },
      ]}
      accessibilityRole="radiogroup">
      {filhos}
    </View>
  );
}

const styles = StyleSheet.create({
  grupo: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  opcao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    minHeight: 56, // alvo de toque confortável mesmo com uma linha só
  },
  /** Caixa de GEOMETRIA: o ícone não cresce com a fonte, o texto ao lado sim. */
  ladrilho: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textos: {
    flex: 1,
    gap: Space.half,
  },
  marca: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Começa depois do ladrilho: o filete alinhado ao texto agrupa em vez de fatiar. */
  divisor: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Space.lg + 36 + Space.md,
  },
  cabecalho: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.xs,
  },
  etiqueta: Type.meta,
});
