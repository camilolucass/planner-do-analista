'use strict';

const { supabase } = require('../lib/supabase');
const { verificarSenha, iniciarSessao, loginBloqueado, registrarFalhaLogin, limparTentativasLogin } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const analistaId = Number(req.body?.analista_id);
  const senha = req.body?.senha || '';
  if (!analistaId) return res.status(400).json({ erro: 'Informe o analista.' });

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'desconhecido').split(',')[0].trim();
  const chave = `${ip}|${analistaId}`;
  if (await loginBloqueado(chave)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });

  const { data: analista, error } = await supabase.from('cockpit_analistas').select('*').eq('id', analistaId).maybeSingle();
  if (error) return res.status(500).json({ erro: error.message });
  if (!analista) return res.status(404).json({ erro: 'Analista não encontrado.' });
  if (!analista.senha_hash) return res.status(401).json({ erro: 'SEM_SENHA' });
  if (!verificarSenha(senha, analista.senha_hash)) {
    await registrarFalhaLogin(chave);
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }

  await limparTentativasLogin(chave);
  await iniciarSessao(res, analista.id);
  return res.status(200).json({ id: analista.id, nome: analista.nome });
};
