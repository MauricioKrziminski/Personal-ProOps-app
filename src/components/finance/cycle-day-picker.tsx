import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * O dia em que o mês FINANCEIRO fecha — a grade de 28 dias + "Último dia do mês".
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
 * O teto é 28 para o dia existir em fevereiro — sem isso o ciclo mudaria de tamanho conforme o
 * mês, que é justamente o defeito que ele resolve.
 */
export function CycleDayPicker({
  value,
  onChange,
}: {
  /** `null` = último dia do mês, que é o padrão e o comportamento de quem nunca mexeu nisso. */
  value: number | null;
  onChange: (dia: number | null) => void;
}) {
  const theme = useTheme();

  return (
    <>
      <View style={styles.grade}>
        {Array.from({ length: 28 }, (_, i) => i + 1).map((dia) => {
          const escolhido = value === dia;
          return (
            <Pressable
              key={dia}
              accessibilityRole="button"
              accessibilityState={{ selected: escolhido }}
              accessibilityLabel={`Fechar o mês no dia ${dia}`}
              onPress={() => {
                Haptics.selectionAsync();
                onChange(dia);
              }}
              style={[
                styles.dia,
                {
                  backgroundColor: escolhido ? theme.tint : theme.surface,
                  borderColor: escolhido ? theme.tint : theme.cardBorder,
                },
              ]}>
              <ThemedText
                type="default"
                style={[tabular, escolhido ? { color: theme.onTint } : undefined]}>
                {dia}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {/*
        Fora da grade de propósito: "último dia" não é um número entre 1 e 28, é a AUSÊNCIA de
        escolha (e o padrão). Dentro dela leria como um 29º dia — e o mês nem sempre tem.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: value == null }}
        onPress={() => {
          Haptics.selectionAsync();
          onChange(null);
        }}
        style={[
          styles.ultimo,
          {
            backgroundColor: value == null ? theme.tint : theme.surface,
            borderColor: value == null ? theme.tint : theme.cardBorder,
          },
        ]}>
        <ThemedText type="default" style={value == null ? { color: theme.onTint } : undefined}>
          Último dia do mês
        </ThemedText>
      </Pressable>

      <ThemedText type="footnote" themeColor="textSecondary" style={[styles.previa, tabular]}>
        {value == null
          ? 'do dia 1 ao último dia de cada mês'
          : `do dia ${value === 28 ? 1 : value + 1} de um mês ao dia ${value} do seguinte`}
      </ThemedText>
    </>
  );
}

const styles = StyleSheet.create({
  /*
    7 colunas, como a semana de um calendário — é a grade que a pessoa já sabe varrer com o
    olho. `flexBasis` em vez de largura fixa: a calha muda entre 384dp e um tablet, e um número
    cravado deixaria a última coluna fora ou uma faixa vazia à direita.
  */
  grade: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  /*
    ⚠️ `minHeight`, nunca `height`. O conteúdo é TEXTO e cresce com a fonte do sistema: a 1,3×
    um alvo de altura fixa corta o número. 44 é o mínimo de toque; daí para cima quem manda é
    o texto.
  */
  dia: {
    flexBasis: '12%',
    flexGrow: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  ultimo: {
    marginTop: Space.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  previa: {
    marginTop: Space.sm,
  },
});
