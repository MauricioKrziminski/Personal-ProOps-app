import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { formatBRL } from '@/hooks/use-items';

export const CONCEAL_KEY = 'proops.conceal';
const KEY = CONCEAL_KEY;

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
 * `formatBRL` que obedece ao "esconder saldo" — para valor no MEIO de uma frase.
 *
 * ⚠️ **Existe porque `<Money>` não serve em texto corrido.** `Money` é um `<Text>` irmão com
 * `flexShrink: 0`; enfiado dentro de "entra X · sai Y" ele quebra a sentença em pedaços que se
 * alinham sozinhos. Então toda frase com dinheiro caía no `formatBRL` cru — e o olho que esconde
 * o total do topo deixava o mesmo número escrito por extenso três linhas abaixo.
 *
 * Esconder num lugar e vazar em três é a falha nº 1 deste padrão, e está escrita no cabeçalho
 * deste arquivo: *"meio-olho é pior que nenhum olho"*.
 *
 * ⚠️ **É HOOK de propósito, e `formatBRL` continua puro.** Um formatador que lesse o estado por
 * variável de módulo devolveria texto diferente sem o React saber — e qualquer string montada
 * dentro de um `useMemo` ficaria com o valor à mostra depois de apertar o olho, em silêncio.
 * Sendo hook, `concealed` entra nas dependências e o compilador cobra.
 */
export function useBRL(): (cents: number) => string {
  const { concealed } = useConceal();
  return useCallback((cents: number) => (concealed ? MASK : formatBRL(cents)), [concealed]);
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
export function concealText() {
  return MASK;
}

/**
 * **Largura fixa, e é de propósito.**
 *
 * A primeira versão repetia o ponto conforme o tamanho do número, para o layout não pular. Visto
 * rodando numa lista de contas, o efeito foi outro: dá para **contar as bolinhas** e distinguir
 * R$ 132,10 de R$ 2.700,00. Uma máscara que revela a ordem de grandeza entrega justamente o que
 * a pessoa quis esconder de quem olha por cima do ombro.
 *
 * Máscara igual para todo valor custa um salto de largura na alternância — e esse é o lado certo
 * de errar numa feature de privacidade.
 */
const MASK = '••••••';
