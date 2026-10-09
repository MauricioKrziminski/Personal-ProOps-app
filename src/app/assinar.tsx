import { TelaDeAssinatura } from '@/app/paywall';

/**
 * O portão de assinatura: quem entrou, concluiu o onboarding e nunca assinou só tem esta tela.
 * Sem ✕ — a porta fecha sozinha quando o `plan_status` vira `subscriber` (`_layout.tsx`).
 */
export default function AssinarScreen() {
  return <TelaDeAssinatura portao />;
}
