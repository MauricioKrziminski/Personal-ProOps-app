import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { monthLabel } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, TextField } from '@/components/ui/field';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Space, Type, tabular } from '@/design/tokens';
import {
  useInviteMember,
  useInvites,
  usePlanStatus,
  useRevokeInvite,
  useWorkspaceMembers,
} from '@/hooks/use-finance';
import { useSession } from '@/hooks/use-session';
import { confirmDestructive } from '@/lib/item-actions';

/**
 * Pessoas — "quem enxerga o meu financeiro?".
 *
 * Três restrições do banco desenham esta tela, e nenhuma é contornável em TS:
 *
 * - **Ninguém lê o perfil do outro** (`profiles` é `own row`), então o telefone das outras
 *   pessoas não aparece aqui. A tela diz isso em vez de inventar nome ou apelido.
 * - **A pessoa é o telefone**: `profiles` não tem nome nem avatar.
 * - **`role` não é aplicado por policy nenhuma**: um `viewer` escreve igual a um membro. Por isso
 *   o papel aparece só como informação e o convite é sempre `member` — prometer "somente
 *   leitura" seria uma promessa que o banco não cumpre.
 */

/** 5551999998888 -> (51) 99999-8888. Cópia da de `plan.tsx` (a de lá não é exportada). */
function telefoneBR(digitos: string): string {
  const d = digitos.replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return digitos;
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  const meio = resto.length === 9 ? resto.slice(0, 5) : resto.slice(0, 4);
  return `(${ddd}) ${meio}-${resto.slice(meio.length)}`;
}

const PAPEL: Record<string, string> = {
  owner: 'dono',
  member: 'membro',
  viewer: 'membro',
};

