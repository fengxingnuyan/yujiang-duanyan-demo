const app = document.querySelector('#app');
const scenario = document.querySelector('#scenario');
const legacyKey = 'yujiang-demo:v7:expert-example:rsi-example';
const questionPrefix = 'yujiang-demo:expert-example:V7T-79ecb8f6-456a-43:question:';
const manager = document.querySelector('#manager');
const phases = ['题目预审中', '题目运行中', '题目评审中'];
const stageDuration = 4500;
const upload = {count:3, sizeMB:10, extensions:['pdf','docx','md','txt','csv','json','xlsx','png','jpg','jpeg','zip']};
const uploadHint = `最多 ${upload.count} 份，每份不超过 ${upload.sizeMB} MB。支持 ${upload.extensions.join('、').toUpperCase()}。代码及其他格式可打包为 ZIP。`;
const blank = () => ({title:'', domain:'', files:[], rounds:[], editing:true});
let timer;
let task;
function readQuestion(id) {
  return JSON.parse(localStorage.getItem(questionPrefix + id));
}
function migrateLegacyQuestion() {
  const data = localStorage.getItem(legacyKey);
  if (!data) return;
  const old = JSON.parse(data);
  if (old && (old.title || old.domain || old.files?.length || old.rounds?.length) && !readQuestion('legacy')) {
    localStorage.setItem(questionPrefix+'legacy', JSON.stringify({...blank(), ...old, id:'legacy', updated:old.rounds?.at(-1)?.time || Date.now()}));
  }
  localStorage.removeItem(legacyKey);
}
function save() {
  const stored = readQuestion(task.id);
  if (stored?.version !== task.version || (!stored && task.id === 'legacy')) {
    route();
    return false;
  }
  task.updated = Date.now();
  task.version = crypto.randomUUID();
  localStorage.setItem(questionPrefix + task.id, JSON.stringify(task));
  if (location.hash === '#new') window.history.replaceState(null, '', '#q/' + task.id);
  return true;
}
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
}
function revisitDate(time) {
  const date = new Date(time);
  date.setDate(date.getDate() + 1);
  return date.toLocaleDateString('zh-CN', {year:'numeric', month:'long', day:'numeric'});
}
function progress(round, now) {
  const step = Math.max(0, Math.floor((now - round.time) / stageDuration));
  if (step === 0) return phases[0];
  if (round.scenario === 'precheck') return '预审需修改';
  if (step === 1) return phases[1];
  if (step === 2) return phases[2];
  return round.scenario === 'revise' ? '评审需修改' : '任务已完成';
}
function attachmentErrors(files) {
  const errors = [];
  if (files.length > upload.count) errors.push(`本轮最多可添加 ${upload.count} 份附件，当前共 ${files.length} 份。`);
  for (const file of files) {
    const dot = file.name.lastIndexOf('.');
    if (dot < 0 || !upload.extensions.includes(file.name.slice(dot + 1).toLowerCase())) {
      errors.push(`《${file.name}》格式不支持，可打包为 ZIP 后添加。`);
    }
    if (file.size > upload.sizeMB * 1024 * 1024) errors.push(`《${file.name}》超过 ${upload.sizeMB} MB，请压缩后再添加。`);
  }
  return errors;
}
function fileList(editable) {
  return task.files.map((f,i) => `<div class="row file"><span>${escapeText(f.name)} · ${Math.ceil(f.size/1024)} KB</span>${editable ? `<button type="button" data-remove="${i}">移除</button>` : ''}</div>`).join('');
}
function needsRevision(status) { return status.endsWith('需修改'); }
function issues(round) {
  const early = round.scenario === 'precheck';
  const name = escapeText(round.files[0].name);
  const entries = early ? [
    ['研究目标','题目要求“验证结果”，但未列出应交付的结果。','在研究目标中列出所求变量、预期结果和交付形式。'],
    ['验收标准','附件中没有可核验的判断条件。','给出判定方法、指标及允许误差。']
  ] : [
    ['约束验证','本轮模拟结果缺少可行性检查，题目也未要求逐项验证。','在题目中要求对每项约束给出计算值和满足情况。'],
    ['结果精度','题目未指定误差阈值，本轮结果无法按统一标准核验。','补充误差阈值和验证方法，再提交修订后的附件。']
  ];
  return '<ol>'+entries.map(([where,reason,fix])=>`<li><strong>${name} · ${where}</strong><p>判断依据（示例）：${reason}<br>修改要求：${fix}</p></li>`).join('')+'</ol>';
}
function report(round, stage = progress(round, Date.now()), expandIssues = true) {
  if (stage === phases[0]) return '';
  const precheckFailed = stage === '预审需修改';
  const precheck = `<details class="report" data-report="precheck" ${precheckFailed && expandIssues ? 'open' : ''}><summary>题目预审报告 · ${precheckFailed ? '需修改' : '已通过'}</summary>
    ${precheckFailed ? issues(round) : '<p>题目说明列出了研究目标、输入条件和验收标准，现有材料可以用于运行验证。</p>'}</details>`;
  if (stage !== '评审需修改' && stage !== '任务已完成') return precheck;
  const revise = needsRevision(stage);
  return `<details class="report" data-report="final" ${expandIssues ? 'open' : ''}><summary>题目评审报告 · ${revise ? '需修改' : '已通过'}</summary>
    ${revise ? issues(round) : '<p>已结合本轮运行记录核验题目说明、输入条件与验收方法，题目符合本次任务要求。</p>'}</details>${precheck}`;
}
function roundHistory() {
  return task.rounds.slice(0,-1).map((r,i)=>`<details><summary>第 ${i+1} 轮 · ${escapeText(r.title)} · ${progress(r,Date.now())}</summary><p>本轮附件　${r.files.map(f=>escapeText(f.name)).join('、')}</p>${report(r)}</details>`).join('');
}
const stepNames = ['提交题目', '题目预审', '题目运行', '题目评审'];
function updateOverview(round, status, editing) {
  let step = phases.indexOf(status) + 1;
  let label = status;
  let hint = '下一步';
  let action;
  let tone = 'active';
  if (editing) {
    step = 0;
    label = round ? '待重新提交' : '待提交';
    action = round ? '按反馈修改并重新提交' : '填写题目名称、领域并添加附件';
  } else if (phases.includes(status)) {
    hint = '建议回访日期';
    action = round.revisit;
  } else if (status === '任务已完成') {
    step = stepNames.length;
    tone = 'done';
    action = '查看题目评审报告';
  } else {
    tone = 'attention';
    step = status === '预审需修改' ? 1 : 3;
    action = '按报告修改并重新提交';
  }
  const state = document.querySelector('#state');
  if (state.textContent !== label) state.textContent = label;
  state.dataset.tone = tone;
  document.querySelector('#next').innerHTML = `<span class="caption">${hint}</span><strong>${escapeText(action)}</strong>`;
  document.querySelector('#steps').innerHTML = stepNames.map((name, i) =>
    `<li ${i === step ? 'aria-current="step"' : ''} class="${i < step ? 'done' : ''}"><span class="dot" aria-hidden="true">${i < step ? '✓' : i + 1}</span>${name}</li>`
  ).join('');
}
function form() {
  const last = task.rounds.at(-1);
  return `<form class="panel" id="question"><div class="row"><h2>${last ? '修改科研题目' : '提交科研题目'}</h2>${last ? '' : '<button type="button" id="sample">填入示例材料</button>'}</div>
  <p class="help">${last ? '更新下方材料后重新提交，新一轮将从题目预审开始。' : '预审通过后，端砚会自动运行题目，并依据运行记录评审题目。'}</p>
  <label for="title">题目名称</label><input id="title" type="text" required maxlength="200" placeholder="输入本次验证的研究题目名称" value="${escapeText(task.title)}">
  <label for="domain">题目领域</label><input id="domain" type="text" required maxlength="80" list="domains" placeholder="选择或输入研究领域" value="${escapeText(task.domain || '')}">
  <datalist id="domains">${['数学','物理学','化学','材料科学','生命科学','计算机科学','地球科学','交叉学科'].map(name=>`<option value="${name}"></option>`).join('')}</datalist>
  <label for="files">题目附件</label><label class="upload">选择题目文件<input id="files" type="file" multiple aria-describedby="upload-hint" accept="${upload.extensions.map(ext=>'.'+ext).join(',')}"></label><p id="upload-hint" class="help">${uploadHint}</p><p id="file-error" class="warn" role="alert"></p><div id="fileList">${fileList(true)}</div>
  ${last ? report(last, progress(last, Date.now()), false) : ''}
  <details><summary>合作说明与材料用途</summary><p>语匠提供专家、组织及任务信息。合作任务使用题目和附件进行验证，按双方约定记录运行过程并交付验证结果。本演示仅使用本机示例进度。</p></details>
  <p id="error" class="warn" role="alert"></p>${last ? '' : '<p class="help submit-tip">提交后将自动开始预审，题目无法撤回或删除。若评审要求修改，可按报告修订后重新提交。</p>'}<button class="primary">${last ? '重新提交题目' : '提交题目'}</button></form>${roundHistory()}`;
}
function statusView(round, status) {
  const index = phases.indexOf(status);
  const message = ['评审智能体正在核对题目说明和验收条件，预审结束后可在这里查看报告。','题目已通过预审，端砚正在运行实验。','评审智能体正在结合题目要求、运行记录和实验结果进行评审。'];
  return `<section class="panel"><span class="caption">第 ${task.rounds.length} 轮提交${round.domain ? ' · '+escapeText(round.domain) : ''}</span><h2>${escapeText(round.title)}</h2>
  ${needsRevision(status) ? '<div class="revision-bar"><strong>本轮题目需要修改</strong><button id="edit" class="primary">修改题目与附件</button></div>' : ''}
  ${index >= 0 ? `<p>${message[index]}</p><div class="note">你可以关闭页面，按建议日期从库帕思语匠的原任务入口回来查看进展。</div>` : ''}
  ${report(round, status)}
  <details><summary>本轮提交材料</summary><p>${round.files.map(f=>escapeText(f.name)).join('<br>')}</p></details></section>${roundHistory()}`;
}
function render() {
  clearTimeout(timer);
  if (!task) { renderManager(); return; }
  const last = task.rounds.at(-1);
  if (task.editing || !last) { updateOverview(last, '', true); app.innerHTML = form(); return; }
  const now = Date.now();
  const status = progress(last, now);
  updateOverview(last, status, false);
  const openPrecheck = app.querySelector('.panel > [data-report="precheck"][open]') && !task.editing;
  app.innerHTML = statusView(last,status);
  if (openPrecheck) app.querySelector('.panel > [data-report="precheck"]')?.setAttribute('open','');
  const index = phases.indexOf(status);
  if (index >= 0) timer = setTimeout(render, Math.max(10,last.time+(index+1)*stageDuration-now));
}
app.addEventListener('input', e => {
  if (e.target.id === 'title' || e.target.id === 'domain') { task[e.target.id]=e.target.value; save(); }
});
app.addEventListener('change', e => {
  if (e.target.id !== 'files') return;
  const files = [...task.files];
  for (const {name,size} of e.target.files) {
    if (!files.some(f=>f.name===name && f.size===size)) files.push({name,size});
  }
  e.target.value='';
  const errors = attachmentErrors(files);
  if (errors.length) {
    document.querySelector('#file-error').textContent = '本次选择未添加。' + errors.join(' ');
    return;
  }
  task.files = files;
  save();
  render();
});
app.addEventListener('click', e => {
  if (e.target.id === 'sample') {
    task.title='带约束的二次优化问题';
    task.domain='数学';
    task.files=[{name:'研究题目说明.pdf',size:245760}];
  } else if (e.target.hasAttribute('data-remove')) {
    task.files.splice(Number(e.target.dataset.remove),1);
  } else if (e.target.id === 'edit') {
    task.editing=true;
    if (!save()) return;
    render();
    document.querySelector('#title').focus();
    return;
  } else return;
  save();
  render();
});
app.addEventListener('submit', e => {
  e.preventDefault();
  if (!task.editing) return;
  if (!task.title.trim() || !task.domain?.trim() || !task.files.length) {
    document.querySelector('#error').textContent='请填写题目名称、题目领域，并至少添加一份附件。';
    return;
  }
  const errors = attachmentErrors(task.files);
  if (errors.length) {
    document.querySelector('#file-error').textContent = errors.join(' ');
    return;
  }
  const time = Date.now();
  task.rounds.push({title:task.title.trim(),domain:task.domain.trim(),files:task.files.map(f=>({...f})),time,revisit:revisitDate(time),scenario:scenario.value});
  task.editing=false;
  save();
  render();
  window.scrollTo(0,0);
});
function renderManager() {
  const questions = Object.keys(localStorage).filter(key=>key.startsWith(questionPrefix))
    .map(key=>JSON.parse(localStorage.getItem(key))).filter(Boolean);
  const now = Date.now();
  let refreshAt = Infinity;
  let passed = 0;
  const rows = questions.map(question=>{
    const round = question.rounds.at(-1);
    const status = round ? progress(round, now) : '草稿';
    const index = phases.indexOf(status);
    const revision = needsRevision(status);
    const complete = status === '任务已完成';
    if (complete) passed++;
    if (index >= 0) refreshAt = Math.min(refreshAt, round.time + (index + 1) * stageDuration);
    const action = !round ? '继续编辑' : revision ? '查看反馈并修改' : complete ? '查看评审报告' : '查看进度';
    const title = question.title.trim() || '未命名题目';
    const id = escapeText(question.id);
    const html = `<li class="question-row"><div><h3><a href="#q/${id}">${escapeText(title)}</a></h3>
      <div class="question-meta">${question.domain?.trim() ? `<span class="subject-tag">${escapeText(question.domain.trim())}</span>` : '<small>领域待填写</small>'}${round ? `<small>第 ${question.rounds.length} 轮</small>` : ''}</div></div>
      <div><span class="list-status ${revision ? 'attention' : complete ? 'complete' : ''}">${complete ? '评审通过' : status}</span>
      ${index >= 0 ? '<small class="revisit">建议回访　'+escapeText(round.revisit)+'</small>' : ''}</div>
      <div class="actions"><a class="action-link" href="#q/${id}">${action}</a>${round ? '' : `<details class="more" data-id="${id}"><summary>更多</summary><button type="button" data-delete="${id}">删除草稿</button></details>`}</div></li>`;
    return {html,revision,updated:question.updated};
  });
  rows.sort((a,b)=>Number(b.revision)-Number(a.revision) || b.updated-a.updated);
  const openMenu = manager.querySelector('.more[open]')?.dataset.id;
  manager.innerHTML = `<div class="list-heading"><div><h2 id="my-questions">我的题目</h2>${rows.length ? `<p class="help">共 ${rows.length} 道 · 已通过 ${passed} 道</p>` : ''}</div>
    ${rows.length ? '<a class="new-question" href="#new">＋ 新建题目</a>' : ''}</div>
    ${rows.length ? '<ul class="questions">'+rows.map(row=>row.html).join('')+'</ul>' : '<div class="empty"><p>你还没有为本任务创建题目。</p><a class="new-question" href="#new">新建第一道题</a></div>'}`;
  if (openMenu) manager.querySelector(`.more[data-id="${CSS.escape(openMenu)}"]`)?.setAttribute('open','');
  if (Number.isFinite(refreshAt)) timer = setTimeout(render, Math.max(10,refreshAt-Date.now()));
}
const deleteDialog = document.querySelector('#delete-dialog');
let pendingDraft;
manager.addEventListener('click', e=>{
  const id = e.target.dataset.delete;
  if (!id) return;
  const draft = readQuestion(id);
  if (!draft || draft.rounds.length) { render(); return; }
  pendingDraft = draft;
  document.querySelector('#delete-name').textContent = `《${draft.title.trim() || '未命名题目'}》将从我的题目中移除。`;
  deleteDialog.returnValue = 'cancel';
  deleteDialog.showModal();
});
deleteDialog.addEventListener('close', ()=>{
  const draft = pendingDraft;
  pendingDraft = null;
  if (deleteDialog.returnValue !== 'delete' || !draft) return;
  const current = readQuestion(draft.id);
  if (current && current.version === draft.version && !current.rounds.length) localStorage.removeItem(questionPrefix+draft.id);
  render();
});
function route() {
  const hash = location.hash;
  if (hash === '#new') task = {...blank(), id:crypto.randomUUID()};
  else task = hash.startsWith('#q/') ? readQuestion(hash.slice(3)) : null;
  if (!task && hash) window.history.replaceState(null, '', location.pathname + location.search);
  manager.hidden = Boolean(task);
  document.querySelector('.work-area').hidden = !task;
  document.querySelector('#state').hidden = !task;
  document.querySelector('#next').hidden = !task;
  document.querySelector('#requirements').hidden = Boolean(task);
  document.querySelector('#location-label').innerHTML = task ? '<a href="#">← 返回我的题目</a>' : '我的任务';
  app.replaceChildren();
  render();
}
window.addEventListener('storage', e => {
  if (e.key === null || (e.key?.startsWith(questionPrefix) && (!task || e.key === questionPrefix + task.id))) route();
});
window.addEventListener('hashchange', () => { route(); window.scrollTo(0,0); });
window.addEventListener('pageshow', route);
migrateLegacyQuestion();
route();
