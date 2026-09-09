#!/usr/bin/env bash
# `criar_cron` não pode desligar um cron que já está ligado. `./scripts/setup-gcp-crons.test.sh`
#
# O defeito que isto prende (09/09/2026): o `pause` era incondicional, então TODO
# `setup-gcp.sh deploy` desligava reminders, finance-scheduler e alerts em produção — em
# silêncio, com uma linha "PAUSADO até o corte" que ninguém ligava ao efeito. A recorrência do
# salário parou de materializar por causa disso, e o conserto foi desfeito pelo deploy seguinte.
#
# `gcloud` é dublado: o teste mede QUAIS subcomandos o script chamaria, sem tocar em nuvem
# nenhuma. Sem o dublê este arquivo não poderia existir — e é justamente o caminho de produção.
set -euo pipefail
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
chamadas="$tmp/chamadas.txt"

# Extrai só a função do script real: rodar o arquivo inteiro dispararia o guard de produção.
sed -n '/^criar_cron() {/,/^}/p' scripts/setup-gcp.sh > "$tmp/criar_cron.sh"
[[ -s "$tmp/criar_cron.sh" ]] || { echo "✗ não achei criar_cron em setup-gcp.sh"; exit 1; }

REGION=southamerica-east1 PROJECT_ID=p SA_EMAIL=sa@x.iam.gserviceaccount.com
export REGION PROJECT_ID SA_EMAIL

roda() { # $1 = existe|nao_existe
  : > "$chamadas"
  cat > "$tmp/gcloud" <<EOF
#!/usr/bin/env bash
echo "\$2 \$3" >> "$chamadas"
case "\$2 \$3" in
  "jobs describe") [[ "$1" == existe ]] || exit 1; echo ENABLED ;;
esac
exit 0
EOF
  chmod +x "$tmp/gcloud"
  PATH="$tmp:$PATH" bash -c "source '$tmp/criar_cron.sh'; criar_cron reminders '* * * * *' https://x/cron/reminders" >/dev/null
}

falhas=0
verifica() { # $1 rótulo  $2 esperado(sim|nao)  $3 padrão
  local achou=nao
  grep -q "$3" "$chamadas" && achou=sim
  if [[ "$achou" == "$2" ]]; then
    printf '  ✓ %s\n' "$1"
  else
    printf '  ✗ %s — esperava %s, foi %s\n' "$1" "$2" "$achou"
    falhas=$((falhas + 1))
  fi
}

echo "job NOVO — nasce pausado (o fluxo Deno podia estar entregando o mesmo lembrete)"
roda nao_existe
verifica "cria o job"        sim "jobs create"
verifica "pausa o job novo"  sim "jobs pause"

echo "job QUE JÁ EXISTE — estado preservado"
roda existe
verifica "atualiza o job"          sim "jobs update"
verifica "NÃO pausa o que existe"  nao "jobs pause"

[[ $falhas -eq 0 ]] && echo "ok" || echo "$falhas falha(s)"
exit "$falhas"
