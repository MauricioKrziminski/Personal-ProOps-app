/** Shared command-owned receipt protocol. Domain strategies validate payloads and receipts. */
export interface SealedSaveStrategy<TInput, TResult> {
  normalize: (input: TInput) => TInput;
  requestId: (value: string) => string;
  decode: (value: unknown, input: TInput) => TResult;
  definitiveRefusal: (error: unknown) => boolean;
  confirmedRefusal: (error: unknown, mode: 'save' | 'resolve') => boolean;
  terminalRefusal: (error: unknown) => boolean;
}
function freezeOwned<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeOwned);
    Object.freeze(value);
  }
  return value;
}
export function createSealedSaveController<TInput, TResult>(
  send: (input: TInput, requestId: string) => Promise<unknown>,
  newId: () => string,
  strategy: SealedSaveStrategy<TInput, TResult>,
  publish?: (input: TInput | null) => void,
  resolveAttempt?: (input: TInput, requestId: string) => Promise<unknown>,
): { submit: (input: TInput) => Promise<TResult>; resolve: () => Promise<TResult> } {
  type Attempt = { input: TInput; canonical: string; requestId: string; ambiguous: boolean; inflight: Promise<TResult> | null };
  let pending: Attempt | null = null;
  const dispatchAttempt = (attempt: Attempt, dispatchCommand: typeof send, mode: 'save' | 'resolve') => {
    if (attempt.inflight) return attempt.inflight;
    let resolve!: (value: TResult) => void;
    let reject!: (error: unknown) => void;
    const inflight = new Promise<TResult>((yes, no) => { resolve = yes; reject = no; });
    attempt.inflight = inflight;
    const refused = (error: unknown) => {
      attempt.inflight = null;
      if ((!attempt.ambiguous && strategy.definitiveRefusal(error)) || strategy.confirmedRefusal(error, mode)
        || strategy.terminalRefusal(error)) { pending = null; publish?.(null); }
      else attempt.ambiguous = true;
      reject(error);
    };
    let dispatch: Promise<unknown>;
    try { dispatch = dispatchCommand(attempt.input, attempt.requestId); } catch (error) { refused(error); return inflight; }
    Promise.resolve(dispatch).then(value => {
      let result: TResult;
      try { result = strategy.decode(value, attempt.input); } catch (error) { refused(error); return; }
      attempt.inflight = null; pending = null; publish?.(null); resolve(result);
    }, refused);
    return inflight;
  };
  return {
    submit(input) {
      let copy: TInput;
      try { copy = strategy.normalize(input); } catch (error) { return Promise.reject(error); }
      const canonical = JSON.stringify(copy);
      if (pending && pending.canonical !== canonical) return Promise.reject(new Error('A tentativa anterior ainda aguarda confirmação. Tente novamente com os mesmos valores.'));
      if (pending?.inflight) return pending.inflight;
      if (!pending) {
        let requestId: string;
        try { requestId = strategy.requestId(newId()); } catch (error) { return Promise.reject(error); }
        pending = { input: freezeOwned(copy), canonical, requestId, ambiguous: false, inflight: null };
        publish?.(pending.input);
      }
      return dispatchAttempt(pending, send, 'save');
    },
    resolve() {
      if (!pending || !resolveAttempt) return Promise.reject(new Error('Nenhuma tentativa disponível para conferir.'));
      return dispatchAttempt(pending, resolveAttempt, 'resolve');
    },
  };
}
