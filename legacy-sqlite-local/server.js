/* ============================================================
   COCKPIT DO ANALISTA — Servidor (Node.js puro, sem dependências)
   Requisitos: Node.js 22 ou superior (usa o SQLite embutido)
   Rodar:      node server.js
   Acesso:     http://localhost:8020  (ou http://IP-DO-SERVIDOR:8020)
   Banco:      cockpit.db (criado automaticamente nesta pasta)

   Produção: defina NODE_ENV=production quando o site estiver atrás
   de HTTPS (reverse proxy) — isso ativa o cookie de sessão "Secure".
   ============================================================ */
'use strict';

const http   = require('node:http');
const fs     = require('node:fs');
const path   = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT   = process.env.PORT || 8020;
const PROD   = process.env.NODE_ENV === 'production';
const BASE   = __dirname;
const STATIC = path.join(BASE, 'static');
const db     = new DatabaseSync(path.join(BASE, 'cockpit.db'));

/* ---------- BANCO: criado automaticamente na primeira execução ---------- */
db.exec(`
  CREATE TABLE IF NOT EXISTS analistas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT NOT NULL UNIQUE,
    senha_hash  TEXT
  );

  CREATE TABLE IF NOT EXISTS tarefas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    analista_id     INTEGER NOT NULL,
    titulo          TEXT NOT NULL,
    descricao       TEXT DEFAULT '',
    prioridade      TEXT DEFAULT 'media',
    semana          INTEGER,
    dia_semana      INTEGER,
    planejada_para  TEXT,
    conta_meta      INTEGER DEFAULT 1,
    coluna          TEXT DEFAULT 'backlog',
    done            INTEGER DEFAULT 0,
    passos_json      TEXT DEFAULT '[]',
    criada_em       TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (analista_id) REFERENCES analistas(id)
  );

  CREATE TABLE IF NOT EXISTS sessoes (
    token        TEXT PRIMARY KEY,
    analista_id  INTEGER NOT NULL,
    criada_em    TEXT DEFAULT (datetime('now')),
    expira_em    TEXT NOT NULL,
    FOREIGN KEY (analista_id) REFERENCES analistas(id)
  );
`);

/* migração: bancos criados antes da senha existir ganham a coluna agora */
try {
  db.exec('ALTER TABLE analistas ADD COLUMN senha_hash TEXT');
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e;
}

/* seed simples: garante que existe pelo menos um analista para começar
   (sem senha — no primeiro login o app pede para definir uma) */
const totalAnalistas = db.prepare('SELECT COUNT(*) AS n FROM analistas').get().n;
if (totalAnalistas === 0) {
  db.prepare('INSERT INTO analistas (nome) VALUES (?)').run('Lucas Camilo');
}

const hoje = () => new Date().toISOString().slice(0, 10);

/* ---------- senhas ---------- */
function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verificarSenha(senha, senhaHash) {
  if (!senhaHash) return false;
  const [salt, hashArmazenadoHex] = senhaHash.split(':');
  const tentativa = crypto.scryptSync(senha, salt, 64);
  const armazenado = Buffer.from(hashArmazenadoHex, 'hex');
  return tentativa.length === armazenado.length && crypto.timingSafeEqual(tentativa, armazenado);
}

/* ---------- sessões (cookie httpOnly, guardadas no banco) ---------- */
const SESSAO_DIAS = 30;

