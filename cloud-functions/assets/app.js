/* 班级学习打卡 —— 前端（原生 JS，无构建步骤） */

const appEl = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastEl = document.getElementById('toast');

const state = {
  token: '',
  me: null,
  feed: null,
  rank: null,
  rankType: 'total',
  tab: 'today',
  loading: false,
};

/* ---------------- 工具 ---------------- */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function bjNow() {
  return new Date(Date.now() + 8 * 3600 * 1000);
}

function fmtDay(d = bjNow()) {
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

function weekday(d = bjNow()) {
  return '周' + '日一二三四五六'[d.getUTCDay()];
}

function fmtTime(ts) {
  const d = new Date(ts + 8 * 3600 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  return Math.round(bytes / 1024) + ' KB';
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function loadingHtml(text = '加载中…') {
  return `<div class="loading"><div class="spinner"></div><div>${esc(text)}</div></div>`;
}

function avatarColor(name) {
  const colors = [
    'linear-gradient(135deg,#8e7bff,#4b7bff)',
    'linear-gradient(135deg,#ff9a6b,#ff5e7e)',
    'linear-gradient(135deg,#3ecf8e,#2bb3a3)',
    'linear-gradient(135deg,#f6b73c,#f08a24)',
    'linear-gradient(135deg,#7f8cff,#b46bff)',
  ];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return colors[h % colors.length];
}

/* ---------------- 请求 ---------------- */

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { error: '网络异常，请稍后重试' };
  }
  if (!res.ok) {
    const err = new Error(data.error || '请求失败');
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------------- 登录态 ---------------- */

function loadAuth() {
  try {
    return JSON.parse(localStorage.getItem('checkin.auth') || 'null');
  } catch {
    return null;
  }
}

function saveAuth(token, member) {
  localStorage.setItem('checkin.auth', JSON.stringify({ token, member }));
}

function clearAuth() {
  localStorage.removeItem('checkin.auth');
  state.token = '';
  state.me = null;
}

/* ---------------- 登录页 ---------------- */

function renderJoin() {
  appEl.innerHTML = `
    <div class="join-wrap">
      <div class="join-card">
        <div class="join-logo">📚</div>
        <h1>班级学习打卡</h1>
        <p class="sub">每天一张照片，一起坚持下去</p>
        <div class="field">
          <label for="j-code">班级口令</label>
          <input id="j-code" type="text" inputmode="text" placeholder="问一下班长或老师" autocomplete="off" />
        </div>
        <div class="field">
          <label for="j-name">昵称</label>
          <input id="j-name" type="text" maxlength="16" placeholder="例如：小明" autocomplete="nickname" />
        </div>
        <div class="field">
          <label for="j-no">学号</label>
          <input id="j-no" type="text" maxlength="24" placeholder="用于识别同一个人" autocomplete="off" />
        </div>
        <p class="form-error" id="j-err"></p>
        <button class="btn-primary" id="j-submit">进入班级</button>
      </div>
      <p class="join-foot">数据仅用于本班打卡 · 每天可上传一张学习照片</p>
    </div>
  `;

  const submit = async () => {
    const classCode = document.getElementById('j-code').value.trim();
    const nickname = document.getElementById('j-name').value.trim();
    const studentNo = document.getElementById('j-no').value.trim();
    const errEl = document.getElementById('j-err');
    errEl.textContent = '';
    if (!classCode) return (errEl.textContent = '请填写班级口令');
    if (!nickname) return (errEl.textContent = '请填写昵称');
    if (!studentNo) return (errEl.textContent = '请填写学号');

    const btn = document.getElementById('j-submit');
    btn.disabled = true;
    btn.textContent = '进入中…';
    try {
      const data = await api('/join', {
        method: 'POST',
        body: JSON.stringify({ classCode, nickname, studentNo }),
      });
      state.token = data.token;
      saveAuth(data.token, data.member);
      location.hash = '#/today';
      await boot();
      toast(data.rejoined ? '欢迎回来，' + data.member.nickname : '欢迎加入，' + data.member.nickname);
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false;
      btn.textContent = '进入班级';
    }
  };

  document.getElementById('j-submit').addEventListener('click', submit);
  ['j-code', 'j-name', 'j-no'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') submit();
    });
  });
}