export default function MembersScreen() {
  const { session } = useSession();
  const toast = useToast();
  const membros = useWorkspaceMembers();
  const convites = useInvites();
  const plano = usePlanStatus();
  const convidar = useInviteMember();
  const revogar = useRevokeInvite();

  const [telefone, setTelefone] = useState('');

  const meuId = session?.user?.id;
  const meuTelefone = session?.user?.phone ?? '';
  const lista = membros.data ?? [];
  const eDono = lista.some((m) => m.user_id === meuId && m.role === 'owner');
  const pendentes = (convites.data ?? []).filter((c) => c.status === 'pending');

  // Convite pendente CONTA no limite: sem isso dá para enfileirar convite além do plano e o
  // aceite simplesmente pula, sem avisar ninguém dos dois lados.
  const ocupadas = (plano.data?.members ?? lista.length) + pendentes.length;
  const teto = plano.data?.max_members ?? 0;
  const noLimite = teto > 0 && ocupadas >= teto;
  const telefoneValido = telefone.replace(/\D/g, '').length >= 10;

  const enviarConvite = () =>
    convidar.mutate(
      { phone: telefone, role: 'member' },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setTelefone('');
          toast({ message: 'Convite enviado.', tone: 'success' });
        },
        onError: (erro) =>
          toast({
            message:
              erro instanceof Error && erro.message.includes('duplicate')
                ? 'Esse número já foi convidado.'
                : 'Não deu para convidar agora.',
            tone: 'error',
          }),
      },
    );

  return (
    <Screen
      grouped
      onRefresh={() => {
        membros.refetch();
        convites.refetch();
        plano.refetch();
      }}
      refreshing={membros.isRefetching}>
      <Stack.Screen options={{ title: 'Pessoas', headerLargeTitle: true }} />

      {membros.isLoading ? (
        <Section title="Quem está aqui">
          <SkeletonRow />
          <SkeletonRow />
        </Section>
      ) : null}

      {membros.isError ? (
        <Section title="Quem está aqui">
          <Row
            title="Não deu para carregar quem tem acesso"
            subtitle="Toque para tentar de novo"
            icon="exclamationmark.triangle"
            onPress={() => membros.refetch()}
          />
        </Section>
      ) : null}

      {lista.length > 0 ? (
        <Section title="Quem está aqui">
          {lista.map((membro, index) => {
            const sou = membro.user_id === meuId;
            const papel = PAPEL[membro.role] ?? 'membro';
            const desde = `desde ${monthLabel(membro.created_at.slice(0, 7))}`;
            const titulo = sou
              ? `${meuTelefone ? telefoneBR(meuTelefone) : 'Seu número'} · você`
              : papel === 'dono'
                ? 'Dono do espaço'
                : 'Outra pessoa';
            return (
              <Animated.View
                key={membro.user_id}
                entering={FadeInDown.duration(Motion.duration.base).delay(
                  Math.min(index * Motion.stagger.step, Motion.stagger.cap),
                )}>
                <Row
                  title={titulo}
                  subtitle={`${papel} · ${desde}`}
                  icon={sou ? 'person.crop.circle' : 'person'}
                  chevron={false}
                  accessibilityLabel={`${titulo}, ${papel}, ${desde}`}
                />
              </Animated.View>
            );
          })}
        </Section>
      ) : null}

      {!membros.isLoading && !membros.isError && lista.length <= 1 ? (
        <EmptyState
          icon="person.2"
          title="Só você por aqui"
          hint={
            teto <= 1
              ? 'O Free é para uma pessoa. Um plano pago abre o espaço para mais gente.'
              : 'Convide pelo telefone — a pessoa entra usando o mesmo número no WhatsApp e vocês compartilham o mesmo financeiro.'
          }
          action={
            teto <= 1
              ? {
                  label: 'Ver planos',
                  onPress: () => router.push({ pathname: '/paywall', params: { from: 'members' } }),
                }
              : undefined
          }
        />
      ) : null}

      {/* Sem plano lido, nada de afirmar limite: falhar aqui não pode virar "você é Free". */}
      {plano.isError ? (
        <Section title="Plano">
          <Row
            title="Não deu para ler seu plano"
            subtitle="Toque para tentar de novo"
            icon="exclamationmark.triangle"
            onPress={() => plano.refetch()}
          />
        </Section>
      ) : plano.data ? (
        <Section title="Plano">
          <Row
            title="Pessoas no plano"
            subtitle={noLimite ? 'no limite do plano' : 'inclui convites esperando aceite'}
            icon="person.2"
            chevron={false}
            trailing={
              <ThemedText type="smallBold" style={tabular}>
                {ocupadas} de {teto}
              </ThemedText>
            }
          />
        </Section>
      ) : null}

      {/* Convite é policy `owner manages`: para quem não é dono a consulta volta VAZIA, sem erro.
          Mostrar "nenhum convite" para essa pessoa seria mentira — a seção simplesmente não existe. */}
      {eDono ? (
        <>
          <View style={styles.bloco}>
            <Field
              label="Convidar alguém"
              hint="Quem entrar enxerga e lança no mesmo financeiro. O acesso entra sozinho quando a pessoa se cadastrar com esse número."
            >
              <TextField
                value={telefone}
                onChangeText={setTelefone}
                placeholder="(51) 99999-8888"
                keyboardType="phone-pad"
                autoComplete="tel"
                accessibilityLabel="Telefone com DDD, como (51) 99999-8888"
              />
            </Field>
            <Button
              label={convidar.isPending ? 'Convidando…' : 'Convidar'}
              icon="person.badge.plus"
              loading={convidar.isPending}
              disabled={!telefoneValido || noLimite || !plano.data}
              onPress={enviarConvite}
              block
            />
            {noLimite ? (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.rodape}>
                  Seu plano vai até {teto} {teto === 1 ? 'pessoa' : 'pessoas'} — e convite pendente
                  já ocupa uma vaga.
                </ThemedText>
                <Button
                  label="Ver planos"
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/paywall', params: { from: 'members' } })}
                  block
                />
              </>
            ) : null}
          </View>

          {convites.isError ? (
            <Section title="Convites enviados">
              <Row
                title="Não deu para ler os convites"
                subtitle="Toque para tentar de novo"
                icon="exclamationmark.triangle"
                onPress={() => convites.refetch()}
              />
            </Section>
          ) : null}

          {pendentes.length > 0 ? (
            <Animated.View layout={LinearTransition.duration(Motion.duration.base)}>
              <Section title="Convites enviados">
                {pendentes.map((convite) => (
                  <Row
                    key={convite.id}
                    title={telefoneBR(convite.phone)}
                    subtitle="esperando a pessoa se cadastrar"
                    icon="paperplane"
                    chevron={false}
                    accessibilityLabel={`Convite para ${telefoneBR(convite.phone)}, esperando a pessoa se cadastrar`}
                    onPress={() =>
                      confirmDestructive(
                        'Revogar este convite?',
                        'Revogar',
                        () =>
                          revogar.mutate(convite.id, {
                            onSuccess: () =>
                              toast({ message: 'Convite revogado.', tone: 'success' }),
                            onError: () =>
                              toast({ message: 'Não deu para revogar o convite.', tone: 'error' }),
                          }),
                        `${telefoneBR(convite.phone)} deixa de poder entrar. Dá para convidar de novo depois.`,
                      )
                    }
                  />
                ))}
              </Section>
            </Animated.View>
          ) : null}
        </>
      ) : null}

      <View style={styles.bloco}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.rodape}>
          Quem entra vê e lança tudo: não existe acesso só de leitura hoje. Cada lançamento guarda
          quem lançou, e tirar alguém do espaço não apaga o que essa pessoa lançou.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.rodape}>
          O telefone das outras pessoas não aparece aqui — cada perfil só é visível para o próprio
          dono. Remover alguém e renomear o espaço também ainda não existem nesta tela.
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bloco: {
    gap: Space.md,
  },
  rodape: {
    ...Type.footnote,
    paddingHorizontal: Space.lg,
  },
});
