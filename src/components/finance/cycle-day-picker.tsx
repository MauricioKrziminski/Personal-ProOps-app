import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * Linhas de 7, e a última completada com espaços VAZIOS: com `flexWrap` + `flexGrow` os três
 * últimos dias (29, 30, 31) esticavam para preencher a linha e a grade perdia as colunas.
 */
const SEMANAS: (number | null)[][] = Array.from({ length: 5 }, (_, s) =>
  Array.from({ length: 7 }, (_, i) => {
    const dia = s * 7 + i + 1;
    return dia <= 31 ? dia : null;
  }),
);

/**
 * O dia em que o mês FINANCEIRO fecha — a grade de 1 a 31 (o 31 é o último dia do mês).
 *
 * Nasceu dentro do Perfil e saiu de lá quando o onboarding precisou da mesma escolha: a segunda
 * cópia é como as duas divergem, e aqui a divergência seria silenciosa (uma grade aceitando 31,
 * a outra 28, e o `check` da coluna reclamando só em fevereiro).
 *
 * ## Por que uma GRADE, e não o `SelectField`
 *
 * A primeira versão usava o seletor de lista, e a queixa foi literal: *"como assim abre um mundo
 * de uma caixa de seleção para escolher de 1 até 31?"*. Escolher um DIA DO MÊS não é escolher um
 * item de lista curta: são 29 opções homogêneas, sem nome, que a pessoa compara por POSIÇÃO e não
 * por leitura. Numa lista viram 29 linhas de rolagem para um número; numa grade de 7 colunas
 * cabem todas na tela de uma vez, como num calendário — a forma que a pessoa já sabe ler.
 *
 * ## Por que UM número define os dois extremos
 *
 * A outra metade da queixa foi *"onde eu defino um começo e final para o meu ciclo?"*. Não dá
 * para escolher os dois: eles são grudados — o mês seguinte começa no dia após o anterior fechar.
 * Explicar isso em texto não resolve; o que resolve é o intervalo aparecer e MUDAR junto com o
 * toque. Por isso a prévia faz parte do componente, e não da tela que o usa.
 *
 * ## Até o 31, e o 31 É o "último dia do mês" (23/09/2026)
 *
 * O teto era 28 "para o dia existir em fevereiro", e a queixa foi literal: *"o mês vai só até o
 * dia 28 em vez de ir até o 31"*. Hoje o banco faz o clamp (`private.cycle_bounds`, a mesma regra
 * do vencimento do cartão): 29 e 30 fecham no último dia do mês mais curto. Com isso, fechar no 31
 * e fechar no último dia são a MESMA coisa — o 31 grava `null` e o `null` acende o 31. O botão
 * separado "Último dia do mês" saiu: eram dois controles dizendo a mesma coisa.
 *
 * ⚠️ **Vidro só no dia ESCOLHIDO, nunca atrás da grade nem em toda célula.** A grade inteira
 * tinha um `GlassBackdrop` e as células eram transparentes: no iPhone os números apareciam sobre
 * uma placa "nada a ver". Vidro em cada uma das 31 células foi medido no simulador (iOS 26, escuro)
 * e também não serve: lado a lado, o sistema pinta umas escuras e outras claras, sem padrão. A
 * célula é opaca como no Android, e o vidro marca a escolha — o mesmo desenho do `Calendar`.
 */
export function CycleDayPicker({
  value,
  onChange,
}: {
  /** `null` = último dia do mês — o padrão, e o que o 31 grava. */
  value: number | null;
  onChange: (dia: number | null) => void;
}) {
  const theme = useTheme();
  const vidro = supportsLiquidGlass();

  return (
    <>
      <View style={styles.grade}>
        {SEMANAS.map((semana, s) => (
          <View key={s} style={styles.semana}>
            {semana.map((dia, i) => {
              if (dia == null) return <View key={`vazio-${i}`} style={styles.vazio} />;
              const ultimo = dia === 31;
              const escolhido = ultimo ? value == null : value === dia;
              return (
                <Pressable
                  key={dia}
                  accessibilityRole="button"
                  accessibilityState={{ selected: escolhido }}
                  accessibilityLabel={
                    ultimo ? 'Fechar o mês no último dia' : `Fechar o mês no dia ${dia}`
                  }
                  onPress={() => {
                    Haptics.selectionAsync();
                    onChange(ultimo ? null : dia);
                  }}
                  style={[
                    styles.dia,
                    {
                      backgroundColor: escolhido
                        ? vidro
                          ? 'transparent'
                          : theme.tintFill
                        : theme.surface,
                      borderColor: escolhido ? theme.tintFill : theme.cardBorder,
                    },
                  ]}>
                  {vidro && escolhido ? (
                    <GlassBackdrop
                      fallbackColor={theme.tintFill}
                      radius={Radius.sm}
                      tintColor={theme.glassActionTint}
                    />
                  ) : null}
                  <ThemedText
                    type="default"
                    style={[tabular, escolhido ? { color: theme.onTint } : undefined]}>
                    {dia}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <ThemedText type="footnote" themeColor="textSecondary" style={[styles.previa, tabular]}>
        {value == null
          ? 'do dia 1 ao último dia de cada mês'
          : value >= 29
            ? `até o dia ${value} de cada mês, ou o último dia no mês mais curto`
            : `do dia ${value + 1} de um mês ao dia ${value} do seguinte`}
      </ThemedText>
    </>
  );
}

const styles = StyleSheet.create({
  /*
    7 colunas, como a semana de um calendário — é a grade que a pessoa já sabe varrer com o
    olho. `flex: 1` em vez de largura fixa: a calha muda entre 384dp e um tablet, e um número
    cravado deixaria a última coluna fora ou uma faixa vazia à direita.
  */
  grade: {
    gap: Space.sm,
  },
  semana: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  /*
    ⚠️ `minHeight`, nunca `height`. O conteúdo é TEXTO e cresce com a fonte do sistema: a 1,3×
    um alvo de altura fixa corta o número. 44 é o mínimo de toque; daí para cima quem manda é
    o texto.
  */
  dia: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  vazio: { flex: 1 },
  previa: {
    marginTop: Space.sm,
  },
});
