import { Stack } from 'expo-router';
import { useState } from 'react';

import { LinhaDaCaptura, pendentesDaCaptura, useAcoesDaCaptura } from '@/components/feed/capturas-da-hoje';
import { EmptyState } from '@/components/ui/empty-state';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { PASSO } from '@/lib/aos-poucos';
import { VerMais } from '@/components/ui/ver-mais';
import { useCapturas } from '@/hooks/use-capturas';

/** "A confirmar": tudo o que veio das notificações dos bancos, e o que parece já estar no app. */
export default function CapturasScreen() {
  const [limite, setLimite] = useState(PASSO);
  const capturas = useCapturas(limite);
  const acoesDa = useAcoesDaCaptura();
  const pendentes = pendentesDaCaptura(capturas.data);
  const duplicadas = (capturas.data ?? []).filter((c) => c.status === 'duplicate');
  const restantes = Math.max(0, (capturas.total ?? 0) - (capturas.data?.length ?? 0));

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
          {pendentes.map((c) => <LinhaDaCaptura key={c.id} captura={c} acoes={acoesDa(c)} />)}
        </Section>
      ) : null}
      {duplicadas.length ? (
        <Section title="Parecem já lançados">
          {duplicadas.map((c) => <LinhaDaCaptura key={c.id} captura={c} acoes={acoesDa(c)} />)}
        </Section>
      ) : null}
      {restantes ? <VerMais restantes={restantes} carregando={capturas.isFetching} onPress={() => setLimite((l) => l + PASSO)} /> : null}
      {capturas.isSuccess && !capturas.data?.length ? (
        <EmptyState
          icon="checkmark.circle"
          title="Nada a confirmar"
          hint="As compras dos bancos que você marcou aparecem aqui"
        />
      ) : null}
    </Screen>
  );
}
