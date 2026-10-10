import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { useCortina } from '@/components/motion/session-curtain';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Row, RowSeparator } from '@/components/ui/row';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useSession } from '@/hooks/use-session';
import { authErrorMessage } from '@/lib/auth-errors';
import { confirmDestructive } from '@/lib/item-actions';
import { ondaDaTroca } from '@/lib/session-gate';
import { criarClienteDeRecuperacao, supabase } from '@/lib/supabase';

const MIN_SENHA = 8;

/**
 * Linhas de Segurança no Perfil: trocar a senha (só com identidade de e-mail) e sair de todos os
 * aparelhos. A senha atual é conferida num cliente DESCARTÁVEL (só memória, como o do
 * `forgot-password`): `signInWithPassword` no principal anunciaria um login que não é um.
 */
export function SegurancaRows() {
  const { session } = useSession();
  const toast = useToast();
  const cortina = useCortina();
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const email = session?.user.email ?? null;
  const temSenha = !!email && !!session?.user.identities?.some((i) => i.provider === 'email');

  const fechar = () => {
    setAberto(false);
    setAtual('');
    setNova('');
    setConfirma('');
    setErro(null);
  };

  const trocar = async () => {
    if (!email || salvando) return;
    if (nova.length < MIN_SENHA) return setErro(`A senha nova precisa de pelo menos ${MIN_SENHA} caracteres.`);
    if (nova !== confirma) return setErro('As senhas novas não são iguais.');
    setErro(null);
    setSalvando(true);
    const conferencia = criarClienteDeRecuperacao();
    try {
      const { error: errAtual } = await conferencia.auth.signInWithPassword({ email, password: atual });
      if (errAtual) return setErro(errAtual.status === 400 ? 'A senha atual não confere.' : authErrorMessage(errAtual));
      const { error } = await supabase.auth.updateUser({ password: nova });
      if (error) return setErro(authErrorMessage(error));
      fechar();
      toast({ message: 'Senha trocada.', tone: 'success' });
    } catch {
      setErro('Não deu para trocar agora. Tente de novo.');
    } finally {
      void conferencia.auth.signOut({ scope: 'local' });
      setSalvando(false);
    }
  };

  const sairDeTodos = () => {
    cortina.preparar();
    confirmDestructive('Sair de todos os aparelhos?', 'Sair de todos', async () => {
      void cortina.cobrir(ondaDaTroca(null, null));
      try {
        const { error } = await supabase.auth.signOut({ scope: 'global' });
        if (error) throw error;
      } catch {
        cortina.cobrirJa();
        void cortina.revelar({ mode: 'up' }).catch(() => cortina.abrirJa());
        toast({ message: 'Não foi possível sair agora.', tone: 'error' });
      }
    });
  };

  return (
    <>
      {temSenha ? (
        <>
          <Row title="Trocar senha" icon="key" onPress={() => setAberto(true)} />
          <RowSeparator />
        </>
      ) : null}
      <Row title="Sair de todos os aparelhos" icon="rectangle.portrait.and.arrow.right" chevron={false} onPress={sairDeTodos} />

      <Sheet visible={aberto} onClose={fechar}>
        <TaskHeader
          title="Trocar senha"
          onClose={fechar}
          action={<Button label="Trocar" size="sm" loading={salvando} disabled={!atual || !nova || !confirma} onPress={() => { void trocar(); }} />}
        />
        <SheetScroll contentContainerStyle={styles.corpo}>
          <Field label="Senha atual" obrigatorio>
            <TextField value={atual} onChangeText={setAtual} secureTextEntry autoComplete="current-password" textContentType="password" autoFocus />
          </Field>
          <Field label="Senha nova" obrigatorio>
            <TextField value={nova} onChangeText={setNova} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
          </Field>
          <Field label="Repita a senha nova" obrigatorio error={erro ?? undefined}>
            <TextField value={confirma} onChangeText={setConfirma} secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="done" />
          </Field>
        </SheetScroll>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({ corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl } });
