'use strict';

const { supabase } = require('../../../lib/supabase');
const { hashSenha, iniciarSessao } = require('../../../lib/auth');

/* Define a primeira senha de um analista antigo que ainda não tem uma.
   Só funciona se senha_hash ainda for nulo — depois disso, use /login. */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const id = Number(req.query.id);
  const senha = req.body?.senha || '';
  if (senha.length < 4) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 4 caracteres.' });

  const { data: analista, error } = await supabase.from('cockpit_analistas').select('*').eq('id', id).maybeSingle();
  if (error) return res.status(500).json({ erro: error.message });
  if (!analista) return res.status(404).json({ erro: 'Analista não encontrado.' });
  if (analista.senha_hash) return res.status(409).json({ erro: 'Este analista já tem senha. Faça login normalmente.' });

  const { error: updErr } = await supabase.from('cockpit_analistas').update({ senha_hash: hashSenha(senha) }).eq('id', id);
  if (updErr) return res.status(500).json({ erro: updErr.message });

  await iniciarSessao(res, id);
  return res.status(200).json({ id, nome: analista.nome });
};
