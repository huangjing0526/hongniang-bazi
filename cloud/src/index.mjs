// 红娘八字排盘 · Worker
//
// 两件事：托管 dist/ 静态资源，接收老师端的命例与裁定同步。
// 排盘本身仍然全在浏览器里算，服务端不碰历法逻辑——断网时老师照常能用。

const JSON_BODY_LIMIT = 1024 * 1024; // 1MB，几百条命例远远用不到
const MAX_CASES = 2000;
const MAX_VERDICTS = 2000;
const MAX_TEXT = 2000;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 统一响应体：{ code, data, message }，code 0 为成功 */
function json(status, code, data, message = '') {
  return new Response(JSON.stringify({ code, data, message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

const ok = (data) => json(200, 0, data, '');

function text(value, name, { required = false, maxLength = MAX_TEXT } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, 4001, `缺少必填字段「${name}」`);
    return null;
  }
  if (typeof value !== 'string') throw new ApiError(400, 4002, `字段「${name}」必须是文本`);
  if (value.length > maxLength) throw new ApiError(400, 4003, `字段「${name}」过长`);
  return value;
}

function jsonField(value, name) {
  if (value === undefined || value === null) return null;
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_TEXT) throw new ApiError(400, 4003, `字段「${name}」过长`);
  return serialized;
}

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > JSON_BODY_LIMIT) throw new ApiError(413, 4131, '上传内容过大');
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw new ApiError(400, 4004, '请求体不是合法 JSON 对象');
  }
}

/** 邀请码鉴权。吊销一位老师只需把 teachers.active 置 0。 */
async function authenticate(request, env) {
  const token = request.headers.get('x-teacher-token');
  if (!token) throw new ApiError(401, 4011, '缺少邀请码，请使用我们发给您的专属链接打开');

  const teacher = await env.DB
    .prepare('SELECT id, name, active FROM teachers WHERE id = ?')
    .bind(token)
    .first();

  if (!teacher || teacher.active !== 1) {
    console.warn(JSON.stringify({ action: 'authenticate', tokenPrefix: token.slice(0, 6), result: 'rejected' }));
    throw new ApiError(403, 4031, '邀请码无效或已停用，请联系我们');
  }
  return teacher;
}

function caseStatement(env, teacherId, item, now) {
  if (item === null || typeof item !== 'object') throw new ApiError(400, 4005, '命例格式不正确');
  const birth = item.parsedTime && typeof item.parsedTime === 'object'
    ? `${item.parsedTime.year}-${String(item.parsedTime.month).padStart(2, '0')}-${String(item.parsedTime.day).padStart(2, '0')} ${String(item.parsedTime.hour).padStart(2, '0')}:${String(item.parsedTime.minute).padStart(2, '0')}`
    : null;

  return env.DB.prepare(
    `INSERT INTO cases (teacher_id, id, name, gender, city_name, longitude, birth_at, time_source, raw, status, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (teacher_id, id) DO UPDATE SET
       name = excluded.name, gender = excluded.gender, city_name = excluded.city_name,
       longitude = excluded.longitude, birth_at = excluded.birth_at,
       time_source = excluded.time_source, raw = excluded.raw,
       status = excluded.status, synced_at = excluded.synced_at`,
  ).bind(
    teacherId,
    text(item.id, 'case.id', { required: true, maxLength: 120 }),
    text(item.name, 'case.name', { maxLength: 120 }),
    text(item.gender, 'case.gender', { maxLength: 16 }),
    text(item.cityName, 'case.cityName', { maxLength: 120 }),
    Number.isFinite(item.longitude) ? item.longitude : null,
    birth,
    text(item.timeSource, 'case.timeSource', { maxLength: 64 }),
    text(item.raw, 'case.raw', { maxLength: 500 }),
    text(item.status, 'case.status', { maxLength: 32 }),
    now,
  );
}

