# Painel de admin (SPA)

Vite + React 19 + Tailwind v4 + shadcn/ui. Contrato da API: `docs/ADMIN-API.md`.

```bash
npm ci
npm run dev        # http://localhost:5180/admin/ — proxy de /admin/api para :8090 (agente local)
npm run dev:mock   # VITE_MOCK=1: dados fictícios, sem login nem backend (nunca entra no build)
npm run build      # tsc + vite build -> dist/
npm run lint
```

Em produção o `Dockerfile` do agente roda o build e copia `dist/` para `app/static/admin/`
(servido por `app/routes/admin_web.py`). `dist/` não é versionado.
