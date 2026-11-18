const app = document.querySelector('#app');
const scenario = document.querySelector('#scenario');
const storageKey = 'yujiang-demo:v7:expert-example:rsi-example';
const phases = ['题目预审中', '任务运行中', '产物评审中'];
const stageDuration = 4500;
const blank = () => ({title:'', files:[], rounds:[], editing:true});
let timer;
let task = restore();
function restore() {
  try { return JSON.parse(localStorage.getItem(storageKey)) || blank(); }
  catch { return blank(); }
}
function save() { localStorage.setItem(storageKey, JSON.stringify(task)); }
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
  if (round.scenario === 'reviewError') return '预审服务异常';
  if (step === 1) return phases[1];
  if (round.scenario === 'runError') return '任务运行异常';
  if (round.scenario === 'unsolved') return '模型未解出';
  if (step === 2) return phases[2];
  if (round.scenario === 'evalError') return '产物评审服务异常';
  return round.scenario === 'revise' ? '评审需修改' : '任务已完成';
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
function report(round) {
  const stage = progress(round, Date.now());
  if (needsRevision(stage)) return `<h3>${stage === '预审需修改' ? '题目预审反馈' : '产物评测报告'} · 题目需修改</h3>${issues(round)}`;
  if (stage === '任务已完成') return '<h3>产物评测报告</h3><p>本轮模拟评审通过。运行结果、验证说明和题目版本已对应，预期交付项齐全。</p>';
  if (stage === '模型未解出') return '<p>本轮模型未得到可验证的解。平台将复核运行结果，你可以稍后查看进展。</p>';
  return '<p>平台将排查该阶段的服务异常。已提交的题目和附件已保留，你可以从语匠原入口回来查看。</p>';
}
function history() {
  return task.rounds.slice(0,-1).map((r,i)=>`<details><summary>第 ${i+1} 轮 · ${escapeText(r.title)} · ${progress(r,Date.now())}</summary>${report(r)}</details>`).join('');
}
function form() {
  const last = task.rounds.at(-1);
  return `<form class="panel" id="question"><div class="row"><h2>${last ? '修改科研题目' : '提交科研题目'}</h2>${last ? '' : '<button type="button" id="sample">填入示例材料</button>'}</div>
  ${last ? report(last) : ''}
  <label for="title">题目名称</label><input id="title" type="text" required maxlength="200" value="${escapeText(task.title)}">
  <label for="files">题目附件</label><input id="files" type="file" multiple><div id="fileList">${fileList(true)}</div>
  <details><summary>合作说明与材料用途</summary><p>语匠提供专家、组织及任务信息。合作任务使用题目和附件进行验证，按双方约定记录运行过程并交付验证结果。本演示仅使用本机示例进度。</p></details>
  <p id="error" class="warn" role="alert"></p><button class="primary">${last ? '重新提交题目' : '提交题目'}</button></form>${history()}`;
}
function statusView(round, status) {
  const index = phases.indexOf(status);
  return `<section class="panel"><p class="muted">第 ${task.rounds.length} 轮 · ${escapeText(round.title)}</p>
  <h2 aria-live="polite">${index >= 0 ? '题目已提交' : needsRevision(status) ? '题目需修改' : status}</h2>
  <p><strong>当前状态　${status}</strong></p>
  ${index >= 0 ? `<ol class="stages">${phases.map((name,i)=>`<li ${i===index?'aria-current="step"':''}>${name}</li>`).join('')}</ol>
  <div class="note"><strong>建议回访日期　${escapeText(round.revisit)}</strong><br>你可以关闭页面，届时从语匠的这项任务进入，查看最新进展。如果需要修改题目，修改清单会显示在这里。</div>` : report(round)}
  ${needsRevision(status) ? '<button id="edit" class="primary">修改题目并重新提交</button>' : ''}
  <details><summary>本轮提交材料</summary><p>${round.files.map(f=>escapeText(f.name)).join('<br>')}</p></details></section>${history()}`;
}
function render() {
  clearTimeout(timer);
  const last = task.rounds.at(-1);
  if (task.editing || !last) { app.innerHTML = form(); return; }
  const now = Date.now();
  const status = progress(last, now);
  app.innerHTML = statusView(last,status);
  const index = phases.indexOf(status);
  if (index >= 0) timer = setTimeout(render, Math.max(10,last.time+(index+1)*stageDuration-now));
}
app.addEventListener('input', e => {
  if (e.target.id === 'title') { task.title=e.target.value; save(); }
});
app.addEventListener('change', e => {
  if (e.target.id !== 'files') return;
  for (const {name,size} of e.target.files) {
    if (!task.files.some(f=>f.name===name && f.size===size)) task.files.push({name,size});
  }
  e.target.value='';
  save();
  render();
});
app.addEventListener('click', e => {
  if (e.target.id === 'sample') {
    task.title='带约束的二次优化问题';
    task.files=[{name:'研究题目说明.pdf',size:245760}];
  } else if (e.target.hasAttribute('data-remove')) {
    task.files.splice(Number(e.target.dataset.remove),1);
  } else if (e.target.id === 'edit') {
    task.editing=true;
  } else return;
  save();
  render();
});
app.addEventListener('submit', e => {
  e.preventDefault();
  if (!task.editing) return;
  if (!task.title.trim() || !task.files.length) {
    document.querySelector('#error').textContent='请填写题目名称，并至少添加一份题目附件。';
    return;
  }
  const time = Date.now();
  task.rounds.push({title:task.title.trim(),files:task.files.map(f=>({...f})),time,revisit:revisitDate(time),scenario:scenario.value});
  task.editing=false;
  save();
  render();
  window.scrollTo(0,0);
});
document.querySelector('#reset').addEventListener('click', () => {
  task=blank();
  scenario.value='pass';
  save();
  render();
});
window.addEventListener('storage', e => {
  if (e.key === storageKey) { task=restore(); render(); }
});
window.addEventListener('pageshow', () => { task=restore(); render(); });
render();
