#!/usr/bin/env bash
#
# Qual banco Supabase está armado — e o portão que impede escrever no errado.
#
# Existem DOIS projetos com nome parecido, e o erro já aconteceu duas vezes: a `0049` e as
# `0050`/`0051` foram anunciadas como "aplicadas em produção" quando foram para o staging.
# Nome não basta; o que manda é o ref.
#
#   kwriuifcwyvdrxtspjiz  = PRODUÇÃO   ("Personal ProOps app")
#   utkqoiigimqzeenxkxdl  = STAGING    ("Personal ProOps app - staging") — é o do `.env.local`
#
# ## Dois usos
#
# 1. **Humano**, sem stdin: imprime o alvo e sai 1 se `.env.local` e o CLI discordarem.
#
#        scripts/supabase-target.sh
#
# 2. **Hook `PreToolUse`** do Claude Code (`.claude/settings.json`): recebe o JSON da chamada no
#    stdin e devolve `permissionDecision: deny` quando o comando escreve no banco (`db push`,
#    `db reset`, `migration up`, `db execute`) e o alvo é PRODUÇÃO. Um `db push` estava
#    pré-autorizado no `settings.json`, ou seja, corria sem nenhuma pergunta — este portão é o
#    que transforma "escrever em produção" numa decisão consciente.
#
# Para aplicar em produção de propósito: rode o comando com `PROOPS_PROD_OK=1` no ambiente.
set -uo pipefail

PROD_REF="kwriuifcwyvdrxtspjiz"
STAGING_REF="utkqoiigimqzeenxkxdl"

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
linkado="$(cat "$raiz/supabase/.temp/project-ref" 2>/dev/null || true)"
# O ref do app sai da URL do `.env.local` (https://<ref>.supabase.co).
do_env="$(grep -m1 '^EXPO_PUBLIC_SUPABASE_URL=' "$raiz/.env.local" 2>/dev/null \
  | sed -E 's#.*//([a-z0-9]+)\.supabase\.co.*#\1#' || true)"

nome_de() {
  case "$1" in
    "$PROD_REF") echo "PRODUÇÃO" ;;
    "$STAGING_REF") echo "staging" ;;
    "") echo "nenhum" ;;
    *) echo "DESCONHECIDO" ;;
  esac
}

# ---------------------------------------------------------------------------
# Modo hook: quando chega um comando pelo JSON do stdin.
#
# O discriminador NÃO pode ser só "stdin não é tty": rodado por um script ou por uma ferramenta
# (que é como esta função vai ser exercitada), o stdin não é tty e mesmo assim não há JSON —
# e o relatório sumia em silêncio. Quem decide é ter um comando dentro do JSON.
# ---------------------------------------------------------------------------
if [ ! -t 0 ]; then
  entrada="$(cat)"
  comando="$(printf '%s' "$entrada" | jq -r '.tool_input.command // ""' 2>/dev/null || true)"

  if [ -n "$comando" ]; then
    # Só comandos que ESCREVEM no banco remoto. `migration list`, `gen types` e `db diff` leem.
    if ! printf '%s' "$comando" \
      | grep -qE 'supabase[[:space:]]+(db[[:space:]]+(push|reset|execute)|migration[[:space:]]+(up|repair))'; then
      exit 0
    fi
    # `--project-ref X` na linha de comando ganha do link gravado em disco.
    alvo="$linkado"
    explicito="$(printf '%s' "$comando" | sed -nE 's/.*--project-ref[= ]+([a-z0-9]+).*/\1/p')"
    [ -n "$explicito" ] && alvo="$explicito"

    if [ "$alvo" = "$PROD_REF" ] && [ "${PROOPS_PROD_OK:-}" != "1" ]; then
      jq -nc --arg r "$(printf 'Bloqueado: este comando ESCREVE no Supabase de PRODUÇÃO (%s, "Personal ProOps app"). O staging é %s, e é para onde o .env.local aponta. Se a intenção era produção mesmo, confirme com o Gabriel e rode de novo com PROOPS_PROD_OK=1 no ambiente.' "$PROD_REF" "$STAGING_REF")" \
        '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
      exit 0
    fi

    if [ -z "$alvo" ]; then
      jq -nc '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: "Nenhum projeto Supabase linkado (supabase/.temp/project-ref vazio). Rode scripts/supabase-target.sh antes de escrever no banco."}}'
      exit 0
    fi
    exit 0
  fi
  # Sem comando no stdin: cai no relatório abaixo.
fi

# ---------------------------------------------------------------------------
# Modo relatório.
# ---------------------------------------------------------------------------
echo "produção : $PROD_REF  (Personal ProOps app)"
echo "staging  : $STAGING_REF  (Personal ProOps app - staging)"
echo
echo "CLI linkado (destino do db push) : $linkado  → $(nome_de "$linkado")"
echo "app (.env.local)                 : ${do_env:-nenhum}  → $(nome_de "${do_env:-}")"

if [ -n "$linkado" ] && [ -n "$do_env" ] && [ "$linkado" != "$do_env" ]; then
  echo
  echo "DIVERGEM: o db push iria para um banco diferente do que o app usa."
  exit 1
fi
