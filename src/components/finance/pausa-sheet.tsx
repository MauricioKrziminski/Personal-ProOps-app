import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { DatePickerField } from '@/components/finance/date-picker-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useBRL } from '@/components/ui/conceal';
import { Field } from '@/components/ui/field';
import { QuantityField } from '@/components/ui/quantity-field';
import { Segmented } from '@/components/ui/segmented';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useToggleRecurring } from '@/hooks/use-finance';
import { useToggleReminder } from '@/hooks/use-items';
import { usePauseRecurring, usePauseRecurringPreview, usePauseReminder } from '@/hooks/use-pausas';
import { brToISO, isoToBR, isValidBRDate, somaDias } from '@/lib/dates';
import { financeErrorMessage } from '@/lib/finance-form';
import { fimDaPausa, type ModoDaPausa } from '@/lib/pausa';

export type AlvoDaPausa = { tipo: 'recurring' | 'reminder'; id: string; titulo: string };

const MODOS = [
  { value: 'dias', label: 'Dias' },
  { value: 'meses', label: 'Meses' },
  { value: 'ate', label: 'Até uma data' },
  { value: 'sem_prazo', label: 'Sem prazo' },
] as const;

const dm = (iso: string) => isoToBR(iso).slice(0, 5);

/**
 * "Pausar…" de uma série ou lembrete que repete: a pessoa escolhe o início e até quando. Sem prazo
 * é a pausa de sempre (`active = false`); com prazo grava o período `[início, fim)`.
 */
export function PausaSheet({ visivel, onClose, alvo, inicioPadrao }: {
  visivel: boolean; onClose: () => void; alvo: AlvoDaPausa; inicioPadrao: string;
}) {
  const toast = useToast();
  const brl = useBRL();
  const [inicioBR, setInicioBR] = useState(isoToBR(inicioPadrao));
  const [modo, setModo] = useState<ModoDaPausa>('dias');
  const [n, setN] = useState(7);
  const [ateBR, setAteBR] = useState<string | null>(null);

  const pausarSerie = usePauseRecurring();
  const toggleSerie = useToggleRecurring();
  const pausarLembrete = usePauseReminder();
  const toggleLembrete = useToggleReminder();

  const serie = alvo.tipo === 'recurring';
  const inicioOk = isValidBRDate(inicioBR);
  const inicio = inicioOk ? brToISO(inicioBR) : null;
  const ateOk = ateBR != null && isValidBRDate(ateBR) && inicio != null && brToISO(ateBR) >= inicio;
  const fim = inicio ? fimDaPausa(inicio, modo, n, ateOk ? brToISO(ateBR!) : null) : null;
  const semPrazo = modo === 'sem_prazo';
  const previa = usePauseRecurringPreview(serie && visivel && !semPrazo ? alvo.id : null, inicio, fim);

  const motivo = semPrazo ? undefined : !inicioOk ? 'Data inválida'
    : modo === 'ate' && !ateOk ? (ateBR ? 'Escolha uma data a partir do início' : 'Escolha até quando') : undefined;
  const pendente = pausarSerie.isPending || toggleSerie.isPending || pausarLembrete.isPending || toggleLembrete.isPending;
  const pronto = !motivo && (semPrazo || !serie || Boolean(previa.data && !previa.isFetching));

  // Fechar no meio do envio perderia o aviso de erro (o retorno da mutação some com a folha).
  const fechar = () => { if (!pendente) onClose(); };
  const trocarModo = (novo: ModoDaPausa) => {
    if ((novo === 'dias' || novo === 'meses') && novo !== modo) setN(novo === 'dias' ? 7 : 1);
    setModo(novo);
  };
  const feito = (message: string) => () => { onClose(); toast({ message, tone: 'success' }); };
  const falhou = (error: unknown) => toast({ message: financeErrorMessage(error, 'Não deu para pausar. Tenta de novo.'), tone: 'error' });
  const confirmar = () => {
    if (!pronto) return;
    const opts = { onSuccess: feito(serie ? 'Série pausada.' : 'Lembrete pausado.'), onError: falhou };
    if (semPrazo) (serie ? toggleSerie : toggleLembrete).mutate({ id: alvo.id, active: false }, opts);
    else if (inicio && fim) (serie ? pausarSerie : pausarLembrete).mutate({ id: alvo.id, from: inicio, until: fim }, opts);
  };

  const dates = previa.data?.dates ?? [];
  const frase = serie
    ? previa.data && !previa.isFetching
      ? previa.data.removed_count === 0
        ? 'Nenhuma cobrança sai.'
        : `Saem ${previa.data.removed_count} ${previa.data.removed_count === 1 ? 'cobrança' : 'cobranças'} (${brl(previa.data.cents)}): ${dates.slice(0, 6).map(dm).join(', ')}${dates.length > 6 ? ` e mais ${dates.length - 6}` : ''}.`
      : null
    : inicio && fim ? `Não toca de ${dm(inicio)} a ${dm(somaDias(fim, -1))}.` : null;

  return (
    <Sheet visible={visivel} onClose={fechar}>
      <TaskHeader
        title={`Pausar ${alvo.titulo}`}
        onClose={fechar}
        action={<Button label="Pausar" size="sm" loading={pendente} disabled={!pronto || pendente} onPress={confirmar} />}
      />
      <SheetScroll contentContainerStyle={styles.corpo}>
        {semPrazo ? null : (
          <Field label="A partir de" error={!inicioOk ? 'Data inválida' : undefined}>
            <DatePickerField value={inicioBR} onChange={setInicioBR} accessibilityLabel="Início da pausa" invalid={!inicioOk} />
          </Field>
        )}
        <Segmented options={MODOS} value={modo} onChange={trocarModo} />
        {modo === 'dias' || modo === 'meses' ? (
          <Field label={modo === 'dias' ? 'Quantos dias' : 'Quantos meses'}>
            <QuantityField value={n} min={1} max={modo === 'dias' ? 365 : 24} onChange={setN}
              accessibilityLabel={modo === 'dias' ? 'Dias de pausa' : 'Meses de pausa'} />
          </Field>
        ) : null}
        {modo === 'ate' ? (
          <Field label="Até" error={motivo && inicioOk ? motivo : undefined}>
            <DatePickerField value={ateBR} onChange={setAteBR} min={inicio ?? undefined}
              accessibilityLabel="Último dia da pausa" invalid={Boolean(motivo && inicioOk)} />
          </Field>
        ) : null}
        {previa.isError ? (
          <ThemedText type="small" themeColor="danger">{financeErrorMessage(previa.error, 'Não deu para calcular a pausa.')}</ThemedText>
        ) : frase ? (
          <ThemedText type="small" themeColor="textSecondary">{frase}</ThemedText>
        ) : serie && !semPrazo && !motivo ? (
          <Skeleton height={40} />
        ) : null}
      </SheetScroll>
    </Sheet>
  );
}

/** O gancho que as telas usam (a folha monta ao abrir, então cada abertura recomeça do padrão): `abrir(alvo, inicio)` e `folha` no fim da tela. */
export function usePausa() {
  const [aberta, setAberta] = useState<{ alvo: AlvoDaPausa; inicio: string } | null>(null);
  const fechar = () => setAberta(null);
  const folha = aberta ? (
    <PausaSheet visivel onClose={fechar} alvo={aberta.alvo} inicioPadrao={aberta.inicio} />
  ) : null;
  return { abrir: (alvo: AlvoDaPausa, inicio: string) => setAberta({ alvo, inicio }), folha };
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
});
