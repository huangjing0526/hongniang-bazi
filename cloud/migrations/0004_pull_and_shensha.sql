-- 拉取同步 + 神煞表源异议。
--
-- 1. cases.city_known：老师端区分「出生地查不到、经度按 120° 兜底」与「老师手填了经度」，
--    引擎据此决定报不报 CITY_UNKNOWN 风险。服务端原来不存它，新设备从 GET /api/sync
--    拉回来时就分不清了。已有的行为 NULL，拉取时按「city_name 不是占位名」推断。
--
-- 2. verdicts.shensha_disputed / shensha_note：试用说明里请老师告诉我们四条带星神煞
--    （德秀贵人 / 福星贵人 / 学堂 / 羊刃）该用哪一派，但裁定表单一直没有地方写。
--    shensha_disputed 是 JSON 数组（有异议的神煞名），shensha_note 是老师的一句话。

ALTER TABLE cases ADD COLUMN city_known INTEGER;          -- 1 / 0 / NULL(0004 之前的行)
ALTER TABLE verdicts ADD COLUMN shensha_disputed TEXT;    -- JSON 数组，如 ["羊刃","学堂"]
ALTER TABLE verdicts ADD COLUMN shensha_note TEXT;
