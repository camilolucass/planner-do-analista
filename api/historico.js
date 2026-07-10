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

  const meses = Math.min(Math.max(Number(req.query.meses) || 6, 1), 24);
  const { data, error } = await supabase
    .from('cockpit_tarefas')
    .select('done, planejada_para, criada_em')
    .eq('analista_id', sessao.analistaId)
    .eq('conta_meta', true);
  if (error) return res.status(500).json({ erro: error.message });

  const buckets = new Map();
  for (const t of data) {
    const base = t.planejada_para || t.criada_em;
    const mes = String(base).slice(0, 7);
    if (!buckets.has(mes)) buckets.set(mes, { total: 0, concluidas: 0 });
    const b = buckets.get(mes);
    b.total++;
    if (t.done) b.concluidas++;
  }
  const linhas = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-meses)
    .map(([mes, v]) => ({ mes, total: v.total, concluidas: v.concluidas }));
  return res.status(200).json(linhas);
};
