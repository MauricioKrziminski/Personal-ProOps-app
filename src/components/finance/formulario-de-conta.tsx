import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AccountFormFields } from '@/components/finance/account-form';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ButtonRow } from '@/components/ui/button-row';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useCreateAccount, type Account } from '@/hooks/use-finance';
import {
  accountFormErrorMessage,
  accountFormErrors,
  accountFormPayload,
  emptyAccountForm,
  type AccountType,
} from '@/lib/account-form';

const TIPOS_DE_CONTA: readonly AccountType[] = ['checking', 'savings', 'cash', 'investment'];

/** O formulário de conta/cartão do primeiro cadastro: os campos e a escrita são os de Contas. */
export function FormularioDeConta({
  tipo,
  contas,
  payerId,
  onCriada,
  onPular,
  rotuloPular,
  onSalvando,
}: {
  tipo: AccountType;
  contas: readonly Account[];
  payerId: string | null;
  onCriada: (id: string) => void;
  onPular: () => void;
  rotuloPular: string;
  /** Liga ao tocar Salvar e desliga depois do `onCriada`: a tela segura o passo nesse meio. */
  onSalvando?: (sim: boolean) => void;
}) {
  const toast = useToast();
  const criar = useCreateAccount();
  const [form, setForm] = useState(() => ({ ...emptyAccountForm(tipo), payerId }));
  const [aviso, setAviso] = useState<string | null>(null);
  const salvando = useRef(false);
  const valido = Object.keys(accountFormErrors(form)).length === 0;
  // Resposta perdida: o recibo da tentativa devolve a conta já criada, e os campos não mudam.
  const travado = criar.isPending || Boolean(criar.unconfirmedInput);

  const salvar = () => {
    if (!valido || salvando.current || criar.isPending) return;
    salvando.current = true;
    onSalvando?.(true);
    criar.mutate(criar.unconfirmedInput ?? accountFormPayload(form), {
      onSuccess: (r) => {
        if (r.availability !== 'active') {
          setAviso('A conta foi criada, mas não está disponível. Confira em Contas.');
          return;
        }
        onCriada(r.id);
      },
      onError: (e) => toast({ message: accountFormErrorMessage(e), tone: 'error' }),
      onSettled: () => {
        salvando.current = false;
        onSalvando?.(false);
      },
    });
  };

  return (
    <View style={styles.bloco}>
      <AccountFormFields
        form={form}
        onChange={setForm}
        accounts={contas}
        allowedTypes={tipo === 'credit_card' ? ['credit_card'] : TIPOS_DE_CONTA}
        disabled={travado}
      />
      {aviso ? <ThemedText type="footnote" themeColor="danger">{aviso}</ThemedText> : null}
      <ButtonRow>
        <Button label="Salvar" block loading={criar.isPending} disabled={!valido} onPress={salvar} />
        <Button label={rotuloPular} variant="secondary" block onPress={onPular} />
      </ButtonRow>
    </View>
  );
}

const styles = StyleSheet.create({
  bloco: { gap: Space.lg },
});
