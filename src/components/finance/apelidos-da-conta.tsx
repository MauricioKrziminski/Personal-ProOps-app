import { ErrorCard } from '@/components/error-card';
import { Forte } from '@/components/ui/forte';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { useToast } from '@/components/ui/toast';
import { useApelidosDaConta, useRemoverApelido } from '@/hooks/use-apelidos-da-conta';
import { apelidoParaExibir } from '@/lib/apelidos';
import { confirmDestructive } from '@/lib/item-actions';

/**
 * "Apelidos que o agente aprendeu" de uma conta, na edição dela. Some sem apelido.
 * Sem "Desfazer": só o serviço cria apelido, então o app não tem como recriar.
 */
export function ApelidosDaConta({ accountId }: { accountId: string }) {
  const toast = useToast();
  const consulta = useApelidosDaConta(accountId);
  const remover = useRemoverApelido();

  if (consulta.isError) return <ErrorCard onRetry={consulta.refetch} />;
  const itens = consulta.data ?? [];
  if (itens.length === 0) return null;

  const apaga = (id: string, nome: string) =>
    confirmDestructive(`Remover o apelido ${nome}?`, 'Remover', () =>
      remover.mutate(id, {
        onSuccess: () => toast({ message: <>Apelido <Forte>{nome}</Forte> removido.</>, tone: 'success' }),
        onError: () => toast({ message: <>Não deu para remover <Forte>{nome}</Forte>.</>, tone: 'error' }),
      }), 'O agente deixa de entender esse nome; ele pergunta de novo se você usar.');

  return (
    <Section title="Apelidos que o agente aprendeu">
      {itens.map((item) => {
        const nome = apelidoParaExibir(item.dito ?? item.alias);
        return (
          <Row
            key={item.id}
            title={nome}
            chevron={false}
            trailing={<Icon name="trash" size="sm" color="textSecondary" />}
            onPress={() => apaga(item.id, nome)}
            accessibilityLabel={`Apelido ${nome}. Toque para remover.`}
          />
        );
      })}
    </Section>
  );
}
