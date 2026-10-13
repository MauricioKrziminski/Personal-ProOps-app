import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { BlockHeader } from '@/components/ui/block-header';
import { Deslizavel } from '@/components/ui/deslizavel';
import { Row, Section } from '@/components/ui/row';
import { useToast } from '@/components/ui/toast';
import { useResolverCaptura, type Captura } from '@/hooks/use-capturas';
import { hrefDaCaptura } from '@/lib/captura';
import { Space } from '@/design/tokens';
import { formatDateBR } from '@/lib/dates';
import { showItemActions, type ItemAction } from '@/lib/item-actions';

const NA_HOJE = 3;

/** Só o que espera confirmação: o "parece já lançado" fica na lista, nunca na Hoje. */
export const pendentesDaCaptura = (capturas: readonly Captura[] | undefined) =>
  (capturas ?? []).filter((c) => c.status === 'pending');

const tituloDa = (c: Captura) => c.entendido ?? c.draft.entendido;

/** Lançar (abre o formulário preenchido) e Descartar (com Desfazer): a régua do arrasto, §6. */
export function useAcoesDaCaptura() {
  const toast = useToast();
  const resolver = useResolverCaptura();
  // Desfazer devolve ao status de ANTES: o duplicado volta para "Parecem já lançados", não para a Hoje.
  const descartar = ({ id, status }: Captura) =>
    resolver.mutate({ id, status: 'discarded' }, {
      onSuccess: () => toast({
        message: 'Descartado.',
        tone: 'info',
        action: { label: 'Desfazer', onPress: () => resolver.mutate({ id, status }) },
      }),
    });
  return (c: Captura): ItemAction[] => [
    {
      label: c.status === 'duplicate' ? 'Lançar mesmo assim' : 'Lançar',
      curto: 'Lançar',
      icon: 'checkmark',
      arrasto: 'direita',
      onPress: () => router.push(hrefDaCaptura(c)),
    },
    { label: 'Descartar', icon: 'trash', destructive: true, arrasto: 'esquerda', desfaz: true, onPress: () => descartar(c) },
  ];
}

/** A linha de uma captura, a mesma na Hoje e em "A confirmar". */
export function LinhaDaCaptura({ captura: c, acoes }: { captura: Captura; acoes: ItemAction[] }) {
  const titulo = tituloDa(c);
  const quando = `${c.bank} · ${formatDateBR(new Date(c.posted_at))}`;
  return (
    <Deslizavel titulo={titulo} acoes={acoes}>
      <Row
        title={titulo}
        subtitle={c.status === 'duplicate' ? `Parece já estar no app · ${quando}` : quando}
        icon={c.status === 'duplicate' ? 'doc.on.doc' : 'bell.badge'}
        onPress={c.status === 'duplicate' ? () => showItemActions(titulo, acoes) : () => router.push(hrefDaCaptura(c))}
        onLongPress={() => showItemActions(titulo, acoes)}
      />
    </Deslizavel>
  );
}

/** "A confirmar": compras e Pix lidos das notificações. Quem decide se o bloco existe é a Hoje. */
export function CapturasDaHoje({ pendentes, total }: { pendentes: Captura[]; total?: number }) {
  const acoesDa = useAcoesDaCaptura();
  return (
    <View style={styles.bloco}>
      <BlockHeader
        title="A confirmar"
        voice="app"
        count={total ?? pendentes.length}
        action={{ label: 'Ver todos', accessibilityLabel: 'Ver tudo o que está a confirmar', onPress: () => router.push('/finance/capturas') }}
      />
      <Section>
        {pendentes.slice(0, NA_HOJE).map((c) => (
          <LinhaDaCaptura key={c.id} captura={c} acoes={acoesDa(c)} />
        ))}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({ bloco: { gap: Space.md } });
