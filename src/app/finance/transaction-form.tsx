import { router, useLocalSearchParams } from 'expo-router';

import { FormularioDoLancamento, LancamentoEditando } from '@/components/finance/formulario-do-lancamento';
import { isoToBR, localISODate } from '@/lib/dates';

/**
 * Novo/editar lançamento — modal do Stack raiz (Cancelar nativo vem do `_layout.tsx`).
 *
 * Editando, quem espera o registro (e os portões de esqueleto e erro) é `LancamentoEditando`, o
 * MESMO que o formulário único (`/finance/lancar`) usa — as duas rotas se comportam igual.
 */

export default function TransactionFormScreen() {
  const params = useLocalSearchParams<{ id?: string; conta?: string; deHipotese?: string; kind?: string; amount?: string; data?: string; parcelas?: string }>();
  const fechar = () => router.back();

  if (params.id) {
    return (
      // Outro id é outro formulário: aberto por link sobre um já aberto, a tela era reaproveitada
      // e o `useForm` (que só lê os valores na montagem) seguia com o lançamento anterior.
      <LancamentoEditando
        key={params.id}
        editandoId={params.id}
        comum={{ kind: 'expense', descricao: '', valorCents: 0, contaId: null, dataBR: isoToBR(localISODate()), categoria: null }}
        registrarComum={() => {}}
        registrarEstado={() => {}}
        onSalvo={fechar}
        onFechar={fechar}
      />
    );
  }

  // Aberto pelo "Aplicar" de uma hipótese do "E se…?": o formulário nasce com o tipo, o valor (o
  // total, com parcelas), a data, as parcelas e a conta dela.
  const rapida = params.deHipotese !== undefined;
  return (
    <FormularioDoLancamento
      key={params.id ?? `novo:${params.conta ?? ''}:${params.deHipotese ?? ''}`}
      comum={{
        kind: rapida && params.kind === 'income' ? 'income' : 'expense',
        descricao: '',
        valorCents: rapida ? Number(params.amount) || 0 : 0,
        contaId: params.conta ?? null,
        dataBR: (rapida && params.data) || isoToBR(localISODate()),
        categoria: null,
      }}
      parcelas={rapida ? Math.max(1, Number(params.parcelas) || 1) : undefined}
      deHipotese={rapida ? params.deHipotese : undefined}
      registrarComum={() => {}}
      registrarEstado={() => {}}
      onSalvo={fechar}
      onFechar={fechar}
    />
  );
}
