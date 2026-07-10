'use strict';

const { supabase } = require('../../../lib/supabase');
const { verificarSenha, hashSenha, obterSessao } = require('../../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const sessao = await obterSessao(req);
  if (!sessao) return res.status(401).json({ erro: 'Não autenticado.' });

  const id = Number(req.query.id);
  if (sessao.analistaId !== id) return res.status(403).json({ erro: 'Sem permissão.' });

  const { data: analista, error } = await supabase.from('cockpit_analistas').select('*').eq('id', id).maybeSingle();
  if (error || !analista) return res.status(404).json({ erro: 'Analista não encontrado.' });
  if (!verificarSenha(req.body?.senha_atual || '', analista.senha_hash)) {
    return res.status(401).json({ erro: 'Senha atual incorreta.' });
  }

  const nova = req.body?.senha_nova || '';
  if (nova.length < 4) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 4 caracteres.' });

  const { error: updErr } = await supabase.from('cockpit_analistas').update({ senha_hash: hashSenha(nova) }).eq('id', id);
  if (updErr) return res.status(500).json({ erro: updErr.message });
  return res.status(200).json({ ok: true });
};
