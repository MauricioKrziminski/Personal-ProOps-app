export type AlertChannel = "push" | "whatsapp";

interface AlertCapabilitiesAndPreferences {
  alerts_push_enabled: boolean;
  alerts_whatsapp_enabled: boolean;
  expo_push_token: string | null;
  phone: string | null;
}

/**
 * Resolve entregas sem fallback implícito.
 *
 * Telefone e token apenas dizem que o canal existe. A entrega só entra na
 * lista quando a pessoa também ativou aquele canal explicitamente.
 */
export function alertChannels(alert: AlertCapabilitiesAndPreferences): AlertChannel[] {
  const channels: AlertChannel[] = [];
  if (alert.alerts_push_enabled && alert.expo_push_token) channels.push("push");
  if (alert.alerts_whatsapp_enabled && alert.phone) channels.push("whatsapp");
  return channels;
}
