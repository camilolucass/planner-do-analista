'use strict';

const crypto = require('node:crypto');
const { supabase } = require('./supabase');

const SESSAO_DIAS = 30;
const MAX_TENTATIVAS = 8;
const JANELA_MS = 15 * 60 * 1000;

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

/* ---------- cookies / sessão (guardada na tabela cockpit_sessoes) ---------- */
function lerCookie(req, nome) {
  const bruto = req.headers.cookie || '';
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

async function iniciarSessao(res, analistaId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiraEm = new Date(Date.now() + SESSAO_DIAS * 86400000).toISOString();
  const { error } = await supabase.from('cockpit_sessoes').insert({ token, analista_id: analistaId, expira_em: expiraEm });
  if (error) throw new Error(error.message);
  // Vercel serve tudo por HTTPS, então "Secure" pode ficar sempre ligado.
  res.setHeader('Set-Cookie', `sessao=${token}; HttpOnly; Path=/; Max-Age=${SESSAO_DIAS * 86400}; SameSite=Lax; Secure`);
}

async function encerrarSessao(req, res) {
  const token = lerCookie(req, 'sessao');
  if (token) await supabase.from('cockpit_sessoes').delete().eq('token', token);
  res.setHeader('Set-Cookie', 'sessao=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure');
}

async function obterSessao(req) {
  const token = lerCookie(req, 'sessao');
  if (!token) return null;
  const { data, error } = await supabase
    .from('cockpit_sessoes')
    .select('analista_id, expira_em, cockpit_analistas(nome)')
    .eq('token', token)
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expira_em) < new Date()) {
    await supabase.from('cockpit_sessoes').delete().eq('token', token);
    return null;
  }
  return { analistaId: data.analista_id, analistaNome: data.cockpit_analistas.nome };
}

/* ---------- rate limit de login (guardado na tabela cockpit_tentativas_login) ---------- */
async function loginBloqueado(chave) {
  const { data } = await supabase.from('cockpit_tentativas_login').select('*').eq('chave', chave).maybeSingle();
  if (!data) return false;
  if (new Date(data.expira_em) < new Date()) {
    await supabase.from('cockpit_tentativas_login').delete().eq('chave', chave);
    return false;
  }
  return data.contagem >= MAX_TENTATIVAS;
}

async function registrarFalhaLogin(chave) {
  const { data } = await supabase.from('cockpit_tentativas_login').select('*').eq('chave', chave).maybeSingle();
  if (!data || new Date(data.expira_em) < new Date()) {
    await supabase.from('cockpit_tentativas_login').upsert({ chave, contagem: 1, expira_em: new Date(Date.now() + JANELA_MS).toISOString() });
  } else {
    await supabase.from('cockpit_tentativas_login').update({ contagem: data.contagem + 1 }).eq('chave', chave);
  }
}

async function limparTentativasLogin(chave) {
  await supabase.from('cockpit_tentativas_login').delete().eq('chave', chave);
}

module.exports = {
  hashSenha, verificarSenha, lerCookie,
  iniciarSessao, encerrarSessao, obterSessao,
  loginBloqueado, registrarFalhaLogin, limparTentativasLogin,
};
