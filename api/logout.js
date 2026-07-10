'use strict';

const { encerrarSessao } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ erro: 'Método não permitido.' });
  }
  await encerrarSessao(req, res);
  return res.status(204).end();
};
