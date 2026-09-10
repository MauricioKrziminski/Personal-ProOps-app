import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/finance/chip';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Row } from '@/components/ui/row';
import { SearchField } from '@/components/ui/search-field';
import { Sheet } from '@/components/ui/sheet';
import { Space } from '@/design/tokens';
import { useCategoriesUsed } from '@/hooks/use-finance';
import { SUGGESTED_CATEGORIES } from '@/lib/categories';
import { filterCategories, foldCategory, mergeCategories } from '@/lib/categories-merge';

/**
 * O seletor de categoria — chips do que ele mais usa, folha com busca para o resto.
 *
 * Antes eram as 13 sugestões de `categories.ts` em fileira, e só elas. Em produção há 25
 * categorias distintas: 17 não estavam ali, inclusive "despesas eventuais" (14 lançamentos),
 * "roupa" (10) e "eletrônicos" (10). O usuário via treze opções que não usa e não conseguia
 * escolher as que usa — nem as via ao editar um lançamento que já tinha uma delas.
 *
 * A pergunta do dono do produto foi "e se tiver muito?", e a resposta não é encolher os chips:
 * é parar de tratar uma lista aberta como se fosse fechada. Categoria é TEXTO LIVRE no banco
 * (`finance.md`) — quem digita pelo WhatsApp cria categoria nova, e a tela tem que acompanhar.
 *
 * `LIMITE_CHIPS` é o teto do que fica à vista: acima disso a fileira vira um bloco de rolagem
 * que come a tela do formulário. O resto está a um toque em "Todas", com busca.
 *
 * **Caiu de 8 para 5 em 09/09/2026**, quando a Conta virou um campo colapsado de uma linha
 * (`SelectField`). Oito chips mais o "Todas…" ocupavam três fileiras logo acima de um campo de
 * 56px — nove pílulas cinzas idênticas, que foi a queixa do dono do produto ("parecendo um mvp").
 * O corte é de VOLUME, não de alcance: a lista inteira continua a um toque, com busca, e a
 * ordenação é por USO (`mergeCategories`), então as cinco à vista são as cinco que ele mais
 * escolhe. Um toque continua bastando para o caso comum — que é por que isto não virou o mesmo
 * campo colapsado da Conta: categoria é o campo preenchido em TODO lançamento, e um toque a mais
 * ali é um imposto diário.
 */
const LIMITE_CHIPS = 5;

export function CategoryPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (category: string | null) => void;
}) {
  const usadas = useCategoriesUsed();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');

  const opcoes = mergeCategories(usadas.data ?? [], SUGGESTED_CATEGORIES, value);
  // A escolhida sempre à vista, mesmo que seja a 25ª mais usada.
  const naFrente = opcoes.slice(0, LIMITE_CHIPS);
  const chips =
    value && !naFrente.some((o) => foldCategory(o.label) === foldCategory(value))
      ? [...naFrente.slice(0, LIMITE_CHIPS - 1), { label: value, uses: 0 }]
      : naFrente;

  const escolher = (label: string | null) => {
    onChange(label);
    setAberto(false);
    setBusca('');
  };

  const filtradas = filterCategories(opcoes, busca);
  const termo = busca.trim();
  // Categoria nova nasce aqui, digitada — é o mesmo que o WhatsApp já permite.
  const podeCriar =
    termo.length > 1 && !opcoes.some((o) => foldCategory(o.label) === foldCategory(termo));

  return (
    <>
      <View style={styles.chipRow}>
        {chips.map((o) => (
          <Chip
            key={o.label}
            label={o.label}
            selected={!!value && foldCategory(o.label) === foldCategory(value)}
            onPress={() => escolher(value && foldCategory(o.label) === foldCategory(value) ? null : o.label)}
          />
        ))}
        {opcoes.length > chips.length ? (
          <Chip label="Todas…" selected={false} onPress={() => setAberto(true)} />
        ) : null}
      </View>

      <Sheet visible={aberto} onClose={() => setAberto(false)}>
        <View style={styles.head}>
          <Button label="Cancelar" variant="ghost" size="sm" onPress={() => setAberto(false)} />
          <ThemedText type="smallBold">Categoria</ThemedText>
          {/* Simetria da faixa: o sheet fecha por Cancelar ou pela escolha, não por "Salvar". */}
          <View style={styles.headSpacer} />
        </View>

        <View style={styles.searchSlot}>
          <SearchField
            value={busca}
            onChangeText={setBusca}
            placeholder="Buscar ou criar categoria"
            accessibilityLabel="Buscar categoria"
            autoFocus
          />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {podeCriar ? (
            <Row
              title={`Usar "${termo}"`}
              subtitle="Categoria nova"
              icon="plus"
              chevron={false}
              onPress={() => escolher(termo)}
            />
          ) : null}
          {value ? (
            <Row title="Sem categoria" icon="xmark" chevron={false} onPress={() => escolher(null)} />
          ) : null}
          {filtradas.map((o) => (
            <Row
              key={o.label}
              title={o.label}
              subtitle={o.uses > 0 ? `${o.uses} ${o.uses === 1 ? 'lançamento' : 'lançamentos'}` : 'sugestão'}
              icon={
                value && foldCategory(o.label) === foldCategory(value) ? 'checkmark' : 'tag'
              }
              chevron={false}
              onPress={() => escolher(o.label)}
            />
          ))}
          {filtradas.length === 0 && !podeCriar ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nada com esse nome. Digite mais para criar uma categoria.
            </ThemedText>
          ) : null}
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
  },
  headSpacer: { width: 72 },
  searchSlot: { paddingHorizontal: Space.lg },
  body: { padding: Space.lg, gap: Space.xs },
});
