import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { QuantityField } from '@/components/ui/quantity-field';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { TaskHeader } from '@/components/ui/task-header';
import { TimePicker } from '@/components/ui/time-picker';
import { ToastDoModal, useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useBillReminderFor, useSaveBillReminder } from '@/hooks/use-bill-reminders';
import { useAlertPreferences } from '@/hooks/use-push';
import { useSession } from '@/hooks/use-session';
import { AVISO_PADRAO, alvoDoParam, type Aviso } from '@/lib/lembrete-de-conta';

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
  const [escopo, setEscopo] = useState<'so' | 'todas'>('so');
  const alvo = escopo === 'todas' && alvoTodas ? alvoTodas : alvoSo;
  const existente = useBillReminderFor(alvo);
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [canal, setCanal] = useState<Canal | null>(null);
  const [horaAberta, setHoraAberta] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const salvar = useSaveBillReminder();
  const { session } = useSession();
  const prefs = useAlertPreferences(session?.user.id);

  const lista = avisos ?? existente?.avisos ?? [AVISO_PADRAO];
  const canalAtual = canal ?? existente?.channel ?? 'push';
  const mudar = (i: number, parte: Partial<Aviso>) => setAvisos(lista.map((a, j) => (j === i ? { ...a, ...parte } : a)));

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
    if (!lista.length) return setErro('Adicione pelo menos um aviso');
    setErro(null);
    gravar(lista);
  };

  const semWhatsApp = canalAtual !== 'push' && prefs.data && !prefs.data.whatsapp;

  return (
    <Screen>
      <TaskHeader
        title={existente ? 'Editar lembrete' : 'Lembrar'}
        onClose={() => router.back()}
        action={
          <Button label="Salvar" size="sm" loading={salvar.isPending} disabled={salvar.isPending} onPress={onSalvar} />
        }
      />
      <View style={styles.corpo}>
        <ThemedText type="subtitle">{nome}</ThemedText>
        {alvoTodas ? (
          <Segmented
            options={[{ value: 'so', label: 'Só esta' }, { value: 'todas', label: 'Todas as próximas' }]}
            value={escopo}
            onChange={(v) => { setEscopo(v); setAvisos(null); setCanal(null); setErro(null); }}
          />
        ) : null}
        <Card>
          <Field label="Avisar" error={erro ?? undefined}>
            {lista.map((a, i) => (
              <View key={i} style={styles.aviso}>
                <QuantityField
                  value={a.days_before}
                  min={0}
                  max={30}
                  onChange={(n) => mudar(i, { days_before: n })}
                  accessibilityLabel="Dias antes"
                />
                <ThemedText type="small">{a.days_before === 0 ? 'no dia' : 'dias antes'}</ThemedText>
                <Pressable accessibilityRole="button" accessibilityLabel={`Hora, ${a.at_time}`} onPress={() => setHoraAberta(i)}>
                  <ThemedText type="smallBold">{a.at_time}</ThemedText>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Tirar aviso" hitSlop={12}
                  onPress={() => setAvisos(lista.filter((_, j) => j !== i))}>
                  <ThemedText type="small">✕</ThemedText>
                </Pressable>
              </View>
            ))}
            <Button label="Adicionar aviso" variant="secondary" size="sm"
              onPress={() => { setErro(null); setAvisos([...lista, AVISO_PADRAO]); }} />
          </Field>
          {horaAberta !== null ? (
            <TimePicker value={lista[horaAberta]?.at_time ?? AVISO_PADRAO.at_time}
              onChange={(h) => mudar(horaAberta, { at_time: h })}
              onClose={() => setHoraAberta(null)} />
          ) : null}
        </Card>
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
  aviso: { flexDirection: 'row', alignItems: 'center', gap: Space.md, flexWrap: 'wrap' },
});
