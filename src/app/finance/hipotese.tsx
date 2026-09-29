import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ErrorCard } from '@/components/error-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useBRL } from '@/components/ui/conceal';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Note } from '@/components/ui/note';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { SkeletonList } from '@/components/ui/skeleton';
import { VerMais } from '@/components/ui/ver-mais';
import { Space, tabular } from '@/design/tokens';
import { useAccounts, useHorizonteReal, useSimulacao } from '@/hooks/use-finance';
import { useAosPoucos } from '@/hooks/use-aos-poucos';
import { useRascunho } from '@/hooks/use-rascunho';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { isoToBR, localISODate, somaDias } from '@/lib/dates';
import { resumoDaHipotese } from '@/lib/hipotese';
import { fraseDoLimite, fraseDoNegativo, ondeMuda } from '@/lib/onde-muda';

/**
 * O detalhe de UMA conta ou cartão com as hipóteses do "E se…?" (spec 2026-09-29, §5): antes →
 * depois, o aviso (fica negativa, passa do limite, sem limite) e as hipóteses que caem nela.
 *
 * Chega pela linha do "Onde muda" com a janela da Projeção (`dias`): a hipótese pode ter esticado
 * o horizonte só naquela visita, e o detalhe tem que mostrar a MESMA janela da linha tocada. A
 * leitura é a mesma do "Onde muda" (`useSimulacao` com o detalhe por conta, `useHorizonteReal`),
 * então a chave do cache é a mesma e a tela abre sem ir ao banco de novo.
 */
