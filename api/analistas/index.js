'use strict';

const { supabase } = require('../../lib/supabase');
const { hashSenha, iniciarSessao } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('cockpit_analistas').select('id, nome').order('nome');
    if (error) return res.status(500).json({ erro: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const nome = (req.body?.nome || '').trim();
    const senha = req.body?.senha || '';
    if (!nome) return res.status(400).json({ erro: 'Informe um nome.' });
    if (senha.length < 4) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 4 caracteres.' });

    const { data, error } = await supabase
      .from('cockpit_analistas')
      .insert({ nome, senha_hash: hashSenha(senha) })
      .select('id, nome')
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ erro: 'Já existe um analista com esse nome.' });
      return res.status(500).json({ erro: error.message });
    }
    await iniciarSessao(res, data.id);
    return res.status(201).json(data);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ erro: 'Método não permitido.' });
};
