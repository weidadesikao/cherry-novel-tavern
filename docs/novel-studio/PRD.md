# Cherry Novel Tavern｜AI 小说创作与酒馆兼容工作台

> 项目定位和当前代码基线见 [PROJECT.md](./PROJECT.md)。本文件保留较早的需求与架构细节，作为实现参考。

> 版本：v0.1（需求与架构设计）
> 日期：2026-06-13
> 状态：已与需求方就三个关键决策达成共识，进入设计阶段

---

## 1. 项目概述

在 Cherry Studio（Electron + React 的 AI 客户端）基础上**新增**一套面向小说写作的工具与流程，核心能力对标 SillyTavern（下称 ST）的提示词工程体系，但以原生方式实现。

### 1.1 不可违背的原则

1. **Cherry Studio 原有功能全部保持不变**：助手对话、多 Provider、多模型对比回答、消息编辑、知识库（嵌入+重排序）、提示词查看与编辑等，一律不动。本项目只做"加法"。
2. **新功能以独立模块形式接入**：新增侧边栏入口与页面路由，不侵入既有页面。
3. **ST 兼容采用「原生兼容引擎」方案**（已确认）：用 TypeScript 在 Cherry Studio 内部重新实现 ST 的提示词组装逻辑（预设 prompts + prompt_order 解析、世界书关键词触发与注入、`{{char}}`/`{{user}}` 等宏替换），不嵌入 ST 本体代码。
4. **数据存储复用现有数据层**（已确认）：新增数据走 SQLite + Drizzle（DataApi 体系），新增自己的表；不另建独立文件夹存储体系。
5. **角色卡、世界书、预设全部使用 ST 标准 JSON 格式导入导出，不做 PNG 嵌入解析。**

### 1.2 实体卡双轨制（已确认）

- **外部表**：用户导入的 ST JSON 文件（预设/角色卡/世界书）原样保留，**永不改动**。
- **内部表**：导入时解析为 SQLite 内部数据。写作过程中 AI 自动根据剧情填充/更新内部表；用户点击"更新角色卡"时也更新内部表。
- 仅当用户主动**导出**时，才由内部表生成新的 ST 标准 JSON 文件。

---

## 2. ST 兼容引擎（核心底层）

### 2.1 ST 预设格式（已从样本 JSON 确认的结构）

顶层字段分三类：

| 类别 | 字段示例 | 处理方式 |
|---|---|---|
| 采样参数 | `temperature`、`top_p`、`frequency_penalty`、`openai_max_tokens` 等 | 映射到 Cherry Studio 现有的模型参数设置 |
| 提示词条目 | `prompts[]`：每条含 `name`、`role`、`content`、`identifier`、`system_prompt`、`injection_position`、`injection_depth`、`injection_order`、`injection_trigger`、`forbid_overrides` | 引擎核心：按规则组装进最终消息序列 |
| 排序与开关 | `prompt_order[]`：按 `character_id` 分组的 `{identifier, enabled}` 有序列表 | 决定哪些条目启用、以什么顺序拼接 |
| 行为开关 | `wi_format`、`squash_system_messages`、`continue_prefill`、`continue_nudge_prompt` 等 | 按需实现，第一期支持最常用子集 |

### 2.2 引擎职责

1. **预设解析**：校验并导入 ST 预设 JSON → 内部表。
2. **提示词组装管线**：组装顺序遵循 `prompt_order`；支持相对位置（按顺序拼接）与绝对注入（`injection_position=1` 时按 `injection_depth` 插入到聊天历史的指定深度）。
3. **占位符条目**：ST 的 marker 条目（如 `charDescription`、`worldInfoBefore`、`chatHistory`、`personaDescription` 等 identifier）在组装时替换为对应实体内容——这正是"双轨制内部表自动填充"的接入点：角色卡/世界书内部表的内容在运行时填进这些槽位。
4. **世界书（World Info）触发**：扫描最近 N 条消息中的关键词（`keys`/`secondary_keys`），命中则按 `position`/`depth`/`order` 注入条目内容；支持 `constant`（常驻）与 `selective` 逻辑。
5. **宏替换**：`{{char}}`、`{{user}}`、`{{description}}`、`{{scenario}}`、`{{persona}}` 等常用宏；第一期实现高频子集，留扩展点。
6. **JSON Schema 校验**：用 zod 为预设/角色卡（Character Card v2/v3 spec）/世界书定义 schema，导入时校验并给出友好错误。

