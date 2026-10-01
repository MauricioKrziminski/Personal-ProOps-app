import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { TrocaSuave } from '@/components/motion/presenca';

import { FormularioDaDivida } from '@/components/finance/formulario-da-divida';
import { FormatoDoLancamento } from '@/components/finance/formato-do-lancamento';
import { FormularioDaSerie } from '@/components/finance/formulario-da-serie';
import { FormularioDoLancamento, LancamentoEditando } from '@/components/finance/formulario-do-lancamento';
import { Screen } from '@/components/ui/screen';
import { FormularioEmTela } from '@/components/ui/sheet';
import { ToastDoModal, useToast } from '@/components/ui/toast';
import { useConverterRegistro, useDebts, useInstallmentPlan, useTransaction } from '@/hooks/use-finance';
import { usePurchaseDownPayment } from '@/hooks/use-down-payment';
import { isoToBR, localISODate } from '@/lib/dates';
import { financeErrorMessage } from '@/lib/finance-form';
import type { RegistroSimulado } from '@/lib/hipotese';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import {
  comumDepoisDeSalvar,
  comumParaSerie,
  hrefDoResultadoDaConversao,
  opcoesDaConversao,
  papelDaTransacao,
  temPassadoDoParam,
  TIPOS_DE_LANCAMENTO,
  type Comum,
  type OrigemDaConversao,
  type TipoDeLancamento,
} from '@/lib/lancar';

/** De que tabela vem o registro aberto, quando a entrada não diz. */
const ORIGEM_DO_TIPO: Record<TipoDeLancamento, OrigemDaConversao['tipo']> = {
  uma: 'transacao',
  recorrente: 'serie',
  financiamento: 'divida',
};

/**
 * O formulário único (spec 2026-09-29): um seletor, três corpos, e os campos comuns viajando entre
 * eles. Editar abre no tipo do registro; trocar o tipo e salvar pergunta o alcance e converte.
 */
