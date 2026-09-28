import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * O relógio da Hoje: vira no começo de cada minuto, e na volta do app ao primeiro plano.
 *
 * A aba fica montada a tarde inteira; com `Date.now()` congelado na montagem, "em 2 h" e o AGORA
 * do Seu dia ficavam parados na hora em que a tela abriu. A cada virada a tela desenha de novo — e
 * à meia-noite isso é também o que troca o dia das consultas de "hoje".
 */
export function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const proximaVirada = () => {
      clearTimeout(timer);
      // +50ms: acordar um tique DEPOIS da virada, nunca um antes (e desenhar o minuto velho).
      timer = setTimeout(() => {
        setAgora(Date.now());
        proximaVirada();
      }, 60_000 - (Date.now() % 60_000) + 50);
    };
    proximaVirada();
    // Com o app em segundo plano o timer dorme; voltando, o minuto certo é o de agora.
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado !== 'active') return;
      setAgora(Date.now());
      proximaVirada();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);
  return agora;
}
