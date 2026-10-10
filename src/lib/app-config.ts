import { abaixoDe } from './semver.ts';

export type Plataforma = 'ios' | 'android' | 'web';
export type NivelDoAviso = 'info' | 'warning' | 'critical';

/** A linha única de `public.app_config`. */
export interface AppConfig {
  min_version_ios?: string | null;
  min_version_android?: string | null;
  latest_version_ios?: string | null;
  latest_version_android?: string | null;
  store_url_ios?: string | null;
  store_url_android?: string | null;
  notice_title?: string | null;
  notice_body?: string | null;
  notice_level?: NivelDoAviso | null;
  notice_until?: string | null;
  updated_at?: string | null;
}

export interface DecisaoDeVersao {
  /** `bloquear`: abaixo do mínimo (tela /atualizar). `aviso`: abaixo da última (faixa dispensável). */
  tipo: 'bloquear' | 'aviso' | null;
  url: string | null;
  /** A versão que a faixa de aviso anuncia (a chave da dispensa). */
  ultima: string | null;
}

const por = (cfg: AppConfig, plat: Plataforma, campo: 'min_version' | 'latest_version' | 'store_url') =>
  (cfg[`${campo}_${plat === 'ios' ? 'ios' : 'android'}` as keyof AppConfig] as string | null | undefined) ?? null;

/** Config ausente, plataforma web ou versão ilegível: segue (falha aberto). */
export function decisaoDeVersao(cfg: AppConfig | null | undefined, plat: Plataforma, versao: string | null): DecisaoDeVersao {
  const nada: DecisaoDeVersao = { tipo: null, url: null, ultima: null };
  if (!cfg || plat === 'web') return nada;
  const url = por(cfg, plat, 'store_url') || null;
  if (abaixoDe(versao, por(cfg, plat, 'min_version'))) return { tipo: 'bloquear', url, ultima: null };
  const ultima = por(cfg, plat, 'latest_version');
  if (abaixoDe(versao, ultima)) return { tipo: 'aviso', url, ultima };
  return nada;
}

export interface AvisoDoApp {
  titulo: string;
  corpo: string;
  nivel: NivelDoAviso;
  /** `updated_at`: dispensar vale para ESTE texto, editar o aviso o traz de volta. */
  chave: string;
}

/** O aviso vale se tem texto e está no prazo (`notice_until` nulo = sem prazo). */
export function avisoNoPrazo(cfg: AppConfig | null | undefined, agora: number): AvisoDoApp | null {
  const titulo = cfg?.notice_title?.trim();
  const corpo = cfg?.notice_body?.trim();
  if (!cfg || (!titulo && !corpo)) return null;
  if (cfg.notice_until && Date.parse(cfg.notice_until) <= agora) return null;
  const nivel = cfg.notice_level ?? 'info';
  return { titulo: titulo ?? '', corpo: corpo ?? '', nivel, chave: cfg.updated_at ?? '' };
}

/** Crítico não dispensa; os outros, só se a chave gravada for a deste aviso. */
export function avisoVisivel(aviso: AvisoDoApp | null, dispensada: string): AvisoDoApp | null {
  if (!aviso) return null;
  return aviso.nivel !== 'critical' && dispensada === aviso.chave ? null : aviso;
}
