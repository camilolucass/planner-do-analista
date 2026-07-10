# Planner do Analista

Painel de planejamento e acompanhamento de tarefas para analistas — visão do dia, quadro Kanban, histórico mensal de metas e visão geral da equipe.

**Produção:** [cockpit-servidor.vercel.app](https://cockpit-servidor.vercel.app)

## Stack

- **Frontend:** HTML, CSS e JavaScript puros (`public/`), sem build step.
- **API:** funções serverless da Vercel (`api/`), Node.js.
- **Banco:** Postgres via [Supabase](https://supabase.com) (`lib/supabase.js`).
- **Deploy:** Vercel.

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

