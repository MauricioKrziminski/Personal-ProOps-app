import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useImperativeHandle, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';

import { AccountFormFields } from '@/components/finance/account-form';
import { AccountPicker } from '@/components/finance/account-picker';
import { TrocaSuave, usePresencaAtiva } from '@/components/motion/presenca';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useAccounts, useCreateAccount } from '@/hooks/use-finance';
import { accountFormErrorMessage, accountFormErrors, accountFormPayload, emptyAccountForm, type AccountFormState, type AccountType } from '@/lib/account-form';
import { ACCOUNT_TYPES, createdAccountSelection } from '@/lib/accounts';
import { paymentMethodAccounts, type PaymentMethod } from '@/lib/payment-method';

type Target = {
  owner: object;
  types: readonly AccountType[];
  isActive: () => boolean;
  apply: (id: string) => void;
  eligibleTypes: () => readonly AccountType[];
};
export type OriginCreationController = { close: () => boolean };
type CreationContext = {
  owner: object | null;
  pending: boolean;
  open: (target: Target, type: AccountType) => void;
  cancelOwner: (owner: object) => void;
  editor: (types: readonly AccountType[]) => ReactNode;
};
const Context = createContext<CreationContext | null>(null);

/** The receipt outlives the inline editor, including cancellation after dispatch. */
export function OriginCreationHost({ children, controllerRef, onActiveChange }: {
  children: ReactNode;
  controllerRef: RefObject<OriginCreationController | null>;
  onActiveChange: (active: boolean) => void;
}) {
  const accounts = useAccounts();
  const create = useCreateAccount();
  const toast = useToast();
  const [target, setTarget] = useState<Target | null>(null);
  const [form, setForm] = useState<AccountFormState>(() => emptyAccountForm());
  const [error, setError] = useState<string | null>(null);
  const activeTarget = useRef<Target | null>(null);
  const submitting = useRef(false);
  const submitted = useRef<{ form: AccountFormState; types: readonly AccountType[] } | null>(null);
  const mounted = useRef(true);
  const close = useCallback(() => {
    if (!activeTarget.current) return false;
    activeTarget.current = null;
    setTarget(null);
    setError(null);
    onActiveChange(false);
    return true;
  }, [onActiveChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeTarget.current = null; };
  }, []);
  useImperativeHandle(controllerRef, () => ({ close }), [close]);
  // Back closes the subtask first, preserving the mounted financial draft underneath it.
  usePreventRemove(Boolean(target), () => { close(); });

  const open = (next: Target, type: AccountType) => {
    if (activeTarget.current || submitting.current || create.isPending || !next.isActive()) return;
    const original = create.unconfirmedInput ? submitted.current : null;
    const current = original ? { ...next, types: original.types } : next;
    activeTarget.current = current;
    setTarget(current);
    setForm(original?.form ?? emptyAccountForm(type));
    setError(null);
    create.reset();
    onActiveChange(true);
  };
  const save = () => {
    const current = activeTarget.current;
    if (!current || !current.isActive() || submitting.current || create.isPending || Object.keys(accountFormErrors(form)).length) return;
    if (!create.unconfirmedInput && !current.eligibleTypes().includes(form.type)) {
      setError('Escolha um tipo de conta compatível com a forma de pagamento atual.');
      return;
    }
    submitting.current = true;
    submitted.current = { form, types: current.types };
    setError(null);
    return create.mutateAsync(create.unconfirmedInput ?? accountFormPayload(form)).then((result) => {
      submitted.current = null;
      if (!mounted.current) return;
      // A canceled/outgoing field never receives the former task's late selection.
      if (activeTarget.current !== current || !current.isActive()) {
        if (result.availability === 'active') toast({ message: 'Conta criada. Ela já está disponível no seletor.', tone: 'success' });
        return;
      }
      const id = createdAccountSelection(result, current.eligibleTypes(), current.isActive());
      if (id) {
        current.apply(id);
        close();
        toast({ message: result.account?.type === 'credit_card' ? 'Cartão criado e selecionado.' : 'Conta criada e selecionada.', tone: 'success' });
      } else {
        close();
        toast({ message: result.availability === 'archived'
          ? 'A conta está arquivada. Confira em Contas.'
          : result.availability === 'unavailable'
          ? 'A conta criada não está disponível. Confira em Contas.'
          : 'Conta criada. Para selecioná-la, use uma forma de pagamento compatível.', tone: 'info' });
      }
    }).catch((failure) => {
      if (mounted.current && activeTarget.current === current && current.isActive()) setError(accountFormErrorMessage(failure));
    }).finally(() => {
      submitting.current = false;
    });
  };
  const locked = create.isPending || Boolean(create.unconfirmedInput);
  const card = form.type === 'credit_card';
  const editor = (eligibleTypes: readonly AccountType[]) => <Card style={styles.editor}>
    <View style={styles.header}>
      <ThemedText type="subtitle" style={styles.title}>{card ? 'Novo cartão' : 'Nova conta'}</ThemedText>
      <Button label="Cancelar cadastro" variant="secondary" size="sm" onPress={close} />
    </View>
    <ThemedText type="footnote" themeColor="textSecondary">Seu lançamento fica guardado enquanto você cadastra.</ThemedText>
    <AccountFormFields form={form} onChange={setForm} accounts={accounts.data ?? []}
      allowedTypes={create.unconfirmedInput ? target?.types : eligibleTypes} disabled={locked} autoFocus />
    {create.unconfirmedInput && !create.isPending ? <ThemedText type="footnote" themeColor="textSecondary">
      A confirmação não chegou. Verifique este cadastro antes de alterar os dados.
    </ThemedText> : null}
    {!create.unconfirmedInput && !eligibleTypes.includes(form.type) ? <ThemedText type="footnote" themeColor="danger" accessibilityRole="alert">Escolha um tipo de conta compatível com a forma de pagamento atual.</ThemedText> : null}
    {error ? <ThemedText type="footnote" themeColor="danger" accessibilityRole="alert">{error}</ThemedText> : null}
    <Button label={create.unconfirmedInput && !create.isPending ? 'Verificar cadastro' : card ? 'Criar e usar cartão' : 'Criar e usar conta'}
      loading={create.isPending} disabled={Object.keys(accountFormErrors(form)).length > 0 || create.isPending || !create.unconfirmedInput && !eligibleTypes.includes(form.type)}
      onPress={() => { void save(); }} block />
  </Card>;
  return <Context.Provider value={{ owner: target?.owner ?? null, pending: create.isPending,
    open, cancelOwner: (owner) => { if (activeTarget.current?.owner === owner) close(); }, editor }}>
    {children}
  </Context.Provider>;
}

