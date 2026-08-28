import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { ErrorCard } from "@/components/error-card";
import { GlassCard } from "@/components/glass/glass-card";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Field, TextField } from "@/components/ui/field";
import { Row, Section } from "@/components/ui/row";
import { Screen } from "@/components/ui/screen";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { ProgressBar } from "@/components/ui/sparkline";
import { useToast } from "@/components/ui/toast";
import { Motion, Radius, Space, Type, tabular } from "@/design/tokens";
import { confirmDestructive } from "@/lib/item-actions";
import {
  PLANS,
  useCancelSubscription,
  useInviteMember,
  useInvites,
  usePlanStatus,
  useRevokeInvite,
} from "@/hooks/use-finance";
import { formatDateBR } from "@/hooks/use-items";
import { useTheme } from "@/hooks/use-theme";

/** 5551999998888 -> (51) 99999-8888 */
function telefoneBR(digitos: string): string {
  const d = digitos.replace(/\D/g, "").replace(/^55/, "");
  if (d.length < 10) return digitos;
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  const meio = resto.length === 9 ? resto.slice(0, 5) : resto.slice(0, 4);
  return `(${ddd}) ${meio}-${resto.slice(meio.length)}`;
}

/** Assinatura de loja só se cancela na loja — cancelar por dentro tiraria o acesso e deixaria a cobrança rodando. */
const LOJA_URL = {
  apple: "https://apps.apple.com/account/subscriptions",
  google: "https://play.google.com/store/account/subscriptions",
} as const;

/** Selo de estado ao lado do nome do plano. Nunca é só cor: `expirou` é palavra. */
function selo(
  status: string,
  ate: string | null,
): { texto: string; perigo: boolean } | null {
  if (status === "trialing") {
    return {
      texto: ate ? `teste grátis até ${formatDateBR(ate)}` : "teste grátis",
      perigo: false,
    };
  }
  if (status === "expired") return { texto: "expirou", perigo: true };
  if (status === "canceled") {
    return {
      texto: ate ? `ativo até ${formatDateBR(ate)}` : "cancelado",
      perigo: false,
    };
  }
  if (status === "past_due")
    return { texto: "pagamento pendente", perigo: true };
  return null;
}

/**
 * Plano — "o que eu tenho, quanto já usei, e como eu saio disso".
 *
 * As três partes pesam igual. A terceira é a que ganha confiança: **cancelar é uma chamada, sem
 * formulário**, porque dificultar cancelamento é a reclamação nº1 contra os concorrentes no
 * Reclame Aqui.
 *
 * O catálogo de planos saiu daqui: preço só existe de verdade no `getOfferings()` da loja, e a
 * `PLANS` tem valor escrito à mão. Quem vende é o paywall; isto é uma tela de conta.
 */
