/* ============================================================
   COCKPIT DO ANALISTA — Frontend (app.js)
   Conversa com a API do server.js. Nenhum dado fica no navegador:
   tudo é lido e gravado no banco central (cockpit.db). A sessão
   de login vive num cookie httpOnly controlado pelo servidor.
   ============================================================ */
'use strict';

const API = '/api';
let analistaId = null;
let analistaNome = '';
let tarefas = [];
let tarefaEditando = null; // id da tarefa aberta no modal, ou null se for nova
let passosTemp = [];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------- tema claro/escuro ---------- */
function temaEfetivo() {
  const salvo = localStorage.getItem('cockpit-tema');
  if (salvo === 'light' || salvo === 'dark') return salvo;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function aplicarIconeTema(tema) {
  $('#iconTema').innerHTML = `<use href="${tema === 'dark' ? '#ic-moon' : '#ic-sun'}"></use>`;
}
function iniciarTema() {
  aplicarIconeTema(temaEfetivo());
  $('#btnTema').addEventListener('click', () => {
    const atual = document.documentElement.getAttribute('data-theme') || temaEfetivo();
    const novo = atual === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', novo);
    localStorage.setItem('cockpit-tema', novo);
    aplicarIconeTema(novo);
  });
}

/* ---------- mostrar/ocultar senha ---------- */
function iniciarTogglesSenha() {
  $$('[data-toggle-senha]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.toggleSenha);
      const mostrar = input.type === 'password';
      input.type = mostrar ? 'text' : 'password';
      btn.innerHTML = `<svg class="icon icon-sm"><use href="${mostrar ? '#ic-eye-off' : '#ic-eye'}"></use></svg>`;
      btn.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
    });
  });
}

/* ---------- helper: estado de carregamento em botões ---------- */
async function comCarregando(botao, fn) {
  if (botao.hasAttribute('data-loading')) return;
  botao.setAttribute('data-loading', '');
  botao.disabled = true;
  try {
    await fn();
  } finally {
    botao.removeAttribute('data-loading');
    botao.disabled = false;
  }
}

/* ---------- API helpers ---------- */
async function api(metodo, rota, corpo) {
  const resp = await fetch(API + rota, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (resp.status === 204) return null;
  const dados = await resp.json();
  if (!resp.ok) throw new Error(dados.erro || 'Erro na requisição.');
  return dados;
}

function toast(msg) {
  const el = $('#toast');
  $('#toastMsg').textContent = msg;
  el.classList.add('visivel');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('visivel'), 3200);
}

/* ---------- inicialização / login (com senha) ---------- */
let analistasCache = [];

async function iniciar() {
  iniciarTema();
  iniciarTogglesSenha();
  analistasCache = await api('GET', '/analistas');
  const sel = $('#selAnalista');
  sel.innerHTML = analistasCache.map(a => `<option value="${a.id}">${a.nome}</option>`).join('');
  // sessão não é persistida entre abas/reinícios do navegador por segurança — sempre pede login
  $('#overlaySelecao').hidden = false;
}

