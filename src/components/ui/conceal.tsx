import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const KEY = 'proops.conceal';

interface ConcealValue {
  /** Todo valor monetário do app está oculto agora? */
  concealed: boolean;
  toggle: () => void;
  /** `false` até a preferência voltar do disco — evita o valor piscar antes de ser escondido. */
  ready: boolean;
}

const Ctx = createContext<ConcealValue>({ concealed: false, toggle: () => {}, ready: false });

/**
 * O "esconder saldo" — **um estado só, para o app inteiro.**
 *
 * A tentação é resolver isso dentro da tela que tem o número grande. É exatamente assim que a
 * funcionalidade vira teatro: o dashboard esconde e o extrato, a fatura e o patrimônio continuam
 * mostrando tudo para quem está olhando por cima do ombro. Esconder num lugar e vazar em três é
 * a falha nº 1 documentada desse padrão — meio-olho é pior que nenhum olho, porque promete uma
 * proteção que não entrega.
 *
 * Por isso mora num provider, acima das abas, e persiste: sair do app e voltar mantém oculto.
 *
 * **Pendência consciente:** o padrão completo pede biometria para *revelar* (esconder é livre) —
 * quem consegue olhar a tela também consegue tocar nela. Isso exige `expo-local-authentication`,
 * que não está instalada e depende de aprovação (`DECISOES-PENDENTES.md` §2). Está registrado
 * como pendência, não como esquecimento.
 */
export function ConcealProvider({ children }: { children: React.ReactNode }) {
  const [concealed, setConcealed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let vivo = true;
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (vivo) setConcealed(v === '1');
      })
      // Preferência de conveniência: falha de leitura mostra o valor, não trava a tela.
      .catch(() => {})
      .finally(() => {
        if (vivo) setReady(true);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const toggle = useCallback(() => {
    setConcealed((prev) => {
      const próximo = !prev;
      AsyncStorage.setItem(KEY, próximo ? '1' : '0').catch(() => {});
      return próximo;
    });
  }, []);

  const value = useMemo(() => ({ concealed, toggle, ready }), [concealed, toggle, ready]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConceal() {
  return useContext(Ctx);
}

/**
 * O texto que substitui o valor quando está oculto.
 *
 * **Ponto, não bloco cheio.** A primeira versão usava `█` para ocupar largura parecida com a do
 * número e evitar salto de layout. Visto rodando, no tamanho do painel (56px) os blocos se
 * encostam e viram uma **barra branca sólida** — lê como tarja de censura ou como elemento
 * quebrado, não como "seu saldo está oculto".
 *
 * O ponto é a convenção que todo mundo já leu em campo de senha, e mantém a largura aproximada
 * sem virar um retângulo.
 */
export function concealText(chars = 6) {
  return '•'.repeat(Math.max(3, chars));
}
