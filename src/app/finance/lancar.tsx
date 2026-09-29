import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { FormularioDaDivida } from '@/components/finance/formulario-da-divida';
import { FormularioDaSerie } from '@/components/finance/formulario-da-serie';
import { FormularioDoLancamento, LancamentoEditando } from '@/components/finance/formulario-do-lancamento';
import { Segmented } from '@/components/ui/segmented';
import { ToastDoModal, useToast } from '@/components/ui/toast';
import { Motion } from '@/design/tokens';
import { useConverterRegistro, useTransaction } from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';
import { isoToBR, localISODate } from '@/lib/dates';
import { financeErrorMessage } from '@/lib/finance-form';
import type { RegistroSimulado } from '@/lib/hipotese';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import {
  comumDepoisDeSalvar,
  comumParaSerie,
  opcoesDaConversao,
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
  const theme = useTheme();
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
  const reduzir = useReducedMotion();
  const opacidade = useSharedValue(1);
  const estilo = useAnimatedStyle(() => ({ opacity: opacidade.get() }));

  const editandoId = p.id;
  const tipoDaOrigem = (p.origem as OrigemDaConversao['tipo'] | undefined) ?? ORIGEM_DO_TIPO[tipoOriginal];
  const origem: OrigemDaConversao | null = editandoId
    ? {
        tipo: tipoDaOrigem,
        id: editandoId,
        papel: (p.papel as OrigemDaConversao['papel'] | undefined) ?? (tipoDaOrigem === 'transacao' ? 'avulsa' : 'registro'),
        temPassado: temPassadoDoParam(p.passado),
      }
    : null;
  // Lançamento PAGO virando financiamento: o banco o adota como um pagamento (o corpo avisa).
  const transacao = useTransaction(origem?.tipo === 'transacao' ? editandoId : undefined);
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
    // Crossfade curto: some o corpo, troca, volta. Só opacidade — animação de LAYOUT não existe no
    // Android (design.md §5).
    opacidade.set(withTiming(0, { duration: Motion.duration.fast }, () => {
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
    if (!origem) return;
    const acoes = opcoesDaConversao(origem).map((o) => ({
      label: o.label,
      destructive: o.destrutiva,
      onPress: () => {
        const ir = () =>
          converter.mutateAsync({ origem, alcance: o.alcance, destino }).then(
            () => router.back(),
            // A recusa do banco diz o motivo e o caminho; a tela fica aberta com o que foi digitado.
            (e) => toast({ message: financeErrorMessage(e, 'Não deu para mudar o tipo.'), tone: 'error' }),
          );
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
  };

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      <Animated.View style={[styles.fill, estilo]}>
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
      </Animated.View>
      {/* O corpo do lançamento já traz o dele; os outros dois nasceram para uma folha. */}
      {tipo !== 'uma' ? <ToastDoModal /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
