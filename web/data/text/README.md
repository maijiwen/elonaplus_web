# 文本库（翻译用）

本目录是**从 `hsp/start.hsp` 机械提取**的游戏文本库：**只提取，未做任何翻译**。
`zh` 字段全部为空，供你逐条填写译文。

生成方式：`python tools/extract_text.py`（可重复执行，结果覆盖本目录）。

## 文件清单

| 文件 | 内容 |
|---|---|
| `strings.json` | **全量文本**（唯一化后 2.2 万条，约 8.8 MB），翻译主文件 |
| `index.json` | 索引：按来源分组的条目数、源码行号范围、首条预览、与其他表的重复率 |
| `parts/*.json` | 按来源（`*label_xxxx` / 函数名）切分的分片，共 41 个 + `_misc.json` |

`parts/` 与 `strings.json` 内容一致，只是分组不同：想按主题分批翻译就用 `parts/`，
想一次性批量处理就用 `strings.json`。

## 条目字段

```json
{
  "id": "s01234",          // 稳定唯一键，翻译时不要改
  "kind": "lang",          // lang = 原版有日英对照；raw = 只有日文原文
  "jp": "日文原文",         // 不要改（对照用）
  "en": "原版英文",         // 可能为空（kind=raw 时通常为空）
  "zh": "",                // ← 翻译填这里
  "count": 3,              // 该文本在原版中出现的次数
  "refs": [                // 出处（最多 8 条）：函数 / 标签 / 行号
    { "fn": "txteledmg", "label": "label_1936", "line": 197523 }
  ],
  "owner": "label_1936",   // 主要归属（用于分片）
  "concat": true           // 可选：该文本是拼接片段，见下文
}
```

## 怎么翻译

1. **只改 `zh`**，不要动 `id` / `refs` / `jp` / `en`，否则后续重新生成会对不上。
2. `en` 有内容的条目，可以拿英文做参考；`en` 为空的（`kind: "raw"`）只有日文。
3. `concat: true` 表示这行在源码里是拼接出来的，例如
   `lang("、大丈夫ですよ。", ", it's fine.")` 前面还接了角色名 —— 字面量只是片段，
   翻译时按 `refs.line` 去 `hsp/start.hsp` 对应行看完整语句。
4. `count > 1` 的条目在多处复用，译一次即可（主表已按 `jp+en` 去重）。

### 用编辑器

直接打开 `strings.json` / `parts/*.json`，搜索 `"zh": ""` 逐条填。

### 用脚本（推荐，可断点续译）

```python
import json, io
p = 'web/data/text/strings.json'
d = json.load(io.open(p, encoding='utf-8'))
todo = [e for e in d['entries'] if not e['zh']]
print('待译', len(todo))
# 把 todo 送去翻译，回填 e['zh'] 后整体写回即可
json.dump(d, io.open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
```

> 注意：`parts/*.json` 是 `strings.json` 的分组副本，改完主表后请重新运行
> `python tools/extract_text.py` 会覆盖分片 —— 因此**建议只译 `strings.json`**，
> 或者在译完后自行把 `zh` 合并回主表再禁用重新生成。

## 已提取过、不必重复翻译的文本

下面这些文本已有独立数据表（本库中仍会重复出现一部分）：

| 内容 | 数据表 |
|---|---|
| 物品名 / 物品说明 | `web/data/tables/items.json`（`nameJp` / `nameEn` / `desc`） |
| 怪物名 | `web/data/tables/creature.json`（`nameJp` / `nameEn`） |
| 技能名 | `web/data/tables/skills.json`（`skillNames`） |
| 特性（feat）名 | `web/data/tables/feats.json`（`name`） |

`index.json` 里 `byOwner[*].overlap` 会标出「该分片有多少比例已存在于其他表」，例如：

```json
"label_4269": { "count": 3560, "overlap": { "table": "creature.json", "ratio": 0.32 } }
```

表示该分片 32% 的文本就是怪物名，可以跳过；剩余部分仍需翻译。

## 已知限制（提取层面，不是翻译问题）

| 项 | 说明 |
|---|---|
| 变量拼接 | 形如 `角色名 + lang("…")` 的句子，只能提取到字面量片段（标 `concat: true`） |
| 动态生成 | 完全由代码拼出的文本（无字面量）无法静态提取 |
| 技术字符串 | 资源路径、键名、`"sc"` 这类短标识已被过滤（共跳过 879 处） |
| 转义 | HSP 的 `\n` 已转成真实换行；`\"` 已转成 `"` |
| 空原文 | 极少数条目 `jp` 为空、只有 `en`（如 `Recipe of `），属原版如此 |

## 重新生成

```bash
python tools/extract_text.py          # 重新提取并覆盖本目录
python tools/verify_text.py            # 校验结构与统计一致性
```