function lerCookie(req, nome) {
  const bruto = req.headers.cookie || '';
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

function iniciarSessao(res, analistaId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiraEm = new Date(Date.now() + SESSAO_DIAS * 86400000).toISOString();
  db.prepare('INSERT INTO sessoes (token, analista_id, expira_em) VALUES (?,?,?)').run(token, analistaId, expiraEm);
  const atributos = ['HttpOnly', 'Path=/', `Max-Age=${SESSAO_DIAS * 86400}`, 'SameSite=Lax'];
  if (PROD) atributos.push('Secure');
  res.setHeader('Set-Cookie', `sessao=${token}; ${atributos.join('; ')}`);
}

function encerrarSessao(req, res) {
  const token = lerCookie(req, 'sessao');
  if (token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
  const atributos = ['HttpOnly', 'Path=/', 'Max-Age=0', 'SameSite=Lax'];
  if (PROD) atributos.push('Secure');
  res.setHeader('Set-Cookie', `sessao=; ${atributos.join('; ')}`);
}

function obterSessao(req) {
  const token = lerCookie(req, 'sessao');
  if (!token) return null;
  const linha = db.prepare(`
    SELECT s.analista_id AS analistaId, a.nome AS analistaNome, s.expira_em AS expiraEm
    FROM sessoes s JOIN analistas a ON a.id = s.analista_id
    WHERE s.token = ?`).get(token);
  if (!linha) return null;
  if (new Date(linha.expiraEm) < new Date()) {
    db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
    return null;
  }
  return { analistaId: linha.analistaId, analistaNome: linha.analistaNome };
}

/* limpeza periódica de sessões vencidas */
setInterval(() => db.prepare("DELETE FROM sessoes WHERE expira_em < datetime('now')").run(), 60 * 60 * 1000).unref();

/* ---------- rate limit simples de login (por IP + analista) ---------- */
const tentativasLogin = new Map();
const MAX_TENTATIVAS = 8;
const JANELA_MS = 15 * 60 * 1000;

function loginBloqueado(chave) {
  const r = tentativasLogin.get(chave);
  if (!r) return false;
  if (Date.now() > r.resetEm) { tentativasLogin.delete(chave); return false; }
  return r.contagem >= MAX_TENTATIVAS;
}
function registrarFalhaLogin(chave) {
  const r = tentativasLogin.get(chave) || { contagem: 0, resetEm: Date.now() + JANELA_MS };
  r.contagem++;
  tentativasLogin.set(chave, r);
}
function limparTentativasLogin(chave) { tentativasLogin.delete(chave); }

setInterval(() => {
  const agora = Date.now();
  for (const [chave, r] of tentativasLogin) if (agora > r.resetEm) tentativasLogin.delete(chave);
}, 30 * 60 * 1000).unref();

/* ---------- helpers HTTP ---------- */
function json(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', c => (dados += c));
    req.on('end', () => {
      if (!dados) return resolve({});
      try { resolve(JSON.parse(dados)); }
      catch { reject(new Error('JSON inválido no corpo da requisição.')); }
    });
    req.on('error', reject);
  });
}

/* ---------- ROTAS DA API ----------
   Assinatura de cada handler: (body, params, query, ctx)
   ctx = { sessao, req, res } — sessao é null em rotas públicas sem login. */
