import { Stack } from 'expo-router';

import { LinhaDaCaptura, pendentesDaCaptura, useAcoesDaCaptura } from '@/components/feed/capturas-da-hoje';
import { EmptyState } from '@/components/ui/empty-state';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { VerMais } from '@/components/ui/ver-mais';
import { useAosPoucos } from '@/hooks/use-aos-poucos';
import { useCapturas } from '@/hooks/use-capturas';

/** "A confirmar": tudo o que veio das notificações dos bancos, e o que parece já estar no app. */
export default function CapturasScreen() {
  const capturas = useCapturas();
  const acoesDa = useAcoesDaCaptura();
  const pendentes = pendentesDaCaptura(capturas.data);
  const duplicadas = (capturas.data ?? []).filter((c) => c.status === 'duplicate');
  const aPendentes = useAosPoucos(pendentes);
  const aDuplicadas = useAosPoucos(duplicadas);

  return (
    <Screen grouped onRefresh={() => capturas.refetch()}>
      <Stack.Screen options={{ title: 'A confirmar' }} />
      {capturas.isPending ? (
        <Section>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </Section>
      ) : null}
      {capturas.isError ? (
        <Section>
          <Row
            title="Não deu para carregar o que está a confirmar"
            subtitle="Toque para tentar de novo"
            icon="exclamationmark.triangle"
            onPress={() => capturas.refetch()}
          />
        </Section>
      ) : null}
      {pendentes.length ? (
        <Section title="A confirmar">
          {aPendentes.visiveis.map((c) => <LinhaDaCaptura key={c.id} captura={c} acoes={acoesDa(c)} />)}
        </Section>
      ) : null}
      {aPendentes.restantes ? <VerMais restantes={aPendentes.restantes} onPress={aPendentes.verMais} /> : null}
      {duplicadas.length ? (
        <Section title="Parecem já lançados">
          {aDuplicadas.visiveis.map((c) => <LinhaDaCaptura key={c.id} captura={c} acoes={acoesDa(c)} />)}
        </Section>
      ) : null}
      {aDuplicadas.restantes ? <VerMais restantes={aDuplicadas.restantes} onPress={aDuplicadas.verMais} /> : null}
      {capturas.isSuccess && !capturas.data.length ? (
        <EmptyState
          icon="checkmark.circle"
          title="Nada a confirmar"
          hint="As compras dos bancos que você marcou aparecem aqui"
        />
      ) : null}
    </Screen>
  );
}
