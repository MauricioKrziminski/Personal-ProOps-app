import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { useCortina } from '@/components/motion/session-curtain';
import { AlertPreferencesSection } from '@/components/profile/alert-preferences-section';
import { ProfileTabletCanvas } from '@/components/profile/profile-tablet-canvas';
import { AppHeader } from '@/components/ui/app-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { LockRows } from '@/components/profile/lock-section';
import { Screen } from '@/components/ui/screen';
import { SkeletonHero, SkeletonList, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { currentMonth } from '@/components/finance/month-picker';
import { CycleDayPicker } from '@/components/finance/cycle-day-picker';
import { environmentLabel } from '@/lib/environment';
import {
  useAiMonthStats,
  useCycle,
  usePlanStatus,
  useSetCycleCloseDay,
} from '@/hooks/use-finance';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { useAppUpdate } from '@/hooks/use-app-update';
import { formatDateBR } from '@/hooks/use-items';
import { isoToBR } from '@/lib/dates';
import { useProfile, useUpdateProfile } from '@/hooks/use-profile';
import { useSession } from '@/hooks/use-session';
import { useTheme, useThemeMode, type ThemeMode } from '@/hooks/use-theme';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import { ondaDaTroca } from '@/lib/session-gate';
import { appUpdateAction, appUpdateSubtitle, type AppUpdateState } from '@/lib/app-update';
import { supabase, supabaseUrl } from '@/lib/supabase';
import { telefoneLegivel } from '@/lib/phone-br';

const TEMAS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
];

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
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const cycle = useCycle();
  const setCloseDay = useSetCycleCloseDay();
  const theme = useTheme();
  const ambiente = environmentLabel(supabaseUrl);
  const { mode, setMode } = useThemeMode();
  const { session } = useSession();
  const cortina = useCortina();
  const toast = useToast();
  const userId = session?.user?.id;

  const plan = usePlanStatus();
  const ia = useAiMonthStats(currentMonth());
  const profile = useProfile(userId);
  const saveName = useUpdateProfile(userId);

  /** `null` = sheet fechado. String vazia é um estado válido (apagar o nome). */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [notificationRefreshKey, setNotificationRefreshKey] = useState(0);
  const [saindo, setSaindo] = useState(false);
  const nome = profile.data?.display_name?.trim() || null;

  /**
   * O telefone verificado — e a única coisa que autoriza dizer "conectado ao WhatsApp".
   *
   * Ele mora na SESSÃO, não em `profiles`: só entra ali por Phone OTP, que é verificado por
   * construção. Conta criada por e-mail não tem nenhum, e o cartão precisa dizer isso.
   */
  // Por partes (`+55 (35) 99874-4200`): cru, o número era uma palavra só e partia nos dígitos.
  const phone = session?.user?.phone ? telefoneLegivel(session.user.phone) : null;
  /*
    Quem entrou por Phone OTP não tem e-mail, e quem entrou por e-mail pode não ter telefone. A
    linha da Conta muda de rótulo conforme isso: "Cadastrar" quando falta, "Trocar" quando já
    existe. Sem esta linha a conta de WhatsApp era de mão única — perdeu o número, perdeu tudo.
  */
  const emailDaConta = session?.user?.email ?? null;

  const confirmSignOut = () => {
    // O ActionSheetIOS fecha com uma animação própria. Deixe a camada pronta enquanto ele está aberto
    // para a cortina começar no mesmo instante em que o usuário confirma.
    cortina.preparar();
    const doIt = async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setSaindo(true);
      // Começa no toque. O evento de sessão reutiliza esta cobertura enquanto a rede responde.
      void cortina.cobrir(ondaDaTroca(null, null));
      try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      } catch {
        setSaindo(false);
        cortina.cobrirJa();
        void cortina.revelar({ mode: 'up' }).catch(() => cortina.abrirJa());
        toast({ message: 'Não foi possível sair agora.', tone: 'error' });
      }
    };
    confirmDestructive('Sair da conta?', 'Sair', doIt);
  };

  // Bloqueio e tema são ajustes do APARELHO, não da conta: uma seção só.
  const rotuloDoTema = TEMAS.find((t) => t.value === mode)?.label ?? 'Sistema';
  const segurancaEAparencia = (
    <Section heading="block" title="Segurança e aparência">
      <LockRows />
      <Row
        title="Tema"
        icon="circle.lefthalf.filled"
        chevron={false}
        trailing={<ThemedText type="default" themeColor="textSecondary">{rotuloDoTema}</ThemedText>}
        accessibilityLabel={`Tema: ${rotuloDoTema}`}
        onPress={() =>
          showItemActions('Tema', TEMAS.map((t) => ({ label: t.label, selected: t.value === mode, onPress: () => setMode(t.value) })))
        }
      />
    </Section>
  );

  /**
   * Onde o mês FINANCEIRO fecha.
   *
   * O padrão é o último dia do mês, que é o que quase todo app assume — e é errado para quem
   * paga tudo num dia só. O caso que motivou: salário no dia 5 e no 20, as duas faturas
   * vencendo dia 10. O período que importa é **11 de agosto a 10 de setembro** — recebe,
   * gasta, e no dia 10 paga tudo. Lido de 1 a 31, o salário do dia 20 cai num balde e a fatura
   * que ele paga com esse salário, no seguinte.
   *
   * ⚠️ **Isto não mexe em fatura.** Em qual fatura uma compra cai continua sendo o dia de
   * FECHAMENTO do cartão (Nubank fecha dia 3, BB no último dia), e o dinheiro sai do caixa na
   * data de VENCIMENTO. Uma compra no dia 4 no Nubank já não entra na fatura que vence dia 10 —
   * isso valia antes e continua valendo. O ciclo só move a régua que corta os gráficos.
   *
   * ## Por que uma GRADE, e não o `SelectField`
   *
   * A primeira versão usava o seletor de lista, e ele estava errado por dois motivos ao mesmo
   * tempo — a queixa foi literal: *"como assim abre um mundo de uma caixa de seleção para
   * escolher de 1 até 31?"*. Escolher um DIA DO MÊS não é escolher um item de lista curta: são
   * 29 opções homogêneas, sem nome, que a pessoa compara por posição e não por leitura. Numa
   * lista elas viram 29 linhas de rolagem para um número; numa grade de 7 colunas cabem todas
   * na tela de uma vez, como num calendário — que é a forma que a pessoa já sabe ler.
   *
   * `SelectField` continua certo para conta, categoria e cartão. Componente pronto não vira o
   * componente certo só porque aceita os dados.
   *
   * ## Por que UM número define os dois extremos
   *
   * A outra metade da queixa foi *"onde eu defino um começo e final para o meu ciclo?"*. Não
   * dá para escolher os dois: eles são grudados — o mês seguinte começa no dia após o anterior
   * fechar. Explicar isso em texto não resolve; o que resolve é o intervalo aparecer em cima,
   * grande, e MUDAR junto com o toque. A pessoa toca no 10 e lê "de 11/08 a 10/09".
   */
  const diaAtual = cycle.data?.closeDay ?? null;
  /**
   * ⚠️ **O campo nasce COLAPSADO, e a escolha só vale no Salvar.**
   *
   * A primeira versão deixava a grade sempre aberta: cinco fileiras de números ocupando um
   * terço do Perfil para uma configuração que se mexe uma vez na vida. A queixa foi literal —
   * *"não fica mostrando esse calendário aberto 100% do tempo que fica poluído"*. É a mesma
   * régua do `SelectField` (§1 do design): campo de formulário mostra o VALOR; a escolha é o
   * que aparece quando se vai trocá-la.
   *
   * O rascunho existe porque aqui a escolha CUSTA: trocar o dia remonta painel, tendência,
   * projeção e lista. Gravar a cada toque faria quatro telas recalcularem enquanto o dedo
   * ainda procura o número certo. Fecha sem salvar = nada mudou.
   */
  const [editandoCiclo, setEditandoCiclo] = useState(false);
  const [diaRascunho, setDiaRascunho] = useState<number | null>(null);
  const diaEmEdicao = editandoCiclo ? diaRascunho : diaAtual;
  const mudou = editandoCiclo && diaRascunho !== diaAtual;

  const abrirCiclo = () => {
    setDiaRascunho(diaAtual);
    setEditandoCiclo(true);
  };
  const salvarCiclo = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (mudou) setCloseDay.mutate(diaRascunho);
    setEditandoCiclo(false);
  };

  // A pergunta que a pessoa sabe responder é até que dia ela PAGA; "o mês fecha" é consequência
  // (28/09/2026: *"muita gente não sabe qual data tem que colocar ali"*). O mesmo texto do
  // onboarding e do agente (`query_cycle`).
  const rotuloCiclo = diaAtual == null ? 'Pago as contas até o último dia do mês' : `Pago as contas até o dia ${diaAtual}`;

  const cicloConfig = (
    <>
      <Row
        title={rotuloCiclo}
        subtitle={
          cycle.data
            ? `${isoToBR(cycle.data.de)} a ${isoToBR(cycle.data.ate)}`
            : 'carregando…'
        }
        icon="calendar"
        onPress={editandoCiclo ? () => setEditandoCiclo(false) : abrirCiclo}
        accessibilityState={{ expanded: editandoCiclo }}
      />

      {editandoCiclo ? (
        <Animated.View
          entering={FadeIn.duration(Motion.duration.fast)}
          style={styles.cicloEdicao}>
          <CycleDayPicker value={diaEmEdicao} onChange={setDiaRascunho} />

          <Button
            label={mudou ? 'Salvar' : 'Fechar'}
            variant={mudou ? 'primary' : 'secondary'}
            onPress={salvarCiclo}
            loading={setCloseDay.isPending}
            block
          />
        </Animated.View>
      ) : null}

      {/*
        ⚠️ **A régua de leitura NÃO mora mais aqui** (11/09/2026). Ela foi global por algumas
        horas e o pedido do dono do produto foi o contrário: *"eu pedi para dar a opção do
        usuário escolher não de forma global entre ciclo e mês, e sim individualmente em cada
        tela. Ele define o ciclo de forma global, mas dentro de cada tela onde fixa e visualiza
        por ciclo ou por mês, o usuário escolhe."*

        O que é global é o DIA, que está na linha acima. O controle `Mês | Ciclo` vive em
        `MonthRuler` e cada tela de período carrega o seu.
      */}
    </>
  );

  /*
    O PORTÃO DA TELA (Fase 5) — 7 consultas, 3 portões antes disto. O cartão de identidade
    ficava pronto e o plano, o consumo de IA e o ciclo chegavam depois, um a um.
  */
  const pronta = useTelaPronta(profile, plan, ia, cycle);

  if (!pronta) {
    return (
      <Screen wide={tablet} grouped topBar={<AppHeader title="Perfil" />}>
        <SkeletonHero />
        <SkeletonList linhas={3} />
        <SkeletonList linhas={2} />
      </Screen>
    );
  }

  const account = (
    <>
      {/*
        Cartão de identidade — o topo da tela no desenho do Stitch.

        Responde "de quem é esta conta" antes de qualquer ajuste, e é o que separa uma tela de
        perfil de uma lista de configurações. É o bloco NEGATIVO da página, como o painel de
        destaque das outras raízes: o único destaque desta tela (§1, um por tela).

        O nome vem de `profiles.display_name` (migration 0050) e o telefone desce para baixo dele,
        em mono, porque é DADO (§3). Sem nome preenchido — o caso de quem entrou por Phone OTP —
        o número volta a ser a linha principal: o card nunca fica com um vazio no lugar do nome.
        O selo verde no avatar diz o que o número significa aqui: está vinculado ao WhatsApp.
      */}
      <View style={[styles.idCard, { backgroundColor: theme.heroSurface }]}>

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
              <View style={[styles.idSelo, { backgroundColor: theme.tintFill, borderColor: theme.heroSurface }]}>
                <Icon name="checkmark" size="xs" color="onTint" />
              </View>
            ) : null}
          </View>

          <View style={styles.idInfo}>
            {nome ? (
              <ThemedText type="headline" themeColor="onHero">
                {nome}
              </ThemedText>
            ) : null}
            {/*
              O estado do WhatsApp mora NO número: o balão verde na frente dele é o "conectado".
              Uma linha só de "conectado ao WhatsApp" ao lado da pílula do plano quebrava em duas
              a 384dp × fonte 1,3. Sem telefone ele não vira erro em vermelho: não ter WhatsApp
              ligado é um estado NORMAL de quem entrou por e-mail, e pintar de `danger`
              transformaria uma escolha em problema. Cinza, dizendo o que falta.
            */}
            {phone ? (
              <View style={styles.idMeta} accessible accessibilityLabel={`WhatsApp conectado, ${phone}`}>
                <Icon name="bubble.left" size="xs" color="onHeroSuccess" />
                <ThemedText
                  type={nome ? 'code' : 'ticker'}
                  themeColor={nome ? 'onHeroMuted' : 'onHero'}
                  style={tabular}
                  selectable>
                  {phone}
                </ThemedText>
              </View>
            ) : (
              <>
                {nome ? null : (
                  <ThemedText type="ticker" themeColor="onHero">
                    Sua conta
                  </ThemedText>
                )}
                <View style={styles.idMeta}>
                  <Icon name="exclamationmark.bubble" size="xs" color="onHeroMuted" />
                  <ThemedText type="caption" themeColor="onHeroMuted">
                    WhatsApp desligado
                  </ThemedText>
                </View>
              </>
            )}
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
        {/*
          A fileira QUEBRA quando a fonte do sistema cresce, e a conta é font-aware de propósito.
          Três chips de largura igual dividem ~312dp numa tela de 384dp: sobram ~74dp de texto por
          chip, e "lançamentos" a 1,3× precisa de ~80. O Android então quebra no MEIO da palavra
          ("lançame / ntos"), que lê como texto corrompido. Uma base fixa em dp não resolve — ela
          não sabe o tamanho da fonte —, e apertar o teto de escala até caber equivaleria a
          desligar o Dynamic Type nesta linha. Com a base multiplicada por `fontScale`, a fileira
          fica 3-em-linha na fonte normal e passa a 2+1 quando a pessoa aumenta a letra, onde cada
          chip fica largo o bastante para a palavra inteira.
        */}
        {/* Os três números são DO MÊS, e os dois primeiros só do que chegou pelo WhatsApp
            (`useAiMonthStats`). Sem dizer isso, "0 lançamentos" num perfil com dezenas de
            lançamentos lia como defeito (24/09/2026). "no WhatsApp" tem a largura de
            "lançamentos": a conta da quebra abaixo continua valendo. */}
        {/* O rótulo fica a `Space.md` dos números que ele nomeia (§2), não a `lg` do card. */}
        <View style={styles.idMes}>
          <ThemedText type="caption" themeColor="onHeroMuted">
            Neste mês
          </ThemedText>
          <View style={[styles.idStats, { flexWrap: 'wrap' }]}>
            <Stat
              valor={ia.data ? String(ia.data.lancamentos) : '—'}
              rotulo={'lançamentos\nno WhatsApp'}
            />
            <Stat valor={ia.data ? String(ia.data.notas) : '—'} rotulo={'notas\nno WhatsApp'} />
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
      </View>

      {/* Ordem: identidade → Conta → Plano → Finanças → Notificações → Segurança e aparência → Ajuda e app → Sair. */}
      <Section heading="block" title="Conta">
        <Row
          title="Nome"
          subtitle={nome ?? 'Não informado'}
          icon="person"
          onPress={() => setNameDraft(nome ?? '')}
        />
        <Row
          title={emailDaConta ? 'E-mail' : 'Cadastrar e-mail e senha'}
          subtitle={emailDaConta ?? 'Segundo jeito de entrar'}
          icon="paperplane"
          onPress={() => router.push('/link-email')}
        />
        <Row
          title={phone ? 'WhatsApp' : 'Conectar o WhatsApp'}
          subtitle={phone ? phone : 'Libera o agente e os avisos'}
          icon="bubble.left"
          onPress={() => router.push('/link-phone')}
        />
      </Section>

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
              variant="secondary"
              size="sm"
              onPress={() => router.push('/profile/members')}
            />
          </View>
        </View>
      ) : null}
    </>
  );

  const settings = (
    <>
      <Section heading="block" title="Finanças">
        {cicloConfig}
        <Row title="Categorias" subtitle="Ícone, cor, renomear e juntar" icon="tag" onPress={() => router.push('/finance/categories')} />
        <Row title="Regras" subtitle="Categoria automática por palavra" icon="wand.and.stars" onPress={() => router.push('/finance/rules')} />
        <Row title="Importar extrato" icon="square.and.arrow.down" onPress={() => router.push('/import')} />
        <Row title="Importações" icon="clock.arrow.circlepath" onPress={() => router.push('/import-history')} />
      </Section>

      <AlertPreferencesSection
        key={notificationRefreshKey}
        userId={userId}
        hasVerifiedPhone={!!phone}
      />

      {segurancaEAparencia}

      <AppAndHelp />

      <Section>
        <Row
          title="Sair da conta"
          icon="rectangle.portrait.and.arrow.right"
          destructive
          chevron={false}
          onPress={saindo ? undefined : confirmSignOut}
        />
      </Section>

      {!session ? (
        <EmptyState icon="person.crop.circle.badge.questionmark" title="Sem sessão" hint="Entre para ver seu perfil." />
      ) : null}
    </>
  );

  return (
    <Screen
      wide={tablet}
      grouped
      topBar={<AppHeader title="Perfil" />}
      stagger
      onRefresh={() => {
        setNotificationRefreshKey((current) => current + 1);

        return Promise.all([profile.refetch(), plan.refetch(), ia.refetch()]);
      }}>
      {tablet ? <ProfileTabletCanvas account={account} settings={settings} /> : <>{account}{settings}</>}

      {/*
        Um campo só, no mesmo desenho de sheet que Contas, Metas e Orçamentos já usam — nada de
        rota modal nova para uma linha de texto.
      */}
      <Sheet visible={nameDraft !== null} onClose={() => setNameDraft(null)}>
        <TaskHeader
          title="Seu nome"
          onClose={() => setNameDraft(null)}
          action={
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
          }
        />
        <SheetScroll contentContainerStyle={styles.sheetBody}>
          <Field label="Nome">
            <TextField
              value={nameDraft ?? ''}
              onChangeText={(v) => setNameDraft(v.slice(0, 60))}
              placeholder="Seu nome"
              autoFocus
              autoCapitalize="words"
              returnKeyType="done"
            />
          </Field>
        </SheetScroll>
      </Sheet>

      <View style={styles.footer}>
        <ThemedText type="small" themeColor="textSecondary">
          ProOps
        </ThemedText>
        {/*
          Em qual banco este build escreve. Some em produção de propósito — ver
          `environmentLabel`. Com três apps instalados no mesmo aparelho, o nome do ícone não
          basta: um build "dev" aponta para o `.env` da máquina, que pode ser qualquer um.
        */}
        {ambiente ? (
          <View style={[styles.ambiente, { backgroundColor: theme.warningSoft }]}>
            <ThemedText type="meta" themeColor="warning">
              {ambiente.toUpperCase()}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

/** Ajuda + atualização. Só a linha de atualização renderiza a cada percentual; o Perfil fica fora do ciclo. */
function AppAndHelp() {
  const appUpdate = useAppUpdate();
  const action = appUpdateAction(appUpdate.state);
  return (
    <Section heading="block" title="Ajuda e app">
      <Row title="Como usar o ProOps" icon="questionmark.circle" onPress={() => router.push('/guia')} />
      {/* ponytail: diagnóstico temporário da cortina presa (`lib/trilha-da-abertura.ts`) */}
      <Row title="Diagnóstico da abertura" icon="doc.text" onPress={() => router.push('/profile/diagnostico')} />
      {appUpdate.state.status === 'unsupported' ? null : (
        <Row
          title="Atualização do app"
          subtitle={appUpdateSubtitle(appUpdate.state, appUpdate.installedVersionName)}
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
      )}
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
  /**
   * A base em dp precisa acompanhar a FONTE, senão a fileira nunca quebra quando deveria.
   *
   * 88 é o menor valor em que "lançamentos" ainda cabe inteiro na fonte normal (~63dp de texto
   * em 64dp úteis). Ele decide só o ponto de quebra — quem dá a largura final é o `flexGrow`.
   * Com 88, três chips pedem 280dp de fileira: continuam lado a lado até uma tela de 352dp
   * (abaixo de qualquer Android atual) e passam a 2+1 quando a pessoa aumenta a letra.
   */
  const { fontScale } = useWindowDimensions();
  return (
    <View style={[styles.stat, { flexBasis: 88 * fontScale, backgroundColor: theme.heroChip }]}>
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
      <ThemedText type="caption" themeColor="onHeroMuted">
        {rotulo}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  /*
    A calha lateral é da TELA; o seletor não conhece o recuo de quem o usa.

    O `paddingTop` separa a grade da LINHA que a abriu: sem ele a primeira
    fileira de dias nascia colada em "Último dia do mês / 01/09 a 30/09", e as
    duas coisas liam como um bloco só.
  */
  cicloEdicao: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.md,
    gap: Space.md,
  },
  shrink: { flex: 1, minWidth: 0 },
  idCard: {
    gap: Space.lg,
    padding: Space.gutter,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
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
  idMes: { gap: Space.md },
  idStats: { flexDirection: 'row', gap: Space.sm },
  stat: {
    flexGrow: 1,
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
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
  footer: {
    alignItems: 'center',
    gap: Space.sm,
    paddingVertical: Space.xl,
  },
  ambiente: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.xs,
    borderCurve: 'continuous',
  },
});
