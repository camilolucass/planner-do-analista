# Planner do Analista

Painel de planejamento e acompanhamento de tarefas para analistas — visão do dia, quadro Kanban, histórico mensal de metas e visão geral da equipe.

**Produção:** [cockpit-servidor.vercel.app](https://cockpit-servidor.vercel.app)

## Stack

- **Frontend:** HTML, CSS e JavaScript puros (`public/`), sem build step.
- **API:** funções serverless da Vercel (`api/`), Node.js.
- **Banco:** Postgres via [Supabase](https://supabase.com) (`lib/supabase.js`), acessado só no servidor com a `service_role` key.
- **Deploy:** Vercel, com deploy automático a cada push na branch `master`.

## Funcionalidades

- Login por analista com senha (sessão via cookie httpOnly, sem dado sensível no navegador).
- **Hoje** — indicadores do mês, tarefas atrasadas, do dia e sugestões do backlog.
- **Kanban** — backlog, planejada na semana, em andamento e concluída, com arrastar-e-soltar.
- **Histórico** — progresso mensal (metas batidas x meta do mês).
- **Equipe** — visão geral de tarefas concluídas/pendentes/atrasadas por analista.
- Tema claro/escuro, exportação de tarefas em Markdown.

## Estrutura

```
api/            Rotas serverless (login, analistas, tarefas, histórico, resumo)
lib/            Cliente Supabase e helpers de autenticação/sessão
public/         Frontend estático (index.html, styles.css, app.js)
```

## Rodando localmente

Pré-requisitos: Node.js e a [Vercel CLI](https://vercel.com/docs/cli) (`npx vercel`).

1. Copie `.env.example` para `.env.local` e preencha `SUPABASE_SERVICE_ROLE_KEY` (pegue no painel do Supabase, em Project Settings → API).
2. Instale as dependências:
   ```
   npm install
   ```
3. Suba o ambiente local (roda o frontend estático + as funções da API juntos):
   ```
   npx vercel dev
   ```

## Variáveis de ambiente

| Nome | Descrição |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave `service_role` do Supabase — **secreta**, nunca commitar. Usada só nas funções server-side. |

## Deploy

O projeto Vercel (`cockpit-servidor`) está conectado a este repositório: todo push na branch `master` gera um deploy automático de produção. Pull requests geram deploys de preview.
