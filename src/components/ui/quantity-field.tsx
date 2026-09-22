import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { HitTarget, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * Quantidade ABERTA: digita qualquer número, e − / + para o ajuste fino. Nunca atalhos fixos
 * (pedido do dono do produto, 22/09/2026: *"essas coisas nunca devem ser fixadas"* — "do 3 já
 * pula para o 6"). Nasceu no "Adiantar" do E se… e é o caminho para toda quantidade do app.
 *
 * `max` é o que EXISTE (as parcelas a vencer, por exemplo): digitar além assenta no teto, e o
 * campo mostra o número que valeu.
 *
 * ⚠️ **Quando o teto (ou o piso) MUDA por causa de outro campo, o valor se ajusta sozinho** —
 * nunca vira erro (22/09/2026, *"sempre que for possível ser automático, fazer automático ao
 * invés de mostrar erro"*). O ajuste é devolvido por `onChange`, então o estado de quem chama
 * passa a ser o número que a tela mostra: nunca "o campo diz 8 e grava 3".
 */
export function QuantityField({
  value,
  max = 999,
  min = 1,
  invalid = false,
  onChange,
  accessibilityLabel = 'Quantidade',
}: {
  value: number;
  max?: number;
  min?: number;
  invalid?: boolean;
  onChange: (n: number) => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  // Só DURANTE a digitação o campo mostra o texto cru: apagar para digitar outro número não pode
  // virar o mínimo no meio do caminho. Fora dela, mostra o número que valeu.
  const [digitando, setDigitando] = useState<string | null>(null);
  const assentado = Math.max(min, Math.min(value, max));
  useEffect(() => {
    if (assentado !== value) onChange(assentado);
  }, [assentado, value, onChange]);
  const muda = (n: number) => {
    const certo = Math.max(min, Math.min(n, max));
    if (certo !== value) Haptics.selectionAsync();
    // − / + com o campo ainda em foco: sem largar o texto digitado, o campo continuava mostrando
    // o número antigo enquanto o valor já era outro (visto no simulador, 22/09/2026)
    setDigitando(null);
    onChange(certo);
  };
  const botao = (icone: 'minus' | 'plus', rotulo: string, alvo: number, desligado: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityState={{ disabled: desligado }}
      disabled={desligado}
      onPress={() => muda(alvo)}
      style={({ pressed }) => [
        styles.passo,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, opacity: desligado ? 0.4 : 1 },
      ]}>
      <Icon name={icone} size="sm" color="text" />
    </Pressable>
  );
  return (
    <View style={styles.linha}>
      {botao('minus', 'Um a menos', assentado - 1, assentado <= min)}
      <TextField
        value={digitando ?? String(assentado)}
        onChangeText={(t) => {
          const digitos = t.replace(/\D/g, '').slice(0, String(max).length);
          setDigitando(digitos);
          const n = Number(digitos);
          if (n >= min) onChange(Math.min(n, max));
        }}
        onBlur={() => setDigitando(null)}
        keyboardType="number-pad"
        selectTextOnFocus
        accessibilityLabel={accessibilityLabel}
        invalid={invalid}
        style={[styles.numero, tabular]}
      />
      {botao('plus', 'Um a mais', assentado + 1, assentado >= max)}
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  passo: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numero: { flex: 1, textAlign: 'center' },
});