/* ---------------- 骨架 ---------------- */

function shell(inner, active) {
  return `
    <div class="app-shell">
      ${inner}
      <nav class="tabbar">
        <a href="#/today" class="${active === 'today' ? 'on' : ''}"><span class="ico">🏠</span>今日</a>
        <a href="#/rank" class="${active === 'rank' ? 'on' : ''}"><span class="ico">🏆</span>排行</a>
        <a href="#/me" class="${active === 'me' ? 'on' : ''}"><span class="ico">🙂</span>我的</a>
      </nav>
    </div>
  `;
}

/* ---------------- 今日页 ---------------- */

function heroHtml() {
  const feed = state.feed;
  const total = feed ? feed.total : 0;
  const checked = feed ? feed.checked : 0;
  const pct = total ? Math.round((checked / total) * 100) : 0;
  const streak = state.me ? state.me.streak : 0;
  const now = bjNow();
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  const left = Math.max(0, end - now);
  const leftH = Math.floor(left / 3600000);
  const leftM = Math.floor((left % 3600000) / 60000);

  return `
    <header class="hero">
      <div class="hero-top">
        <span>${fmtDay(now)} ${weekday(now)}</span>
        <span class="streak-chip">🔥 连续 ${streak} 天</span>
      </div>
      <h1>${checked >= total && total > 0 ? '全班都打卡啦 🎉' : '今天也要加油鸭'}</h1>
      <div class="hero-sub">距离今天结束还有 ${leftH} 小时 ${leftM} 分</div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <div class="hero-count">
        <span><b>${checked}</b> / ${total} 人已打卡</span>
        <span>${pct}%</span>
      </div>
    </header>
  `;
}

function ctaHtml() {
  if (!state.me) return '';
  if (state.me.checkedToday) {
    return `
      <div class="card checkin-cta done-card">
        <div class="done-icon">✓</div>
        <div>
          <div class="done-title">今天已完成打卡</div>
          <div class="done-sub">连续 ${state.me.streak} 天 · 累计 ${state.me.total} 天</div>
        </div>
      </div>
    `;
  }
  return `
    <div class="card checkin-cta">
      <button class="btn-primary" id="open-checkin">📷 上传学习照片打卡</button>
      <p class="cta-hint">今天还没有打卡，什么时候传都算数</p>
    </div>
  `;
}

