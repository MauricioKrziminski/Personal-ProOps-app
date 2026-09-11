import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  FadeOutLeft,
  FadeOutRight,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type BaseAnimationBuilder,
} from 'react-native-reanimated';

import { AlertPreferencesSection } from '@/components/profile/alert-preferences-section';
import { CycleDayPicker } from '@/components/finance/cycle-day-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { GradientSurface } from '@/components/ui/gradient';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import { TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { HitTarget, Motion, Radius, Space } from '@/design/tokens';
import { useCycle, useSetCycleCloseDay } from '@/hooks/use-finance';
import { useProfile, useUpdateProfile } from '@/hooks/use-profile';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

/**
 * Onboarding — quatro passos, vistos uma vez na vida.
 *
 * ## Por que o movimento aqui é diferente do resto do app
 *
 * `design.md` §5 decide animação por FREQUÊNCIA, e é por isso que o app é sóbrio: trocar de aba
 * acontece 100× por dia e não pode virar coreografia. **Esta tela é o extremo oposto da mesma
 * régua** — ela é vista UMA vez, e é a única chance de o app dizer quem ele é antes de virar
 * ferramenta. Aqui o delight é o comportamento correto, não a exceção; nas telas de uso diário a
 * disciplina continua valendo linha por linha.
 *
 * ## Por que o passo é ESTADO, e não rota
 *
 * O portão de sessão (`Stack.Protected` no `_layout.tsx` raiz) é o que faz `(tabs)` e as ~30
 * telas de detalhe **não existirem na árvore** enquanto a flag de onboarding é falsa. Quatro
 * rotas obrigariam a mexer nesse portão para nada: o passo é estado interno de uma tarefa, não
 * um destino que alguém compartilha por link. Sair continua sendo porta de mão única (`replace`).
 *
 * ## O que NÃO se pergunta aqui
 *
 * Tema (o app segue o aparelho e o Perfil troca em dois toques) e WhatsApp (pedir um número
 * antes de a pessoa ver o produto é a barreira de entrada que a migração de auth existiu para
 * derrubar). Passo que não muda nada no primeiro dia é passo que se pula sem ler.
 */

const TOTAL = 4;

/** Cada linha do passo ① é uma promessa do produto — três, porque a quarta ninguém lê. */
const PROMESSAS = [
  {
    icon: 'bubble.left.and.bubble.right' as const,
    titulo: 'Fale do seu jeito',
    texto: '“gastei 45 no mercado” já vira lançamento.',
  },
  {
    icon: 'chart.pie' as const,
    titulo: 'O app organiza',
    texto: 'Contas, cartões, orçamento e projeção — sem planilha.',
  },
  {
    icon: 'bell.badge' as const,
    titulo: 'E avisa antes',
    texto: 'Fatura fechando, orçamento estourando, receita que não caiu.',
  },
];

