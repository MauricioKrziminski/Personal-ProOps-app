import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { AlertPreferencesSection } from '@/components/profile/alert-preferences-section';
import { AppHeader } from '@/components/ui/app-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Segmented } from '@/components/ui/segmented';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { GradientSurface } from '@/components/ui/gradient';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { Radius, Space, tabular } from '@/design/tokens';
import { currentMonth } from '@/components/finance/month-picker';
import { useAiMonthStats, usePlanStatus } from '@/hooks/use-finance';
import { useAppUpdate } from '@/hooks/use-app-update';
import { formatDateBR } from '@/hooks/use-items';
import { useProfile, useUpdateProfile } from '@/hooks/use-profile';
import { useSession } from '@/hooks/use-session';
import { useTheme, useThemeMode } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/item-actions';
import { appUpdateAction, appUpdateSubtitle, type AppUpdateState } from '@/lib/app-update';
import { supabase } from '@/lib/supabase';

const APP_UPDATE_ICON: Partial<
  Record<AppUpdateState['status'], Parameters<typeof Icon>[0]['name']>
> = {
  error: 'exclamationmark.circle',
  upToDate: 'checkmark.circle',
};

/**
 * Perfil — tela de manutenção. O sucesso dela é a pessoa achar o que veio buscar e sair.
 */