const rotas = {

  /* ----- LOGIN / CADASTRO (públicas) ----- */
  'GET /api/analistas': () =>
    [200, db.prepare('SELECT id, nome FROM analistas ORDER BY nome').all()],

  'POST /api/analistas': (body, _p, _q, ctx) => {
    const nome = (body.nome || '').trim();
    const senha = body.senha || '';
    if (!nome) return [400, { erro: 'Informe um nome.' }];
    if (senha.length < 4) return [400, { erro: 'A senha precisa ter pelo menos 4 caracteres.' }];
    try {
      const r = db.prepare('INSERT INTO analistas (nome, senha_hash) VALUES (?,?)').run(nome, hashSenha(senha));
      const id = Number(r.lastInsertRowid);
      iniciarSessao(ctx.res, id);
      return [201, { id, nome }];
    } catch (e) {
      return [409, { erro: 'Já existe um analista com esse nome.' }];
    }
  },

  'POST /api/login': (body, _p, _q, ctx) => {
    const analistaId = Number(body.analista_id);
    const senha = body.senha || '';
    if (!analistaId) return [400, { erro: 'Informe o analista.' }];
    const chave = `${ctx.req.socket.remoteAddress}|${analistaId}`;
    if (loginBloqueado(chave)) return [429, { erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' }];

    const analista = db.prepare('SELECT * FROM analistas WHERE id = ?').get(analistaId);
    if (!analista) return [404, { erro: 'Analista não encontrado.' }];
    if (!analista.senha_hash) return [401, { erro: 'SEM_SENHA' }];
    if (!verificarSenha(senha, analista.senha_hash)) {
      registrarFalhaLogin(chave);
      return [401, { erro: 'Senha incorreta.' }];
    }
    limparTentativasLogin(chave);
    iniciarSessao(ctx.res, analista.id);
    return [200, { id: analista.id, nome: analista.nome }];
  },

  /* define a primeira senha de um analista antigo que ainda não tem uma */
  'POST /api/analistas/:id/senha': (body, params, _q, ctx) => {
    const senha = body.senha || '';
    if (senha.length < 4) return [400, { erro: 'A senha precisa ter pelo menos 4 caracteres.' }];
    const analista = db.prepare('SELECT * FROM analistas WHERE id = ?').get(params.id);
    if (!analista) return [404, { erro: 'Analista não encontrado.' }];
    if (analista.senha_hash) return [409, { erro: 'Este analista já tem senha. Faça login normalmente.' }];
    db.prepare('UPDATE analistas SET senha_hash = ? WHERE id = ?').run(hashSenha(senha), analista.id);
    iniciarSessao(ctx.res, analista.id);
    return [200, { id: analista.id, nome: analista.nome }];
  },

  /* ----- SESSÃO (autenticadas) ----- */
  'POST /api/logout': (_b, _p, _q, ctx) => { encerrarSessao(ctx.req, ctx.res); return [204, null]; },

  'POST /api/analistas/:id/trocar-senha': (body, params, _q, ctx) => {
    if (ctx.sessao.analistaId !== Number(params.id)) return [403, { erro: 'Sem permissão.' }];
    const analista = db.prepare('SELECT * FROM analistas WHERE id = ?').get(params.id);
    if (!verificarSenha(body.senha_atual || '', analista.senha_hash)) return [401, { erro: 'Senha atual incorreta.' }];
    const nova = body.senha_nova || '';
    if (nova.length < 4) return [400, { erro: 'A nova senha precisa ter pelo menos 4 caracteres.' }];
    db.prepare('UPDATE analistas SET senha_hash = ? WHERE id = ?').run(hashSenha(nova), analista.id);
    return [200, { ok: true }];
  },

  /* ----- TAREFAS (autenticadas — sempre a partir do analista da sessão) ----- */
  'GET /api/tarefas': (_b, _p, _q, ctx) => {
    const linhas = db.prepare('SELECT * FROM tarefas WHERE analista_id = ? ORDER BY id DESC')
                     .all(ctx.sessao.analistaId)
                     .map(t => ({ ...t, passos: JSON.parse(t.passos_json || '[]') }));
    return [200, linhas];
  },

  'POST /api/tarefas': (body, _p, _q, ctx) => {
    if (!body.titulo) return [400, { erro: 'titulo é obrigatório.' }];
    const r = db.prepare(`
      INSERT INTO tarefas
        (analista_id, titulo, descricao, prioridade, semana, dia_semana, planejada_para, conta_meta, coluna, passos_json)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      ctx.sessao.analistaId, body.titulo, body.descricao || '', body.prioridade || 'media',
      body.semana ?? null, body.dia_semana ?? null, body.planejada_para ?? null,
      body.conta_meta ? 1 : 0, body.coluna || 'backlog', JSON.stringify(body.passos || [])
    );
    return [201, db.prepare('SELECT * FROM tarefas WHERE id = ?').get(Number(r.lastInsertRowid))];
  },

  'PUT /api/tarefas/:id': (body, params, _q, ctx) => {
    const atual = db.prepare('SELECT * FROM tarefas WHERE id = ?').get(params.id);
    if (!atual) return [404, { erro: 'Tarefa não encontrada.' }];
    if (atual.analista_id !== ctx.sessao.analistaId) return [403, { erro: 'Sem permissão para editar esta tarefa.' }];
    const novo = { ...atual, ...body };
    db.prepare(`
      UPDATE tarefas SET
        titulo=?, descricao=?, prioridade=?, semana=?, dia_semana=?,
        planejada_para=?, conta_meta=?, coluna=?, done=?, passos_json=?
      WHERE id=?
    `).run(
      novo.titulo, novo.descricao, novo.prioridade, novo.semana ?? null, novo.dia_semana ?? null,
      novo.planejada_para ?? null, novo.conta_meta ? 1 : 0, novo.coluna, novo.done ? 1 : 0,
      JSON.stringify(novo.passos || JSON.parse(atual.passos_json || '[]')), params.id
    );
    return [200, db.prepare('SELECT * FROM tarefas WHERE id = ?').get(params.id)];
  },

  'PATCH /api/tarefas/:id': (body, params, _q, ctx) => {
    const atual = db.prepare('SELECT * FROM tarefas WHERE id = ?').get(params.id);
    if (!atual) return [404, { erro: 'Tarefa não encontrada.' }];
    if (atual.analista_id !== ctx.sessao.analistaId) return [403, { erro: 'Sem permissão para editar esta tarefa.' }];
    const campos = [];
    const valores = [];
    for (const chave of ['coluna', 'done', 'semana', 'dia_semana', 'planejada_para', 'passos_json']) {
      if (chave === 'passos_json' && body.passos !== undefined) {
        campos.push('passos_json = ?'); valores.push(JSON.stringify(body.passos));
      } else if (body[chave] !== undefined) {
        campos.push(`${chave} = ?`); valores.push(chave === 'done' ? (body.done ? 1 : 0) : body[chave]);
      }
    }
    if (!campos.length) return [400, { erro: 'Nada para atualizar.' }];
    valores.push(params.id);
    db.prepare(`UPDATE tarefas SET ${campos.join(', ')} WHERE id = ?`).run(...valores);
    return [200, db.prepare('SELECT * FROM tarefas WHERE id = ?').get(params.id)];
  },

  'DELETE /api/tarefas/:id': (_b, params, _q, ctx) => {
    const atual = db.prepare('SELECT * FROM tarefas WHERE id = ?').get(params.id);
    if (!atual) return [404, { erro: 'Tarefa não encontrada.' }];
    if (atual.analista_id !== ctx.sessao.analistaId) return [403, { erro: 'Sem permissão para excluir esta tarefa.' }];
    db.prepare('DELETE FROM tarefas WHERE id = ?').run(params.id);
    return [204, null];
  },

  /* ----- RESUMO DA EQUIPE (qualquer analista logado pode ver) ----- */
  'GET /api/resumo': () =>
    [200, db.prepare(`
      SELECT a.id, a.nome,
             COUNT(t.id)                                                        AS total,
             COALESCE(SUM(t.done), 0)                                           AS concluidas,
             COALESCE(SUM(CASE WHEN t.done = 0 THEN 1 END), 0)                  AS pendentes,
             COALESCE(SUM(CASE WHEN t.done = 0 AND t.planejada_para < ?
                                THEN 1 END), 0)                                 AS atrasadas
      FROM analistas a
      LEFT JOIN tarefas t ON t.analista_id = a.id
      GROUP BY a.id
      ORDER BY a.nome`).all(hoje())],

  /* ----- HISTÓRICO MENSAL (do próprio analista da sessão) ----- */
  'GET /api/historico': (_b, _p, query, ctx) => {
    const meses = Math.min(Math.max(Number(query.get('meses')) || 6, 1), 24);
    const linhas = db.prepare(`
      SELECT mes, total, concluidas FROM (
        SELECT strftime('%Y-%m', COALESCE(planejada_para, criada_em)) AS mes,
               COUNT(*)                    AS total,
               COALESCE(SUM(done), 0)      AS concluidas
        FROM tarefas
        WHERE analista_id = ? AND conta_meta = 1
        GROUP BY mes
        ORDER BY mes DESC
        LIMIT ?
      ) sub ORDER BY mes ASC
    `).all(ctx.sessao.analistaId, meses);
    return [200, linhas];
  },
};

/* rotas que não exigem sessão ativa */
const ROTAS_PUBLICAS = new Set([
  'GET /api/analistas',
  'POST /api/analistas',
  'POST /api/login',
  'POST /api/analistas/:id/senha',
]);

/* ---------- ARQUIVOS ESTÁTICOS (frontend) ---------- */
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
               '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon',
               '.woff2':'font/woff2', '.md':'text/markdown' };

function servirEstatico(req, res, pathname) {
  let alvo = pathname === '/' ? '/index.html' : pathname;
  const arquivo = path.join(STATIC, path.normalize(alvo));
  if (!arquivo.startsWith(STATIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(arquivo, (err, dados) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': (MIME[path.extname(arquivo)] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(dados);
  });
}

/* ---------- ROTEADOR ---------- */
function resolverRota(req, pathname) {
  const chaveDireta = `${req.method} ${pathname}`;
  if (rotas[chaveDireta]) return { handler: rotas[chaveDireta], chave: chaveDireta, params: {} };

  let m = pathname.match(/^(\/api\/tarefas)\/(\d+)$/);
  if (m) {
    const chave = `${req.method} ${m[1]}/:id`;
    if (rotas[chave]) return { handler: rotas[chave], chave, params: { id: parseInt(m[2], 10) } };
  }

  m = pathname.match(/^\/api\/analistas\/(\d+)\/senha$/);
  if (m && req.method === 'POST') {
    const chave = 'POST /api/analistas/:id/senha';
    return { handler: rotas[chave], chave, params: { id: parseInt(m[1], 10) } };
  }

  m = pathname.match(/^\/api\/analistas\/(\d+)\/trocar-senha$/);
  if (m && req.method === 'POST') {
    const chave = 'POST /api/analistas/:id/trocar-senha';
    return { handler: rotas[chave], chave, params: { id: parseInt(m[1], 10) } };
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) return servirEstatico(req, res, pathname);

  try {
    const body = (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') ? await lerCorpo(req) : {};
    const resolvida = resolverRota(req, pathname);
    if (!resolvida) return json(res, 404, { erro: 'Rota não encontrada.' });

    const sessao = obterSessao(req);
    if (!ROTAS_PUBLICAS.has(resolvida.chave) && !sessao) {
      return json(res, 401, { erro: 'Não autenticado.' });
    }

    const [code, payload] = resolvida.handler(body, resolvida.params, url.searchParams, { sessao, req, res });
    if (code === 204) { res.writeHead(204); return res.end(); }
    return json(res, code, payload);
  } catch (e) {
    console.error(new Date().toISOString(), req.method, pathname, '-', e.message);
    return json(res, 500, { erro: 'Erro interno: ' + e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('==============================================');
  console.log('  Cockpit do Analista — servidor no ar');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Rede:    http://<IP-deste-servidor>:${PORT}`);
  console.log(`  Banco:   ${path.join(BASE, 'cockpit.db')}`);
  console.log(`  Modo:    ${PROD ? 'produção (cookie Secure ativo)' : 'desenvolvimento'}`);
  console.log('  Parar:   Ctrl+C');
  console.log('==============================================');
});
