-- 红娘八字排盘 · 试用数据回传
--
-- 三张表：老师（邀请码）、命例、裁定。
-- 命例与裁定的主键都带 teacher_id，客户端生成的 id 只需在单个老师内唯一。

CREATE TABLE teachers (
  id           TEXT PRIMARY KEY,          -- 邀请码，出现在试用链接 ?t= 里
  name         TEXT NOT NULL,             -- 老师姓名或机构，仅内部标注用
  note         TEXT,
  active       INTEGER NOT NULL DEFAULT 1, -- 置 0 即吊销该邀请码
  created_at   TEXT NOT NULL,
  last_seen_at TEXT
);

-- 老师录入的命例。含真实客户姓名与出生信息，属个人信息，见 docs/给老师的试用说明.md
CREATE TABLE cases (
  teacher_id  TEXT NOT NULL,
  id          TEXT NOT NULL,              -- 客户端 case id
  name        TEXT,
  gender      TEXT,
  city_name   TEXT,
  longitude   REAL,
  birth_at    TEXT,                       -- 'YYYY-MM-DD HH:mm'，未解析成功时为空
  time_source TEXT,
  raw         TEXT,                       -- 老师粘贴的原始行
  status      TEXT,                       -- valid / error
  synced_at   TEXT NOT NULL,
  PRIMARY KEY (teacher_id, id),
  FOREIGN KEY (teacher_id) REFERENCES teachers(id)
);

-- 老师当场裁定。这是整个试用要收的东西。
CREATE TABLE verdicts (
  teacher_id       TEXT NOT NULL,
  id               TEXT NOT NULL,         -- 客户端 uuid，重复同步靠它去重
  chart_id         TEXT NOT NULL,
  disputed_pillars TEXT NOT NULL,         -- JSON 数组，空数组表示「与我们一致」
  teacher_gan_zhi  TEXT NOT NULL,         -- JSON 对象，老师给的正确干支
  school           TEXT,
  time_source      TEXT NOT NULL,         -- 出生证 / 家人口述 / 客户自报
  reason           TEXT,
  created_at       TEXT NOT NULL,         -- 老师提交那一刻（客户端时间）
  synced_at        TEXT NOT NULL,
  PRIMARY KEY (teacher_id, id),
  FOREIGN KEY (teacher_id) REFERENCES teachers(id)
);

-- 复盘时最常用的两个口子：按老师看进度、按分歧柱看聚集
CREATE INDEX idx_verdicts_teacher_created ON verdicts (teacher_id, created_at);
CREATE INDEX idx_cases_teacher ON cases (teacher_id);
