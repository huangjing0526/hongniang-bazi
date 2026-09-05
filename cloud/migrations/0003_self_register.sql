-- 自助登记：老师在页面上填个称呼就能开始回传，不必等我们手工发邀请码。
--
-- 邀请码从「预先发放的密钥」变成「服务端现发的随机凭据」。名字只是显示用的标签，
-- **不进主键**：两个人都填「王老师」是两份互不相干的数据，谁也读不到谁的。
-- 老路径（我们手工 INSERT 一行再把 ?t=xxx 发出去）原样保留，两条路共用同一套鉴权。

-- 分析时要能把正式老师和路人试用分开，否则收上来的裁定分不清份量。
-- 只是溯源属性，代码里不据它分支；已有的行都是我们手工开的，默认 'invite' 正好。
ALTER TABLE teachers ADD COLUMN source TEXT NOT NULL DEFAULT 'invite';  -- invite / self

-- 限制「开身份」的速率：同一 IP 一小时内只能登记有限个。
-- 注意它挡的是批量刷身份，不是 /api/sync 的写入量——后者仍只受每次请求的条数上限约束。
-- 只存 IP 的 SHA-256，不留明文；过期行在每次注册时顺手清掉。
CREATE TABLE register_log (
  ip_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL   -- ISO 8601，与 synced_at 同口径，便于直接比大小
);

-- 两条查询各一个索引：限流按 (ip_hash, created_at) 查，清理按 created_at 单列扫。
-- 少了第二个，每次注册的清理都要全表扫一遍。
CREATE INDEX idx_register_log_ip      ON register_log (ip_hash, created_at);
CREATE INDEX idx_register_log_created ON register_log (created_at);