/** Ordinary selection everywhere; contextual actions only inside an explicitly mounted host. */
export function OriginAccountPicker({ paymentMethod, excludeCredit = false, ...props }: ComponentProps<typeof AccountPicker> & {
  paymentMethod?: PaymentMethod | null;
  excludeCredit?: boolean;
}) {
  const context = useContext(Context);
  const active = usePresencaAtiva();
  const [owner] = useState(() => ({}));
  const types = paymentMethodAccounts(paymentMethod, ACCOUNT_TYPES.map(({ value }) => ({ type: value })))
    .map(({ type }) => type).filter((type) => !excludeCredit || type !== 'credit_card');
  const latest = useRef({ active, types, onChange: props.onChange, disabled: props.disabled });
  useLayoutEffect(() => { latest.current = { active, types, onChange: props.onChange, disabled: props.disabled }; });
  const cancelOwner = useRef(context?.cancelOwner);
  useEffect(() => { cancelOwner.current = context?.cancelOwner; });
  useEffect(() => () => { latest.current.active = false; cancelOwner.current?.(owner); }, [owner]);
  useEffect(() => { if (!active || props.disabled) context?.cancelOwner(owner); }, [active, props.disabled, context, owner]);
  if (!context) return <AccountPicker {...props} />;
  const accountTypes = types.filter((type) => type !== 'credit_card');
  const open = (type: AccountType) => context.open({ owner, types,
    isActive: () => latest.current.active && !latest.current.disabled,
    eligibleTypes: () => latest.current.types,
    apply: (id) => latest.current.onChange(id),
  }, type);
  const actions = [
    ...(props.actions ?? []),
    ...(accountTypes.length ? [{ id: 'create-account', label: 'Criar conta', icon: 'plus' as const,
      disabled: context.pending, onPress: () => open(accountTypes[0]) }] : []),
    ...(types.includes('credit_card') ? [{ id: 'create-card', label: 'Criar cartão', icon: 'creditcard' as const,
      disabled: context.pending, onPress: () => open('credit_card') }] : []),
  ];
  const editing = context.owner === owner;
  return <TrocaSuave estado={editing ? 'cadastro' : 'seletor'}>
    {editing ? context.editor(types) : <AccountPicker {...props} actions={actions} />}
  </TrocaSuave>;
}

const styles = StyleSheet.create({
  editor: { gap: Space.lg },
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Space.sm },
  title: { flexGrow: 1 },
});
