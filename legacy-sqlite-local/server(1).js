/* ============================================================
   COCKPIT DO ANALISTA — Servidor (Node.js puro, sem dependências)
   Requisitos: Node.js 22 ou superior (usa o SQLite embutido)
   Rodar:      node server.js
   Acesso:     http://localhost:8020  (ou http://IP-DO-SERVIDOR:8020)
   Banco:      cockpit.db (criado automaticamente nesta pasta)
   ============================================================ */
'use strict';

const http   = require('node:http');
const fs     = require('node:fs');
const path   = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT   = process.env.PORT || 8020;
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
`);

/* migração leve: se o banco já existia de uma versão anterior sem a coluna senha_hash */
try { db.exec('ALTER TABLE analistas ADD COLUMN senha_hash TEXT'); } catch (_) { /* coluna já existe */ }

/* ---------- senhas: hash com scrypt (nativo do Node, sem dependências) ---------- */
function gerarHash(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function conferirHash(senha, guardado) {
  if (!guardado) return false;
  const [salt, hash] = guardado.split(':');
  const calc = crypto.scryptSync(senha, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calc, 'hex'));
}

/* seed simples: garante que existe pelo menos um analista para começar */
const totalAnalistas = db.prepare('SELECT COUNT(*) AS n FROM analistas').get().n;
if (totalAnalistas === 0) {
  db.prepare('INSERT INTO analistas (nome, senha_hash) VALUES (?, ?)')
    .run('Lucas Camilo', gerarHash('1234'));
  console.log('Analista inicial criado: "Lucas Camilo" — senha padrão: 1234 (troque depois de logar).');
}

const hoje = () => new Date().toISOString().slice(0, 10);

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

/* ---------- ROTAS DA API ---------- */
const rotas = {

  /* ----- ANALISTAS ----- */
  /* nunca devolve senha_hash pro frontend — só se ela existe (bool) */
  'GET /api/analistas': () =>
    [200, db.prepare('SELECT id, nome, (senha_hash IS NOT NULL) AS tem_senha FROM analistas ORDER BY nome').all()],

  'POST /api/analistas': (body) => {
    const nome = (body.nome || '').trim();
    const senha = (body.senha || '').trim();
    if (!nome) return [400, { erro: 'Informe um nome.' }];
    if (!senha || senha.length < 4) return [400, { erro: 'Defina uma senha com pelo menos 4 caracteres.' }];
    try {
      const r = db.prepare('INSERT INTO analistas (nome, senha_hash) VALUES (?, ?)').run(nome, gerarHash(senha));
      return [201, { id: Number(r.lastInsertRowid), nome }];
    } catch (e) {
      return [409, { erro: 'Já existe um analista com esse nome.' }];
    }
  },

  /* login: confere a senha antes de liberar o acesso */
  'POST /api/login': (body) => {
    const { analista_id, senha } = body;
    const a = db.prepare('SELECT * FROM analistas WHERE id = ?').get(analista_id);
    if (!a) return [404, { erro: 'Analista não encontrado.' }];
    if (!a.senha_hash) return [400, { erro: 'SEM_SENHA' }]; // legado: ainda não definiu senha
    if (!conferirHash(senha || '', a.senha_hash)) return [401, { erro: 'Senha incorreta.' }];
    return [200, { id: a.id, nome: a.nome }];
  },

  /* define a senha de um analista que ainda não tem uma (fluxo de migração/legado) */
  'POST /api/analistas/:id/senha': (body, params) => {
    const a = db.prepare('SELECT * FROM analistas WHERE id = ?').get(params.id);
    if (!a) return [404, { erro: 'Analista não encontrado.' }];
    if (a.senha_hash) return [409, { erro: 'Este analista já tem senha definida.' }];
    const senha = (body.senha || '').trim();
    if (!senha || senha.length < 4) return [400, { erro: 'Defina uma senha com pelo menos 4 caracteres.' }];
    db.prepare('UPDATE analistas SET senha_hash = ? WHERE id = ?').run(gerarHash(senha), params.id);
    return [200, { id: a.id, nome: a.nome }];
  },

  /* troca de senha: exige a senha atual correta antes de trocar */
  'POST /api/analistas/:id/trocar-senha': (body, params) => {
    const a = db.prepare('SELECT * FROM analistas WHERE id = ?').get(params.id);
    if (!a) return [404, { erro: 'Analista não encontrado.' }];
    const senhaAtual = (body.senha_atual || '').trim();
    const senhaNova = (body.senha_nova || '').trim();
    if (!conferirHash(senhaAtual, a.senha_hash)) return [401, { erro: 'Senha atual incorreta.' }];
    if (!senhaNova || senhaNova.length < 4) return [400, { erro: 'A nova senha precisa ter pelo menos 4 caracteres.' }];
    db.prepare('UPDATE analistas SET senha_hash = ? WHERE id = ?').run(gerarHash(senhaNova), params.id);
    return [200, { ok: true }];
  },

  /* ----- TAREFAS ----- */
  'GET /api/tarefas': (_b, _p, query) => {
    const analistaId = query.get('analista_id');
    if (!analistaId) return [400, { erro: 'Informe analista_id.' }];
    const linhas = db.prepare('SELECT * FROM tarefas WHERE analista_id = ? ORDER BY id DESC')
                     .all(analistaId)
                     .map(t => ({ ...t, passos: JSON.parse(t.passos_json || '[]') }));
    return [200, linhas];
  },

  'POST /api/tarefas': (body) => {
    if (!body.analista_id || !body.titulo) return [400, { erro: 'analista_id e titulo são obrigatórios.' }];
    const r = db.prepare(`
      INSERT INTO tarefas
        (analista_id, titulo, descricao, prioridade, semana, dia_semana, planejada_para, conta_meta, coluna, passos_json)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      body.analista_id, body.titulo, body.descricao || '', body.prioridade || 'media',
      body.semana ?? null, body.dia_semana ?? null, body.planejada_para ?? null,
      body.conta_meta ? 1 : 0, body.coluna || 'backlog', JSON.stringify(body.passos || [])
    );
    return [201, db.prepare('SELECT * FROM tarefas WHERE id = ?').get(Number(r.lastInsertRowid))];
  },

  'PUT /api/tarefas/:id': (body, params) => {
    const atual = db.prepare('SELECT * FROM tarefas WHERE id = ?').get(params.id);
    if (!atual) return [404, { erro: 'Tarefa não encontrada.' }];
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

  'PATCH /api/tarefas/:id': (body, params) => {
    const atual = db.prepare('SELECT * FROM tarefas WHERE id = ?').get(params.id);
    if (!atual) return [404, { erro: 'Tarefa não encontrada.' }];
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

  'DELETE /api/tarefas/:id': (_b, params) => {
    const r = db.prepare('DELETE FROM tarefas WHERE id = ?').run(params.id);
    return r.changes ? [204, null] : [404, { erro: 'Tarefa não encontrada.' }];
  },

  /* ----- RESUMO DA EQUIPE (visão do gestor) ----- */
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

  /* ----- HISTÓRICO MENSAL (gráfico de progresso ao longo do tempo) ----- */
  'GET /api/historico': (_b, _p, query) => {
    const analistaId = query.get('analista_id');
    const meses = Math.min(24, Number(query.get('meses')) || 6);
    if (!analistaId) return [400, { erro: 'Informe analista_id.' }];
    const linhas = db.prepare(`
      SELECT strftime('%Y-%m', criada_em) AS mes,
             COUNT(*)                                          AS total,
             COALESCE(SUM(CASE WHEN done = 1 THEN 1 END), 0)    AS concluidas
      FROM tarefas
      WHERE analista_id = ? AND conta_meta = 1
      GROUP BY mes
      ORDER BY mes DESC
      LIMIT ?
    `).all(analistaId, meses);
    return [200, linhas.reverse()]; // ordem cronológica pro gráfico
  },
};

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
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) return servirEstatico(req, res, pathname);

  try {
    const body = (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') ? await lerCorpo(req) : {};
    let handler = rotas[`${req.method} ${pathname}`], params = {};
    if (!handler) {
      const m1 = pathname.match(/^(\/api\/tarefas)\/(\d+)$/);
      const m2 = pathname.match(/^\/api\/analistas\/(\d+)\/senha$/);
      const m3 = pathname.match(/^\/api\/analistas\/(\d+)\/trocar-senha$/);
      if (m1) { handler = rotas[`${req.method} ${m1[1]}/:id`]; params = { id: parseInt(m1[2], 10) }; }
      else if (m2) { handler = rotas[`${req.method} /api/analistas/:id/senha`]; params = { id: parseInt(m2[1], 10) }; }
      else if (m3) { handler = rotas[`${req.method} /api/analistas/:id/trocar-senha`]; params = { id: parseInt(m3[1], 10) }; }
    }
    if (!handler) return json(res, 404, { erro: 'Rota não encontrada.' });

    const [code, payload] = handler(body, params, url.searchParams);
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
  console.log('  Parar:   Ctrl+C');
  console.log('==============================================');
});
