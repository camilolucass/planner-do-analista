'use strict';

const { supabase } = require('../lib/supabase');
const { obterSessao } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const sessao = await obterSessao(req);
  if (!sessao) return res.status(401).json({ erro: 'Não autenticado.' });

  const hoje = new Date().toISOString().slice(0, 10);
  const { data: analistas, error: e1 } = await supabase.from('cockpit_analistas').select('id, nome').order('nome');
  if (e1) return res.status(500).json({ erro: e1.message });
  const { data: tarefas, error: e2 } = await supabase.from('cockpit_tarefas').select('analista_id, done, planejada_para');
  if (e2) return res.status(500).json({ erro: e2.message });

  const resumo = analistas.map(a => {
    const doAnalista = tarefas.filter(t => t.analista_id === a.id);
    const total = doAnalista.length;
    const concluidas = doAnalista.filter(t => t.done).length;
    const pendentes = doAnalista.filter(t => !t.done).length;
    const atrasadas = doAnalista.filter(t => !t.done && t.planejada_para && t.planejada_para < hoje).length;
    return { id: a.id, nome: a.nome, total, concluidas, pendentes, atrasadas };
  });
  return res.status(200).json(resumo);
};
