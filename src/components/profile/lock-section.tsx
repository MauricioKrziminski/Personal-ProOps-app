/**
 * "Bloquear o app" — a configuração da trava, no Perfil, ao lado do "esconder saldo".
 *
 * ⚠️ **Trava e olho são coisas DIFERENTES e ficam independentes.** A trava protege quem abre o
 * app; o olho protege quem olha por cima do ombro. Ligar uma não liga a outra — quem quer as duas
 * liga as duas, e quem quer só uma não ganha um efeito colateral que não pediu.
 *
 * ⚠️ **Não há "trocar a senha" aqui, e nem podia haver.** A senha é a do aparelho; trocá-la é nas
 * configurações do celular. Oferecer o caminho no app daria a entender que existe uma segunda
 * senha, que é exatamente o que esta versão deixou de ter.
 */

import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Note } from '@/components/ui/note';
import { Section } from '@/components/ui/row';
import { Segmented } from '@/components/ui/segmented';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useLock } from '@/hooks/use-lock';
import type { LockDelay, LockMode } from '@/lib/lock-policy';

const MODOS = [
  { value: 'off', label: 'Não' },
  { value: 'on', label: 'Sim' },
] as const;

const ESPERAS = [
  { value: '0', label: 'Na hora' },
  { value: '30', label: '30s' },
  { value: '60', label: '1 min' },
] as const;

export function LockSection() {
  const { mode, delaySeconds, disponivel, comoAutentica, configurar, definirEspera } = useLock();
  const toast = useToast();

  const escolher = async (novo: string) => {
    /*
      ⚠️ **Sem o try/catch isto falha em SILÊNCIO.** Uma exceção no `AsyncStorage` deixaria o
      segmentado voltando sozinho para a posição anterior, sem toast e sem log — a pessoa toca e
      não acontece nada. `design.md` §6: "mutation que falha precisa aparecer".
    */
    try {
      await configurar(novo as LockMode);
    } catch (e) {
      console.error('[lock] configurar falhou', e);
      toast({ message: 'Não deu para mudar o bloqueio.', tone: 'error' });
      return;
    }
    toast({ message: novo === 'off' ? 'Bloqueio desligado.' : 'Bloqueio ligado.', tone: 'success' });
  };

  return (
    <Section title="Bloqueio">
      <View style={styles.linha}>
        <View style={styles.texto}>
          <ThemedText type="default">Pedir para desbloquear ao abrir</ThemedText>
          {/* Desligado não ganha palavra: o segmentado ao lado já diz "Não". */}
          {!disponivel || mode !== 'off' ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              {disponivel ? comoAutentica : 'indisponível'}
            </ThemedText>
          ) : null}
        </View>
        {/*
          Sem bloqueio de tela no celular o controle nem aparece: ligado, ele trancaria o app num
          prompt que nunca abre — e não existe senha nossa para servir de saída.
        */}
        {disponivel ? (
          <View style={styles.controle}>
            <Segmented value={mode} onChange={(v: LockMode) => void escolher(v)} options={MODOS} />
          </View>
        ) : null}
      </View>

      {!disponivel ? (
        <View style={styles.aviso}>
          <Note icon="exclamationmark.triangle">
            Este celular não tem bloqueio de tela. Configure uma senha, padrão ou biometria nos
            ajustes do aparelho e o bloqueio do app fica disponível.
          </Note>
        </View>
      ) : null}

      {disponivel && mode !== 'off' ? (
        <View style={styles.linha}>
          <View style={styles.texto}>
            <ThemedText type="default">Depois de sair do app</ThemedText>
          </View>
          <View style={styles.controle}>
            <Segmented
              value={String(delaySeconds)}
              onChange={(v) => void definirEspera(Number(v) as LockDelay)}
              options={ESPERAS}
            />
          </View>
        </View>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  /*
    Copiado do `temaRow` do Perfil, e cada propriedade tem motivo — a primeira versão daqui usava
    `flex: 1` no texto e o rótulo ERA ESPREMIDO ATÉ SUMIR, deixando o segmentado sozinho numa
    caixa alta e vazia. `flexShrink: 0` é o que faz o `flexWrap` valer (o Yoga prefere encolher a
    quebrar), e o `minWidth` no controle é o gatilho da quebra: com fonte grande o segmentado
    desce para a linha de baixo inteiro, em vez de truncar o rótulo.
  */
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  texto: { flexShrink: 0, maxWidth: '100%', gap: Space.half },
  controle: { flexGrow: 1, minWidth: 240 },
  aviso: { paddingHorizontal: Space.lg, paddingBottom: Space.md },
});
