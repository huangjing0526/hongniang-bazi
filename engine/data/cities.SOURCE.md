# cities.json 数据来源

| 项 | 值 |
|---|---|
| 来源 | [GeoNames](https://www.geonames.org/) 中国 dump — https://download.geonames.org/export/dump/CN.zip |
| 许可证 | **CC BY 4.0** — 允许商用，**必须署名** |
| 下载日期 | 2026-09-03（dump 文件日期 2026-09-02） |
| 抽取范围 | ADM1 31 条 + ADM2 360 条 + ADM3 2938 条，去重后 **3301** 条 |
| 字段 | `{ name, lng, lat }`，经纬度保留 4 位小数 |
| 中文名 | 取自 dump 的 `alternatenames` 列，优先带行政后缀（省/市/区/县/自治区…）的条目 |

## 署名义务（CC BY 4.0）

产品界面与 `engine/README.md` 必须保留一句 GeoNames 署名并链回 geonames.org。删掉署名即违反许可证。

## 两个使用注意

**一、地级市（ADM2）坐标是整个辖区的质心，不是市中心。**
例：杭州市 ADM2 为 119.60，而上城区 ADM3 为 120.30，差 0.56° ≈ 2.2 分钟时差（杭州辖区西达淳安）。
远小于时辰跨度 120 分钟，但录入时应引导老师**选到区县**而非只选市。

**二、GeoNames 是地名录，不是民政部行政区划主数据。**
改名、撤县设区会滞后。**取经度够用，不要当区划主数据。**

## 为什么不用别的源

见主方案 §5.2。简言之：AreaCity、cn-pcas-geo 等仓库虽挂 MIT，但坐标抓自高德，
高德条款禁止存储与生成数据库，**仓库作者无权转授**。GeoNames 是唯一确认可商用的。

## 复现

```bash
curl -sSL -o CN.zip https://download.geonames.org/export/dump/CN.zip
unzip CN.zip   # 得到 CN.txt，制表符分隔
# 列：1 geonameid 2 name 3 asciiname 4 alternatenames 5 lat 6 lng 7 class 8 code
#     11 admin1 12 admin2 13 admin3
# 抽 $8 ∈ {ADM1,ADM2,ADM3}，按 admin code 拼层级名，中文名取自 $4
```
