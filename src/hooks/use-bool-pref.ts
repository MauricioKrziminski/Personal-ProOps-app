import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

/**
 * Uma chave liga/desliga gravada no aparelho — recolher um bloco, esconder um aviso.
 *
 * Mesmo desenho e mesmos motivos do `useNoteSort`: é preferência do usuário, não filtro, então
 * ela precisa estar lá amanhã; o `AsyncStorage` já é o estado compartilhado entre telas que nunca
 * estão montadas juntas, e um provider para isso seria estrutura sem ninguém dentro.
 *
 * ⚠️ **Antes de o disco responder vale o padrão**, nunca um terceiro estado. A tela pinta uma vez
 * com o valor de quem nunca escolheu nada e, se houver escolha gravada, ela chega no quadro
 * seguinte — em vez de a tela começar vazia e piscar.
 *
 * Gravação que falha (disco cheio, modo restrito) não derruba o toque: o estado já mudou na tela
 * e o pior caso é ele não sobreviver ao próximo boot.
 */
export function useBoolPref(chave: string, padrao = false): [boolean, (v: boolean) => void] {
  const [valor, setValor] = useState(padrao);

  useEffect(() => {
    let vivo = true;
    AsyncStorage.getItem(chave)
      .then((bruto) => {
        if (vivo && (bruto === '1' || bruto === '0')) setValor(bruto === '1');
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [chave]);

  return [
    valor,
    (v: boolean) => {
      setValor(v);
      AsyncStorage.setItem(chave, v ? '1' : '0').catch(() => undefined);
    },
  ];
}
