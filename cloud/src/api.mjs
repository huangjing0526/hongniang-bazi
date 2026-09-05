// 同步接口的业务逻辑，Cloudflare Worker 与自有服务器共用这一份。
//
// 全程只用 Web 标准的 Request/Response（Node 18+ 自带），所以两个运行时都能直接跑；
// 数据库那头只用到 D1 的四个接口（prepare / bind / first / batch），自有服务器上
// 由 d1-sqlite.mjs 用 node:sqlite 顶上。

const JSON_BODY_LIMIT = 1024 * 1024; // 1MB，几百条命例远远用不到
const MAX_CASES = 2000;
const MAX_VERDICTS = 2000;
const MAX_RETIRED = 2000;
const MAX_TEXT = 2000;
// 32 与 web/app.js 的 TEACHER_NAME_MAX 对齐，改一边要同时改另一边。
const MAX_NAME = 32;
// 注册限流：同一 IP 一小时内最多开 5 个。够一位老师换设备重登几次，
// 也让脚本刷不出成千上万条脏数据。
const REGISTER_MAX_PER_IP = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
// 只留一倍余量给时钟漂移。留 24 小时的话，表和索引会白养 24 倍的行，
// 而超出窗口的那些行没有任何读者。
const REGISTER_LOG_TTL_MS = 2 * REGISTER_WINDOW_MS;

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

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 取调用方 IP 的哈希桶。Cloudflare 用 CF-Connecting-IP；自有服务器前面挂着 Caddy，
 * 取 X-Forwarded-For 的第一段。两个都取不到就都归进 'unknown' 一个桶——
 * 同一个桶里限流比不限流强，不为取不到 IP 就放行。
 *
 * 只哈希不存明文：限流要知道的是「是不是同一个人」，不需要知道他是谁。
 */
async function ipBucket(request) {
  const raw = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')
    || '';
  const ip = raw.split(',')[0].trim();   // cf-connecting-ip 不含逗号，对它是恒等操作
  if (!ip) return 'unknown';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`hongniang-bazi:${ip}`),
  );
  return toHex(new Uint8Array(digest));
}

/** 16 字节随机数的 hex。这是身份凭据，必须用 CSPRNG，不能用 Math.random */
function newToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/**
 * 自助登记。老师在页面上填个称呼，服务端现发一个随机邀请码。
 *
 * 名字**不当**主键、也不当凭据：同名复用一份数据的话，任何人输入「王老师」
 * 就能读写他的全部记录。所以同名的两次登记是两份互不相干的数据，
 * 换设备靠前端给出的专属链接接回来，不靠重新输名字。
 *
 * 限流写在函数体里而不抽成中间件：三个端点里只有这一个是公开的，
 * 而且 register_log 与 teachers 两条 INSERT 必须在同一个 batch 里原子落盘——
 * 抽成前置中间件反而会把它们劈开，让「发了身份但没记账」变成可能。
 */
async function handleRegister(request, env) {
  const body = await readJson(request);
  // 走 text()，与其它端点的字段校验同一套：非字符串一律 4002，不做静默强转
  const name = (text(body.name, 'name', { required: true, maxLength: MAX_NAME }) ?? '').trim();
  if (!name) throw new ApiError(400, 4012, '请填写您的称呼');

  const now = new Date();
  const nowIso = now.toISOString();
  const bucket = await ipBucket(request);

  // 限流先查后写。并发下有可能多放行一两个，但这里挡的是脚本批量刷，
  // 不是精确配额，不值得为它上一把锁。
  const cutoff = new Date(now.getTime() - REGISTER_WINDOW_MS).toISOString();
  const seen = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM register_log WHERE ip_hash = ? AND created_at > ?')
    .bind(bucket, cutoff)
    .first();
  if (Number(seen.n) >= REGISTER_MAX_PER_IP) {
    console.warn(JSON.stringify({
      action: 'register', bucketPrefix: bucket.slice(0, 8), result: 'rate_limited',
    }));
    throw new ApiError(429, 4291, '登记太频繁了，请一小时后再试');
  }

  const token = newToken();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO teachers (id, name, note, active, created_at, source)
         VALUES (?, ?, NULL, 1, ?, 'self')`,
      ).bind(token, name, nowIso),
      env.DB.prepare('INSERT INTO register_log (ip_hash, created_at) VALUES (?, ?)')
        .bind(bucket, nowIso),
      // 顺手清掉过期的限流记录，免得这张表无限涨。
      // 走 idx_register_log_created，是一次范围 seek 而不是全表扫。
      env.DB.prepare('DELETE FROM register_log WHERE created_at < ?')
        .bind(new Date(now.getTime() - REGISTER_LOG_TTL_MS).toISOString()),
    ]);
  } catch (err) {
    console.error(JSON.stringify({
      action: 'register', name, bucketPrefix: bucket.slice(0, 8),
      error: String(err && err.message ? err.message : err),
    }));
    throw new ApiError(500, 5002, '登记失败，请稍后重试');
  }

  console.log(JSON.stringify({ action: 'register', teacherId: token, name, result: 'ok' }));
  return ok({ token, name });
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
    // 120 与 web/app.js 的 CASE_ID_MAX 对齐，改一边要同时改另一边
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

  // our_gan_zhi / options / city_name / longitude 是 0002 补的排盘上下文。
  // 缺了它们，一条裁定说不清老师当时看的是哪个口径下的盘，等于收了个寂寞。
  return env.DB.prepare(
    `INSERT INTO verdicts (teacher_id, id, chart_id, disputed_pillars, teacher_gan_zhi, school, time_source, reason, created_at, our_gan_zhi, options, city_name, longitude, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (teacher_id, id) DO UPDATE SET
       chart_id = excluded.chart_id, disputed_pillars = excluded.disputed_pillars,
       teacher_gan_zhi = excluded.teacher_gan_zhi, school = excluded.school,
       time_source = excluded.time_source, reason = excluded.reason,
       our_gan_zhi = excluded.our_gan_zhi, options = excluded.options,
       city_name = excluded.city_name, longitude = excluded.longitude,
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
    text(item.ourGanZhi, 'verdict.ourGanZhi', { maxLength: 64 }),
    item.options ? jsonField(item.options, 'verdict.options') : null,
    text(item.cityName, 'verdict.cityName', { maxLength: 120 }),
    Number.isFinite(item.longitude) ? item.longitude : null,
    now,
  );
}

