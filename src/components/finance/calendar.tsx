import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { monthTitle, shiftMonth } from '@/components/finance/month-picker';
import { Icon } from '@/components/ui/icon';
import { HitTarget, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { isoToBR, localISODate, monthGrid } from '@/lib/dates';

/**
 * As células da grade SEM as semanas vazias do fim.
 *
 * `monthGrid` devolve sempre 6×7, que é o que o mês mais longo precisa. Desenhar as seis deixava
 * uma faixa vazia dentro do card em todo mês que cabe em cinco — espaço vazio, que é exatamente
 * a queixa de que este sheet acabou de sair. Só linhas INTEIRAS saem, então nenhum dia some, e o
 * card muda de altura ao trocar de mês sem nada embaixo dele para empurrar.
 */
function semanasVisiveis(mes: string): (string | null)[] {
  const celulas = monthGrid(mes);
  let ultimo = 0;
  celulas.forEach((c, i) => {
    if (c) ultimo = i;
  });
  return celulas.slice(0, (Math.floor(ultimo / 7) + 1) * 7);
}

/** Domingo primeiro, que é como todo calendário pt-BR desenha a semana. */
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

interface Props {
  /** Dia marcado, ISO. `null` = nenhum. */
  value: string | null;
  onChange: (iso: string) => void;
  /** Limites inclusivos, ISO. Dia fora deles aparece apagado e não recebe toque. */
  min?: string;
  max?: string;
}

/**
 * Calendário de dias — a grade que escolhe UMA data.
 *
 * ## Por que ele existe
 *
 * A Projeção pedia a data por um campo de texto mascarado, e o dono do produto reclamou dele
 * duas vezes: *"parece que se eu clicar no campo 'projetar até' iria abrir um calendário e nada
 * acontece"* e, depois de o campo ganhar rótulo, *"se eu ainda clico em 'Outra data', eu não
 * consigo mudar a data, tinha que abrir um calendar pick ou algo assim"*. Ele estava certo nas
 * duas: um campo `dd/mm/aaaa` pede que a pessoa SAIBA a data; quem escolhe horizonte quer VER
 * onde ela cai.
 *
 * (E o campo tinha um defeito de digitação por cima: ele abria preenchido com dez caracteres e
 * `maxLength={10}`, então a primeira tecla era engolida — só dava para digitar depois de apagar.)
 *
 * ## Por que escrito à mão
 *
 * Nenhuma lib de calendário está aprovada no projeto, e a decisão é a mesma já registrada no
 * `Segmented` e no `MonthSheet`: o desenho do app vem dos primitivos, e um picker de terceiro
 * não aceita os tokens nem as duas famílias de fonte. `@react-native-community/datetimepicker`
 * ficou de fora de propósito — ele desenha a roda do sistema, que é outro produto na mesma tela.
 *
 * ⚠️ **Ele é INLINE, nunca um `Modal`.** Quem o usa hoje já mora dentro de um `Sheet`, e
 * `Modal` dentro de `Modal` no Android é uma janela dentro de outra, com teclado e botão voltar
 * disputando qual fecha (a mesma razão pela qual o `SelectField` abre no lugar — design.md §1).
 */
export function Calendar({ value, onChange, min, max }: Props) {
  const theme = useTheme();
  const hoje = localISODate();
  const [mes, setMes] = useState(() => (value ?? hoje).slice(0, 7));

  const foraDoLimite = (iso: string) => (min != null && iso < min) || (max != null && iso > max);
  /*
    O passo de mês é barrado quando o mês INTEIRO está fora — comparar só o dia 1 deixaria o
    usuário atravessar para um mês onde nada é tocável, que é pior que uma seta apagada.
  */
  const mesFora = (m: string) =>
    (min != null && m < min.slice(0, 7)) || (max != null && m > max.slice(0, 7));

  const passo = (delta: -1 | 1) => {
    const alvo = shiftMonth(mes, delta);
    const bloqueado = mesFora(alvo);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: bloqueado }}
        accessibilityLabel={delta < 0 ? `Mês anterior, ${monthTitle(alvo)}` : `Próximo mês, ${monthTitle(alvo)}`}
        disabled={bloqueado}
        hitSlop={Space.sm}
        onPress={() => {
          Haptics.selectionAsync();
          setMes(alvo);
        }}
        style={({ pressed }) => [
          styles.seta,
          {
            backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
            opacity: bloqueado ? 0.35 : 1,
          },
        ]}>
        <Icon name={delta < 0 ? 'chevron.left' : 'chevron.right'} size="sm" color="tint" />
      </Pressable>
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.cabecalho}>
        {passo(-1)}
        <ThemedText type="smallBold" accessibilityRole="header" style={styles.mes}>
          {monthTitle(mes)}
        </ThemedText>
        {passo(1)}
      </View>

      <View style={styles.linha}>
        {SEMANA.map((dia) => (
          <View key={dia} style={styles.inicialDaSemana}>
            <ThemedText type="caption" themeColor="textSecondary">
              {dia}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.linha}>
        {semanasVisiveis(mes).map((iso, i) => {
          if (!iso) return <View key={i} style={styles.celula} />;
          const marcado = iso === value;
          const bloqueado = foraDoLimite(iso);
          return (
            <Pressable
              key={iso}
              accessibilityRole="button"
              accessibilityState={{ selected: marcado, disabled: bloqueado }}
              // O leitor de tela lê a data inteira: "12" sozinho não diz de que mês.
              accessibilityLabel={isoToBR(iso)}
              disabled={bloqueado}
              onPress={() => {
                Haptics.selectionAsync();
                onChange(iso);
              }}
              style={styles.celula}>
              {({ pressed }) => (
                <View
                  style={[
                    styles.dia,
                    marcado
                      ? { backgroundColor: theme.tint }
                      : pressed
                        ? { backgroundColor: theme.backgroundSelected }
                        : null,
                    /*
                      HOJE leva um anel, não preenchimento: preenchido ele competiria com o dia
                      escolhido — dois discos cheios na mesma grade e nenhum dizendo qual é a
                      resposta.
                    */
                    iso === hoje && !marcado
                      ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.tint }
                      : null,
                    bloqueado ? styles.bloqueado : null,
                  ]}>
                  <ThemedText
                    type="ticker"
                    themeColor={marcado ? 'onTint' : iso === hoje ? 'tint' : 'text'}
                    style={tabular}>
                    {Number(iso.slice(8))}
                  </ThemedText>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /*
    Sem superfície PRÓPRIA: ele nasce dentro de um campo que expande, e um card dentro do card
    da `Section` seria moldura sobre moldura. Quem enquadra é quem usa.
  */
  wrap: {
    gap: Space.sm,
    padding: Space.md,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  seta: {
    width: HitTarget - Space.sm,
    height: HitTarget - Space.sm,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mes: {
    flex: 1,
    textAlign: 'center',
  },
  linha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  /*
    Sete colunas por PORCENTAGEM, não por largura medida: a grade vive dentro de um sheet, cuja
    calha muda entre iOS e Android, e um número fixo sobraria ou faltaria em um dos dois.
    `aspectRatio` mantém a célula quadrada — a 384dp isso dá ~50pt, acima do alvo de 44.
  */
  celula: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
    ⚠️ **A linha dos dias da semana NÃO é quadrada.** Ela usava a mesma `celula` da grade, e o
    `aspectRatio: 1` dava 50pt de altura a um texto de 11px — cinquenta pontos de vazio entre o
    cabeçalho e o dia 1, visto no emulador. Ela é um rótulo, não um alvo.
  */
  inicialDaSemana: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingBottom: Space.xs,
  },
  dia: {
    width: '86%',
    aspectRatio: 1,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bloqueado: {
    opacity: 0.3,
  },
});
