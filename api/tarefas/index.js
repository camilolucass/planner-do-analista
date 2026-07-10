'use strict';

const { supabase } = require('../../lib/supabase');
const { obterSessao } = require('../../lib/auth');

module.exports = async (req, res) => {
  const sessao = await obterSessao(req);
  if (!sessao) return res.status(401).json({ erro: 'Não autenticado.' });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('cockpit_tarefas')
      .select('*')
      .eq('analista_id', sessao.analistaId)
      .order('id', { ascending: false });
    if (error) return res.status(500).json({ erro: error.message });
    return res.status(200).json(data.map(t => ({ ...t, passos: t.passos || [] })));
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.titulo) return res.status(400).json({ erro: 'titulo é obrigatório.' });

    const { data, error } = await supabase
      .from('cockpit_tarefas')
      .insert({
        analista_id: sessao.analistaId,
        titulo: body.titulo,
        descricao: body.descricao || '',
        prioridade: body.prioridade || 'media',
        semana: body.semana ?? null,
        dia_semana: body.dia_semana ?? null,
        planejada_para: body.planejada_para ?? null,
        conta_meta: !!body.conta_meta,
        coluna: body.coluna || 'backlog',
        passos: body.passos || [],
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ erro: error.message });
    return res.status(201).json({ ...data, passos: data.passos || [] });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ erro: 'Método não permitido.' });
};
