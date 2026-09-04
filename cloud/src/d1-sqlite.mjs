// 用 node:sqlite 顶替 D1，让 cloud/src/api.mjs 在自有服务器上原样跑。
//
// Worker 里只用到 D1 的四个接口：prepare / bind / first / batch。这里照着实现，
// 不多不少——接口面越小，两个运行时行为跑偏的可能就越小。

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/** 一条已绑定参数的语句。bind() 返回新实例，与 D1 一样不改原对象。 */
class SqliteStatement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new SqliteStatement(this.db, this.sql, args);
  }

  /** D1 的 first()：取第一行，没有则 null */
  async first() {
    return this.db.prepare(this.sql).get(...this.args) ?? null;
  }

  run() {
    return this.db.prepare(this.sql).run(...this.args);
  }
}

class SqliteD1 {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new SqliteStatement(this.db, sql);
  }

  /** D1 的 batch 是原子的，这里用事务对齐：任一条失败则整批回滚 */
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map((s) => s.run());
      this.db.exec('COMMIT');
      return results;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** 按文件名顺序执行 migrations 目录下没跑过的 .sql */
function applyMigrations(db, migrationsDir) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r) => r.name),
  );
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')
        .run(file, new Date().toISOString());
      db.exec('COMMIT');
      console.log(`迁移已应用：${file}`);
    } catch (err) {
      db.exec('ROLLBACK');
      // 不吞：迁移失败必须让进程起不来，否则会带着半张表对外服务
      throw new Error(`迁移 ${file} 执行失败：${err.message}`);
    }
  }
}

/**
 * 打开数据库并补齐迁移，返回 D1 形状的对象。
 * @param {string} filePath sqlite 文件路径
 * @param {string} migrationsDir
 */
export function openDatabase(filePath, migrationsDir) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL;');   // 读写并发，断电也不容易坏
  db.exec('PRAGMA foreign_keys = ON;');    // 与 D1 行为对齐
  applyMigrations(db, migrationsDir);
  return new SqliteD1(db);
}
