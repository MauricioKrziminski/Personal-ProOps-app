import { useState, type ReactNode } from 'react';

import { ErrorCard } from '@/components/error-card';
import { Forte } from '@/components/ui/forte';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { useToast } from '@/components/ui/toast';
import { useArquivados, useDesarquivar, type Arquivado, type Arquivavel } from '@/hooks/use-finance';
import { showItemActions } from '@/lib/item-actions';

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
 * "Arquivadas · N" no fim da lista, que abre os arquivados no lugar; tocar num deles oferece
 * "Desarquivar" (28/09/2026). Contas, cartões, metas e bens se arquivavam e SUMIAM — não havia
 * tela que os listasse, e o único caminho de volta era o "Desfazer" do aviso, que dura segundos.
 * É o desenho que as dívidas já tinham. Some sem nada arquivado; com erro, diz que falhou.
 */
export function SecaoDeArquivados({ tabela, titulo, filtro, subtitulo, trailing }: Props) {
  const toast = useToast();
  const consulta = useArquivados(tabela);
  const desarquivar = useDesarquivar(tabela);
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

  return (
    <Section>
      <Row
        icon="archivebox"
        title={`${titulo} · ${itens.length}`}
        chevron={false}
        trailing={<Icon name={aberta ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />}
        onPress={() => setAberta((v) => !v)}
        accessibilityState={{ expanded: aberta }}
      />
      {aberta
        ? itens.map((item) => (
            <Row
              key={item.id}
              title={item.name}
              subtitle={subtitulo(item)}
              chevron={false}
              trailing={trailing?.(item)}
              onPress={() => showItemActions(item.name, [{ label: 'Desarquivar', icon: 'arrow.uturn.backward', onPress: () => volta(item) }])}
              accessibilityLabel={`${item.name}, ${subtitulo(item)}. Toque para desarquivar.`}
            />
          ))
        : null}
    </Section>
  );
}
