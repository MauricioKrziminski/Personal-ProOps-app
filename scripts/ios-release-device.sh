#!/usr/bin/env bash
#
# Instala no iPhone conectado um build RELEASE de PRODUÇÃO — com o JavaScript embutido.
#
# Por que existe (19/09/2026): o iPhone estava com o build Debug do `expo run:ios`. Debug não
# embute o `main.jsbundle`: a cada abertura ele baixa o JS do Metro no Mac (a barra de download
# que aparece toda vez), e sem rede ou sem Metro abre com "No script URL provided ...
# unsanitizedScriptURLString = (null)". Não é defeito do app; é o tipo de build.
#
# ⚠️ Três armadilhas que este script fecha:
#   1. `APP_VARIANT=production` troca o bundle id, NÃO o banco. O banco vem do dotenv, e o
#      `.env.local` (staging) ganha do `.env` (produção). Aqui o ambiente é exportado a partir do
#      `.env` e o `.env.local` fica de fora — variável já exportada não é sobrescrita pelo dotenv.
#   2. O `ios/` gerado guarda o runtime (`EXUpdatesRuntimeVersion`) do `app.json` da época; o
#      `prebuild` o reescreve com a versão atual.
#   3. O `.xcode.env.local` fixava o node pelo caminho versionado do Cellar, que some a cada
#      `brew upgrade` (o erro aparece como falha do Hermes). Aqui ele aponta para o symlink estável.
#
# Build local não recebe OTA (não leva o header de canal do EAS). Para isso: TestFlight/EAS.
#
# Uso: scripts/ios-release-device.sh [udid-do-iphone]
set -euo pipefail
cd "$(dirname "$0")/.."

PROD_REF="kwriuifcwyvdrxtspjiz"
PROD_AGENT_URL="https://agente-wwm7xruoyq-rj.a.run.app"

url="$(sed -n 's/^EXPO_PUBLIC_SUPABASE_URL=//p' .env | tr -d '"' | tail -1)"
anon="$(sed -n 's/^EXPO_PUBLIC_SUPABASE_ANON_KEY=//p' .env | tr -d '"' | tail -1)"
if [[ "$url" != *"$PROD_REF"* || -z "$anon" ]]; then
  echo "✗ .env não aponta para a produção ($PROD_REF). Nada foi compilado." >&2
  exit 1
fi

export APP_VARIANT=production
export EXPO_PUBLIC_SUPABASE_URL="$url"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="$anon"
export EXPO_PUBLIC_AGENT_URL="$PROD_AGENT_URL"

# O ref do banco tem que estar no JS ANTES de ir para o aparelho: um bundle de staging
# instalado e só depois recusado já estaria no iPhone. Mesmo ambiente, mesmo comando que a fase
# de bundle do Xcode roda (`export:embed`), numa pasta temporária.
conferir() {
  # URLs, não o ref solto: `lib/environment.ts` carrega o mapa ref → rótulo dos DOIS projetos.
  # `strings`: no Release o bundle é bytecode Hermes, e o `grep` direto não acha o texto nele.
  local texto; texto="$(strings "$1")"
  if ! grep -q "https://$PROD_REF.supabase.co" <<<"$texto" ||
    grep -q "https://utkqoiigimqzeenxkxdl.supabase.co\|agente-staging\|127.0.0.1:54321\|10.0.2.2:54321" <<<"$texto"; then
    echo "✗ O JavaScript não aponta só para a produção ($1). Nada foi instalado." >&2
    exit 1
  fi
}
previa="$(mktemp -d)"
trap 'rm -rf "$previa"' EXIT
npx expo export:embed --platform ios --dev false --entry-file node_modules/expo-router/entry.js \
  --bundle-output "$previa/main.jsbundle" --assets-dest "$previa"
conferir "$previa/main.jsbundle"

npx expo prebuild -p ios --no-install
printf 'export NODE_BINARY=%s\n' "$(command -v node | sed 's#/Cellar/node/[^/]*/bin/node#/bin/node#')" > ios/.xcode.env.local
(cd ios && pod install)

# Time pessoal (Apple ID gratuito) não assina a capability de Push: o perfil recusa o
# `aps-environment` que o plugin do expo-notifications grava, e o build morre na assinatura.
# Sem um certificado de distribuição, este build local sai SEM push remoto — registrar o aparelho
# em Perfil → Avisos mostra o erro na tela; notificações locais e o resto do app seguem iguais.
# Push de verdade no iPhone é pelo build do EAS/TestFlight, com a conta paga.
ent="ios/ProOps/ProOps.entitlements"
if ! security find-identity -v -p codesigning | grep -q "Apple Distribution" && [[ -f "$ent" ]]; then
  /usr/libexec/PlistBuddy -c "Delete :aps-environment" "$ent" 2>/dev/null || true
  echo "⚠ Time pessoal: build local sem Push Notifications (aps-environment removido de $ent)."
fi

marco="$previa/inicio"; touch "$marco"
# `--no-bundler`: Release não usa o Metro, e com ele o comando fica preso mostrando logs.
args=(--configuration Release --no-bundler)
if [[ -n "${1:-}" ]]; then args+=(--device "$1"); else args+=(--device); fi
npx expo run:ios "${args[@]}"

# E confere o que foi de fato EMBUTIDO nesta execução (mais novo que o marco), não um build velho.
bundle="$(find ~/Library/Developer/Xcode/DerivedData -path '*Release-iphoneos/ProOps.app/main.jsbundle' -newer "$marco" 2>/dev/null | head -1)"
if [[ -z "$bundle" ]]; then
  echo "⚠ main.jsbundle deste build não encontrado para conferir o ambiente." >&2
  exit 1
fi
conferir "$bundle"
echo "✓ Release de produção instalado; JS embutido aponta para $PROD_REF."
