import { useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { FormularioDaDivida } from '@/components/finance/formulario-da-divida';
import { FormularioDaSerie } from '@/components/finance/formulario-da-serie';
import { FormularioDoLancamento, LancamentoEditando } from '@/components/finance/formulario-do-lancamento';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { FormularioEmTela } from '@/components/ui/sheet';
import { ToastDoModal, useToast } from '@/components/ui/toast';
import { Motion } from '@/design/tokens';
import { useConverterRegistro, useDebts, useTransaction } from '@/hooks/use-finance';
import { isoToBR, localISODate } from '@/lib/dates';
import { financeErrorMessage } from '@/lib/finance-form';
import type { RegistroSimulado } from '@/lib/hipotese';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import {
  comumDepoisDeSalvar,
  comumParaSerie,
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
  const reduzir = useReducedMotion();
  const opacidade = useSharedValue(1);
  const estilo = useAnimatedStyle(() => ({ opacity: opacidade.get() }));

  const editandoId = p.id;
  const tipoDaOrigem = (p.origem as OrigemDaConversao['tipo'] | undefined) ?? ORIGEM_DO_TIPO[tipoOriginal];
  // Lançamento PAGO virando financiamento: o banco o adota como um pagamento (o corpo avisa).
  const transacao = useTransaction(editandoId && tipoDaOrigem === 'transacao' ? editandoId : undefined);
  // `passado` na rota é palpite: logo depois do "Paguei" a linha da lista ainda pode dizer 0, e
  // "Converter" (sem confirmação) vira `todas`, que apaga os pagamentos. A dívida carregada decide.
  const dividas = useDebts();
  const divida = editandoId && tipoDaOrigem === 'divida' ? dividas.data?.find((d) => d.id === editandoId) : undefined;
  const origem: OrigemDaConversao | null = editandoId
    ? {
        tipo: tipoDaOrigem,
        id: editandoId,
        // Quem abriu sem dizer o papel (link antigo, a Projeção): o do próprio registro, quando chega.
        papel: (p.papel as OrigemDaConversao['papel'] | undefined)
          ?? (tipoDaOrigem !== 'transacao' ? 'registro' : transacao.data ? papelDaTransacao(transacao.data) : 'avulsa'),
        temPassado: temPassadoDoParam(p.passado) || (divida?.installments_paid ?? 0) > 0,
      }
    : null;
  // O "Aplicar" do "E se…?" vale para o primeiro corpo; o "criar outro" começa limpo.
  const doAplicar = geracao === 0;

  const trocar = (novo: TipoDeLancamento) => {
    if (novo === tipo) return;
    const atual = lerComum.current();
    const guardado = lerEstado.current();
    const aplicar = () => {
      setEstados((e) => ({ ...e, [tipo]: guardado }));
      setComum(novo === 'recorrente' ? comumParaSerie(atual) : atual);
      setTipo(novo);
    };
    if (reduzir) return aplicar();
    // Crossfade curto só no conteúdo abaixo do seletor: some, troca, volta. Cabeçalho e seletor
    // ficam. Só opacidade — animação de LAYOUT não existe no Android (design.md §5).
    // Outro toque durante a saída cancela esta: a cancelada não troca nada, quem troca é a última.
    opacidade.set(withTiming(0, { duration: Motion.duration.fast }, (terminou) => {
      if (!terminou) return;
      runOnJS(aplicar)();
      opacidade.set(withTiming(1, { duration: Motion.duration.base }));
    }));
  };

  const onSalvo = (criarOutro: boolean) => {
    if (!criarOutro) return router.back();
    setComum(comumDepoisDeSalvar(lerComum.current()));
    setEstados({});
    setGeracao((g) => g + 1);
  };

  const converterPara = (destino: RegistroSimulado) => {
    if (!origem || convertendo.current || converter.isPending) return;
    const acoes = opcoesDaConversao(origem).map((o) => ({
      label: o.label,
      destructive: o.destrutiva,
      onPress: () => {
        const ir = () => {
          if (convertendo.current) return;
          convertendo.current = true;
          return converter.mutateAsync({ origem, alcance: o.alcance, destino }).then(
            () => router.back(),
            // A recusa do banco diz o motivo e o caminho; a tela fica aberta com o que foi digitado.
            (e) => {
              convertendo.current = false;
              toast({ message: financeErrorMessage(e, 'Não deu para mudar o tipo.'), tone: 'error' });
            },
          );
        };
        if (o.destrutiva) confirmDestructive('Apagar o que já aconteceu?', 'Apagar e converter', ir, 'Os lançamentos já pagos também saem. Isso não volta.');
        else void ir();
      },
    }));
    showItemActions(`Mudar para ${TIPOS_DE_LANCAMENTO.find((t) => t.value === tipo)!.label}`, acoes);
  };

  /** Editando: só no tipo do registro. Em outro tipo, o corpo cria — e o salvar converte. */
  const editandoAqui = tipo === tipoOriginal ? editandoId : undefined;
  const base = {
    topo: <Segmented<TipoDeLancamento> options={TIPOS_DE_LANCAMENTO} value={tipo} onChange={trocar} />,
    comum,
    registrarComum: (ler: () => Comum) => {
      lerComum.current = ler;
    },
    registrarEstado: (ler: () => unknown) => {
      lerEstado.current = ler;
    },
    estadoGuardado: estados[tipo],
    onSalvo,
    onFechar: () => router.back(),
    deHipotese: doAplicar ? p.deHipotese : undefined,
    editandoId: editandoAqui,
    converter: editandoId && tipo !== tipoOriginal ? converterPara : undefined,
    salvando: converter.isPending,
    estiloDoConteudo: estilo,
  };

  return (
    // `Screen` sem rolagem: o fundo e as laterais seguras no contêiner da pilha, para os três corpos.
    <Screen scroll={false}>
      <FormularioEmTela.Provider value>
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
      </FormularioEmTela.Provider>
      {/* O corpo do lançamento já traz o dele; os outros dois nasceram para uma folha. */}
      {tipo !== 'uma' ? <ToastDoModal /> : null}
    </Screen>
  );
}