### 2.3 代码位置

- 引擎为纯函数库，放 `packages/`（如 `packages/st-compat/`）或 `src/shared/`，主进程与渲染进程均可调用，便于单元测试。

---

## 3. 书架系统

### 3.1 数据模型（SQLite 新表，Drizzle schema）

```
novels          作品（书）：标题、简介、创作模式、风格档案、关联预设/世界书
volumes         分卷
chapters        章节：正文、大纲、状态（草稿/完成）、字数
entities        实体卡：类型（角色/地点/道具/组织/其他）、ST 标准字段(JSON 列)、自由字段
entity_relations 实体关系：from/to、关系类型、描述（驱动关系图谱可视化）
worldbooks      世界书：名称、来源（导入/内建）
worldbook_entries 世界书条目：keys、content、position、depth、constant、enabled…
st_presets      ST 预设：原始 JSON（外部表快照）+ 解析后的内部结构
timeline_events 时间轴事件（StoryEvent）：章节关联、涉及实体
```

实体卡的 ST 标准字段与 Character Card spec 对齐（name、description、personality、scenario、first_mes、mes_example 等），保证导出即标准格式。

### 3.2 功能

- 书架页：作品列表、新建（见 §4 创建流程）、导入导出。
- 作品内三栏工作台（参考示例图 QQ_1781288885284）：左侧章节/实体导航，中部编辑器，右侧信息面板 + AI 对话。
- 实体卡详情页（参考 QQ_1781288929557）：人物档案、性格、外貌、背景、状态变化、当前关系各分区；支持手动编辑与"AI 更新"按钮（按已写正文让 AI 刷新该卡）。
- **关系图谱可视化**：基于 `entity_relations` 渲染力导向图（候选库：`@xyflow/react` 或 `d3-force`，按 Tailwind/Shadcn 体系选型）。
- 外部 txt/docx 小说导入 → AI 提取人物档案、世界观词条、组织派系、章节拆分、StoryEvent、反推大纲、时间轴、人物关系（参考 QQ_1781288808811 的九类产出），逐项可编辑后确认写入。

---

## 4. 写作流程

### 4.1 创建作品的四种入口（参考 QQ_1781287715143）

1. **结构化创作**：雪花法引导（灵感 → 方案 → 分卷 → 导入），AI 从一句话灵感生成可选方案（参考 QQ_1781287745789，支持指定方案数）。
2. **旧稿重塑**：上传旧稿 txt/docx → 选择导入模式（续写索引/交风骨架/素材库等档位，参考 QQ_1781287806130）→ AI 按"事实粒度 profile"（短篇/中篇连载/长篇）分析 → 产出九类结构化结果 → 确认写入 → 续写。
3. **自由创作**：直接进入空白工作台。
4. **JSON 导入**：导入此前导出的作品 JSON 备份。

### 4.2 写作与讨论

- 写作台右侧 AI 对话区：可先提出设定与 AI 讨论，再进入写作；或丢给 AI 一篇小说，讨论总结构思后续写。
- **完全复用** Cherry Studio 现有的对话能力：多 Provider 多模型多次回答择优、消息编辑、重新生成。写作产出（章节正文）支持一键"采纳到编辑器"。
- 提示词全程透明：用户可查看当前组装后的完整提示词（含预设条目、世界书命中项、实体卡注入、知识库片段），可改可加。
- **角色扮演模式**：在讨论/写作会话中，通过页面（类似 ST 网页）选择角色卡 + 世界书 + 预设，组装系统提示词后与所选大模型进行角色扮演。

---

## 5. 知识库扩展：参考模式（已确认方案）

在现有 RAG 架构（嵌入 + 重排序模型均保留）上，给"知识库引用"增加**参考模式**属性：

| 模式 | 注入模板语义 |
|---|---|
| 设定事实（默认，即现状） | "以下是相关设定资料，作为事实依据" |
| 风格借鉴 | "参考以下文段的叙事风格、节奏与氛围，但不要复制内容" |
| 语句仿写 | "模仿以下文段的句式与用词习惯进行书写" |