function iniciais(nome) {
  const partes = (nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

async function entrarComo(id, nome) {
  analistaId = id; analistaNome = nome;
  $('#nomeUsuario').textContent = nome;
  $('#avatarUsuario').textContent = iniciais(nome);
  $('#overlaySelecao').hidden = true;
  mostrarSkeleton();
  await carregarTarefas();
  renderTudo();
  pedirPermissaoNotificacao();
  avisarSeAtrasadas();
}

function mostrarSkeleton() {
  const placeholder = Array.from({ length: 3 }, () => '<div class="skeleton-card"></div>').join('');
  $('#listaHojeGrupo').innerHTML = placeholder;
  $('#listaAtrasadas').innerHTML = '';
  $('#listaSugestoes').innerHTML = '';
}

function mostrarErroLogin(msg) {
  const el = $('#erroLogin');
  el.innerHTML = `<svg class="icon icon-sm"><use href="#ic-alert"></use></svg><span>${escapeHTML(msg)}</span>`;
  el.hidden = false;
}

$('#btnEntrar').addEventListener('click', (e) => comCarregando(e.currentTarget, async () => {
  $('#erroLogin').hidden = true;
  const sel = $('#selAnalista');
  const senha = $('#senhaLogin').value;
  if (!sel.value) return mostrarErroLogin('Selecione um analista.');
  try {
    const r = await api('POST', '/login', { analista_id: Number(sel.value), senha });
    await entrarComo(r.id, r.nome);
  } catch (e) {
    if (e.message === 'SEM_SENHA') {
      analistaId = Number(sel.value);
      analistaNome = sel.options[sel.selectedIndex].text;
      $('#etapaLogin').hidden = true;
      $('#etapaDefinirSenha').hidden = false;
    } else {
      mostrarErroLogin(e.message);
    }
  }
}));

$('#btnDefinirSenha').addEventListener('click', (e) => comCarregando(e.currentTarget, async () => {
  const senha = $('#senhaNova1').value;
  if (!senha || senha.length < 4) return toast('A senha precisa ter pelo menos 4 caracteres.');
  await api('POST', `/analistas/${analistaId}/senha`, { senha });
  await entrarComo(analistaId, analistaNome);
}));

$('#btnCadastrar').addEventListener('click', (e) => comCarregando(e.currentTarget, async () => {
  $('#erroLogin').hidden = true;
  const nome = $('#novoAnalistaNome').value.trim();
  const senha = $('#novoAnalistaSenha').value;
  if (!nome) return mostrarErroLogin('Informe seu nome.');
  if (!senha || senha.length < 4) return mostrarErroLogin('A senha precisa ter pelo menos 4 caracteres.');
  try {
    const criado = await api('POST', '/analistas', { nome, senha });
    await entrarComo(criado.id, criado.nome);
  } catch (e) {
    mostrarErroLogin(e.message);
  }
}));

$('#btnTrocarUsuario').addEventListener('click', async () => {
  try { await api('POST', '/logout'); } catch { /* segue o baile mesmo se falhar */ }
  location.reload();
});

/* ---------- trocar minha senha ---------- */
$('#btnTrocarSenha').addEventListener('click', () => {
  $('#senhaAtualCampo').value = '';
  $('#senhaNovaCampo').value = '';
  $('#erroSenha').hidden = true;
  $('#modalSenha').hidden = false;
  $('#senhaAtualCampo').focus();
});
$$('[data-fechar-senha]').forEach(el => el.addEventListener('click', () => { $('#modalSenha').hidden = true; }));

$('#btnSalvarSenha').addEventListener('click', (e) => comCarregando(e.currentTarget, async () => {
  const senhaAtual = $('#senhaAtualCampo').value;
  const senhaNova = $('#senhaNovaCampo').value;
  $('#erroSenha').hidden = true;
  if (!senhaNova || senhaNova.length < 4) {
    $('#erroSenha').innerHTML = '<svg class="icon icon-sm"><use href="#ic-alert"></use></svg><span>A nova senha precisa ter pelo menos 4 caracteres.</span>';
    $('#erroSenha').hidden = false;
    return;
  }
  try {
    await api('POST', `/analistas/${analistaId}/trocar-senha`, { senha_atual: senhaAtual, senha_nova: senhaNova });
    $('#modalSenha').hidden = true;
    toast('Senha alterada com sucesso.');
  } catch (e) {
    $('#erroSenha').innerHTML = `<svg class="icon icon-sm"><use href="#ic-alert"></use></svg><span>${escapeHTML(e.message)}</span>`;
    $('#erroSenha').hidden = false;
  }
}));

/* ---------- carregar dados ---------- */
async function carregarTarefas() {
  tarefas = await api('GET', '/tarefas');
}

function renderTudo() {
  renderTermometro();
  renderHoje();
  renderKanban();
  renderEquipeSeAtiva();
}

/* ---------- termômetro da meta ---------- */
function renderTermometro() {
  const doMes = tarefas.filter(t => t.conta_meta);
  const total = doMes.length;
  const feitas = doMes.filter(t => t.done).length;
  $('#termoTexto').textContent = `${feitas} / ${total}`;
  const pct = total ? Math.min(100, Math.round((feitas / total) * 100)) : 0;
  $('#termoFill').style.width = pct + '%';

  $('#indMetaFrac').innerHTML = `${feitas}<span> / ${total}</span>`;
  $('#indMetaPct').textContent = pct + '%';
  const circunferencia = 201.06;
  $('#indMetaRing').style.strokeDashoffset = circunferencia * (1 - pct / 100);
}

/* ---------- aba HOJE ---------- */
function diasAtraso(planejadaPara) {
  if (!planejadaPara) return 0;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const alvo = new Date(planejadaPara + 'T00:00:00');
  return Math.round((hoje - alvo) / 86400000);
}

function cardHTML(t) {
  const atraso = !t.done ? diasAtraso(t.planejada_para) : 0;
  const hojeStr = new Date().toISOString().slice(0, 10);
  const venceHoje = !t.done && t.planejada_para === hojeStr;
  const classeAlerta = atraso > 0 ? 'atrasado' : (venceHoje ? 'vence-hoje' : '');
  return `
    <div class="card ${classeAlerta}" data-id="${t.id}" draggable="true" tabindex="0" role="button"
         aria-label="Abrir tarefa: ${escapeHTML(t.titulo)}">
      <div class="linha1">
        <input type="checkbox" class="chk" ${t.done ? 'checked' : ''} data-toggle-done="${t.id}" aria-label="Marcar como concluída">
        <span class="tit ${t.done ? 'done' : ''}">${escapeHTML(t.titulo)}</span>
        <span class="tag ${t.prioridade}">${t.prioridade}</span>
        ${t.conta_meta ? '<span class="tag meta">★ meta</span>' : ''}
      </div>
      <div class="meta-linha">
        ${t.planejada_para ? `<span><svg class="icon icon-sm"><use href="#ic-calendar"></use></svg>${t.planejada_para}</span>` : ''}
        ${atraso > 0 ? `<span class="dias-atraso">${atraso}d atrasada</span>` : ''}
        ${venceHoje ? `<span class="vence-hoje-txt">vence hoje</span>` : ''}
      </div>
    </div>`;
}

function escapeHTML(s) {
  return (s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function vazioHTML(msg, ok) {
  return `<p class="vazio">${ok ? '<svg class="icon"><use href="#ic-check-circle"></use></svg>' : ''}<span>${msg}</span></p>`;
}

function aplicarFiltros(lista) {
  const busca = $('#busca').value.trim().toLowerCase();
  const prioridade = $('#filtroPrioridade').value;
  return lista.filter(t =>
    (!busca || t.titulo.toLowerCase().includes(busca)) &&
    (!prioridade || t.prioridade === prioridade)
  );
}

function renderHoje() {
  const hojeStr = new Date().toISOString().slice(0, 10);
  const pendentes = aplicarFiltros(tarefas.filter(t => !t.done));

  const atrasadas = pendentes.filter(t => t.planejada_para && t.planejada_para < hojeStr);
  const deHoje = pendentes.filter(t => t.planejada_para === hojeStr);
  const idsUsados = new Set([...atrasadas, ...deHoje].map(t => t.id));
  const sugestoes = pendentes.filter(t => !idsUsados.has(t.id) && t.coluna === 'backlog').slice(0, 5);

  $('#listaAtrasadas').innerHTML = atrasadas.length ? atrasadas.map(cardHTML).join('') : vazioHTML('Nenhuma tarefa atrasada.', true);
  $('#listaHojeGrupo').innerHTML = deHoje.length ? deHoje.map(cardHTML).join('') : vazioHTML('Nada planejado para hoje.', false);
  $('#listaSugestoes').innerHTML = sugestoes.length ? sugestoes.map(cardHTML).join('') : vazioHTML('Backlog vazio ou já planejado.', false);

  $('#indAtrasadas').textContent = atrasadas.length;
  $('#indHoje').textContent = deHoje.length;
  $('#indSugestoes').textContent = sugestoes.length;

  const totalAlerta = atrasadas.length + deHoje.length;
  const badge = $('#badgeHoje');
  if (totalAlerta > 0) { badge.textContent = totalAlerta; badge.hidden = false; }
  else { badge.hidden = true; }

  ligarEventosCards();
}

/* ---------- alerta de tarefa vencendo (notificação do navegador) ---------- */
function pedirPermissaoNotificacao() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function avisarSeAtrasadas() {
  const hojeStr = new Date().toISOString().slice(0, 10);
  const pendentesAtrasadas = tarefas.filter(t => !t.done && t.planejada_para && t.planejada_para < hojeStr);
  if (!pendentesAtrasadas.length) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Cockpit do Analista', {
      body: `Você tem ${pendentesAtrasadas.length} tarefa(s) atrasada(s).`,
    });
  }
}

/* ---------- aba KANBAN ---------- */
function renderKanban() {
  const filtradas = aplicarFiltros(tarefas);
  ['backlog','semana','andamento','concluida'].forEach(col => {
    const alvo = document.querySelector(`.drop[data-coluna="${col}"]`);
    const itens = filtradas.filter(t => t.coluna === col);
    alvo.innerHTML = itens.map(cardHTML).join('');
    const contagem = document.querySelector(`[data-coluna-contagem="${col}"]`);
    if (contagem) contagem.textContent = itens.length;
  });
  ligarEventosCards();
  ligarDragDrop();
}

function ligarDragDrop() {
  $$('.card').forEach(card => {
    card.addEventListener('dragstart', () => card.classList.add('arrastando'));
    card.addEventListener('dragend', () => card.classList.remove('arrastando'));
  });
  $$('.drop').forEach(drop => {
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('arrastando-sobre'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('arrastando-sobre'));
    drop.addEventListener('drop', async e => {
      e.preventDefault();
      drop.classList.remove('arrastando-sobre');
      const arrastando = $('.card.arrastando');
      if (!arrastando) return;
      const id = Number(arrastando.dataset.id);
      const novaColuna = drop.dataset.coluna;
      const done = novaColuna === 'concluida' ? 1 : 0;
      await api('PATCH', `/tarefas/${id}`, { coluna: novaColuna, done });
      await carregarTarefas();
      renderTudo();
      toast('Tarefa movida.');
    });
  });
}

/* ---------- eventos comuns dos cards ---------- */
function ligarEventosCards() {
  $$('[data-toggle-done]').forEach(chk => {
    chk.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(chk.dataset.toggleDone);
      const t = tarefas.find(t => t.id === id);
      const done = chk.checked ? 1 : 0;
      await api('PATCH', `/tarefas/${id}`, { done, coluna: done ? 'concluida' : t.coluna });
      await carregarTarefas();
      renderTudo();
    });
  });
  $$('.card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-toggle-done]')) return;
      abrirModal(Number(card.dataset.id));
    });
    card.addEventListener('keydown', (e) => {
      if (e.target.closest('[data-toggle-done]')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        abrirModal(Number(card.dataset.id));
      }
    });
  });
}