/** 按老师端点名删除。只删它明确报上来的 id，绝不按「这次没推上来」反推。 */
function deleteStatements(env, teacherId, table, ids) {
  if (table !== 'cases' && table !== 'verdicts') throw new Error(`表名不在白名单：${table}`);
  return ids.map((id) => {
    if (typeof id !== 'string' || !id || id.length > 200) {
      throw new ApiError(400, 4009, '待删除 id 格式不正确');
    }
    return env.DB.prepare(`DELETE FROM ${table} WHERE teacher_id = ? AND id = ?`).bind(teacherId, id);
  });
}

/**
 * 全量推送。老师端把本地全部命例与裁定一并送上来，服务端按主键 upsert。
 * 量级只有几百条，全量比增量少一个「同步游标」的状态机，也天然自愈——
 * 中间丢过的任何一次同步，下一次就补回来了。
 *
 * 但 upsert 只增不减：老师在本机点了删除，这边那行还留着，他删的等于没删；
 * 改选出生地会换 case id，也会在这边留下旧 id 的孤儿行。所以另收一份
 * retiredCases / retiredVerdicts——老师**点名**要删的 id。
 *
 * 为什么不让服务端拿「这次全量推送里没有的都删掉」去反推：老师可能在手机和电脑
 * 各开一份，两台设备的本地记录不一样，反推会让一台的推送删掉另一台刚录的东西。
 */
async function handleSync(request, env) {
  const teacher = await authenticate(request, env);
  const body = await readJson(request);

  const cases = Array.isArray(body.cases) ? body.cases : [];
  const verdicts = Array.isArray(body.verdicts) ? body.verdicts : [];
  const retiredCases = Array.isArray(body.retiredCases) ? body.retiredCases : [];
  const retiredVerdicts = Array.isArray(body.retiredVerdicts) ? body.retiredVerdicts : [];
  if (cases.length > MAX_CASES) throw new ApiError(400, 4007, `命例数量超出上限（${MAX_CASES}）`);
  if (verdicts.length > MAX_VERDICTS) throw new ApiError(400, 4008, `裁定数量超出上限（${MAX_VERDICTS}）`);
  if (retiredCases.length + retiredVerdicts.length > MAX_RETIRED) {
    throw new ApiError(400, 4010, `待删除数量超出上限（${MAX_RETIRED}）`);
  }

  const now = new Date().toISOString();
  // 删除排在写入前面：万一同一个 id 既在退役名单里又在本次推送里
  //（删掉又重录），先删后写才是老师想要的结果。
  const statements = [
    ...deleteStatements(env, teacher.id, 'cases', retiredCases),
    ...deleteStatements(env, teacher.id, 'verdicts', retiredVerdicts),
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
      retiredCases: retiredCases.length, retiredVerdicts: retiredVerdicts.length,
      error: String(err && err.message ? err.message : err),
    }));
    throw new ApiError(500, 5001, '保存失败，您的记录仍在本机保存，稍后会自动重试');
  }

  return ok({
    cases: cases.length,
    verdicts: verdicts.length,
    retired: retiredCases.length + retiredVerdicts.length,
    syncedAt: now,
  });
}

async function handleMe(request, env) {
  const teacher = await authenticate(request, env);
  return ok({ id: teacher.id, name: teacher.name });
}

/**
 * 处理 /api/* 请求。非 API 路径返回 null，交给调用方去发静态资源。
 * @param {Request} request
 * @param {{DB: object}} env
 */
export async function handleApi(request, env) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/api/')) return null;

  try {
    if (pathname === '/api/health') return ok({ ok: true });
    if (pathname === '/api/me') {
      if (request.method !== 'GET') throw new ApiError(405, 4051, '方法不允许');
      return await handleMe(request, env);
    }
    if (pathname === '/api/register') {
      if (request.method !== 'POST') throw new ApiError(405, 4051, '方法不允许');
      return await handleRegister(request, env);
    }
    if (pathname === '/api/sync') {
      if (request.method !== 'POST') throw new ApiError(405, 4051, '方法不允许');
      return await handleSync(request, env);
    }
    throw new ApiError(404, 4041, '接口不存在');
  } catch (err) {
    if (err instanceof ApiError) return json(err.status, err.code, null, err.message);
    console.error(JSON.stringify({
      action: 'unhandled', url: request.url,
      error: String(err && err.stack ? err.stack : err),
    }));
    return json(500, 5000, null, '服务器开小差了，请稍后重试');
  }
}
