import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorCard } from '@/components/error-card';
import { Presenca } from '@/components/motion/presenca';
import { Forte } from '@/components/ui/forte';
import { Deslizavel } from '@/components/ui/deslizavel';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import {
  ContaComLancamentos,
  useArquivados,
  useDesarquivar,
  useExcluirArquivado,
  type Arquivado,
  type Arquivavel,
} from '@/hooks/use-finance';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';

/** O que some junto com o item — dito na confirmação, antes do toque. */
const O_QUE_SOME: Record<Arquivavel, string> = {
  accounts: 'Só dá para apagar sem lançamentos. Não dá para desfazer.',
  goals: 'Os aportes dela saem junto. Não dá para desfazer.',
  assets: 'O histórico de valores sai junto. Não dá para desfazer.',
};

interface Props {
  tabela: Arquivavel;
  /** "Arquivadas" (contas, metas) ou "Arquivados" (cartões, bens) — concorda com a lista. */
  titulo: string;
  /** Só os itens que ESTA tela mostra (Cartões só os cartões, Contas as duas). */
  filtro?: (item: Arquivado) => boolean;
  /** O que distingue o item: "conta arquivada", "cartão arquivado", "meta arquivada". */
  subtitulo: (item: Arquivado) => string;
  trailing?: (item: Arquivado) => ReactNode;
}

/**
 * "Arquivadas · N" no fim da lista, que abre os arquivados no lugar; tocar num deles desarquiva,
 * e o arrasto põe Desarquivar à direita e Apagar à esquerda (28/09/2026). Contas, cartões, metas e bens se arquivavam e SUMIAM — não havia
 * tela que os listasse, e o único caminho de volta era o "Desfazer" do aviso, que dura segundos.
 * É o desenho que as dívidas já tinham. Some sem nada arquivado; com erro, diz que falhou.
 */
export function SecaoDeArquivados({ tabela, titulo, filtro, subtitulo, trailing }: Props) {
  const theme = useTheme();
  const toast = useToast();
  const consulta = useArquivados(tabela);
  const desarquivar = useDesarquivar(tabela);
  const excluir = useExcluirArquivado(tabela);
  const [aberta, setAberta] = useState(false);

  if (consulta.isError) return <ErrorCard onRetry={consulta.refetch} />;
  const itens = (consulta.data ?? []).filter((i) => !filtro || filtro(i));
  if (itens.length === 0) return null;

  const volta = (item: Arquivado) =>
    desarquivar.mutate(item.id, {
      onSuccess: (voltou) =>
        toast(
          voltou
            ? { message: <><Forte>{item.name}</Forte> voltou para a lista.</>, tone: 'success' }
            : { message: <><Forte>{item.name}</Forte> não existe mais.</>, tone: 'error' },
        ),
      onError: () => toast({ message: <>Não deu para desarquivar <Forte>{item.name}</Forte>.</>, tone: 'error' }),
    });

  const exclui = (item: Arquivado) =>
    confirmDestructive(`Apagar ${item.name}?`, 'Apagar', () =>
      excluir.mutate(item.id, {
        onSuccess: (saiu) =>
          toast(
            saiu
              ? { message: <><Forte>{item.name}</Forte> saiu de vez.</>, tone: 'success' }
              : { message: <><Forte>{item.name}</Forte> não existe mais.</>, tone: 'error' },
          ),
        onError: (e) =>
          toast({
            message:
              e instanceof ContaComLancamentos ? (
                <><Forte>{item.name}</Forte> tem {e.quantos} lançamento{e.quantos === 1 ? '' : 's'}: apague-os antes ou deixe arquivada.</>
              ) : (
                <>Não deu para apagar <Forte>{item.name}</Forte>.</>
              ),
            tone: 'error',
          }),
      }), O_QUE_SOME[tabela]);

  const acoes = (item: Arquivado): ItemAction[] => [
    { label: 'Desarquivar', curto: 'Restaurar', icon: 'arrow.uturn.backward', arrasto: 'direita', onPress: () => volta(item) },
    { label: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => exclui(item) },
  ];

  return (
    <Section>
      <View>
      <Row
        icon="archivebox"
        title={`${titulo} · ${itens.length}`}
        chevron={false}
        trailing={<Icon name={aberta ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />}
        onPress={() => setAberta((v) => !v)}
        accessibilityState={{ expanded: aberta }}
      />
      <Presenca visivel={aberta}>
        {itens.map((item) => (
          <View key={item.id}>
            <View style={[styles.separador, { backgroundColor: theme.separator }]} />
            <Deslizavel titulo={item.name} acoes={acoes(item)}>
              <Row
                title={item.name}
                subtitle={subtitulo(item)}
                chevron={false}
                trailing={trailing?.(item)}
                onPress={() => volta(item)}
                onLongPress={() => showItemActions(item.name, acoes(item))}
                accessibilityLabel={`${item.name}, ${subtitulo(item)}. Toque para desarquivar.`}
              />
            </Deslizavel>
          </View>
        ))}
      </Presenca>
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  separador: { height: StyleSheet.hairlineWidth, marginLeft: Space.lg },
});