/* ---------- aba EQUIPE ---------- */
async function renderEquipeSeAtiva() {
  if ($('#painelEquipe').hidden) return;
  const resumo = await api('GET', '/resumo');
  $('#listaEquipe').innerHTML = resumo.length ? resumo.map(a => {
    const pct = a.total ? Math.round((a.concluidas / a.total) * 100) : 0;
    return `
      <div class="eq-card">
        <div class="eq-topo"><span>${escapeHTML(a.nome)}</span><span>${a.concluidas}/${a.total}</span></div>
        <div class="eq-nums">
          <span class="pos">Concluídas: <b>${a.concluidas}</b></span>
          <span>Pendentes: <b>${a.pendentes}</b></span>
          <span class="neg">Atrasadas: <b>${a.atrasadas}</b></span>
        </div>
        <div class="eq-trilho"><div class="fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('') : '<div class="eq-vazio">Nenhum analista com tarefas ainda.</div>';
}

/* ---------- navegação por abas ---------- */
const TITULOS_ABA = {
  hoje: ['Hoje', 'Suas tarefas e prioridades do dia'],
  kanban: ['Kanban', 'Arraste as tarefas entre as colunas'],
  historico: ['Histórico', 'Seu progresso mês a mês'],
  equipe: ['Equipe', 'Visão geral do time'],
};
$$('.aba').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.aba').forEach(b => { b.classList.remove('ativa'); b.removeAttribute('aria-current'); });
    btn.classList.add('ativa');
    btn.setAttribute('aria-current', 'page');
    const aba = btn.dataset.aba;
    $('#painelHoje').hidden = aba !== 'hoje';
    $('#painelKanban').hidden = aba !== 'kanban';
    $('#painelHistorico').hidden = aba !== 'historico';
    $('#painelEquipe').hidden = aba !== 'equipe';
    const [titulo, sub] = TITULOS_ABA[aba] || ['', ''];
    $('#tituloPagina').textContent = titulo;
    $('#subtituloPagina').textContent = sub;
    if (aba === 'equipe') renderEquipeSeAtiva();
    if (aba === 'historico') renderHistorico();
  });
});

/* ---------- aba HISTÓRICO ---------- */
async function renderHistorico() {
  const alvo = $('#graficoHistorico');
  alvo.innerHTML = '<div class="skeleton-card" style="height:200px"></div>';
  const dados = await api('GET', '/historico?meses=6');
  if (!dados.length) { alvo.innerHTML = vazioHTML('Ainda não há dados suficientes. Continue registrando suas tarefas.', false); return; }

  const nomesMes = { '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun',
                     '07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez' };

  alvo.innerHTML = `<div class="grafico-barras">` + dados.map(m => {
    const pct = m.total ? Math.round((m.concluidas / m.total) * 100) : 0;
    const cor = pct >= 90 ? '' : (pct >= 60 ? 'medio' : 'baixo');
    const [, mesNum] = m.mes.split('-');
    return `
      <div class="barra-mes">
        <span class="barra-pct">${pct}%</span>
        <div class="barra-trilho"><div class="barra-fill ${cor}" style="height:${pct}%"></div></div>
        <span class="barra-label">${nomesMes[mesNum] || m.mes}</span>
        <span class="barra-label">${m.concluidas}/${m.total}</span>
      </div>`;
  }).join('') + `</div>`;
}

$('#busca').addEventListener('input', renderTudo);
$('#filtroPrioridade').addEventListener('change', renderTudo);

/* ---------- modal: criar/editar tarefa ---------- */
function abrirModal(id) {
  tarefaEditando = id;
  const t = id ? tarefas.find(t => t.id === id) : null;
  $('#modalTitulo').textContent = t ? 'Editar tarefa' : 'Nova tarefa';
  $('#fTitulo').value = t ? t.titulo : '';
  $('#fDesc').value = t ? t.descricao : '';
  $('#fPrioridade').value = t ? t.prioridade : 'media';
  $('#fSemana').value = t && t.semana ? t.semana : '';
  $('#fDia').value = t && t.dia_semana !== null && t.dia_semana !== undefined ? t.dia_semana : '';
  $('#fMeta').checked = t ? !!t.conta_meta : true;
  passosTemp = t ? [...(t.passos || [])] : [];
  $('#btnExcluir').hidden = !t;
  renderPassos();
  atualizarHintData();
  $('#modalTarefa').hidden = false;
  $('#fTitulo').focus();
}

function fecharModal() {
  $('#modalTarefa').hidden = true;
  tarefaEditando = null;
  passosTemp = [];
}

$('#btnNovaTarefa').addEventListener('click', () => abrirModal(null));
$$('[data-fechar]').forEach(el => el.addEventListener('click', fecharModal));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modalTarefa').hidden) fecharModal();
  if (!$('#modalSenha').hidden) $('#modalSenha').hidden = true;
});

function atualizarHintData() {
  const semana = $('#fSemana').value;
  const dia = $('#fDia').value;
  const hint = $('#hintData');
  if (!semana || dia === '') { hint.textContent = ''; return; }
  hint.textContent = `Isso será planejado para a Semana ${semana}, ${['Segunda','Terça','Quarta','Quinta','Sexta'][dia]}.`;
}
$('#fSemana').addEventListener('change', atualizarHintData);
$('#fDia').addEventListener('change', atualizarHintData);

/* passos (plano de ação) */
function renderPassos() {
  const feitos = passosTemp.filter(p => p.feito).length;
  $('#passosProg').textContent = passosTemp.length ? `${feitos}/${passosTemp.length}` : '';
  $('#listaPassos').innerHTML = passosTemp.map((p, i) => `
    <div class="passo ${p.feito ? 'feito' : ''}">
      <input type="checkbox" class="chk" ${p.feito ? 'checked' : ''} data-passo-toggle="${i}" aria-label="Marcar passo como feito">
      <span>${escapeHTML(p.texto)}</span>
      <button data-passo-del="${i}" aria-label="Remover passo"><svg class="icon icon-sm"><use href="#ic-x"></use></svg></button>
    </div>`).join('');
  $$('[data-passo-toggle]').forEach(chk => chk.addEventListener('change', () => {
    passosTemp[Number(chk.dataset.passoToggle)].feito = chk.checked;
    renderPassos();
  }));
  $$('[data-passo-del]').forEach(btn => btn.addEventListener('click', () => {
    passosTemp.splice(Number(btn.dataset.passoDel), 1);
    renderPassos();
  }));
}

$('#btnAddPasso').addEventListener('click', adicionarPasso);
$('#novoPasso').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); adicionarPasso(); } });
function adicionarPasso() {
  const input = $('#novoPasso');
  const texto = input.value.trim();
  if (!texto) return;
  passosTemp.push({ texto, feito: false });
  input.value = '';
  renderPassos();
}

/* salvar / excluir tarefa */
$('#btnSalvarCard').addEventListener('click', (e) => comCarregando(e.currentTarget, async () => {
  const titulo = $('#fTitulo').value.trim();
  if (!titulo) return toast('Digite um título para a tarefa.');

  const semana = $('#fSemana').value ? Number($('#fSemana').value) : null;
  const dia = $('#fDia').value !== '' ? Number($('#fDia').value) : null;
  const planejadaPara = calcularDataPlanejada(semana, dia);

  const payload = {
    titulo,
    descricao: $('#fDesc').value.trim(),
    prioridade: $('#fPrioridade').value,
    semana, dia_semana: dia,
    planejada_para: planejadaPara,
    conta_meta: $('#fMeta').checked ? 1 : 0,
    passos: passosTemp,
  };

  if (tarefaEditando) {
    const atual = tarefas.find(t => t.id === tarefaEditando);
    await api('PUT', `/tarefas/${tarefaEditando}`, { ...atual, ...payload });
  } else {
    payload.coluna = semana ? 'semana' : 'backlog';
    await api('POST', '/tarefas', payload);
  }
  fecharModal();
  await carregarTarefas();
  renderTudo();
  toast('Tarefa salva.');
}));

$('#btnExcluir').addEventListener('click', (e) => comCarregando(e.currentTarget, async () => {
  if (!tarefaEditando) return;
  if (!confirm('Excluir esta tarefa?')) return;
  await api('DELETE', `/tarefas/${tarefaEditando}`);
  fecharModal();
  await carregarTarefas();
  renderTudo();
  toast('Tarefa excluída.');
}));

/* calcula a data real (YYYY-MM-DD) a partir de "semana do mês" + "dia da semana" */
function calcularDataPlanejada(semana, diaSemana) {
  if (!semana || diaSemana === null || diaSemana === undefined) return null;
  const hoje = new Date();
  const primeiroDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  // encontra a primeira segunda-feira do mês (ou antes, se o mês já começar depois da segunda)
  const diaSemanaPrimeiro = (primeiroDoMes.getDay() + 6) % 7; // 0 = segunda
  const inicioSemana1 = new Date(primeiroDoMes);
  inicioSemana1.setDate(primeiroDoMes.getDate() - diaSemanaPrimeiro);
  const alvo = new Date(inicioSemana1);
  alvo.setDate(inicioSemana1.getDate() + (semana - 1) * 7 + diaSemana);
  return alvo.toISOString().slice(0, 10);
}

/* ---------- exportar Markdown ---------- */
$('#btnExportar').addEventListener('click', () => {
  const linhas = [`# Cockpit do Analista — ${analistaNome}`, `Exportado em ${new Date().toLocaleString('pt-BR')}`, ''];
  const grupos = { backlog: 'Backlog', semana: 'Planejada na semana', andamento: 'Em andamento', concluida: 'Concluída' };
  for (const [col, titulo] of Object.entries(grupos)) {
    const itens = tarefas.filter(t => t.coluna === col);
    if (!itens.length) continue;
    linhas.push(`## ${titulo}`);
    itens.forEach(t => {
      linhas.push(`- [${t.done ? 'x' : ' '}] **${t.titulo}** (${t.prioridade}${t.conta_meta ? ', ★ meta' : ''}${t.planejada_para ? `, ${t.planejada_para}` : ''})`);
      (t.passos || []).forEach(p => linhas.push(`  - [${p.feito ? 'x' : ' '}] ${p.texto}`));
    });
    linhas.push('');
  }
  const blob = new Blob([linhas.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cockpit-${analistaNome.replace(/\s+/g,'-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.md`;
  a.click();
  toast('Markdown exportado.');
});

iniciar();