export default function ProfileScreen() {
  const theme = useTheme();
  const { mode, setMode } = useThemeMode();
  const { session } = useSession();
  const toast = useToast();
  const userId = session?.user?.id;

  const plan = usePlanStatus();
  const ia = useAiMonthStats(currentMonth());
  const profile = useProfile(userId);
  const saveName = useUpdateProfile(userId);

  /** `null` = sheet fechado. String vazia é um estado válido (apagar o nome). */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [notificationRefreshKey, setNotificationRefreshKey] = useState(0);
  const nome = profile.data?.display_name?.trim() || null;

  /**
   * O telefone verificado — e a única coisa que autoriza dizer "conectado ao WhatsApp".
   *
   * Ele mora na SESSÃO, não em `profiles`: só entra ali por Phone OTP, que é verificado por
   * construção. Conta criada por e-mail não tem nenhum, e o cartão precisa dizer isso.
   */
  const phone = session?.user?.phone ? `+${session.user.phone}` : null;

  const confirmSignOut = () => {
    const doIt = async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await supabase.auth.signOut();
    };
    confirmDestructive('Sair da conta?', 'Sair', doIt);
  };

  const aparencia = (
    <Section title="Aparência">
      <View style={styles.temaRow}>
        <View style={styles.temaText}>
          <ThemedText type="default">Tema</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {mode === 'system' ? 'seguindo o aparelho' : mode === 'dark' ? 'sempre escuro' : 'sempre claro'}
          </ThemedText>
        </View>
        <View style={styles.temaControl}>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'system', label: 'Sistema' },
              { value: 'light', label: 'Claro' },
              { value: 'dark', label: 'Escuro' },
            ]}
          />
        </View>
      </View>
    </Section>
  );

  return (
    <Screen
      grouped
      topBar={<AppHeader title="Perfil" />}
      onRefresh={() => {
        setNotificationRefreshKey((current) => current + 1);
        profile.refetch();
        plan.refetch();
      }}
      refreshing={profile.isRefetching || plan.isRefetching}>
      {/*
        Cartão de identidade — o topo da tela no desenho do Stitch.

        Responde "de quem é esta conta" antes de qualquer ajuste, e é o que separa uma tela de
        perfil de uma lista de configurações. Fundo em gradiente com brilho, como o painel de
        destaque: é o único bloco de destaque desta tela (§1, um por tela).

        O nome vem de `profiles.display_name` (migration 0050) e o telefone desce para baixo dele,
        em mono, porque é DADO (§3). Sem nome preenchido — o caso de quem entrou por Phone OTP —
        o número volta a ser a linha principal: o card nunca fica com um vazio no lugar do nome.
        O selo verde no avatar diz o que o número significa aqui: está vinculado ao WhatsApp.
      */}
      <View style={[styles.idCard, { borderColor: theme.cardBorder, backgroundColor: theme.heroBottom }]}>
        <GradientSurface from={theme.heroTop} to={theme.heroBottom} sheen={`${theme.tint}1F`} />

        <View style={styles.idTop}>
          <View>
            <View style={[styles.idAvatar, { backgroundColor: theme.heroChip }]}>
              <Icon name="person.crop.circle" size="xl" color="onHero" />
            </View>
            {/*
              O selo é uma AFIRMAÇÃO: "este número está ligado ao WhatsApp". Ele era verde
              incondicional, então uma conta de e-mail — que não tem telefone nenhum — exibia
              selo de verificado e "conectado ao WhatsApp" com o número em "—". Cor semântica
              mentindo é pior que ausência de cor (§2): sem telefone, sem selo.
            */}
            {phone ? (
              <View style={[styles.idSelo, { backgroundColor: theme.tint, borderColor: theme.heroBottom }]}>
                <Icon name="checkmark" size="xs" color="onTint" />
              </View>
            ) : null}
          </View>

          <View style={styles.idInfo}>
            {nome ? (
              <>
                <ThemedText type="headline" themeColor="onHero" numberOfLines={1}>
                  {nome}
                </ThemedText>
                {phone ? (
                  <ThemedText type="code" themeColor="onHeroMuted" style={tabular} selectable>
                    {phone}
                  </ThemedText>
                ) : null}
              </>
            ) : (
              <ThemedText type="ticker" themeColor="onHero" selectable>
                {phone ?? 'Sua conta'}
              </ThemedText>
            )}
            {/*
              A linha de estado do WhatsApp. Sem telefone ela não vira um erro em vermelho: não
              ter WhatsApp ligado é um estado NORMAL de quem entrou por e-mail, e pintar de
              `danger` transformaria uma escolha em problema. Cinza, dizendo o que falta.
            */}
            <View style={styles.idMeta}>
              <Icon
                name={phone ? 'bubble.left' : 'exclamationmark.bubble'}
                size="xs"
                color={phone ? 'onHeroSuccess' : 'onHeroMuted'}
              />
              <ThemedText type="caption" themeColor="onHeroMuted">
                {phone ? 'conectado ao WhatsApp' : 'WhatsApp não conectado'}
              </ThemedText>
            </View>
          </View>

          {plan.data?.plan ? (
            <View style={[styles.idPlan, { backgroundColor: theme.heroChip }]}>
              <ThemedText type="meta" themeColor="onHeroSuccess">
                {plan.data.plan.toUpperCase()}
              </ThemedText>
            </View>
          ) : null}
        </View>

        {/*
          A grade de estatísticas do desenho — três números, **todos medidos**.

          O Stitch põe "99,8% de acurácia da LLM" na terceira coluna. Não existe dado nenhum que
          sustente isso: `ai_events` conta CHAMADAS, não acertos. No lugar vai o consumo de
          mensagens de IA do mês, que é medido de verdade e ainda é o número que decide se o
          plano vai estourar.
        */}
        <View style={styles.idStats}>
          <Stat
            valor={ia.data ? String(ia.data.lancamentos) : '—'}
            rotulo="lançamentos por mensagem"
          />
          <Stat valor={ia.data ? String(ia.data.notas) : '—'} rotulo="notas capturadas" />
          <Stat
            valor={plan.data ? String(plan.data.ai_messages_month) : '—'}
            rotulo={
              plan.data
                ? `${plan.data.ai_messages_whatsapp} WhatsApp\n${plan.data.ai_messages_app} no app`
                : 'mensagens de IA no mês'
            }
            limite={plan.data ? plan.data.max_ai_messages_month : null}
          />
        </View>
      </View>

      {/*
        Assinatura — card próprio, não uma linha perdida em "Conta".
        É o segundo motivo pelo qual alguém abre o Perfil (o primeiro é desligar notificação), e
        como `Row` ele competia em peso com "Lixeira de notas".
      */}
      {plan.isLoading ? (
        <Section>
          <SkeletonRow />
        </Section>
      ) : plan.isError ? (
        <Section>
          <Row
            title="Plano"
            subtitle="Não deu para carregar"
            icon="exclamationmark.triangle"
            onPress={() => plan.refetch()}
          />
        </Section>
      ) : plan.data ? (
        <View style={[styles.planoCard, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
          <View style={styles.planoTopo}>
            <View style={styles.shrink}>
              <ThemedText type="smallBold">{`Plano ${plan.data.plan}`}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {plan.data.is_trial
                  ? `Teste até ${formatDateBR(plan.data.current_period_end)}`
                  : `${plan.data.members} de ${plan.data.max_members} ${plan.data.max_members === 1 ? 'pessoa' : 'pessoas'}`}
              </ThemedText>
            </View>
            <View
              style={[
                styles.planoBadge,
                { backgroundColor: plan.data.is_trial ? theme.warningSoft : theme.successSoft },
              ]}>
              <ThemedText type="meta" themeColor={plan.data.is_trial ? 'warning' : 'success'}>
                {plan.data.is_trial ? 'TESTE' : 'ATIVO'}
              </ThemedText>
            </View>
          </View>

          <View style={styles.planoAcoes}>
            <Button
              label="Gerenciar plano"
              icon="creditcard"
              variant="secondary"
              size="sm"
              onPress={() => router.push('/finance/plan')}
            />
            <Button
              label="Pessoas"
              icon="person.2"
              variant="ghost"
              size="sm"
              onPress={() => router.push('/profile/members')}
            />
          </View>
        </View>
      ) : null}

      {/*
        Notificações tem UM lugar, logo abaixo de Conta.
        Antes ela era renderizada em duas posições diferentes conforme o push estivesse ligado ou
        não — o bloco "subia" quando desligado. Um bloco que muda de lugar conforme o estado
        obriga a pessoa a procurá-lo, e a promoção rendia pouco: aqui ele já é a segunda seção de
        cinco. O alerta de push desligado é a LINHA, não a posição dela.
      */}
      <AlertPreferencesSection
        key={notificationRefreshKey}
        userId={userId}
        hasVerifiedPhone={!!phone}
      />

      {/*
        Conta — hoje só o nome. Ele é o que a saudação da Hoje lê, e a única coisa desta tela que
        o usuário ESCREVE; por isso a linha diz o valor atual em vez de repetir "Nome".
      */}
      <Section title="Conta">
        <Row
          title={phone ? 'Trocar número do WhatsApp' : 'Conectar o WhatsApp'}
          subtitle={
            phone
              ? phone
              : 'Libera o agente e os avisos neste canal depois da confirmação'
          }
          subtitleLines={2}
          icon="bubble.left"
          onPress={() => router.push('/link-phone')}
        />
        <Row
          title="Nome"
          subtitle={nome ?? 'Ninguém te chama pelo nome ainda'}
          icon="person"
          onPress={() => setNameDraft(nome ?? '')}
        />
      </Section>

      <Section title="Dados">
        <Row title="Lixeira de notas" icon="trash" onPress={() => router.push('/notes/trash')} />
        <Row title="Regras de categoria" icon="wand.and.stars" onPress={() => router.push('/finance/rules')} />
        <Row title="Importar extrato" icon="square.and.arrow.down" onPress={() => router.push('/import')} />
        <Row title="Importações" subtitle="histórico e revisões pendentes" icon="clock.arrow.circlepath" onPress={() => router.push('/import-history')} />
      </Section>

      {aparencia}

      <AppUpdateSection />

      <Section>
        <Row title="Sair da conta" icon="rectangle.portrait.and.arrow.right" destructive chevron={false} onPress={confirmSignOut} />
      </Section>

      {!session ? (
        <EmptyState icon="person.crop.circle.badge.questionmark" title="Sem sessão" hint="Entre para ver seu perfil." />
      ) : null}

      {/*
        Um campo só, no mesmo desenho de sheet que Contas, Metas e Orçamentos já usam — nada de
        rota modal nova para uma linha de texto.
      */}
      <Sheet visible={nameDraft !== null} onClose={() => setNameDraft(null)}>
        <View style={styles.sheetHead}>
          <Button label="Cancelar" variant="ghost" size="sm" onPress={() => setNameDraft(null)} />
          <ThemedText type="smallBold">Seu nome</ThemedText>
          <Button
            label="Salvar"
            size="sm"
            loading={saveName.isPending}
            onPress={() =>
              saveName.mutate(
                { display_name: (nameDraft ?? '').trim() || null },
                {
                  onSuccess: () => {
                    setNameDraft(null);
                    toast({ message: 'Nome salvo.', tone: 'success' });
                  },
                  onError: () => toast({ message: 'Não deu para salvar.', tone: 'error' }),
                }
              )
            }
          />
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <Field label="Nome" hint="É como o app vai te cumprimentar na Hoje.">
            <TextField
              value={nameDraft ?? ''}
              onChangeText={(v) => setNameDraft(v.slice(0, 60))}
              placeholder="Gabriel"
              autoFocus
              autoCapitalize="words"
              returnKeyType="done"
            />
          </Field>
        </ScrollView>
      </Sheet>

      <View style={styles.footer}>
        <ThemedText type="small" themeColor="textSecondary">
          Personal ProOps app
        </ThemedText>
      </View>
    </Screen>
  );
}

/** Só esta linha renderiza de novo a cada percentual; o Perfil inteiro fica fora desse ciclo. */
function AppUpdateSection() {
  const appUpdate = useAppUpdate();
  if (Platform.OS !== 'android') return null;

  const action = appUpdateAction(appUpdate.state);
  return (
    <Section title="App">
      <Row
        title="Atualização do app"
        subtitle={appUpdateSubtitle(appUpdate.state, appUpdate.installedVersionName)}
        subtitleLines={3}
        icon={APP_UPDATE_ICON[appUpdate.state.status] ?? 'arrow.down.circle'}
        chevron={false}
        onPress={
          action
            ? () => {
                void appUpdate.runNextStep();
              }
            : undefined
        }
      />
    </Section>
  );
}

/**
 * Uma coluna da grade de estatísticas do cartão de perfil.
 *
 * Número grande em cima, rótulo pequeno embaixo — o contraste de escala é o que faz o número ser
 * lido primeiro. `limite` só aparece quando existe: escrever "de ∞" para plano ilimitado seria
 * ruído, e escrever "de 0" seria mentira.
 */
function Stat({ valor, rotulo, limite }: { valor: string; rotulo: string; limite?: number | null }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.heroChip }]}>
      <View style={styles.statValor}>
        <ThemedText type="subtitle" themeColor="onHero" style={tabular}>
          {valor}
        </ThemedText>
        {limite && limite > 0 ? (
          <ThemedText type="code" themeColor="onHeroMuted" style={tabular}>
            {`/${limite}`}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="caption" themeColor="onHeroMuted" numberOfLines={2}>
        {rotulo}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  temaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  temaText: { flex: 1, minWidth: 0 },
  /** Largura fixa: com `flex` o segmentado encolhia até o rótulo "Sistema" truncar. */
  temaControl: { width: 200 },
  shrink: { flex: 1, minWidth: 0 },
  idCard: {
    gap: Space.lg,
    padding: Space.gutter,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  idTop: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  idAvatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** O selo do avatar. A borda é da COR DO CARD, para ele parecer recortado por cima. */
  idSelo: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idInfo: { flex: 1, minWidth: 0, gap: Space.xs },
  idMeta: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  idPlan: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  idStats: { flexDirection: 'row', gap: Space.sm },
  stat: {
    flex: 1,
    gap: Space.xs,
    padding: Space.md,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  statValor: { flexDirection: 'row', alignItems: 'baseline', gap: Space.half },
  planoCard: {
    gap: Space.lg,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  planoTopo: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  planoBadge: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.pill,
  },
  planoAcoes: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: Space.xl,
  },
});
