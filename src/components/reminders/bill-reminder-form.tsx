import { router } from 'expo-router';
import { useState } from 'react';
import * as Haptics from 'expo-haptics';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { QuantityField } from '@/components/ui/quantity-field';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { TaskHeader } from '@/components/ui/task-header';
import { TimePicker } from '@/components/ui/time-picker';
import { ToastDoModal, useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useBillReminderFor, useBillReminders, useSaveBillReminder } from '@/hooks/use-bill-reminders';
import { useAlertPreferences } from '@/hooks/use-push';
import { useSession } from '@/hooks/use-session';
import { AVISO_PADRAO, alvoDoParam, quandoDoAviso, type Aviso } from '@/lib/lembrete-de-conta';

const CANAIS = [
  { value: 'push', label: 'Push' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'both', label: 'Os dois' },
] as const;

type Canal = (typeof CANAIS)[number]['value'];

/** Lembrete pendurado num registro financeiro: quem manda na data é o vencimento (banco). */
export function BillReminderForm({ conta, todas, nome }: { conta: string; todas?: string; nome: string }) {
  const toast = useToast();
  const alvoSo = alvoDoParam(conta);
  const alvoTodas = todas ? alvoDoParam(todas) : null;
  const carregados = useBillReminders();
  const existenteSo = useBillReminderFor(alvoSo);
  const existenteTodas = useBillReminderFor(alvoTodas);
  // Abre onde o lembrete existe: ocorrência de série que só tem o da série abre em "Todas".
  const [escolhido, setEscopo] = useState<'so' | 'todas' | null>(null);
  const escopo = escolhido ?? (!existenteSo && existenteTodas ? 'todas' : 'so');
  const alvo = escopo === 'todas' && alvoTodas ? alvoTodas : alvoSo;
  const existente = escopo === 'todas' ? existenteTodas : existenteSo;
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [canal, setCanal] = useState<Canal | null>(null);
  const [aberto, setAberto] = useState<{ i: number; parte: 'dias' | 'hora' } | null>(null);
  const salvar = useSaveBillReminder();
  const { session } = useSession();
  const prefs = useAlertPreferences(session?.user.id);

  // Nunca vazio: o lembrete sem aviso se tira em "Remover lembrete", e só se tira um aviso havendo outro.
  const lista = avisos ?? (existente?.avisos.length ? existente.avisos : [AVISO_PADRAO]);
  const canalAtual = canal ?? existente?.channel ?? 'push';
  const mudar = (i: number, parte: Partial<Aviso>) => setAvisos(lista.map((a, j) => (j === i ? { ...a, ...parte } : a)));
  const alternar = (i: number, parte: 'dias' | 'hora') => {
    Haptics.selectionAsync();
    setAberto((atual) => (atual?.i === i && atual.parte === parte ? null : { i, parte }));
  };

  if (!alvo) {
    return (
      <Screen scroll={false}>
        <TaskHeader title="Lembrete" onClose={() => router.back()} />
        <View style={styles.corpo}>
          <ThemedText>Esse registro não existe mais.</ThemedText>
        </View>
      </Screen>
    );
  }

  const gravar = (novos: Aviso[]) =>
    salvar.mutate(
      { alvo, avisos: novos, channel: canalAtual },
      {
        onSuccess: () => {
          toast({ message: novos.length ? 'Lembrete salvo.' : 'Lembrete removido.', tone: 'success' });
          router.back();
        },
        onError: () => toast({ message: 'Não deu para salvar. Tenta de novo.', tone: 'error' }),
      },
    );

  const onSalvar = () => {
    if (!carregados.isSuccess) return;
    gravar(lista);
  };

  const semWhatsApp = canalAtual !== 'push' && prefs.data && !prefs.data.whatsapp;

  return (
    <Screen>
      <TaskHeader
        title={existente ? 'Editar lembrete' : 'Lembrar'}
        onClose={() => router.back()}
        action={
          <Button label="Salvar" size="sm" loading={salvar.isPending} disabled={salvar.isPending || !carregados.isSuccess} onPress={onSalvar} />
        }
      />
      <View style={styles.corpo}>
        <ThemedText type="subtitle">{nome}</ThemedText>
        {alvoTodas ? (
          <Segmented
            options={[{ value: 'so', label: 'Só esta' }, { value: 'todas', label: 'Todas as próximas' }]}
            value={escopo}
            onChange={(v) => { setEscopo(v); setAvisos(null); setCanal(null); setAberto(null); }}
          />
        ) : null}
        {/* Cada aviso é um grupo de duas linhas (Quando, Hora) com o valor à direita; o controle abre no
            lugar, como o "Quando" do lembrete comum. */}
        {lista.map((a, i) => {
          const quando = quandoDoAviso(a.days_before);
          const vale = (parte: 'dias' | 'hora') => aberto?.i === i && aberto.parte === parte;
          return (
            <Section key={i} title={lista.length > 1 ? `Aviso ${i + 1}` : 'Aviso'}>
              <Row icon="calendar" title="Quando" chevron={false} onPress={() => alternar(i, 'dias')}
                accessibilityLabel={`Quando: ${quando}`} accessibilityState={{ expanded: vale('dias') }}
                trailing={<ThemedText type="smallBold">{quando.charAt(0).toUpperCase() + quando.slice(1)}</ThemedText>} />
              {vale('dias') ? (
                <View style={styles.painel}>
                  <QuantityField value={a.days_before} min={0} max={30}
                    onChange={(n) => mudar(i, { days_before: n })} accessibilityLabel="Dias antes do vencimento" />
                </View>
              ) : null}
              <Row icon="clock" title="Hora" chevron={false} onPress={() => alternar(i, 'hora')}
                accessibilityLabel={`Hora: ${a.at_time}`} accessibilityState={{ expanded: vale('hora') }}
                trailing={<ThemedText type="smallBold">{a.at_time}</ThemedText>} />
              {vale('hora') ? (
                <TimePicker value={a.at_time} onChange={(h) => mudar(i, { at_time: h })}
                  onClose={() => setAberto(null)} inlineStyle={styles.painel} />
              ) : null}
              {lista.length > 1 ? (
                <Row icon="trash" title="Tirar este aviso" destructive chevron={false}
                  onPress={() => { setAberto(null); setAvisos(lista.filter((_, j) => j !== i)); }} />
              ) : null}
            </Section>
          );
        })}
        <Button label="Adicionar aviso" variant="secondary"
          onPress={() => { setAberto(null); setAvisos([...lista, AVISO_PADRAO]); }} />
        <Card>
          <Field label="Onde avisar"
            hint={semWhatsApp ? 'O WhatsApp está desligado no Perfil: não vai por lá.' : undefined}>
            <Segmented options={CANAIS} value={canalAtual} onChange={setCanal} />
          </Field>
          {semWhatsApp ? (
            <Button label="Ligar no Perfil" variant="secondary" size="sm" onPress={() => router.push('/profile/alerts')} />
          ) : null}
        </Card>
        {existente ? (
          <Button label="Remover lembrete" variant="secondary" tone="danger" onPress={() => gravar([])} />
        ) : null}
      </View>
      <ToastDoModal />
    </Screen>
  );
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl },
  painel: { paddingHorizontal: Space.lg, paddingVertical: Space.md },
});
