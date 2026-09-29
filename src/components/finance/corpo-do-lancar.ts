import type { ReactNode } from 'react';
import type { Comum } from '@/lib/lancar';
import type { RegistroSimulado } from '@/lib/hipotese';

/** O contrato dos três corpos do formulário único. */
export type CorpoProps = {
  /** O seletor de tipo, desenhado pelo hospedeiro no TOPO da rolagem do corpo. */
  topo?: ReactNode;
  /** Os campos comuns ao montar (vindos do tipo anterior, ou dos parâmetros). */
  comum: Comum;
  /** O hospedeiro lê os campos comuns do corpo na hora de trocar de tipo. */
  registrarComum: (ler: () => Comum) => void;
  /** O estado INTEIRO do corpo (o objeto do formulário dele), para voltar a este tipo sem perder nada. */
  registrarEstado: (ler: () => unknown) => void;
  /** O que foi digitado neste tipo antes de a pessoa trocar para outro; vence o `comum` ao montar. */
  estadoGuardado?: unknown;
  /** Editando: o id do registro DESTE tipo. */
  editandoId?: string;
  /** Convertendo: o registro de OUTRO tipo que está virando este. Salvar chama `converter`. */
  converter?: (destino: RegistroSimulado) => void;
  /** Criando: `criarOutro` = "Salvar e criar outro". */
  onSalvo: (criarOutro: boolean) => void;
  onFechar: () => void;
  /** Aberta pelo "Aplicar" de uma hipótese: salvar a tira do rascunho. */
  deHipotese?: string;
};
