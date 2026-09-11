import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn } from 'react-native-reanimated';

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
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { currentMonth } from '@/components/finance/month-picker';
import { CycleDayPicker } from '@/components/finance/cycle-day-picker';
import { environmentLabel } from '@/lib/environment';
import {
  useAiMonthStats,
  useCycle,
  usePlanStatus,
  useSetCycleCloseDay,
  useSetCycleView,
} from '@/hooks/use-finance';
import { useAppUpdate } from '@/hooks/use-app-update';
import { formatDateBR } from '@/hooks/use-items';
import { isoToBR } from '@/lib/dates';
import { useProfile, useUpdateProfile } from '@/hooks/use-profile';
import { useSession } from '@/hooks/use-session';
import { useTheme, useThemeMode } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/item-actions';
import { appUpdateAction, appUpdateSubtitle, type AppUpdateState } from '@/lib/app-update';
import { supabase, supabaseUrl } from '@/lib/supabase';

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
  const cycle = useCycle();
  const setCloseDay = useSetCycleCloseDay();
  const setCycleView = useSetCycleView();
  const theme = useTheme();
  const ambiente = environmentLabel(supabaseUrl);
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
  /*
    Quem entrou por Phone OTP não tem e-mail, e quem entrou por e-mail pode não ter telefone. A
    linha da Conta muda de rótulo conforme isso: "Cadastrar" quando falta, "Trocar" quando já
    existe. Sem esta linha a conta de WhatsApp era de mão única — perdeu o número, perdeu tudo.
  */
  const emailDaConta = session?.user?.email ?? null;

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

  const rotuloCiclo = diaAtual == null ? 'Último dia do mês' : `Fecha todo dia ${diaAtual}`;

  const cicloConfig = (
    <Section title="Meu mês">
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
        A régua de LEITURA — e ela só existe depois de haver um dia configurado.
        Sem `closeDay`, "Mês" e "Ciclo" descrevem exatamente o mesmo período (`cycle_bounds(null,
        m)` É o `date_trunc('month')`), e um controle cujas duas opções fazem a mesma coisa
        ensina a pessoa a não confiar nos controles da tela.

        ⚠️ **Trocar aqui NÃO apaga o dia.** É o par do `closeDay` continuar vindo cru do banco:
        a pessoa volta para "Ciclo" e reencontra o 10 onde deixou.

        A confirmação é o SUBTÍTULO da linha acima, que já escreve o intervalo ativo e vira
        "01/09/2026 a 30/09/2026" no toque. Por isso não há texto explicativo aqui — seria a
        parede de cinza do §7b para dizer o que o próprio controle mostra.
      */}
      {diaAtual != null ? (
        <View style={styles.temaRow}>
          <View style={styles.temaText}>
            <ThemedText type="default">Ver por</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {(cycle.data?.view ?? 'cycle') === 'civil'
                ? 'do dia 1 ao último de cada mês'
                : 'do seu ciclo'}
            </ThemedText>
          </View>
          <View style={styles.temaControl}>
            <Segmented
              value={cycle.data?.view ?? 'cycle'}
              onChange={(v) => {
                Haptics.selectionAsync();
                setCycleView.mutate(v);
              }}
              options={[
                { value: 'civil', label: 'Mês' },
                { value: 'cycle', label: 'Ciclo' },
              ]}
            />
          </View>
        </View>
      ) : null}
    </Section>
  );

  return (
    <Screen
      grouped
      topBar={<AppHeader title="Perfil" />}
      onRefresh={() => {
        setNotificationRefreshKey((current) => current + 1);

        return Promise.all([profile.refetch(), plan.refetch(), ia.refetch()]);
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
                <ThemedText type="headline" themeColor="onHero">
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
        <View style={[styles.idStats, { flexWrap: 'wrap' }]}>
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
        **Conta é a PRIMEIRA seção**, logo abaixo do cartão de identidade (07/09/2026). Ela estava
        em quarto lugar, depois de Notificações — quem abria o Perfil para conferir "com que
        e-mail eu entrei" passava por dois blocos antes de chegar nisso.

        A ordem inteira da tela virou a convenção de quem faz isso há mais tempo — WhatsApp abre
        em *Conta*; o app de Ajustes do iOS põe o cartão de identidade e as linhas da conta no
        topo; Revolut e Nubank vão de perfil → plano → notificações. A régua que a literatura de
        UX repete é a mesma: o que é mais usado e mais identitário vem primeiro, e o número de
        seções de topo fica em quatro ou cinco.

        Dentro da seção a ordem é **Nome → e-mail → WhatsApp**: é a ordem em que uma pessoa diz
        quem é, e vai do que ela escolheu para o que confirma o vínculo.
      */}
      <Section title="Conta">
        <Row
          title="Nome"
          subtitle={nome ?? 'Ninguém te chama pelo nome ainda'}
          icon="person"
          onPress={() => setNameDraft(nome ?? '')}
        />
        <Row
          title={emailDaConta ? 'Trocar e-mail da conta' : 'Cadastrar e-mail e senha'}
          subtitle={
            emailDaConta ??
            'Um segundo jeito de entrar — sem depender de continuar com este número'
          }
          icon="paperplane"
          onPress={() => router.push('/link-email')}
        />
        <Row
          title={phone ? 'Trocar número do WhatsApp' : 'Conectar o WhatsApp'}
          subtitle={
            phone
              ? phone
              : 'Libera o agente e os avisos neste canal depois da confirmação'
          }
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
              variant="ghost"
              size="sm"
              onPress={() => router.push('/profile/members')}
            />
          </View>
        </View>
      ) : null}

      {/*
        Notificações tem UM lugar: depois de Conta e Plano, antes de Dados.
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

      <Section title="Dados">
        <Row title="Lixeira de notas" icon="trash" onPress={() => router.push('/notes/trash')} />
        <Row title="Regras de categoria" icon="wand.and.stars" onPress={() => router.push('/finance/rules')} />
        <Row title="Importar extrato" icon="square.and.arrow.down" onPress={() => router.push('/import')} />
        <Row title="Importações" subtitle="histórico e revisões pendentes" icon="clock.arrow.circlepath" onPress={() => router.push('/import-history')} />
      </Section>

      {aparencia}
      {cicloConfig}

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
  /*
    `flexWrap`: com fonte grande o rótulo + os três segmentos não cabem na mesma linha, e apertar
    o controle partia "Sistema" em "Sistem/a" dentro da célula. Aqui quem cede é o LAYOUT — o
    segmentado desce inteiro para a linha de baixo (`minWidth` no controle é o gatilho).
    O `flexShrink: 0` no texto é o que faz o `flexWrap` valer: o Yoga prefere ENCOLHER a quebrar.
  */
  temaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  temaText: { flexShrink: 0, maxWidth: '100%' },
  /** Largura fixa: com `flex` o segmentado encolhia até o rótulo "Sistema" truncar. */
  /* Sem `width` fixa: com fonte grande "Sistema" não cabia em 200 e quebrava no meio da palavra.
     `minWidth` é o gatilho da quebra da linha acima; `flexGrow` faz o controle ocupar a linha
     inteira quando ele desce. */
  temaControl: { flexGrow: 1, minWidth: 240 },
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
