// A trava do app e as folhas são janelas próprias. No Android o Voltar com a trava na tela chegava
// ao `Modal` da folha aberta por baixo e a fechava (05/10/2026): depois do PIN a pessoa caía na
// tela sem a folha. `LockOverlay` marca aqui; quem fecha por Voltar pergunta antes.
let naTela = false;

export function marcarTravaNaTela(valor: boolean) {
  naTela = valor;
}

export function travaNaTela() {
  return naTela;
}