- 检索管线不变（嵌入召回 → 重排序），仅按模式套用不同注入模板。
- 网络搜索作为可选补充开关，与知识库结果并列注入。
- 后续可迭代：导入小说时预生成"风格档案"（视角/句式/用词偏好摘要），效果不足时再加。

---

## 6. UI 规划

- 遵循仓库规范：**Tailwind CSS + Shadcn UI（`@cherrystudio/ui`）**，禁止 antd/HeroUI/styled-components；所有文案走 i18next；样式遵循 DESIGN.md。
- 新增侧边栏一级入口"小说创作"（书架），路由独立（TanStack Router，`routeTree` 新增分支）。
- 页面清单（均参考 QQ 示例图，原有页面不动）：
  1. 书架列表页
  2. 创建作品对话框（四入口）
  3. 结构化创作向导（4 步流程条）
  4. 旧稿重塑向导（3 步流程条）
  5. 写作工作台（三栏）
  6. 实体卡详情页 + 关系图谱页
  7. ST 资产管理页（预设/世界书/角色卡的导入导出与编辑）
  8. 角色扮演会话页

---

## 7. 技术架构对照

| 需求 | 复用 Cherry Studio | 新增 |
|---|---|---|
| 多 Provider LLM 调用 | ✅ 现有 aiCore/provider 体系 | — |
| 嵌入/重排序 | ✅ 现有知识库管线 | 参考模式属性 + 注入模板 |
| 数据存储 | ✅ SQLite + Drizzle + DataApi | 新增 §3.1 各表 |
| 文件读取（txt/docx） | ✅ 现有文件解析能力（确认 docx 支持，缺则补） | 旧稿分析管线 |
| 提示词查看/编辑 | ✅ 现有功能 | 组装结果可视化面板 |
| ST 兼容 | — | st-compat 引擎（§2） |
| 关系图谱 | — | 图可视化组件 |

主进程新服务遵循 lifecycle 体系（`BaseService` + `@Injectable` + 注册 serviceRegistry）；写入走 `withWriteTx`；遵循 DataApi 边界规则。

---

## 8. 验证环境

- 测试 Provider：硅基流动（SiliconFlow，OpenAI 兼容端点）
  - 对话模型：`deepseek-ai/DeepSeek-V4-Flash`
  - 嵌入模型：`Qwen/Qwen3-Embedding-8B`
- API Key 存放于本地 `.env`（已被 .gitignore 忽略），**绝不写入代码、文档或提交记录**。

---

## 9. 里程碑

| 阶段 | 内容 | 验证标准 |
|---|---|---|
| M1 基础设施 | 新表 schema + DataApi 端点 + 侧边栏入口 + 书架空页面 | 建库迁移通过，页面可达，`pnpm build:check` 通过 |
| M2 ST 引擎 | st-compat：预设/角色卡/世界书解析、宏替换、组装管线、世界书触发；单元测试覆盖 | 样本预设导入后组装出的消息序列与 ST 行为一致（用例对照） |
| M3 书架与实体卡 | 作品/章节 CRUD、实体卡 CRUD、双轨制导入导出、关系图谱 | 导入 ST 角色卡→编辑→导出，JSON 与标准 spec 校验通过 |
| M4 写作流程 | 三栏工作台、自由创作、AI 对话集成、提示词可视化、角色扮演页 | 端到端：选预设+角色卡+世界书完成一次角色扮演与一章写作 |
| M5 引导流程 | 结构化创作向导、旧稿重塑向导（txt/docx 分析九类产出） | 导入一篇真实旧稿，产出可编辑并确认入库后成功续写 |
| M6 知识库参考模式 | 参考模式属性 + 注入模板 + 网络搜索并联 | 同一知识库三种模式下注入提示词差异可见，写作效果可对比 |

每阶段完成须通过 `pnpm lint`、`pnpm test`、`pnpm format`，新功能必须带测试。

---

## 10. 风险与开放问题

1. ST 宏与行为开关数量庞大，第一期只实现高频子集——需在导入时对**不支持的字段给出明确提示**，而非静默忽略。
2. 世界书递归扫描（条目内容再触发其他条目）第一期不做，留开关。
3. docx 解析需确认现有依赖是否覆盖，不足则引入 `mammoth` 等库（遵循 library-first 原则）。
4. 关系图谱选型需在 M3 前确定（评估 `@xyflow/react` 与 `d3-force` 的包体与 Shadcn 兼容性）。
