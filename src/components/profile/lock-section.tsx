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

import { Note } from '@/components/ui/note';
import { Row } from '@/components/ui/row';
import { Interruptor } from '@/components/ui/switch-row';
import { ThemedText } from '@/components/themed-text';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useLock } from '@/hooks/use-lock';
import { showItemActions } from '@/lib/item-actions';
import type { LockDelay } from '@/lib/lock-policy';

const ESPERAS: { value: LockDelay; label: string }[] = [
  { value: 0, label: 'Na hora' },
  { value: 30, label: '30 s' },
  { value: 60, label: '1 min' },
];

/**
 * As linhas do bloqueio, sem `Section`: quem embute escolhe o título (Perfil → Segurança e aparência).
 * Ligar é sim/não, então é interruptor; a espera é uma escolha curta, então é linha com o valor à
 * direita que abre o menu nativo — dois segmentados empilhados liam como formulário, não ajuste.
 */
export function LockRows() {
  const { mode, delaySeconds, disponivel, comoAutentica, configurar, definirEspera } = useLock();
  const toast = useToast();
  const ligado = mode !== 'off';

  const escolher = async (ligar: boolean) => {
    /*
      ⚠️ **Sem o try/catch isto falha em SILÊNCIO.** Uma exceção no `AsyncStorage` deixaria o
      interruptor voltando sozinho para a posição anterior, sem toast e sem log — a pessoa toca e
      não acontece nada. `design.md` §6: "mutation que falha precisa aparecer".
    */
    try {
      await configurar(ligar ? 'on' : 'off');
    } catch (e) {
      console.error('[lock] configurar falhou', e);
      toast({ message: 'Não deu para mudar o bloqueio.', tone: 'error' });
      return;
    }
    toast({ message: ligar ? 'Bloqueio ligado.' : 'Bloqueio desligado.', tone: 'success' });
  };

  /*
    Sem bloqueio de tela no celular o interruptor nem aparece: ligado, ele trancaria o app num
    prompt que nunca abre — e não existe senha nossa para servir de saída.
  */
  if (!disponivel) {
    return (
      <View>
        <Row title="Pedir para desbloquear ao abrir" subtitle="Indisponível" icon="lock" />
        <View style={styles.aviso}>
          <Note icon="exclamationmark.triangle">Ative o bloqueio de tela do celular</Note>
        </View>
      </View>
    );
  }

  const espera = ESPERAS.find((e) => e.value === delaySeconds) ?? ESPERAS[0];
  return (
    <>
      <Row
        title="Pedir para desbloquear ao abrir"
        subtitle={ligado ? comoAutentica : undefined}
        icon="lock"
        trailing={<Interruptor value={ligado} onValueChange={(v) => void escolher(v)} accessibilityLabel="Pedir para desbloquear ao abrir" />}
      />
      {ligado ? (
        <Row
          title="Depois de sair do app"
          icon="timer"
          chevron={false}
          trailing={<ThemedText type="default" themeColor="textSecondary">{espera.label}</ThemedText>}
          accessibilityLabel={`Depois de sair do app: ${espera.label}`}
          onPress={() =>
            showItemActions(
              'Pedir de novo depois de sair',
              ESPERAS.map((e) => ({ label: e.label, selected: e.value === delaySeconds, onPress: () => void definirEspera(e.value) }))
            )
          }
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  aviso: { paddingHorizontal: Space.lg, paddingBottom: Space.md },
});
