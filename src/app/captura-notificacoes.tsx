import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { abrirAjustes, acessoConcedido, configurarCaptura, estadoDaCaptura } from '../../modules/proops-captura';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ButtonRow } from '@/components/ui/button-row';
import { Note } from '@/components/ui/note';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { Interruptor } from '@/components/ui/switch-row';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useConsentimento } from '@/hooks/use-consentimento';
import { bancosDisponiveis } from '@/lib/captura';

/**
 * Perfil → Lançar pelas notificações (Android). Ligar passa SEMPRE pelo aviso de destaque do
 * Google Play (User Data policy): a pessoa lê o que é lido e para onde vai, e só "Concordo e
 * ativar" liga a captura e abre o acesso do sistema. O aceite é o próprio `ativa`.
 */
export default function CapturaNotificacoes() {
  const toast = useToast();
  const consentimento = useConsentimento();
  const semIa = consentimento.isSuccess && !consentimento.data.ai_consent_at;
  const [estado, setEstado] = useState(estadoDaCaptura);
  const [acesso, setAcesso] = useState(acessoConcedido);
  const [aviso, setAviso] = useState(false);
  const reler = useCallback(() => { setEstado(estadoDaCaptura()); setAcesso(acessoConcedido()); }, []);
  // Voltar das configurações do Android traz o app ao primeiro plano: relê o acesso.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') reler(); });
    return () => sub.remove();
  }, [reler]);

  // O fallback nativo ainda pode lançar (aparelho sem a tela de ajustes): a pessoa precisa saber.
  const abrirSistema = (abrir: () => unknown) => {
    try {
      void Promise.resolve(abrir()).catch(() => toast({ message: 'Não deu para abrir as configurações.', tone: 'error' }));
    } catch {
      toast({ message: 'Não deu para abrir as configurações.', tone: 'error' });
    }
  };
  const abrirAcesso = () => abrirSistema(abrirAjustes);
  const abrirDetalhes = () => abrirSistema(() => IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
    { data: `package:${Application.applicationId}` },
  ));
  const abrirBateria = () => abrirSistema(() => IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
  ));

  const gravar = (ativa: boolean, pacotes: string[]) => { configurarCaptura(ativa, pacotes); reler(); };
  const concordar = () => {
    // Primeira vez: liga com todos os bancos marcados; a pessoa desmarca o que não usa.
    const pacotes = estado.pacotes.length ? estado.pacotes : bancosDisponiveis(__DEV__).map((b) => b.pacote);
    configurarCaptura(true, pacotes);
    reler();
    setAviso(false);
    if (!acessoConcedido()) abrirAcesso();
  };
  const alternar = (pacote: string, marcado: boolean) =>
    gravar(estado.ativa, marcado ? [...estado.pacotes, pacote] : estado.pacotes.filter((p) => p !== pacote));
  const irParaPrivacidade = () => { setAviso(false); router.navigate('/profile'); };

  return (
    <Screen grouped onRefresh={() => { reler(); return consentimento.refetch(); }}>
      <Section>
        <Row
          title="Ler notificações dos bancos"
          subtitle="Só dos bancos marcados. Nada é lançado sem você confirmar."
          trailing={
            <Interruptor
              value={estado.ativa}
              onValueChange={(v) => (v ? setAviso(true) : gravar(false, estado.pacotes))}
              accessibilityLabel="Ler notificações dos bancos"
            />
          }
        />
        {/* `ativa` volta do backup do Android sem o acesso: só o sistema diz se está concedido. */}
        {estado.ativa ? (
          <Row
            title="Acesso às notificações"
            subtitle={acesso ? 'Concedido' : 'Não concedido. Toque para liberar nas configurações do Android.'}
            onPress={acesso ? undefined : abrirAcesso}
            chevron={!acesso}
          />
        ) : null}
      </Section>

      {estado.ativa && !acesso ? (
        <View style={styles.bloco}>
          <Note icon="info.circle">
            Se a opção estiver bloqueada: Configurações → Apps → ProOps → ⋮ → Permitir configurações restritas, e depois ative o acesso.
          </Note>
          <Button label="Abrir detalhes do app" variant="secondary" size="sm" onPress={abrirDetalhes} />
        </View>
      ) : null}

      {estado.ativa && semIa ? (
        <View style={styles.bloco}>
          <Note icon="exclamationmark.triangle" tone="warning">
            Sem a autorização de IA as notificações ficam guardadas no aparelho e nada vira lançamento.
          </Note>
          <Button label="Autorizar em Privacidade e dados" variant="secondary" size="sm" onPress={irParaPrivacidade} />
        </View>
      ) : null}

      {estado.ativa ? (
        <Section title="Bancos">
          {bancosDisponiveis(__DEV__).map((b) => (
            <Row
              key={b.pacote}
              title={b.nome}
              trailing={
                <Interruptor
                  value={estado.pacotes.includes(b.pacote)}
                  onValueChange={(v) => alternar(b.pacote, v)}
                  accessibilityLabel={b.nome}
                />
              }
            />
          ))}
        </Section>
      ) : null}

      {estado.ativa ? (
        <View style={styles.bloco}>
          <Note icon="bolt">Se as compras pararem de aparecer, libere o ProOps da economia de bateria.</Note>
          <Button label="Ajustes de bateria" variant="secondary" size="sm" onPress={abrirBateria} />
        </View>
      ) : null}

      <Sheet visible={aviso} onClose={() => setAviso(false)}>
        <TaskHeader title="Antes de ativar" onClose={() => setAviso(false)} />
        <SheetScroll contentContainerStyle={styles.folha} keyboardShouldPersistTaps="handled">
          {semIa ? (
            <>
              <Note icon="exclamationmark.triangle" tone="warning">
                Para montar lançamentos das notificações, autorize antes o uso de IA em Perfil → Privacidade e dados.
              </Note>
              <ButtonRow>
                <Button label="Autorizar em Privacidade e dados" block onPress={irParaPrivacidade} />
                <Button label="Agora não" variant="secondary" block onPress={() => setAviso(false)} />
              </ButtonRow>
            </>
          ) : (
            <>
              <ThemedText>
                O ProOps lê as notificações dos bancos que você marcar e envia o texto delas ao nosso servidor, que usa IA (Anthropic e Google) para montar lançamentos que você confirma. As outras notificações nunca saem do aparelho, e nada é lançado sem você confirmar. Você pode desligar quando quiser.
              </ThemedText>
              {consentimento.isError ? (
                <Note icon="exclamationmark.triangle" tone="danger">
                  Não deu para conferir a autorização de IA.
                </Note>
              ) : null}
              <ButtonRow>
                <Button
                  label="Concordo e ativar"
                  block
                  // Sem saber se a IA está autorizada, não liga: a fila ficaria parada sem aviso.
                  disabled={!consentimento.isSuccess}
                  loading={consentimento.isPending}
                  onPress={concordar}
                />
                {consentimento.isError ? (
                  <Button label="Tentar de novo" variant="secondary" block onPress={() => { void consentimento.refetch(); }} />
                ) : (
                  <Button label="Agora não" variant="secondary" block onPress={() => setAviso(false)} />
                )}
              </ButtonRow>
            </>
          )}
        </SheetScroll>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bloco: { gap: Space.sm, alignItems: 'flex-start' },
  folha: { gap: Space.xl, padding: Space.lg },
});