function verdictStatement(env, teacherId, item, now) {
  if (item === null || typeof item !== 'object') throw new ApiError(400, 4006, '裁定格式不正确');

  return env.DB.prepare(
    `INSERT INTO verdicts (teacher_id, id, chart_id, disputed_pillars, teacher_gan_zhi, school, time_source, reason, created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (teacher_id, id) DO UPDATE SET
       chart_id = excluded.chart_id, disputed_pillars = excluded.disputed_pillars,
       teacher_gan_zhi = excluded.teacher_gan_zhi, school = excluded.school,
       time_source = excluded.time_source, reason = excluded.reason,
       synced_at = excluded.synced_at`,
  ).bind(
    teacherId,
    text(item.id, 'verdict.id', { required: true, maxLength: 120 }),
    text(item.chartId, 'verdict.chartId', { required: true, maxLength: 200 }),
    jsonField(item.disputedPillars ?? [], 'verdict.disputedPillars'),
    jsonField(item.teacherGanZhi ?? {}, 'verdict.teacherGanZhi'),
    text(item.school, 'verdict.school', { maxLength: 120 }),
    text(item.timeSource, 'verdict.timeSource', { required: true, maxLength: 64 }),
    text(item.reason, 'verdict.reason'),
    text(item.createdAt, 'verdict.createdAt', { required: true, maxLength: 40 }),
    now,
  );
}

/**
 * 全量推送。老师端把本地全部命例与裁定一并送上来，服务端按主键 upsert。
 * 量级只有几百条，全量比增量少一个「同步游标」的状态机，也天然自愈——
 * 中间丢过的任何一次同步，下一次就补回来了。
 */
async function handleSync(request, env) {
  const teacher = await authenticate(request, env);
  const body = await readJson(request);

  const cases = Array.isArray(body.cases) ? body.cases : [];
  const verdicts = Array.isArray(body.verdicts) ? body.verdicts : [];
  if (cases.length > MAX_CASES) throw new ApiError(400, 4007, `命例数量超出上限（${MAX_CASES}）`);
  if (verdicts.length > MAX_VERDICTS) throw new ApiError(400, 4008, `裁定数量超出上限（${MAX_VERDICTS}）`);

  const now = new Date().toISOString();
  const statements = [
    ...cases.map((item) => caseStatement(env, teacher.id, item, now)),
    ...verdicts.map((item) => verdictStatement(env, teacher.id, item, now)),
    env.DB.prepare('UPDATE teachers SET last_seen_at = ? WHERE id = ?').bind(now, teacher.id),
  ];

  try {
    await env.DB.batch(statements);
  } catch (err) {
    // 不吞错误：先把上下文记下来再抛，否则线上只能看到一句 D1_ERROR
    console.error(JSON.stringify({
      action: 'sync', teacherId: teacher.id,
      cases: cases.length, verdicts: verdicts.length,
      error: String(err && err.message ? err.message : err),
    }));
    throw new ApiError(500, 5001, '保存失败，您的记录仍在本机保存，稍后会自动重试');
  }

  return ok({ cases: cases.length, verdicts: verdicts.length, syncedAt: now });
}

async function handleMe(request, env) {
  const teacher = await authenticate(request, env);
  return ok({ id: teacher.id, name: teacher.name });
}

async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

  if (pathname === '/api/health') return ok({ ok: true });
  if (pathname === '/api/me') {
    if (request.method !== 'GET') throw new ApiError(405, 4051, '方法不允许');
    return handleMe(request, env);
  }
  if (pathname === '/api/sync') {
    if (request.method !== 'POST') throw new ApiError(405, 4051, '方法不允许');
    return handleSync(request, env);
  }
  throw new ApiError(404, 4041, '接口不存在');
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      if (err instanceof ApiError) return json(err.status, err.code, null, err.message);
      console.error(JSON.stringify({
        action: 'unhandled', url: request.url,
        error: String(err && err.stack ? err.stack : err),
      }));
      return json(500, 5000, null, '服务器开小差了，请稍后重试');
    }
  },
};