function feedItemHtml(it) {
  const liked = it.likes.includes(state.me.id);
  const mine = it.id === state.me.id;
  const initial = esc((it.nickname || '?').slice(0, 1));
  return `
    <article class="feed-item" data-like="${it.id}">
      <div class="feed-head">
        <div class="avatar" style="background:${avatarColor(it.nickname)}">${initial}</div>
        <div>
          <div class="feed-name">
            ${esc(it.nickname)}
            ${mine ? '<span class="mine-tag">我</span>' : ''}
          </div>
          <div class="feed-time">${fmtTime(it.ts)} 打卡</div>
        </div>
      </div>
      <a href="${it.photo}" target="_blank" rel="noopener">
        <img class="feed-photo" src="${it.photo}" alt="${esc(it.nickname)}的打卡照片" loading="lazy" />
      </a>
      <div class="feed-body">
        ${it.note ? `<div class="feed-note">${esc(it.note)}</div>` : ''}
        <div class="feed-foot">
          <button class="like-btn ${liked ? 'liked' : ''}" data-like-btn="${it.id}">
            ${liked ? '❤️' : '🤍'} <span>${it.likes.length}</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderToday() {
  if (!state.feed || !state.me) {
    appEl.innerHTML = shell(heroHtml() + `<div class="page">${loadingHtml()}</div>`, 'today');
    return;
  }
  const items = state.feed.items;
  const body = items.length
    ? items.map(feedItemHtml).join('')
    : `<div class="empty"><div class="big">🌱</div><div>今天还没有人打卡，来当第一个吧</div></div>`;

  appEl.innerHTML = shell(
    `${heroHtml()}
     <div class="page">
       ${ctaHtml()}
       <div class="section-title"><h2>今日动态</h2><span>${items.length} 条</span></div>
       <div id="feed">${body}</div>
     </div>`,
    'today'
  );

  document.getElementById('open-checkin')?.addEventListener('click', openCheckinModal);
  document.querySelectorAll('[data-like-btn]').forEach((btn) => {
    btn.addEventListener('click', () => toggleLike(btn.dataset.likeBtn));
  });
}

async function toggleLike(memberId) {
  if (!state.feed) return;
  const item = state.feed.items.find((x) => x.id === memberId);
  if (!item) return;
  const liked = item.likes.includes(state.me.id);
  // 乐观更新
  item.likes = liked ? item.likes.filter((x) => x !== state.me.id) : [...item.likes, state.me.id];
  renderToday();
  try {
    const data = await api('/like', {
      method: 'POST',
      body: JSON.stringify({ day: state.feed.day, memberId }),
    });
    item.likes = data.likes;
  } catch (e) {
    item.likes = liked ? [...item.likes, state.me.id] : item.likes.filter((x) => x !== state.me.id);
    toast(e.message);
  }
  renderToday();
}

/* ---------------- 排行榜 ---------------- */

const RANK_TABS = [
  { key: 'total', label: '总榜', unit: '天' },
  { key: 'streak', label: '连续榜', unit: '天' },
  { key: 'today', label: '今日榜', unit: '' },
  { key: 'month', label: '月度榜', unit: '天' },
];

function rankRowHtml(row, index) {
  const medal = ['🥇', '🥈', '🥉'][index];
  const isMe = row.id === state.me.id;
  const unit = RANK_TABS.find((t) => t.key === state.rankType)?.unit || '';
  const value =
    state.rankType === 'today' ? fmtTime(row.ts) : `${row.value}<small>${unit}</small>`;
  const sub =
    state.rankType === 'today'
      ? `累计 ${row.total} 天 · 连续 ${row.streak} 天`
      : `连续 ${row.streak} 天 · 累计 ${row.total} 天`;
  return `
    <div class="rank-row ${isMe ? 'me' : ''}">
      <div class="rank-no ${medal ? 'top' : ''}">${medal || index + 1}</div>
      <div class="rank-main">
        <div class="rank-name">${esc(row.nickname)}${isMe ? '<span class="mine-tag">我</span>' : ''}</div>
        <div class="rank-sub">${sub}</div>
      </div>
      <div class="rank-value">${value}</div>
    </div>
  `;
}

function renderRank() {
  const tabs = RANK_TABS.map(
    (t) => `<button data-rank-tab="${t.key}" class="${state.rankType === t.key ? 'active' : ''}">${t.label}</button>`
  ).join('');

  const placeholder =
    `<div class="page">
       <div class="tabs">${tabs}</div>
       ${loadingHtml()}
     </div>`;

  if (!state.rank || state.rank.type !== state.rankType) {
    appEl.innerHTML = shell(`<div class="hero" style="padding-bottom:38px"><h1>排行榜</h1><div class="hero-sub">看看谁在偷偷努力</div></div>${placeholder}`, 'rank');
  } else {
    const rows = state.rank.rows;
    const list = rows.length
      ? `<div class="rank-list">${rows.map(rankRowHtml).join('')}</div>`
      : `<div class="empty"><div class="big">👀</div><div>这个榜单今天还空着</div></div>`;
    appEl.innerHTML = shell(
      `<div class="hero" style="padding-bottom:38px"><h1>排行榜</h1><div class="hero-sub">看看谁在偷偷努力</div></div>
       <div class="page">
         <div class="tabs">${tabs}</div>
         ${list}
       </div>`,
      'rank'
    );
  }

  document.querySelectorAll('[data-rank-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.rankType === btn.dataset.rankTab) return;
      state.rankType = btn.dataset.rankTab;
      state.rank = null;
      renderRank();
      loadRank();
    });
  });
}

async function loadRank() {
  try {
    const type = state.rankType;
    const data = await api('/leaderboard?type=' + type);
    if (state.rankType !== type) return;
    state.rank = data;
    renderRank();
  } catch (e) {
    toast(e.message);
  }
}

/* ---------------- 我的 ---------------- */

function heatmapHtml(days) {
  const set = new Set(days);
  const now = bjNow();
  const cells = [];
  // 从 13 周前的周日开始，到本周六
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 12 * 7);
  const todayStr = end.toISOString().slice(0, 10);
  const d = new Date(start);
  while (d <= end || cells.length % 7 !== 0) {
    const key = d.toISOString().slice(0, 10);
    const cls = [set.has(key) ? 'on' : '', key === todayStr ? 'today' : ''].filter(Boolean).join(' ');
    cells.push(`<i class="${cls}" title="${key}"></i>`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return `<div class="heatmap">${cells.join('')}</div>`;
}

function renderMe() {
  const me = state.me;
  if (!me) {
    appEl.innerHTML = shell(`<div class="hero"><h1>我的</h1></div><div class="page">${loadingHtml()}</div>`, 'me');
    return;
  }
  const recent = me.recent || [];
  const history = recent.length
    ? recent
        .map(
          (r) => `
        <div class="history-item">
          <img class="history-thumb" src="${r.photo}" alt="" loading="lazy" />
          <div class="history-main">
            <div class="history-date">${r.day} <span class="badge">已打卡</span></div>
            <div class="history-note">${r.note ? esc(r.note) : '（没有备注）'}</div>
          </div>
          <button class="link-danger" data-del="${r.day}">删除</button>
        </div>`
        )
        .join('')
    : `<div class="empty" style="padding:26px 0"><div class="big">📝</div><div>还没有打卡记录</div></div>`;

  appEl.innerHTML = shell(
    `<div class="hero">
       <div class="hero-top"><span>我的打卡</span></div>
       <h1>${esc(me.nickname)}</h1>
       <div class="hero-sub">学号 ${esc(me.studentNo)}</div>
     </div>
     <div class="page">
       <div class="stat-grid" style="margin-top:-14px;position:relative;z-index:2">
         <div class="stat"><b>${me.total}</b><span>累计天数</span></div>
         <div class="stat hot"><b>${me.streak}</b><span>连续天数</span></div>
         <div class="stat"><b>${me.month}</b><span>本月打卡</span></div>
       </div>
       <div class="card panel">
         <div class="panel-title">打卡热力图 <small>近 13 周</small></div>
         ${heatmapHtml(me.days)}
       </div>
       <div class="card panel">
         <div class="panel-title">最近打卡 <small>可删除传错的记录</small></div>
         ${history}
       </div>
       <button class="ghost-btn" id="logout">退出登录</button>
       <p class="cta-hint" style="margin-bottom:18px">退出后重新输入学号即可回到同一个账号</p>
     </div>`,
    'me'
  );

  document.getElementById('logout').addEventListener('click', () => {
    if (!confirm('确定退出登录吗？打卡记录不会丢失。')) return;
    clearAuth();
    location.hash = '';
    renderJoin();
  });

  document.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const day = btn.dataset.del;
      if (!confirm(`确定删除 ${day} 的打卡吗？删除后可以重新上传。`)) return;
      btn.disabled = true;
      btn.textContent = '删除中…';
      try {
        await api('/checkin?day=' + day, { method: 'DELETE' });
        toast('已删除');
        await refreshMe();
        await refreshFeed();
        renderMe();
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
        btn.textContent = '删除';
      }
    });
  });
}

/* ---------------- 打卡弹层 ---------------- */

async function compressImage(file, maxSide = 1280, maxBytes = 200 * 1024) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  let quality = 0.82;
  let blob = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= maxBytes) break;
    if (quality > 0.5) quality -= 0.1;
    else scale *= 0.8;
  }
  if (bitmap.close) bitmap.close();
  if (!blob) throw new Error('图片处理失败，请换一张试试');
  return blob;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function openCheckinModal() {
  modalRoot.innerHTML = `
    <div class="modal-mask" id="mask">
      <div class="modal">
        <div class="modal-head">
          <h3>今日打卡</h3>
          <button class="modal-close" id="close-modal">×</button>
        </div>
        <div class="field">
          <label>学习照片</label>
          <div class="picker" id="picker">
            <div class="ph" id="ph"><div class="big">📷</div><div>点击拍照或从相册选择</div><div style="font-size:12px;margin-top:4px">会自动压缩到 200KB 左右</div></div>
            <img id="preview" alt="预览" hidden />
            <input id="file" type="file" accept="image/*" />
          </div>
          <div class="size-tip" id="sizeTip"></div>
        </div>
        <div class="field">
          <label>写点什么（可选）</label>
          <textarea id="note" maxlength="80" placeholder="今天学了什么？"></textarea>
          <div class="counter" id="counter">0/80</div>
        </div>
        <button class="btn-primary" id="submit" disabled>打卡</button>
      </div>
    </div>
  `;

  let photoData = null;
  const fileInput = document.getElementById('file');
  const preview = document.getElementById('preview');
  const ph = document.getElementById('ph');
  const tip = document.getElementById('sizeTip');
  const submit = document.getElementById('submit');
  const note = document.getElementById('note');
  const counter = document.getElementById('counter');

  const close = () => {
    modalRoot.innerHTML = '';
  };
  document.getElementById('close-modal').addEventListener('click', close);
  document.getElementById('mask').addEventListener('click', (e) => {
    if (e.target.id === 'mask') close();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    tip.textContent = '正在压缩…';
    submit.disabled = true;
    try {
      const blob = await compressImage(file);
      preview.src = URL.createObjectURL(blob);
      preview.hidden = false;
      ph.hidden = true;
      photoData = await blobToBase64(blob);
      tip.textContent = `已压缩到 ${fmtSize(blob.size)}`;
      submit.disabled = false;
    } catch (e) {
      tip.textContent = '';
      toast(e.message || '图片处理失败');
    }
  });

  note.addEventListener('input', () => {
    counter.textContent = `${note.value.length}/80`;
  });

  submit.addEventListener('click', async () => {
    if (!photoData) return;
    submit.disabled = true;
    submit.textContent = '上传中…';
    try {
      await api('/checkin', {
        method: 'POST',
        body: JSON.stringify({ photo: photoData, note: note.value.trim() }),
      });
      close();
      toast('打卡成功，明天见 👋');
      await Promise.all([refreshMe(), refreshFeed()]);
      renderToday();
    } catch (e) {
      toast(e.message);
      submit.disabled = false;
      submit.textContent = '打卡';
    }
  });
}

/* ---------------- 刷新 ---------------- */

async function refreshMe() {
  try {
    state.me = await api('/me');
  } catch (e) {
    if (e.status === 401) {
      clearAuth();
      renderJoin();
    }
  }
}

async function refreshFeed() {
  try {
    state.feed = await api('/feed');
  } catch (e) {
    if (e.status === 401) {
      clearAuth();
      renderJoin();
    } else {
      toast(e.message);
    }
  }
}

/* ---------------- 路由 ---------------- */

function route() {
  if (!state.token) {
    renderJoin();
    return;
  }
  const hash = location.hash.replace(/^#/, '') || '/today';
  if (hash.startsWith('/rank')) {
    state.tab = 'rank';
    renderRank();
    if (!state.rank) loadRank();
    return;
  }
  if (hash.startsWith('/me')) {
    state.tab = 'me';
    renderMe();
    return;
  }
  state.tab = 'today';
  renderToday();
}

async function boot() {
  const auth = loadAuth();
  if (!auth || !auth.token) {
    renderJoin();
    return;
  }
  state.token = auth.token;
  await refreshMe();
  if (!state.me) return;
  await refreshFeed();
  route();
}

window.addEventListener('hashchange', route);

let refreshTimer = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.token) {
    refreshFeed().then(() => {
      if (state.tab === 'today') renderToday();
    });
  }
});

setInterval(() => {
  if (document.visibilityState === 'visible' && state.token && state.tab === 'today') {
    refreshFeed().then(() => renderToday());
  }
}, 60000);

boot();
