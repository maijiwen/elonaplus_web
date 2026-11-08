# 剧情剧本数据（scene）

由 `tools/extract_scene.py` 从 `hsp/scene1.hsp` / `hsp/scene2.hsp` 机械提取，**只提取不翻译**。

## 文件

| 文件 | 内容 |
|---|---|
| `scene1.json` | 日文剧本：89 个区块、1962 条指令、1745 行文本（其中台词 1187 行） |
| `scene2.json` | 英文剧本：**只有区块 0**（原版英文版仅翻译了开场，其余区块在英文模式下直接结束） |
| `strings.json` | 场景译文表：1691 条，`zh` 已全部填写（运行时只读 `zh`），改这里即可 |
| `index.json` | 区块清单（行号 / 指令数 / 首句预览）与统计 |
| `triggers.json` | **剧情触发规则**：89 条「条件 → 区块 → 新状态」，条件为 AST（`tools/extract_story_triggers.py`） |

## 剧本格式（标签语义来自 start.hsp 591627-592112 的播放器）

```
{12}                       ← 区块开始（区块号 = 源码 var_1877）
{actor_1}	"ザナンの皇子『サイモア』,54"
{actor_1}                  ← 第 1 号角色说下面这行
…そして深い悲しみが 私を襲う。
{txt}                      ← 旁白（其后多行直到下一个标签）
ヴェルニースに入ろうとしたあなたを
{pic}	"bg1"              ← 背景图上 graphic/bg1.bmp
{mc}	"mcTown1"          ← 音乐
{se}	"bg_town.wav"      ← 音效
{fade} {fadein} {wait} {end}
```

`scene1.json` 里每个区块是：

```json
"12": {
  "id": 12,
  "line": 1204,
  "actors": { "1": { "name": "…", "pic": "54" } },
  "commands": [
    { "op": "mc",  "arg": "mcTown1", "line": 1205 },
    { "op": "pic", "arg": "bg1", "line": 1206 },
    { "op": "say", "speaker": 1, "lines": ["…"], "line": 1208 },
    { "op": "txt", "lines": ["…", ""], "line": 1215 }
  ]
}
```

- `op`：`pic` / `mc` / `se` / `fade` / `fadein` / `wait` / `end` / `txt`（旁白）/ `say`（台词）
- `say.speaker`：角色编号，名字查同区块的 `actors`
- `lines` 里的空字符串是**排版用的段落间隔**，不翻译

## 翻译做法

只改 `strings.json` 的 `zh` 字段（`web/js/core/scene.js` 只读 `zh`，`jp` 仅作原文对照）：

```json
"sc1_12_2_0": {
  "jp": "…そして深い悲しみが 私を襲う。",
  "zh": "",                       ← 填这里
  "block": 12,                    ← 属于哪个区块（scene1.json 的 blocks["12"]）
  "kind": "say",                  ← say=台词 / txt=旁白
  "speaker": 1,                   ← 说话人编号（0 = 旁白）
  "line": 1208                    ← 在 hsp/scene1.hsp 的行号
}
```

键名规则：`sc1_<区块>_<指令序>_<行序>`，与 `web/js/core/scene.js` 的 `Scene.textKey()` 完全一致。

- 填了 `zh` 就显示译文，留空就显示日文原文（`Scene.text()` 的兜底）
- **重跑 `tools/extract_scene.py` 会保留已填的 `zh`**（按键名合并）；只有区块结构变化导致键消失时才会提示
- 台词里的说话人名（`actors[].name`）不在译文表里，需要直接改 `scene1.json`——但重跑会被覆盖，
  所以建议先不要改，等确认剧本结构稳定后再处理

## 已知限制

- 原版 `scene2.hsp` 不是 `scene1.hsp` 的逐块译本，因此 `strings.json` 没有 `en` 字段
- `{actor_N}` 的第二个字段是头像编号，`web/assets/graphic/` 里没有对应素材，界面只显示名字
- `{mc}` 的音乐是 MIDI，浏览器无法播放，改为语义相近的环境音（见 `docs/02-diff-report.md`）
