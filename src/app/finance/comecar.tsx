import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { TrocaSuave } from '@/components/motion/presenca';
import { FormularioDeConta } from '@/components/finance/formulario-de-conta';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { VerMais } from '@/components/ui/ver-mais';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskHeader } from '@/components/ui/task-header';
import { ToastDoModal } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useAccounts, useDefaultWorkspaceId, type Account } from '@/hooks/use-finance';
import { useAosPoucos } from '@/hooks/use-aos-poucos';
import { usePreferencia } from '@/hooks/use-preferencia';
import { ACCOUNT_TYPES } from '@/lib/accounts';
import { lerSalvo, passoEfetivo, type PassoDoComecar, type Salvo } from '@/lib/comecar';
import { hrefDoLancar } from '@/lib/lancar';

/**
 * Começar as finanças — conta, cartão e primeiro lançamento, tudo puláveis.
 *
 * Os campos são os de `AccountFormFields` e a escrita é `useCreateAccount` (recibo idempotente):
 * nenhum segundo formulário. O saldo de hoje vai em `initial_balance_cents`, sem lançamento de
 * abertura. O passo vem do dado real (`passoEfetivo`); o aparelho só guarda o que foi criado.
 */
const ehTexto = (v: string | number): v is string => typeof v === 'string';
const TOTAL = 4;
function Resumo({ itens, titulo }: { itens: readonly Account[]; titulo: string }) {
  const { visiveis, restantes, verMais } = useAosPoucos(itens);
  return (
    <Section title={titulo}>
      {visiveis.map((c) => (
        <Row
          key={c.id}
          title={c.name}
          icon={ACCOUNT_TYPES.find((t) => t.value === c.type)?.icon}
          subtitle={c.type === 'credit_card'
            ? `${ACCOUNT_TYPES.find((t) => t.value === c.type)?.label} · fecha dia ${c.closing_day} · vence dia ${c.due_day}`
            : ACCOUNT_TYPES.find((t) => t.value === c.type)?.label}
          trailing={c.type === 'credit_card' ? undefined : <Money cents={c.initial_balance_cents} />}
        />
      ))}
      <VerMais restantes={restantes} onPress={verMais} />
    </Section>
  );
}

export default function ComecarScreen() {
  const workspace = useDefaultWorkspaceId();
  const contas = useAccounts();
  const [bruto, setBruto] = usePreferencia(`comecar:${workspace.data ?? 'pendente'}`, '', ehTexto);
  const [outra, setOutra] = useState(false);
  // Entre o Salvar e o progresso gravado, as contas recarregam com a nova e o passo calculado
  // passaria pelo resumo (ou de volta ao 1): o passo da tela fica parado até o `onCriada`.
  const [salvandoEm, setSalvandoEm] = useState<PassoDoComecar | null>(null);

  const fechar = () => (router.canGoBack() ? router.back() : router.replace('/finance'));
  const pronto = workspace.data !== undefined && contas.data !== undefined;

  if (!pronto) {
    return (
      <Screen>
        <TaskHeader title="Começar as finanças" onClose={fechar} />
        {workspace.isError || contas.isError ? (
          <View style={styles.bloco}>
            <ThemedText type="small" themeColor="textSecondary">Não deu para carregar. Tente de novo.</ThemedText>
            <Button label="Tentar de novo" variant="secondary" onPress={() => { workspace.refetch(); contas.refetch(); }} />
          </View>
        ) : (
          <Skeleton height={160} />
        )}
      </Screen>
    );
  }

  const todas = contas.data ?? [];
  const ef = passoEfetivo(lerSalvo(bruto), todas);
  const passo: PassoDoComecar = salvandoEm ?? (outra ? 1 : ef.passo);
  const gravar = (n: Partial<Salvo> & { passo: PassoDoComecar }) =>
    setBruto(JSON.stringify({ contaIds: ef.contaIds, ...(ef.cartaoId ? { cartaoId: ef.cartaoId } : {}), ...n }));
  const ir = (n: PassoDoComecar) => gravar({ passo: n });
  const doEspaco = (ids: readonly string[]) => todas.filter((c) => ids.includes(c.id));
  const lancar = () => router.push(hrefDoLancar('uma', ef.contaIds[0] ? { conta: ef.contaIds[0] } : {}));
  const criadas = doEspaco([...ef.contaIds, ...(ef.cartaoId ? [ef.cartaoId] : [])]);
  const paginas = (
    passo === 1 ? (
      <FormularioDeConta
        key={outra ? 'outra' : 'conta'}
        tipo="checking"
        contas={todas}
        payerId={null}
        rotuloPular={ef.contaIds.length ? 'Voltar' : 'Agora não'}
        onSalvando={(sim) => setSalvandoEm(sim ? 1 : null)}
        onPular={() => (ef.contaIds.length ? setOutra(false) : fechar())}
        onCriada={(id) => {
          setOutra(false);
          gravar({ passo: ef.passo === 1 ? 2 : ef.passo, contaIds: [...ef.contaIds, id] });
        }}
      />
    ) : passo === 2 ? (
      <View style={styles.bloco}>
        <FormularioDeConta
          key="cartao"
          tipo="credit_card"
          contas={todas}
          payerId={ef.contaIds[0] ?? null}
          rotuloPular="Pular"
          onSalvando={(sim) => setSalvandoEm(sim ? 2 : null)}
          onPular={() => ir(3)}
          onCriada={(id) => gravar({ passo: 3, cartaoId: id })}
        />
        <Button label="Adicionar outra conta" variant="secondary" onPress={() => setOutra(true)} />
      </View>
    ) : passo === 3 ? (
      <View style={styles.bloco}>
        <ThemedText type="small" themeColor="textSecondary">Quer lançar o primeiro gasto ou entrada?</ThemedText>
        <Button
          label="Lançar agora"
          onPress={() => {
            ir(4);
            lancar();
          }}
        />
        <Button label="Pular" variant="secondary" onPress={() => ir(4)} />
      </View>
    ) : (
      <View style={styles.bloco}>
        <Resumo itens={ef.jaTinhaContas ? todas : criadas} titulo={ef.jaTinhaContas ? 'Suas contas' : 'Criado'} />
        <Button label="Abrir Finanças" onPress={() => router.replace('/finance')} />
        {!ef.cartaoId && !todas.some((c) => c.type === 'credit_card') ? (
          <Button label="Adicionar cartão" variant="secondary" onPress={() => gravar({ passo: 2, contaIds: ef.contaIds })} />
        ) : null}
        <Button label="Lançar" variant="secondary" onPress={lancar} />
      </View>
    )
  );

  return (
    <Screen>
      <TaskHeader title="Começar as finanças" onClose={fechar} />
      <ThemedText type="footnote" themeColor="textSecondary" accessibilityLabel={`Passo ${passo} de ${TOTAL}`}>
        {`Passo ${passo} de ${TOTAL}`}
      </ThemedText>
      <TrocaSuave estado={`${passo}${outra ? 'o' : ''}`}>{paginas}</TrocaSuave>
      <ToastDoModal />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bloco: { gap: Space.lg },
});
