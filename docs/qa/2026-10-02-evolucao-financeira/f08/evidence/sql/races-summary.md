F08 real staging races — 4/4 passed, no production access.

Target: utkqoiigimqzeenxkxdl; branch: gabriel/financas-22-melhorias.
Commands: scripts/supabase-target.sh < /dev/null; agent/.venv/bin/python -m py_compile /private/tmp/proops-f08-races-runner.py; agent/.venv/bin/python /private/tmp/proops-f08-races-runner.py --execute.
Runner: /private/tmp/proops-f08-races-runner.py; audited helper dependency: /private/tmp/proops-f07-concurrency.py.
Result events: /private/tmp/proops-f08-races-results.jsonl; synthetic recovery manifest (cleaned=true): /private/tmp/proops-f08-races-fixtures.json.
Two distinct backends, READ COMMITTED, statement timeout 10s, lock timeout 8s; advisory blocking independently observed before holder commit in all cases.
Same request/input: both revision 1; plan1/items2/sealed1/generic1; replay of both APIs unchanged.
Different request IDs/same revision: winner revision1; loser exact PT409; loser sealed/generic receipts0 and no mutation.
Resolve before delayed save: both exact cancelled:true; plan0/items0/sealed1/generic0.
Save before concurrent resolve: both exact revision1; plan1/items2/sealed1/generic1.
All cases: 33 public workspace tables and cash unchanged except the two F08 intent tables; SQL checks compare complete rows/payloads/results.
Cleanup: four synthetic users and eight owned workspaces removed, all four audits passed with zero residue across 82 UUID boundary columns.
Limits: direct PostgreSQL authenticated-role protocol, not HTTP/network response loss or device execution. Default sandbox attempt was blocked before fixtures; authorized escalated run passed. No confirmed bug.
