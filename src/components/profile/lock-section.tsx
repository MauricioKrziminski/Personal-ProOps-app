/**
 * "Bloquear o app" — a configuração da trava, no Perfil, ao lado do "esconder saldo".
 *
 * ⚠️ **Trava e olho são coisas DIFERENTES e ficam independentes.** A trava protege quem abre o
 * app; o olho protege quem olha por cima do ombro. Ligar uma não liga a outra — quem quer as duas
 * liga as duas, e quem quer só uma não ganha um efeito colateral que não pediu.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Row, Section } from '@/components/ui/row';
import { Segmented } from '@/components/ui/segmented';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Field, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useLock } from '@/hooks/use-lock';
import type { LockDelay, LockMode } from '@/lib/lock-policy';
import { TAMANHO_PIN } from '@/lib/lock-secret';

// Tupla, não array: o `Segmented` aceita de 2 a 4 opções NO TIPO — é a regra anti-slop
// ("a partir de 5 o rótulo parte no meio da palavra") escrita onde o compilador cobra.
/**
 * Os dois conjuntos de modo — dois, porque a biometria só existe onde há digital/face cadastrada.
 *
 * ⚠️ **Ficam FORA do JSX de propósito.** Inline, o ternário coloca 5 objetos `{ value: ... }`
 * dentro de um `<Segmented>` e o guarda `'Segmented não passa de 4 opções'` conta os cinco — um
 * falso positivo, já que cada RAMO tem 2 ou 3. Como extrair tira o call site do alcance do
 * guarda, `lock-section.test.ts` repõe a checagem sobre estas duas constantes.
 */
export const MODOS_COM_BIOMETRIA = [
  { value: 'off', label: 'Não' },
  { value: 'pin', label: 'Senha' },
  { value: 'biometric', label: 'Biometria' },
] as const;

export const MODOS_SEM_BIOMETRIA = [
  { value: 'off', label: 'Não' },
  { value: 'pin', label: 'Senha' },
] as const;

export const ESPERAS = [
  { value: '0', label: 'Na hora' },
  { value: '30', label: '30s' },
  { value: '60', label: '1 min' },
] as const;

export function LockSection() {
  const { mode, delaySeconds, biometriaDisponivel, configurar, definirEspera } = useLock();
  const toast = useToast();
  const [pedindoPin, setPedindoPin] = useState<LockMode | null>(null);
  const [pin, setPin] = useState('');
  const [confirma, setConfirma] = useState('');

  const fechar = () => {
    setPedindoPin(null);
    setPin('');
    setConfirma('');
  };

  const escolher = async (novo: string) => {
    const m = novo as LockMode;
    if (m === 'off') {
      await configurar('off').catch((e) => console.error('[lock] desligar falhou', e));
      toast({ message: 'Bloqueio desligado.', tone: 'success' });
      return;
    }
    // Já existe PIN: trocar entre `pin` e `biometric` não precisa redigitar.
    if (mode !== 'off') {
      await configurar(m);
      toast({ message: 'Bloqueio atualizado.', tone: 'success' });
      return;
    }
    setPedindoPin(m);
  };

  const salvarPin = async () => {
    if (pin.length !== TAMANHO_PIN) {
      toast({ message: `A senha tem ${TAMANHO_PIN} dígitos.`, tone: 'error' });
      return;
    }
    if (pin !== confirma) {
      toast({ message: 'As duas senhas não são iguais.', tone: 'error' });
      return;
    }
    /*
      ⚠️ **Sem o try/catch isto falha em SILÊNCIO.** Uma exceção em `definirPin` (SecureStore
      indisponível, Keystore sem chave) deixava o sheet aberto, sem toast e sem log — a pessoa
      toca em Salvar e não acontece nada. `design.md` §6: "mutation que falha precisa aparecer".
    */
    try {
      await configurar(pedindoPin!, pin);
    } catch (e) {
      console.error('[lock] definirPin falhou', e);
      toast({ message: 'Não deu para salvar a senha.', tone: 'error' });
      return;
    }
    fechar();
    toast({ message: 'Bloqueio ligado.', tone: 'success' });
  };

  return (
    <>
      <Section title="Bloqueio">
        <View style={styles.linha}>
          <View style={styles.texto}>
            <ThemedText type="default">Pedir senha ao abrir</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {mode === 'off'
                ? 'desligado'
                : mode === 'pin'
                  ? 'senha de 6 dígitos'
                  : 'biometria, com a senha como reserva'}
            </ThemedText>
          </View>
          <View style={styles.controle}>
            <Segmented
              value={mode}
              onChange={(v: LockMode) => void escolher(v)}
              // Sem digital/face cadastrada a opção nem aparece: um botão que só sabe falhar.
              options={biometriaDisponivel ? MODOS_COM_BIOMETRIA : MODOS_SEM_BIOMETRIA}
            />
          </View>
        </View>

        {mode !== 'off' ? (
          <View style={styles.linha}>
            <View style={styles.texto}>
              <ThemedText type="default">Depois de sair do app</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                quando volta a pedir
              </ThemedText>
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

        {mode !== 'off' ? (
          <Row
            title="Trocar a senha"
            chevron
            onPress={() => {
              setPin('');
              setConfirma('');
              setPedindoPin(mode);
            }}
          />
        ) : null}
      </Section>

      {mode !== 'off' ? (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.nota}>
          Esqueceu a senha? Saia da conta e entre de novo — o bloqueio é deste aparelho, seus dados
          ficam no servidor.
        </ThemedText>
      ) : null}

      <Sheet visible={pedindoPin !== null} onClose={fechar}>
        <TaskHeader title="Senha de 6 dígitos" onClose={fechar} />
        <View style={styles.form}>
          <Field label="Senha" hint="Protege quem pega o celular, não quem leva o aparelho.">
            <TextField
              value={pin}
              onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, TAMANHO_PIN))}
              keyboardType="number-pad"
              secureTextEntry
              autoFocus
            />
          </Field>
          <Field label="Repita a senha">
            <TextField
              value={confirma}
              onChangeText={(t) => setConfirma(t.replace(/\D/g, '').slice(0, TAMANHO_PIN))}
              keyboardType="number-pad"
              secureTextEntry
            />
          </Field>
          <Button label="Salvar" onPress={() => void salvarPin()} block />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  /*
    Copiado do `temaRow` do Perfil, e cada propriedade tem motivo — a primeira versão daqui usava
    `flex: 1` no texto e o rótulo ERA ESPREMIDO ATÉ SUMIR, deixando o segmentado sozinho numa
    caixa alta e vazia. `flexShrink: 0` é o que faz o `flexWrap` valer (o Yoga prefere encolher a
    quebrar), e o `minWidth` no controle é o gatilho da quebra: com fonte grande o segmentado
    desce para a linha de baixo inteiro, em vez de truncar "Biometria".
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
  nota: { paddingHorizontal: Space.xs },
  // O `Sheet` não padda o corpo — cada tela faz a própria calha (padrão de `rules.tsx`).
  form: { gap: Space.lg, padding: Space.lg },
});