export default function HipoteseScreen() {
  const brl = useBRL();
  const params = useLocalSearchParams<{ conta?: string; dias?: string }>();
  const dias = Number(params.dias) >= 1 && Number(params.dias) <= 3650 ? Math.round(Number(params.dias)) : 90;
  const { rascunho } = useRascunho();
  const temRascunho = rascunho.hipoteses.length > 0 || rascunho.adiantamentos.length > 0;
  const accounts = useAccounts();
  const simulacao = useSimulacao({
    dias, modo: 'dia', view: undefined, hipoteses: rascunho.hipoteses, adiantamentos: rascunho.adiantamentos,
    porConta: true, enabled: temRascunho,
  });
  const horizonte = useHorizonteReal(dias, temRascunho);
  const pronta = useTelaPronta(accounts, simulacao, horizonte.contas, horizonte.cartoes);
  const mudanca = ondeMuda(
    { contas: horizonte.contas.data ?? [], cartoes: horizonte.cartoes.data ?? [] },
    { contas: simulacao.data?.contas ?? [], cartoes: simulacao.data?.cartoes ?? [] },
  ).find((m) => m.account_id === params.conta);
  // Uma compra em 72× muda 72 faturas: 20 por vez (frontend.md, "aos poucos").
  const faturas = useAosPoucos(mudanca?.tipo === 'cartao' ? mudanca.faturas : [], params.conta ?? '');

  const conta = accounts.data?.find((a) => a.id === params.conta);
  const cabecalho = <Stack.Screen options={{ title: conta?.name ?? 'Detalhe da hipótese' }} />;
  const recarregar = () =>
    Promise.all([accounts.refetch(), simulacao.refetch(), horizonte.contas.refetch(), horizonte.cartoes.refetch()]);

  if (!pronta) {
    return (
      <Screen grouped>
        {cabecalho}
        <SkeletonList linhas={3} />
      </Screen>
    );
  }

  // A leitura que falha DENTRO do `simular` volta em `erros` (a RPC responde 200).
  const leituraFalhou = (simulacao.data?.erros ?? []).some((e) => e.leitura === 'contas' || e.leitura === 'cartoes');
  if (accounts.isError || simulacao.isError || horizonte.contas.isError || horizonte.cartoes.isError || leituraFalhou) {
    return (
      <Screen grouped onRefresh={recarregar}>
        {cabecalho}
        <ErrorCard onRetry={() => void recarregar()} />
      </Screen>
    );
  }

  const id = params.conta ?? '';
  const ehCartao = conta?.type === 'credit_card';
  const contaAntes = horizonte.contas.data?.find((c) => c.account_id === id) ?? null;
  const contaDepois = simulacao.data?.contas?.find((c) => c.account_id === id) ?? null;
  const cartaoAntes = horizonte.cartoes.data?.find((c) => c.account_id === id) ?? null;
  const cartaoDepois = simulacao.data?.cartoes?.find((c) => c.account_id === id) ?? null;
  const daConta = rascunho.hipoteses.filter((h) => h.conta === id);

  if (!conta || !temRascunho || (ehCartao ? !cartaoDepois : !contaDepois)) {
    return (
      <Screen grouped onRefresh={recarregar}>
        {cabecalho}
        <EmptyState
          compacto
          icon="questionmark.folder"
          title={!conta ? 'Esta conta não existe mais' : 'Nada para mostrar aqui'}
          hint={!conta ? 'Ela pode ter sido apagada ou arquivada.' : 'O rascunho não tem hipótese nesta conta.'}
        />
      </Screen>
    );
  }

  const fim = isoToBR(somaDias(localISODate(), dias));

  return (
    <Screen grouped onRefresh={recarregar}>
      {cabecalho}

      {!ehCartao && contaDepois ? (
        <>
          <Card style={styles.pares}>
            <HeroLabel>Com as hipóteses</HeroLabel>
            <AntesDepois rotulo="Hoje" antes={contaAntes?.saldo_hoje ?? 0} depois={contaDepois.saldo_hoje} />
            <AntesDepois
              rotulo={`Menor saldo · ${isoToBR(contaDepois.dia_do_menor)}`}
              antes={contaAntes?.menor ?? 0}
              depois={contaDepois.menor}
            />
            <AntesDepois rotulo={`No fim · ${fim}`} antes={contaAntes?.saldo_fim ?? 0} depois={contaDepois.saldo_fim} />
          </Card>
          {mudanca?.tipo === 'conta' && fraseDoNegativo(mudanca, isoToBR) ? (
            <Note icon="exclamationmark.triangle.fill" tone={mudanca.ficaNegativaEm ? 'danger' : 'warning'}>
              {fraseDoNegativo(mudanca, isoToBR)}
            </Note>
          ) : null}
        </>
      ) : null}

      {ehCartao && cartaoDepois ? (
        <>
          {cartaoDepois.limite === null ? (
            // Sem limite, "passa do limite" não existe: diz e leva ao cadastro do cartão.
            <Card style={styles.pares}>
              <HeroLabel>Limite</HeroLabel>
              <ThemedText type="headline">Sem limite cadastrado</ThemedText>
              <Button
                label="Cadastrar o limite"
                variant="secondary"
                size="sm"
                onPress={() => router.push({ pathname: '/finance/accounts', params: { edit: id } })}
              />
            </Card>
          ) : (
            <Card style={styles.pares}>
              <HeroLabel>Com as hipóteses</HeroLabel>
              <AntesDepois rotulo="Limite livre" antes={cartaoAntes?.livre ?? 0} depois={cartaoDepois.livre ?? 0} />
            </Card>
          )}
          {mudanca?.tipo === 'cartao' && mudanca.passaDoLimiteEm !== null ? (
            <Note icon="exclamationmark.triangle.fill" tone="danger">
              {fraseDoLimite(mudanca, brl)}
            </Note>
          ) : null}
          {faturas.visiveis.length > 0 ? (
            <Section title="Faturas">
              {faturas.visiveis.map((f) => (
                <Row
                  key={f.vencimento}
                  title={`Vence ${isoToBR(f.vencimento)}`}
                  subtitle={`${brl(f.antes)} → ${brl(f.depois)}`}
                />
              ))}
            </Section>
          ) : null}
          <VerMais restantes={faturas.restantes} onPress={faturas.verMais} />
        </>
      ) : null}

      {daConta.length > 0 ? (
        <Section title={ehCartao ? 'Hipóteses neste cartão' : 'Hipóteses nesta conta'}>
          {daConta.map((h) => (
            <Row key={h.id} title={resumoDaHipotese(h, brl, (x) => (x === id ? conta.name : null))} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

/**
 * Um número antes → depois. Uma FRASE com o `Money` aninhado (design.md §3): com fonte grande ela
 * quebra entre palavras, sem encolher o dinheiro nem desalinhar a linha de base.
 */
function AntesDepois({ rotulo, antes, depois }: { rotulo: string; antes: number; depois: number }) {
  return (
    <View style={styles.par}>
      <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
        {rotulo}
      </ThemedText>
      <ThemedText type="default" style={tabular}>
        <Money cents={antes} variant="body" tone="textSecondary" />
        {' → '}
        <Money cents={depois} variant="body" tone={depois < 0 ? 'danger' : 'text'} />
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pares: { gap: Space.md },
  par: { gap: Space.xs },
});
