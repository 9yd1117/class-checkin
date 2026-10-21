/**
 * 班级学习打卡 —— 核心业务逻辑
 *
 * 这里不直接依赖 EdgeOne，只依赖一个很小的 store 接口：
 *   store.get(key, { type, consistency })  -> string | object | ArrayBuffer | null
 *   store.set(key, value)                  -> void
 *   store.setJSON(key, value)              -> void
 *   store.delete(key)                      -> void
 *   store.list({ prefix, consistency })    -> { blobs: [{ key }] }
 *
 * 云端用 EdgeOne Blob 实现（[[default]].js），本地用文件系统实现（dev/store-fs.mjs）。
 */

const DAY_MS = 86400000;
const MAX_PHOTO_BYTES = 400 * 1024;
const MAX_NOTE_LEN = 80;
const MAX_NICKNAME_LEN = 16;
const MAX_STUDENT_NO_LEN = 24;

/** 北京时间（UTC+8）的 YYYY-MM-DD，offset 为相对今天的天数 */
export function dayStr(offset = 0) {
  const t = Date.now() + 8 * 3600 * 1000 + offset * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function prevDay(day) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function bad(msg, status = 400) {
  return json({ error: msg }, status);
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function randomId(len = 10) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function randomToken() {
  return randomId(8) + '-' + crypto.randomUUID();
}

function isDay(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** 当前连续天数（今天没打则从昨天往前算，昨天也没打则为 0） */
export function calcStreak(days, today = dayStr()) {
  const set = new Set(days);
  let cursor = set.has(today) ? today : prevDay(today);
  let n = 0;
  while (set.has(cursor)) {
    n++;
    cursor = prevDay(cursor);
  }
  return n;
}

function sortDaysDesc(days) {
  return [...new Set(days)].sort().reverse();
}

export function createHandler(store, env = {}) {
  const CLASS_CODE = String(env.CLASS_CODE || '888888');
  const ADMIN_CODE = String(env.ADMIN_CODE || CLASS_CODE);
  const RETENTION_DAYS = Math.max(7, Number(env.RETENTION_DAYS || 120));

  async function getMemberByToken(request) {
    const header = request.headers.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return null;
    const ref = await store.get('token/' + token, { type: 'json', consistency: 'strong' });
    if (!ref || !ref.id) return null;
    return await store.get('member/' + ref.id, { type: 'json', consistency: 'strong' });
  }

  async function getStats(memberId) {
    const s = await store.get('stats/' + memberId, { type: 'json', consistency: 'strong' });
    return s && Array.isArray(s.days) ? s : { id: memberId, days: [] };
  }

  async function saveStats(memberId, nickname, days) {
    const clean = sortDaysDesc(days.filter(isDay));
    await store.setJSON('stats/' + memberId, {
      id: memberId,
      nickname,
      days: clean,
      updatedAt: Date.now(),
    });
    return clean;
  }

  /** 打卡页数据 */
  async function loadFeed(day) {
    const { blobs } = await store.list({ prefix: 'checkin/' + day + '/', consistency: 'strong' });
    const items = await Promise.all(
      blobs.map(async (b) => {
        const rec = await store.get(b.key, { type: 'json', consistency: 'strong' });
        return rec;
      })
    );
    const ok = items.filter(Boolean).sort((a, b) => a.ts - b.ts);
    return ok;
  }

  async function loadAllStats() {
    const { blobs } = await store.list({ prefix: 'stats/', consistency: 'strong' });
    const list = await Promise.all(
      blobs.map((b) => store.get(b.key, { type: 'json', consistency: 'strong' }))
    );
    return list.filter((s) => s && Array.isArray(s.days));
  }

  async function countMembers() {
    const { blobs } = await store.list({ prefix: 'member/', consistency: 'strong' });
    return blobs.length;
  }

  /** 清理超过保留期的照片，每天最多跑一次（只删照片，打卡记录永远保留） */
  async function maybeCleanup() {
    const today = dayStr();
    const marker = await store.get('meta/lastCleanup', { type: 'text', consistency: 'strong' });
    if (marker === today) return;
    await store.set('meta/lastCleanup', today);
    const cutoff = dayStr(-RETENTION_DAYS);
    try {
      const { blobs } = await store.list({ prefix: 'photo/', consistency: 'strong' });
      const stale = blobs.filter((b) => {
        const day = b.key.split('/')[1] || '';
        return isDay(day) && day < cutoff;
      });
      for (const b of stale) await store.delete(b.key);
    } catch (e) {
      // 清理失败不影响打卡
    }
  }

  return async function handle(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
    const method = request.method.toUpperCase();

    try {
      // ---------- 加入班级 ----------
      if (path === '/join' && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const classCode = str(body.classCode, 64);
        const nickname = str(body.nickname, MAX_NICKNAME_LEN);
        const studentNo = str(body.studentNo, MAX_STUDENT_NO_LEN);

        if (classCode !== CLASS_CODE) return bad('班级口令不对，问一下班长或老师', 403);
        if (!nickname) return bad('请填写昵称');
        if (!studentNo) return bad('请填写学号');

        const ref = await store.get('byNo/' + studentNo, { type: 'json', consistency: 'strong' });
        if (ref && ref.id) {
          const member = await store.get('member/' + ref.id, { type: 'json', consistency: 'strong' });
          if (member && member.token) {
            return json({
              token: member.token,
              member: { id: member.id, nickname: member.nickname, studentNo: member.studentNo },
              rejoined: true,
            });
          }
        }

        const id = randomId(10);
        const token = randomToken();
        const member = { id, nickname, studentNo, token, joinedAt: Date.now() };
        await store.setJSON('member/' + id, member);
        await store.setJSON('byNo/' + studentNo, { id });
        await store.setJSON('token/' + token, { id });
        await saveStats(id, nickname, []);
        return json({ token, member: { id, nickname, studentNo } });
      }

      // ---------- 当前登录用户 ----------
      if (path === '/me' && method === 'GET') {
        const member = await getMemberByToken(request);
        if (!member) return bad('登录已失效，请重新进入班级', 401);
        const stats = await getStats(member.id);
        const days = sortDaysDesc(stats.days);
        const today = dayStr();
        const recentDays = days.slice(0, 12);
        const recent = (
          await Promise.all(
            recentDays.map(async (day) => {
              const rec = await store.get('checkin/' + day + '/' + member.id, {
                type: 'json',
                consistency: 'strong',
              });
              if (!rec) return null;
              return {
                day,
                note: rec.note || '',
                ts: rec.ts,
                photo: `/api/photo/${day}/${member.id}?v=${rec.ts}`,
              };
            })
          )
        ).filter(Boolean);
        return json({
          id: member.id,
          nickname: member.nickname,
          studentNo: member.studentNo,
          joinedAt: member.joinedAt,
          days,
          total: days.length,
          streak: calcStreak(days, today),
          month: days.filter((d) => d.startsWith(today.slice(0, 7))).length,
          checkedToday: days.includes(today),
          recent,
        });
      }

      // ---------- 今日动态 ----------
      if (path === '/feed' && method === 'GET') {
        const member = await getMemberByToken(request);
        if (!member) return bad('请先进入班级', 401);
        const day = isDay(url.searchParams.get('day') || '') ? url.searchParams.get('day') : dayStr();
        const [items, total] = await Promise.all([loadFeed(day), countMembers()]);
        return json({
          day,
          total,
          checked: items.length,
          me: member.id,
          items: items.map((it) => ({
            id: it.id,
            nickname: it.nickname,
            note: it.note || '',
            ts: it.ts,
            photo: `/api/photo/${day}/${it.id}?v=${it.ts}`,
            likes: Array.isArray(it.likes) ? it.likes : [],
          })),
        });
      }

      // ---------- 上传打卡 ----------
      if (path === '/checkin' && method === 'POST') {
        const member = await getMemberByToken(request);
        if (!member) return bad('请先进入班级', 401);

        const today = dayStr();
        const key = 'checkin/' + today + '/' + member.id;
        const exists = await store.get(key, { type: 'json', consistency: 'strong' });
        if (exists) return bad('今天已经打过卡啦，明天再来', 409);

        const body = await request.json().catch(() => ({}));
        const note = str(body.note, MAX_NOTE_LEN);
        let photo = typeof body.photo === 'string' ? body.photo : '';
        photo = photo.replace(/^data:image\/[a-z+]+;base64,/i, '');
        if (!photo) return bad('请先选择一张照片');

        let bytes;
        try {
          const bin = atob(photo);
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } catch (e) {
          return bad('照片数据不完整，请重新选择');
        }
        if (!bytes.length) return bad('照片是空的，请重新选择');
        if (bytes.length > MAX_PHOTO_BYTES) return bad('照片太大，请重新选择（会自动压缩）');

        const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
        if (!isJpeg && !isPng) return bad('只支持 JPG / PNG 照片');

        // Blob SDK 接受 string | ArrayBuffer | Blob | ReadableStream，这里传原始 ArrayBuffer
        await store.set('photo/' + today + '/' + member.id, bytes.buffer);
        const record = {
          id: member.id,
          nickname: member.nickname,
          note,
          ts: Date.now(),
          likes: [],
        };
        await store.setJSON(key, record);

        const stats = await getStats(member.id);
        if (!stats.days.includes(today)) {
          await saveStats(member.id, member.nickname, [...stats.days, today]);
        }

        // 顺手清理过期照片（每天最多一次，内部已兜底，失败不影响本次打卡）
        await maybeCleanup();

        return json({ ok: true, day: today, id: member.id, ts: record.ts });
      }

      // ---------- 点赞 / 取消点赞 ----------
      if (path === '/like' && method === 'POST') {
        const member = await getMemberByToken(request);
        if (!member) return bad('请先进入班级', 401);
        const body = await request.json().catch(() => ({}));
        const day = str(body.day, 10);
        const target = str(body.memberId, 32);
        if (!isDay(day) || !target) return bad('参数不对');

        const key = 'checkin/' + day + '/' + target;
        const rec = await store.get(key, { type: 'json', consistency: 'strong' });
        if (!rec) return bad('这条打卡不存在', 404);

        let likes = Array.isArray(rec.likes) ? rec.likes : [];
        if (likes.includes(member.id)) likes = likes.filter((x) => x !== member.id);
        else likes.push(member.id);
        rec.likes = likes;
        await store.setJSON(key, rec);
        return json({ likes });
      }

      // ---------- 删除自己的打卡 ----------
      if (path === '/checkin' && method === 'DELETE') {
        const member = await getMemberByToken(request);
        if (!member) return bad('请先进入班级', 401);
        const day = url.searchParams.get('day') || '';
        if (!isDay(day)) return bad('日期不对');

        const key = 'checkin/' + day + '/' + member.id;
        const rec = await store.get(key, { type: 'json', consistency: 'strong' });
        if (!rec) return bad('没有找到这条打卡', 404);

        await store.delete(key);
        await store.delete('photo/' + day + '/' + member.id);
        const stats = await getStats(member.id);
        await saveStats(member.id, member.nickname, stats.days.filter((d) => d !== day));
        return json({ ok: true });
      }

      // ---------- 排行榜 ----------
      if (path === '/leaderboard' && method === 'GET') {
        const member = await getMemberByToken(request);
        if (!member) return bad('请先进入班级', 401);
        const type = url.searchParams.get('type') || 'total';
        const today = dayStr();
        const month = today.slice(0, 7);

        // 今日榜：按打卡时间先后（早起的排在前面）
        if (type === 'today') {
          const items = await loadFeed(today);
          const rows = await Promise.all(
            items.map(async (it) => {
              const s = await getStats(it.id);
              const days = s.days || [];
              return {
                id: it.id,
                nickname: it.nickname,
                ts: it.ts,
                value: 1,
                total: days.length,
                streak: calcStreak(days, today),
              };
            })
          );
          rows.sort((a, b) => a.ts - b.ts);
          return json({ type, day: today, count: rows.length, rows });
        }

        const all = await loadAllStats();

        const rows = all.map((s) => {
          const days = s.days || [];
          let value = 0;
          if (type === 'streak') value = calcStreak(days, today);
          else if (type === 'month') value = days.filter((d) => d.startsWith(month)).length;
          else if (type === 'today') value = days.includes(today) ? 1 : 0;
          else value = days.length;
          return {
            id: s.id,
            nickname: s.nickname,
            value,
            total: days.length,
            streak: calcStreak(days, today),
          };
        });

        const filtered = type === 'today' ? rows.filter((r) => r.value > 0) : rows;
        filtered.sort((a, b) => b.value - a.value || b.total - a.total || a.nickname.localeCompare(b.nickname, 'zh-CN'));

        return json({ type, day: today, count: filtered.length, rows: filtered.slice(0, 100) });
      }

      // ---------- 照片 ----------
      const photoMatch = path.match(/^\/photo\/(\d{4}-\d{2}-\d{2})\/([a-z0-9]+)$/);
      if (photoMatch && method === 'GET') {
        const [, day, id] = photoMatch;
        const buf = await store.get('photo/' + day + '/' + id, {
          type: 'arrayBuffer',
          consistency: 'strong',
        });
        if (!buf) return bad('照片不存在', 404);
        const isPng = new Uint8Array(buf)[0] === 0x89;
        return new Response(buf, {
          headers: {
            'Content-Type': isPng ? 'image/png' : 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      // ---------- 数据导出（备份用，管理员） ----------
      if (path === '/export' && method === 'GET') {
        if (url.searchParams.get('code') !== ADMIN_CODE) return bad('没有权限', 403);
        const { blobs } = await store.list({ prefix: 'member/', consistency: 'strong' });
        const members = (
          await Promise.all(
            blobs.map((b) => store.get(b.key, { type: 'json', consistency: 'strong' }))
          )
        )
          .filter(Boolean)
          .map((m) => ({ id: m.id, nickname: m.nickname, studentNo: m.studentNo, joinedAt: m.joinedAt }));
        const stats = (await loadAllStats()).map((s) => ({
          id: s.id,
          nickname: s.nickname,
          days: s.days,
        }));
        return json({
          exportedAt: new Date().toISOString(),
          members,
          stats,
          note: '这是打卡记录的完整备份，照片文件保存在 Blob 存储里',
        });
      }

      // ---------- 删除成员（管理员，用于清理测试账号 / 退班同学） ----------
      if (path === '/admin/remove' && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if ((body.code || '') !== ADMIN_CODE) return bad('没有权限', 403);
        const studentNo = str(body.studentNo, MAX_STUDENT_NO_LEN);
        if (!studentNo) return bad('请提供要删除的学号');

        const ref = await store.get('byNo/' + studentNo, { type: 'json', consistency: 'strong' });
        if (!ref || !ref.id) return bad('没有找到这个学号', 404);
        const member = await store.get('member/' + ref.id, { type: 'json', consistency: 'strong' });

        if (member) {
          const stats = await getStats(member.id);
          for (const day of stats.days || []) {
            await store.delete('checkin/' + day + '/' + member.id);
            await store.delete('photo/' + day + '/' + member.id);
          }
          if (member.token) await store.delete('token/' + member.token);
          await store.delete('member/' + member.id);
        }
        await store.delete('stats/' + ref.id);
        await store.delete('byNo/' + studentNo);
        return json({ ok: true, removed: studentNo });
      }

      return bad('接口不存在', 404);
    } catch (err) {
      console.error('[checkin] error', err);
      return bad('服务器开小差了，请稍后再试', 500);
    }
  };
}
