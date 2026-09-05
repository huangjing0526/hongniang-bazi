-- 裁定补齐排盘上下文。
--
-- 0001 收上来的裁定只有「哪一柱有分歧」和「老师认为应该是什么」，缺了三样东西，
-- 导致一条裁定事后无法复现：
--   1. 当时三个开关的状态——真太阳时开与关排出的时柱不同，老师说「你们排对了」指的是哪一个？
--   2. 工具当时排出的四柱——不存就得事后重算，而重算需要 1；
--   3. 出生地与经度——chart_id 里没有，cases 表在单个录入路径下又是空的。
--
-- 已有的行这四列为 NULL，属于 0001 期间的历史数据，分析时按「口径未知」剔除。

ALTER TABLE verdicts ADD COLUMN our_gan_zhi TEXT;   -- '丙子 丙申 己卯 庚午'
ALTER TABLE verdicts ADD COLUMN options     TEXT;   -- JSON: {applyTrueSolar,applyDst,sect,timeFold}
ALTER TABLE verdicts ADD COLUMN city_name   TEXT;
ALTER TABLE verdicts ADD COLUMN longitude   REAL;

-- chart_id 从 0002 起等于 cases.id，两表靠它 join，加个索引
CREATE INDEX idx_verdicts_chart ON verdicts (teacher_id, chart_id);