export default function LancarScreen() {
  const bruto = useLocalSearchParams();
  // A rota pode repetir um parâmetro (`string[]`): vale o primeiro.
  const p: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(bruto).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const tipoOriginal = TIPOS_DE_LANCAMENTO.find((t) => t.value === p.tipo)?.value ?? 'uma';
  const [tipo, setTipo] = useState<TipoDeLancamento>(tipoOriginal);
  const [comum, setComum] = useState<Comum>(() => ({
    kind: p.kind === 'income' ? 'income' : 'expense',
    descricao: p.description ?? '',
    valorCents: Number(p.amount) > 0 ? Number(p.amount) : 0,
    contaId: p.conta ?? p.account ?? null,
    dataBR: p.data ?? p.start ?? isoToBR(localISODate()),
    categoria: p.category || null,
  }));
  /** O que foi digitado em cada tipo antes de a pessoa trocar para outro. */
  const [estados, setEstados] = useState<Partial<Record<TipoDeLancamento, unknown>>>({});
  /** Cada "Salvar e criar outro" é um corpo novo, limpo. */
  const [geracao, setGeracao] = useState(0);
  const lerComum = useRef<() => Comum>(() => comum);
  const lerEstado = useRef<() => unknown>(() => undefined);
  const toast = useToast();
  const converter = useConverterRegistro();
  /**
   * Uma conversão por vez. `isPending` só chega no render seguinte, e a pergunta aberta guarda o
   * `onPress` de antes: o segundo toque gravaria de novo (com "Manter", um segundo registro).
   */
  const convertendo = useRef(false);
  const montado = useRef(true);
  const tipoAtivo = useRef(tipo);
  useLayoutEffect(() => { tipoAtivo.current = tipo; }, [tipo]);
  const [focarAoAbrir, setFocarAoAbrir] = useState(true);
  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  const editandoId = p.id;
  const tipoDaOrigem = (p.origem as OrigemDaConversao['tipo'] | undefined) ?? ORIGEM_DO_TIPO[tipoOriginal];
  // Lançamento PAGO virando financiamento: o banco o adota como um pagamento (o corpo avisa).
  const transacao = useTransaction(editandoId && tipoDaOrigem === 'transacao' ? editandoId : undefined);
  // `passado` na rota é palpite: logo depois do "Paguei" a linha da lista ainda pode dizer 0, e
  // "Converter" (sem confirmação) vira `todas`, que apaga os pagamentos. A dívida carregada decide.
  const dividas = useDebts();
  const divida = editandoId && tipoDaOrigem === 'divida' ? dividas.data?.find((d) => d.id === editandoId) : undefined;
  // A entrada já é um pagamento histórico, mesmo antes da primeira prestação.
  const parentId = tipoDaOrigem === 'divida' || tipoDaOrigem === 'plano' ? editandoId
    : tipoDaOrigem === 'transacao' ? transacao.data?.installment_plan_id ?? undefined : undefined;
  const planoId = tipoDaOrigem === 'divida' ? undefined : parentId;
  const plano = useInstallmentPlan(planoId);
  const entrada = usePurchaseDownPayment(tipoDaOrigem === 'divida' ? 'financiamento' : 'parcelada', parentId);
  const consultasDaOrigem = editandoId ? [
    ...(tipoDaOrigem === 'transacao' ? [transacao] : []),
    ...(tipoDaOrigem === 'divida' ? [dividas] : []),
    ...(planoId ? [plano] : []),
    ...(parentId ? [entrada] : []),
  ] : [];
  const conferindoHistorico = consultasDaOrigem.some((q) => q.isPending);
  const origem: OrigemDaConversao | null = editandoId
    ? {
        tipo: tipoDaOrigem,
        id: editandoId,
        // Quem abriu sem dizer o papel (link antigo, a Projeção): o do próprio registro, quando chega.
        papel: (p.papel as OrigemDaConversao['papel'] | undefined)
          ?? (tipoDaOrigem !== 'transacao' ? 'registro' : transacao.data ? papelDaTransacao(transacao.data) : 'avulsa'),
        temPassado: temPassadoDoParam(p.passado) || (divida?.installments_paid ?? 0) > 0
          || (plano.data?.locked ?? 0) > 0 || Boolean(entrada.data),
      }
    : null;
  // O "Aplicar" do "E se…?" vale para o primeiro corpo; o "criar outro" começa limpo.
  const doAplicar = geracao === 0;

  const trocar = (novo: TipoDeLancamento) => {
    if (!montado.current || novo === tipo) return;
    const atual = lerComum.current();
    const guardado = lerEstado.current();
    setEstados((e) => ({ ...e, [tipo]: guardado }));
    setComum(novo === 'recorrente' ? comumParaSerie(atual) : atual);
    setFocarAoAbrir(false);
    setTipo(novo);
  };

  const onSalvo = (criarOutro: boolean) => {
    if (!criarOutro) return router.back();
    setComum(comumDepoisDeSalvar(lerComum.current()));
    setEstados({});
    setFocarAoAbrir(true);
    setGeracao((g) => g + 1);
  };

  const converterPara = (destino: RegistroSimulado) => {
    if (!origem || convertendo.current || converter.isPending) return;
    if (consultasDaOrigem.some((q) => !q.isSuccess)) {
      const falhas = consultasDaOrigem.filter((q) => q.isError);
      if (falhas.length) {
        toast({ message: 'Não deu para conferir o histórico. Tente salvar novamente após a consulta.', tone: 'error' });
        falhas.forEach((q) => { void q.refetch(); });
      }
      return;
    }
    const acoes = opcoesDaConversao(origem).map((o) => ({
      label: o.label,
      destructive: o.destrutiva,
      onPress: () => {
        const ir = () => {
          if (convertendo.current) return;
          convertendo.current = true;
          return converter.mutateAsync({ origem, alcance: o.alcance, destino }).then(
            (resultado) => {
              // A conversão pode apagar a ocorrência, a série ou a ficha aberta por baixo.
              // Voltar (ou só substituir o modal) deixaria esse detalhe morto na pilha.
              router.dismissAll();
              router.push(hrefDoResultadoDaConversao(destino, resultado));
            },
            // A recusa do banco diz o motivo e o caminho; a tela fica aberta com o que foi digitado.
            (e) => {
              convertendo.current = false;
              toast({ message: financeErrorMessage(e, 'Não deu para mudar o tipo.'), tone: 'error' });
            },
          );
        };
        if (o.destrutiva) confirmDestructive('Apagar o que já aconteceu?', 'Apagar e converter', ir, 'Os lançamentos já pagos, incluindo a entrada, também saem. Isso não volta.');
        else void ir();
      },
    }));
    showItemActions(`Mudar para ${TIPOS_DE_LANCAMENTO.find((t) => t.value === tipo)!.label}`, acoes);
  };

  /** Editando: só no tipo do registro. Em outro tipo, o corpo cria — e o salvar converte. */
  const editandoAqui = tipo === tipoOriginal ? editandoId : undefined;
  const base = {
    topo: <FormatoDoLancamento value={tipo} onChange={trocar}
      disabled={Boolean(transacao.data?.down_payment_debt_id || transacao.data?.down_payment_plan_id)} />,
    comum,
    registrarComum: (ler: () => Comum) => {
      if (tipoAtivo.current === tipo) lerComum.current = ler;
    },
    registrarEstado: (ler: () => unknown) => {
      if (tipoAtivo.current === tipo) lerEstado.current = ler;
    },
    estadoGuardado: estados[tipo],
    onSalvo,
    onFechar: () => router.back(),
    deHipotese: doAplicar ? p.deHipotese : undefined,
    editandoId: editandoAqui,
    converter: editandoId && tipo !== tipoOriginal ? converterPara : undefined,
    salvando: converter.isPending || (tipo !== tipoOriginal && conferindoHistorico),
    focarAoAbrir,
  };

  return (
    // `Screen` sem rolagem: o fundo e as laterais seguras no contêiner da pilha, para os três corpos.
    <Screen scroll={false}>
      <FormularioEmTela.Provider value>
        <TrocaSuave estado={`${tipo}:${geracao}`} preencher>
        {tipo === 'uma' && editandoAqui ? (
          <LancamentoEditando key={`uma:${geracao}`} {...base} editandoId={editandoAqui} />
        ) : tipo === 'uma' ? (
          <FormularioDoLancamento
            key={`uma:${geracao}`}
            {...base}
            parcelas={doAplicar && p.parcelas ? Math.max(1, Number(p.parcelas) || 1) : undefined}
          />
        ) : tipo === 'recorrente' ? (
          <FormularioDaSerie
            key={`rec:${geracao}`}
            {...base}
            preset={doAplicar && (p.repete === 'weekly' || p.repete === 'yearly') ? p.repete : undefined}
          />
        ) : (
          <FormularioDaDivida
            key={`fin:${geracao}`}
            {...base}
            pagamentoConvertido={transacao.data?.status === 'cleared'}
            dadosDoAplicar={doAplicar && p.deHipotese ? { parcela: p.parcela, parcelas: p.parcelas, conta: p.conta, data: p.data } : undefined}
          />
        )}
        </TrocaSuave>
      </FormularioEmTela.Provider>
      {/* O corpo do lançamento já traz o dele; os outros dois nasceram para uma folha. */}
      {tipo !== 'uma' ? <ToastDoModal /> : null}
    </Screen>
  );
}