export default function OnboardingScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { session } = useSession();
  const userId = session?.user.id;
  const profile = useProfile(userId);
  const updateProfile = useUpdateProfile(userId);
  const cycle = useCycle();
  const setCloseDay = useSetCycleCloseDay();
  const reduzido = useReducedMotion();

  const [passo, setPasso] = useState(0);
  /** O lado de onde o conteúdo entra. Voltar tem que devolver o passo pelo caminho que ele veio. */
  const [sentido, setSentido] = useState(1);
  const [saving, setSaving] = useState(false);

  /** `null` = a pessoa ainda não digitou; o valor mostrado é o que já existe no perfil. */
  const [nome, setNome] = useState<string | null>(null);
  /** `undefined` = ainda não escolheu nesta tela; `null` é escolha válida (último dia do mês). */
  const [diaDoCiclo, setDiaDoCiclo] = useState<number | null | undefined>(undefined);
  const diaEscolhido = diaDoCiclo === undefined ? (cycle.data?.closeDay ?? null) : diaDoCiclo;

  /**
   * Movimento espacial vira cross-fade com Reduce Motion ligado.
   *
   * Não é enfeite de acessibilidade: quem liga isso liga porque deslize lateral causa enjoo, e
   * quatro passos deslizando é exatamente o gatilho.
   */
  const entra = (anim: BaseAnimationBuilder) =>
    reduzido ? FadeIn.duration(Motion.duration.base) : anim;

  const irPara = (destino: number) => {
    Haptics.selectionAsync();
    setSentido(destino > passo ? 1 : -1);
    setPasso(destino);
  };

  /*
    Voltar no Android anda um passo para trás; no primeiro passo ele é ENGOLIDO.
    Deixar passar fecharia o app no meio do cadastro — e voltar não pode desfazer a criação da
    conta, que é o que estaria "atrás" desta tela.
  */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (passo > 0) irPara(passo - 1);
      return true;
    });
    return () => sub.remove();
  });

  const finish = async () => {
    if (!userId || saving) return;
    setSaving(true);
    try {
      if (nome !== null) await updateProfile.mutateAsync({ display_name: nome.trim() || null });
      if (diaDoCiclo !== undefined && diaDoCiclo !== (cycle.data?.closeDay ?? null)) {
        await setCloseDay.mutateAsync(diaDoCiclo);
      }
      // Preferência de apresentação: metadata editável nunca controla acesso.
      const { error } = await supabase.auth.updateUser({ data: { onboarding_completed: true } });
      if (error) throw error;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/');
    } catch {
      toast({ message: 'Não deu para salvar. Tente de novo.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const avancar = () => (passo === TOTAL - 1 ? void finish() : irPara(passo + 1));

  const conteudo = [
    <PassoBoasVindas key="0" entra={entra} />,
    <PassoNome
      key="1"
      entra={entra}
      valor={nome ?? profile.data?.display_name ?? ''}
      onChange={setNome}
      editavel={!profile.isLoading}
    />,
    <PassoCiclo key="2" entra={entra} valor={diaEscolhido} onChange={setDiaDoCiclo} />,
    <PassoAvisos key="3" entra={entra} userId={userId} />,
  ][passo];

  return (
    <View style={[styles.root, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topo}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar um passo"
          disabled={passo === 0}
          onPress={() => irPara(passo - 1)}
          style={styles.voltar}>
          {passo > 0 ? <Icon name="chevron.left" size="md" color="textSecondary" /> : null}
        </Pressable>

        <View style={styles.progresso}>
          {Array.from({ length: TOTAL }, (_, i) => (
            <Trilho key={i} cheio={i <= passo} />
          ))}
        </View>

        {/*
          O contrapeso da seta. Sem ele a barra fica encostada na direita e recuada na esquerda
          por uma seta que, no primeiro passo, não existe — lia como desalinhamento
          (*"o step lá em cima não está ficando no centro da tela… está mais para a direita"*).
          Com os dois lados reservados, a barra é a mesma em todos os quatro passos.
        */}
        <View style={styles.voltar} />
      </View>

      {/*
        ⚠️ **O rodapé NÃO sobe com o teclado, e isso é decisão do dono do produto** —
        *"quando você clica para digitar, o botão sobe junto ao invés de ficar no final da
        página"*. O botão mora no fim da página e fica lá.

        O que faz isso funcionar é o campo não roubar o foco sozinho: sem `autoFocus`, a pessoa
        CHEGA no passo vendo o campo e os dois botões, e o teclado só cobre o rodapé depois de
        ela tocar para digitar — com `returnKeyType="done"` devolvendo a tela num toque. Foi com
        `autoFocus` que o teclado engolia os botões antes de qualquer escolha, e é por isso que
        as duas coisas andam juntas.
      */}
      <View style={styles.corpo}>
        {/*
          ⚠️ **A barra de rolagem FICA.** Com fonte 1,3× em 384dp o passo dos avisos passa da
          tela — e aí o corte na borda de baixo é a única coisa que diz que há mais conteúdo.
          Escondê-la (o padrão do resto do app, onde nada corta) deixava o exemplo do aviso
          cortado ao meio parecendo defeito de layout.
        */}
        <ScrollView
          contentContainerStyle={styles.corpoConteudo}
          keyboardShouldPersistTaps="handled">
          <Animated.View
            key={passo}
            entering={entra(
              (sentido > 0 ? FadeInRight : FadeInLeft)
                .duration(Motion.duration.slow)
                .easing(Motion.easing.out),
            )}
            exiting={
              reduzido
                ? undefined
                : (sentido > 0 ? FadeOutLeft : FadeOutRight).duration(Motion.duration.exit)
            }
            style={styles.passo}>
            {conteudo}
          </Animated.View>
        </ScrollView>

        <View style={[styles.rodape, { paddingBottom: insets.bottom + Space.lg }]}>
          <Button
            label={passo === TOTAL - 1 ? 'Começar a usar' : passo === 0 ? 'Vamos lá' : 'Continuar'}
            onPress={avancar}
            loading={saving}
            block
          />
          {/* Pular existe só onde a resposta é opcional de verdade — nome e avisos. */}
          {passo === 1 || passo === 2 ? (
            <Button label="Agora não" variant="ghost" onPress={() => irPara(passo + 1)} block />
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * Um segmento da barra de progresso.
 *
 * `scaleX` com origem à esquerda, nunca `width`: largura anima no layout e sai da UI thread —
 * a barra pularia junto com a transição do passo, que é o único momento em que ela se move.
 */
function Trilho({ cheio }: { cheio: boolean }) {
  const theme = useTheme();
  const estilo = useAnimatedStyle(() => ({
    transform: [
      {
        scaleX: withTiming(cheio ? 1 : 0, {
          duration: Motion.duration.slow,
          easing: Motion.easing.out,
        }),
      },
    ],
  }));

  return (
    <View style={[styles.trilho, { backgroundColor: theme.separator }]}>
      <Animated.View style={[styles.trilhoCheio, { backgroundColor: theme.tint }, estilo]} />
    </View>
  );
}

function PassoBoasVindas({ entra }: { entra: (a: BaseAnimationBuilder) => BaseAnimationBuilder }) {
  const theme = useTheme();
  const chegada = useSharedValue(0);

  useEffect(() => {
    chegada.set(withSpring(1, Motion.spring.sheet));
  }, [chegada]);

  /*
    A marca ENTRA girando e crescendo — meia volta, uma vez, no primeiro quadro da primeira
    tela do app. É o §2b levado a sério: a identidade é monocromática, então quem carrega a
    personalidade é a FORMA, e o único lugar onde ela pode se apresentar sozinha é aqui.
  */
  const estiloMarca = useAnimatedStyle(() => {
    const t = chegada.get();
    return { transform: [{ scale: 0.4 + t * 0.6 }, { rotate: `${(1 - t) * -180}deg` }] };
  });

  return (
    <>
      <Animated.View
        entering={entra(FadeInDown.duration(Motion.duration.slow).easing(Motion.easing.out))}
        style={[styles.hero, { borderColor: theme.cardBorder, backgroundColor: theme.heroBottom }]}>
        <GradientSurface from={theme.heroTop} to={theme.heroBottom} sheen={`${theme.tint}2E`} />
        <Animated.View style={estiloMarca}>
          <Mark size={128} color="onHero" />
        </Animated.View>
      </Animated.View>

      <Animated.View
        entering={entra(
          FadeInDown.delay(Motion.stagger.step * 2)
            .duration(Motion.duration.slow)
            .easing(Motion.easing.out),
        )}
        style={styles.titulo}>
        <ThemedText type="title">Seu dinheiro,{'\n'}em ordem.</ThemedText>
        <ThemedText themeColor="textSecondary">
          Três coisas, e o app já vale o primeiro dia.
        </ThemedText>
      </Animated.View>

      {PROMESSAS.map((promessa, i) => (
        <Animated.View
          key={promessa.titulo}
          entering={entra(
            FadeInDown.delay(Motion.stagger.step * (i + 4))
              .duration(Motion.duration.slow)
              .easing(Motion.easing.out),
          )}
          style={styles.promessa}>
          <View style={[styles.promessaIcone, { backgroundColor: theme.surface }]}>
            <Icon name={promessa.icon} size="md" color="tint" />
          </View>
          <View style={styles.promessaTexto}>
            <ThemedText type="headline">{promessa.titulo}</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {promessa.texto}
            </ThemedText>
          </View>
        </Animated.View>
      ))}
    </>
  );
}

function PassoNome({
  entra,
  valor,
  onChange,
  editavel,
}: {
  entra: (a: BaseAnimationBuilder) => BaseAnimationBuilder;
  valor: string;
  onChange: (v: string) => void;
  editavel: boolean;
}) {
  return (
    <View style={styles.distribuido}>
      <Cabecalho
        entra={entra}
        icone="person.crop.circle"
        titulo="Como te chamo?"
        /*
          ⚠️ **Não escrever o EFEITO na tela ("aparece no Bom dia").** A queixa foi literal —
          *"o cara vai preencher o nome somente para aparecer no bom dia? Horrível isso"* —, e
          ela está certa: um campo se justifica pelo que ele muda para a pessoa, não por onde o
          valor é impresso. O que ele muda é o app inteiro parar de falar com um cadastro.
        */
        texto="Para o app falar com você, e não com um cadastro."
      />
      <Animated.View
        entering={entra(
          FadeInDown.delay(Motion.stagger.step * 3)
            .duration(Motion.duration.slow)
            .easing(Motion.easing.out),
        )}
        style={styles.controle}>
        <TextField
          accessibilityLabel="Seu nome"
          placeholder="Seu nome"
          value={valor}
          onChangeText={onChange}
          maxLength={100}
          editable={editavel}
          autoCapitalize="words"
          returnKeyType="done"
        />
      </Animated.View>
    </View>
  );
}

function PassoCiclo({
  entra,
  valor,
  onChange,
}: {
  entra: (a: BaseAnimationBuilder) => BaseAnimationBuilder;
  valor: number | null;
  onChange: (dia: number | null) => void;
}) {
  return (
    <View style={styles.distribuido}>
      <Cabecalho
        entra={entra}
        icone="calendar"
        titulo="Quando fecha o seu mês?"
        texto="Se você paga tudo num dia só, o seu mês começa no dia seguinte a ele — não no dia 1."
      />
      <Animated.View
        entering={entra(
          FadeInDown.delay(Motion.stagger.step * 3)
            .duration(Motion.duration.slow)
            .easing(Motion.easing.out),
        )}
        style={styles.controle}>
        <CycleDayPicker value={valor} onChange={onChange} />
      </Animated.View>
    </View>
  );
}

function PassoAvisos({
  entra,
  userId,
}: {
  entra: (a: BaseAnimationBuilder) => BaseAnimationBuilder;
  userId?: string;
}) {
  const theme = useTheme();
  const { session } = useSession();
  return (
    <View style={styles.distribuido}>
      <Cabecalho
        entra={entra}
        icone="bell.badge"
        titulo="Quer que eu te avise?"
        texto="Só o que muda uma decisão: fatura fechando, orçamento no limite, receita que não caiu."
      />
      <Animated.View
        entering={entra(
          FadeInDown.delay(Motion.stagger.step * 3)
            .duration(Motion.duration.slow)
            .easing(Motion.easing.out),
        )}
        style={styles.controle}>
        <AlertPreferencesSection
          userId={userId}
          hasVerifiedPhone={!!session?.user.phone_confirmed_at}
          showHistory={false}
        />

        {/*
          Uma amostra do que a pessoa está ligando.

          Ela não está aqui para preencher tela: "avisos financeiros" é uma promessa vaga, e o
          medo real de quem lê isso é o app virar mais uma fonte de notificação inútil. Mostrar
          UM aviso de verdade — com valor, prazo e a ação no fim — é o que responde isso, e é a
          mesma régua do `alerts.py`: aviso que só informa é o que faz desinstalar no segundo mês.
        */}
        <View style={[styles.exemplo, { borderColor: theme.cardBorder }]}>
          <View style={[styles.exemploIcone, { backgroundColor: theme.tint }]}>
            <Icon name="bell.badge" size="sm" color="onTint" />
          </View>
          <ThemedText type="footnote" style={styles.exemploTexto}>
            Sua fatura fecha amanhã — R$ 1.350,00 até agora. Quer adiar?
          </ThemedText>
        </View>
      </Animated.View>
    </View>
  );
}

/** Ícone + título + uma linha. O mesmo esqueleto nos três passos de pergunta. */
function Cabecalho({
  entra,
  icone,
  titulo,
  texto,
}: {
  entra: (a: BaseAnimationBuilder) => BaseAnimationBuilder;
  icone: Parameters<typeof Icon>[0]['name'];
  titulo: string;
  texto: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.cabecalho}>
      <Animated.View
        entering={entra(FadeInDown.duration(Motion.duration.slow).easing(Motion.easing.out))}
        style={[styles.cabecalhoIcone, { backgroundColor: theme.surface }]}>
        <Icon name={icone} size="lg" color="tint" />
      </Animated.View>
      <Animated.View
        entering={entra(
          FadeInDown.delay(Motion.stagger.step)
            .duration(Motion.duration.slow)
            .easing(Motion.easing.out),
        )}
        style={styles.titulo}>
        <ThemedText type="title">{titulo}</ThemedText>
        <ThemedText themeColor="textSecondary">{texto}</ThemedText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topo: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Space.xs,
    paddingTop: Space.md,
  },
  /* Ocupa o mesmo espaço com e sem a seta: a barra não pode escorregar ao trocar de passo. */
  voltar: {
    width: HitTarget,
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progresso: { flex: 1, flexDirection: 'row', gap: Space.xs },
  trilho: {
    flex: 1,
    height: 3,
    borderRadius: Radius.xs,
    overflow: 'hidden',
  },
  trilhoCheio: { flex: 1, transformOrigin: 'left' },
  corpo: { flex: 1 },
  /*
    ⚠️ **O conteúdo é ancorado no TOPO, e centrar foi testado e devolvido.**

    Com `justifyContent: 'center'` cada passo ficava uma faixa no meio da tela, com um vazio
    grande acima e outro abaixo: o título descolava da barra de progresso, o olho não tinha por
    onde começar e a queixa foi literal — *"esta tudo grudado no centro da tela"*. Quem preenche
    a folga é o CONTEÚDO (o painel do passo ① cresce), não um espaço morto no topo.
  */
  corpoConteudo: {
    flexGrow: 1,
    paddingHorizontal: Space.lg,
    paddingTop: Space.xxl,
    paddingBottom: Space.xl,
  },
  passo: { flex: 1, gap: Space.xl },
  /*
    **A folga da tela vira UM respiro, não uma poça de preto no fim.**

    Os passos de pergunta têm dois blocos — o que PERGUNTA (ícone, título, uma linha) e o que
    RESPONDE (campo, grade, interruptores). Empilhados com `gap`, sobravam ~500dp mortos embaixo,
    e tudo o que era conteúdo ficava espremido contra a barra de progresso: foi a queixa
    *"ficou tudo em cima… tem muito espaço sobrando e muitos componentes grudados"*.

    Com `space-between` a sobra vira o intervalo ENTRE a pergunta e a resposta: a pergunta abre
    a tela, a resposta encosta no botão que a confirma, e o vazio some porque virou hierarquia.
  */
  /* `xxxl + lg`: o maior degrau da escala ainda deixava a resposta colada na pergunta. */
  distribuido: { flex: 1, gap: Space.xxxl + Space.lg },
  /*
    ⚠️ **A resposta vem LOGO ABAIXO da pergunta, com um respiro grande — não centrada.**

    Duas tentativas foram devolvidas pelo dono do produto, e as duas erravam por mover a folga
    em vez de decidir onde ela mora: `space-between` jogava a resposta contra o botão e abria um
    buraco de ~700dp no meio; centrar na área livre deixava o bloco *"muito para baixo"*. A folga
    fica no FIM, que é onde ela não separa nada — o que a pergunta e a resposta têm entre si é um
    respiro declarado (`xxxl`), não o resto da divisão.
  */
  controle: { flex: 1, gap: Space.lg },
  /* Não é um `Card`: card é superfície de conteúdo, e isto é a CITAÇÃO de um aviso. */
  exemplo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  exemploIcone: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  exemploTexto: { flex: 1 },
  /*
    O painel é quem COME a folga da tela: `flex: 1` com piso de 160 e sem teto.

    Com altura fixa sobrava uma faixa morta de ~180dp entre a última promessa e o botão, em todo
    aparelho. Deixando ele esticar, a folga vira marca — o bloco da identidade ocupa o topo da
    primeira tela do app —, e numa tela baixa ele encolhe até 160 em vez de empurrar as três
    promessas para fora da área visível.
  */
  hero: {
    flex: 1,
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  cabecalho: { gap: Space.lg },
  titulo: { gap: Space.md },
  promessa: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  /* Geometria fixa: o ícone mora num ladrilho, e ladrilho não cresce com a fonte. */
  promessaIcone: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  promessaTexto: { flex: 1, gap: Space.half },
  cabecalhoIcone: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  rodape: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
    gap: Space.xs,
  },
});