export default function PlanScreen() {
  const theme = useTheme();
  const toast = useToast();
  const {
    data: plano,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = usePlanStatus();
  const convites = useInvites();
  const convidar = useInviteMember();
  const revogar = useRevokeInvite();
  const cancelar = useCancelSubscription();

  const [telefone, setTelefone] = useState("");

  const noLimite = Boolean(plano) && plano!.members >= plano!.max_members;
  const podeConvidar =
    telefone.replace(/\D/g, "").length >= 10 && Boolean(plano) && !noLimite;
  const pendentes = (convites.data ?? []).filter((c) => c.status === "pending");

  const usadas = plano?.ai_messages_month ?? 0;
  const teto = plano?.max_ai_messages_month ?? 0;
  const proporcao = teto > 0 ? usadas / teto : 0;
  const estourou = teto > 0 && usadas >= teto;
  const nomePlano =
    PLANS.find((p) => p.value === plano?.plan)?.label ?? plano?.plan ?? "";
  const estado = plano ? selo(plano.status, plano.current_period_end) : null;
  const naLoja = plano?.provider === "apple" || plano?.provider === "google";

  /**
   * Um toque, sem formulário. A RPC é chamada **sempre** — inclusive para quem assinou na loja,
   * onde ela é um no-op que só devolve para onde mandar a pessoa. Antes a tela decidia sozinha e
   * abria a loja sem nunca chamar o backend.
   */
  const confirmarCancelamento = () =>
    confirmDestructive(
      "Cancelar assinatura",
      naLoja ? "Ir para a loja" : "Cancelar assinatura",
      () =>
        cancelar.mutate(undefined, {
          onSuccess: () => {
            if (plano?.provider === "apple" || plano?.provider === "google") {
              Linking.openURL(LOJA_URL[plano.provider]);
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            toast({
              message: plano?.current_period_end
                ? `Assinatura cancelada. Você continua no ${nomePlano} até ${formatDateBR(plano.current_period_end)}.`
                : "Assinatura cancelada.",
              tone: "success",
            });
          },
          onError: () =>
            toast({ message: "Não deu para cancelar agora.", tone: "error" }),
        }),
      naLoja
        ? "A cobrança é da loja, então o cancelamento acontece lá. Nenhum dado é apagado — e dá para voltar quando quiser, aqui mesmo."
        : "Seu plano volta para o Free no fim do período. Nenhum dado é apagado — e dá para voltar quando quiser, aqui mesmo.",
    );

  return (
    <Screen grouped onRefresh={refetch} refreshing={isRefetching}>
      <Stack.Screen options={{ title: "Plano", headerLargeTitle: true }} />

      {/* Falhar aqui não pode virar "você é Free": sem dado, a tela diz que não conseguiu ler. */}
      {isError ? <ErrorCard onRetry={refetch} /> : null}

      {isLoading && !isError ? (
        <>
          <Skeleton height={148} />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único GlassCard da tela: a cota é o único número aqui que muda comportamento. */}
      {plano ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <GlassCard style={styles.hero}>
            <View style={styles.heroTopo}>
              <ThemedText type="smallBold">{nomePlano}</ThemedText>
              {estado ? (
                <ThemedText
                  type="small"
                  themeColor={estado.perigo ? "danger" : "textSecondary"}
                >
                  {estado.texto}
                </ThemedText>
              ) : null}
            </View>

            <ThemedText style={[Type.title2, tabular]}>
              {usadas} de {teto}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              mensagens da IA usadas este mês
            </ThemedText>
            <ProgressBar
              value={usadas}
              max={teto}
              tone={estourou ? "danger" : proporcao >= 0.9 ? "warning" : "tint"}
            />

            {estourou ? (
              <ThemedText type="small" themeColor="danger">
                A IA para de responder até virar o mês. Subir de plano libera
                mais mensagens.
              </ThemedText>
            ) : null}

            {plano.status === "expired" ? (
              <ThemedText type="small" themeColor="danger">
                Sua assinatura expirou
                {plano.current_period_end
                  ? ` em ${formatDateBR(plano.current_period_end)}`
                  : ""}
                . Você voltou para o Free e nada foi apagado.
              </ThemedText>
            ) : null}

            {plano.status === "past_due" ? (
              <ThemedText type="small" themeColor="danger">
                A loja não conseguiu cobrar. Atualize a forma de pagamento por
                lá.
              </ThemedText>
            ) : null}
          </GlassCard>
        </Animated.View>
      ) : null}

      {/* As três linhas são exatamente as três colunas de `private.plan_limits`. */}
      {plano ? (
        <Section title="O que seu plano dá">
          <Row
            title="Pessoas"
            subtitle={
              noLimite
                ? "no limite do plano"
                : "convide pelo telefone do WhatsApp"
            }
            icon="person.2"
            chevron={false}
            trailing={
              <ThemedText type="smallBold" style={tabular}>
                {plano.members} de {plano.max_members}
              </ThemedText>
            }
          />
          <Row
            title="Mensagens da IA"
            subtitle="zera na virada do mês"
            icon="sparkles"
            chevron={false}
            trailing={
              <ThemedText type="smallBold" style={tabular}>
                {usadas} de {teto}
              </ThemedText>
            }
          />
          <Row
            title="Importar extrato"
            subtitle={plano.can_import ? "liberada" : "não entra no Free"}
            icon="arrow.down.doc"
            chevron={false}
            trailing={
              <ThemedText
                type="small"
                themeColor={plano.can_import ? "success" : "textSecondary"}
              >
                {plano.can_import ? "liberada" : "bloqueada"}
              </ThemedText>
            }
          />
        </Section>
      ) : null}

      {plano && plano.plan !== "free" ? (
        <Section title="Cobrança">
          <Row
            title="Onde você assinou"
            icon="creditcard"
            chevron={false}
            trailing={
              <ThemedText type="small" themeColor="textSecondary">
                {plano.provider === "apple"
                  ? "App Store"
                  : plano.provider === "google"
                    ? "Google Play"
                    : (plano.provider ?? "—")}
              </ThemedText>
            }
          />
          {plano.current_period_end ? (
            <Row
              title={plano.status === "canceled" ? "Ativo até" : "Renova em"}
              icon="calendar"
              chevron={false}
              trailing={
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={tabular}
                >
                  {formatDateBR(plano.current_period_end)}
                </ThemedText>
              }
            />
          ) : null}
          {plano.status !== "canceled" ? (
            <Row
              title={naLoja ? "Gerenciar assinatura" : "Cancelar assinatura"}
              subtitle={
                naLoja
                  ? "abre a loja, onde a cobrança vive"
                  : "um toque, sem formulário"
              }
              icon="xmark.circle"
              destructive={!naLoja}
              chevron={false}
              onPress={confirmarCancelamento}
            />
          ) : null}
        </Section>
      ) : null}

      {/* Convite é por telefone: é o mesmo vínculo que o WhatsApp usa. */}
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
          />
        </Field>
        <Button
          label={convidar.isPending ? "Convidando…" : "Convidar"}
          icon="person.badge.plus"
          loading={convidar.isPending}
          disabled={!podeConvidar}
          onPress={() =>
            convidar.mutate(
              { phone: telefone, role: "member" },
              {
                onSuccess: () => {
                  Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success,
                  );
                  setTelefone("");
                  toast({ message: "Convite enviado.", tone: "success" });
                },
                onError: () =>
                  toast({
                    message:
                      "Não deu para convidar. Confira se o número já não tem convite.",
                    tone: "error",
                  }),
              },
            )
          }
          block
        />
        {noLimite ? (
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.rodape}
          >
            Seu plano já está no limite de pessoas.
          </ThemedText>
        ) : null}
      </View>

      {convites.isError ? (
        <View style={[styles.aviso, { backgroundColor: theme.surface }]}>
          <ThemedText type="small" themeColor="danger">
            Não deu para ler os convites.
          </ThemedText>
          <Button
            label="Tentar de novo"
            variant="secondary"
            size="sm"
            onPress={() => convites.refetch()}
          />
        </View>
      ) : null}

      {convites.isLoading ? <SkeletonRow /> : null}

      {pendentes.length > 0 ? (
        <Section title="Convites pendentes">
          {pendentes.map((convite) => (
            <Row
              key={convite.id}
              title={telefoneBR(convite.phone)}
              subtitle="esperando a pessoa se cadastrar"
              icon="paperplane"
              chevron={false}
              onPress={() =>
                confirmDestructive("Revogar este convite?", "Revogar", () =>
                  revogar.mutate(convite.id, {
                    onSuccess: () =>
                      toast({ message: "Convite revogado.", tone: "success" }),
                    onError: () =>
                      toast({
                        message: "Não deu para revogar o convite.",
                        tone: "error",
                      }),
                  }),
                )
              }
            />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: Space.sm,
  },
  heroTopo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Space.md,
  },
  bloco: {
    gap: Space.md,
  },
  rodape: {
    ...Type.footnote,
  },
  aviso: {
    alignItems: "flex-start",
    gap: Space.sm,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: "continuous",
  },
});
