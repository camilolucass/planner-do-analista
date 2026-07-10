'use strict';

const { supabase } = require('../../lib/supabase');
const { obterSessao } = require('../../lib/auth');

module.exports = async (req, res) => {
  const sessao = await obterSessao(req);
  if (!sessao) return res.status(401).json({ erro: 'Não autenticado.' });

  const id = Number(req.query.id);
  const { data: atual, error: buscaErr } = await supabase.from('cockpit_tarefas').select('*').eq('id', id).maybeSingle();
  if (buscaErr) return res.status(500).json({ erro: buscaErr.message });
  if (!atual) return res.status(404).json({ erro: 'Tarefa não encontrada.' });
  if (atual.analista_id !== sessao.analistaId) return res.status(403).json({ erro: 'Sem permissão para esta tarefa.' });

  if (req.method === 'PUT') {
    const body = req.body || {};
    const novo = { ...atual, ...body };
    const { data, error } = await supabase.from('cockpit_tarefas').update({
      titulo: novo.titulo,
      descricao: novo.descricao,
      prioridade: novo.prioridade,
      semana: novo.semana ?? null,
      dia_semana: novo.dia_semana ?? null,
      planejada_para: novo.planejada_para ?? null,
      conta_meta: !!novo.conta_meta,
      coluna: novo.coluna,
      done: !!novo.done,
      passos: novo.passos ?? atual.passos ?? [],
    }).eq('id', id).select('*').single();
    if (error) return res.status(500).json({ erro: error.message });
    return res.status(200).json({ ...data, passos: data.passos || [] });
  }

  if (req.method === 'PATCH') {
    const body = req.body || {};
    const patch = {};
    for (const chave of ['coluna', 'semana', 'dia_semana', 'planejada_para']) {
      if (body[chave] !== undefined) patch[chave] = body[chave];
    }
    if (body.done !== undefined) patch.done = !!body.done;
    if (body.passos !== undefined) patch.passos = body.passos;
    if (!Object.keys(patch).length) return res.status(400).json({ erro: 'Nada para atualizar.' });

    const { data, error } = await supabase.from('cockpit_tarefas').update(patch).eq('id', id).select('*').single();
    if (error) return res.status(500).json({ erro: error.message });
    return res.status(200).json({ ...data, passos: data.passos || [] });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('cockpit_tarefas').delete().eq('id', id);
    if (error) return res.status(500).json({ erro: error.message });
    return res.status(204).end();
  }

  res.setHeader('Allow', 'PUT, PATCH, DELETE');
  return res.status(405).json({ erro: 'Método não permitido.' });
};
