/**
 * Frases de exemplo para começar uma conversa com o agente.
 *
 * Uma lista só: a Hoje ("Diga ao agente…") e a aba Agente (conversa vazia) ensinam com as MESMAS
 * frases. Duas listas divergiriam — e a pessoa leria um exemplo numa tela que a outra não conhece.
 */
export const EXEMPLOS_DO_AGENTE = [
  'Gastei 45 no mercado',
  'Me lembra do aluguel todo dia 5',
  'Quanto gastei este mês?',
  'O que vence esta semana?',
] as const;

/**
 * Atalhos curtos para a superfície de conversa; o texto continua editável. Uma ou duas palavras:
 * a 384dp × fonte 1,3 "Registrar gasto" partia em duas linhas dentro da pílula.
 */
export const ATALHOS_DO_AGENTE = [
  { label: 'Gasto', prompt: 'Gastei ', icon: 'arrow.up.right' },
  { label: 'Lembrete', prompt: 'Me lembra de ', icon: 'bell' },
  { label: 'Este mês', prompt: 'Quanto gastei este mês?', icon: 'chart.bar' },
  { label: 'Vencimentos', prompt: 'O que vence esta semana?', icon: 'calendar' },
] as const;
