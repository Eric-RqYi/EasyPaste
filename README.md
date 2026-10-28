# EasyPaste

将 PDF、网页或图片中的内容整理为 Obsidian Markdown / LaTeX。所有修改先预览、确认后写入；自动粘贴仅运行离线规则。

## 安装

要求 **Obsidian 1.11.4+**。

1. 将安装包中的 `easy-paste` 文件夹放入笔记库的 `.obsidian/plugins/`。
2. 确认 `.obsidian/plugins/easy-paste/` 下直接包含 `main.js`、`manifest.json`、`styles.css`。
3. 在 Obsidian → 设置 → 第三方插件中启用 EasyPaste。
4. 若使用 LLM/OCR，在 EasyPaste 设置中配置供应商、API Key 和模型 ID。离线规则不需要密钥。

## 使用

| 入口 | 操作 |
| --- | --- |
| 自动粘贴 | 检测到规则可修复的文本时弹出预览；点击「确认应用」粘贴转换结果，或「粘贴原文」。取消或 Esc 不插入内容。 |
| 编辑器右键 | 选中文本后使用「本地规则清洗」或「用 LLM 转换」；OCR 可在当前光标处插入。 |
| 快捷键 / 命令面板 | 在设置 → 快捷键中搜索 `EasyPaste`，绑定三个命令。插件默认不占用按键；插件设置可关闭这些命令。 |
| 图片 OCR | 运行图片命令后，在弹窗中粘贴图片或选择文件，再点击「发送并转换」。也可选中本地 `![[image.png]]` / `![](image.png)` 嵌入，或在文件列表中右键图片。 |

预览包含「改动对比」「编辑结果」「排版预览」。绿色下划线表示新增，红色删除线表示删除，包括空格与缩进变化；图片转写的全部文字视为新增。可直接修改结果，再确认写入。排版预览在手动打开时渲染 Markdown 和公式。

### 自动预览的明确触发条件

自动粘贴预览默认开启，同时满足以下条件才拦截粘贴：

- 事件尚未被其他插件处理，编辑器中没有未完成的 EasyPaste 弹窗。
- 剪贴板有纯文本，且不含图片或文件；图片保持 Obsidian 原生粘贴行为。
- 文本未超过自动处理字符上限（默认 30,000，可设置）。
- 光标不位于代码块、行内代码、YAML 或可识别的公式上下文。
- 启用的规则实际产生了修改，例如 `·` 列表、`1)` 序号、词表确认的断词或粘连词。普通无变化内容不弹窗。

自动入口不会调用 LLM/OCR，也不会读取系统剪贴板图片。手动 API 转换在显示供应商、地址、模型与原文/图片后，用户点击「发送并转换」才发出请求。

## 离线规则

### 英文单词

- `infor-\nmation` → `information`：仅在合并后的词属于词表时删除跨行连字符。
- `infor-mation` → `information`：词表确认后删除误插入的连字符；两边都是完整词时保留。
- 软连字符 U+00AD 与其后的换行可直接还原。
- `ofthe` → `of the`：按可编辑的精确替换表处理。
- `neuralnetwork` → `neural network`：未知词具有唯一的两词拆分且每词至少三个字母时拆分；已经属于词表的词不拆分。
- 默认附带一小组语言/机器学习常用词。专业术语可直接追加到词表，歧义大或没有词表依据的内容可手动交给 LLM。离线规则无法可靠还原任意未知粘连词。

普通段落硬换行合并默认关闭，可在设置开启。代码、链接、YAML、已有 LaTeX 等语法会尽量保护；复杂 HTML、异常 Markdown 和缩进代码的识别并非完整语法解析，应用前应检查预览。

### 列表与缩进

支持 `• · ● ○ ◦ ▪ ▫ ‣ ⁃ ∙ – — −` 等无序列表，以及数字、字母、罗马序号。数字中的 `)`、`、`、全角点等转换为 `.`。

```text
· Parent
wrapped content
○ Child
child content
· Next parent
```

转换为：

```markdown
- Parent
  wrapped content
    - Child
      child content
- Next parent
```

优先保留原始缩进层级，并使用设置的子列表缩进（默认 4 空格）规范化。原始缩进相同时，新的行头符号推断为下一级；之前的符号再次出现时回到对应层级。续行与该列表项的**正文起始列**对齐，包括多位序号。空行后的普通段落结束续行缩进。

当源文本已丢失层级信息时，这种推断可能有歧义；可在预览的「编辑结果」中修正。字母 `i)` 等与罗马序号存在歧义，按常见罗马形式处理。

## API 配置

使用 `POST {Base URL}/chat/completions`，也接受完整的 `/chat/completions` URL。无需安装 OpenAI SDK。

| 预设 | Base URL | 配置说明 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | 填入账户可用的文本 / 视觉模型 ID |
| Nebius Token Factory | `https://api.tokenfactory.nebius.com/v1` | 填入 Nebius 控制台的准确模型 ID（通常包含组织前缀） |
| DeepSeek | `https://api.deepseek.com` | 文本与视觉能力以账户模型实际支持情况为准 |
| 自定义 | 用户输入 | 兼容 OpenAI Chat Completions 的服务；本地 `localhost` 可使用 HTTP |

文本转换和图片识别可以分别选择供应商与模型。预设不内置容易过期的模型 ID。密钥保存在 **Obsidian SecretStorage**，不写入插件 `data.json`。仍应按 Obsidian 自身的密钥存储和设备安全方式管理。

图片使用标准 `image_url` content part 和 Base64 data URL；要求所选模型支持此输入格式。支持 PNG、JPEG、WebP、GIF，插件限制为 10 MB，供应商可能有更严格限制。若模型不支持视觉，请为 OCR 选择其他供应商。

模型提示词要求保留标题、列表、缩进、**加粗**、*斜体*、`==高亮==`、表格及公式；公式使用 `$...$` / `$$...$$`。识别正确率、文字格式和公式准确性受图片质量与模型影响，不保证逐像素还原。无法辨认的部分要求模型标为 `[无法辨认]`。

请求不设置强制温度或供应商特有参数，避免兼容性问题。不执行模型返回的工具调用或原文中的指令；API 返回文本原样保留，避免误删原有代码围栏。

### 数据与异步保护

- 离线规则不联网；手动 API 操作仅发送所选文本或所选图片及转换指令，不发送整本笔记库。
- 使用 Obsidian `requestUrl`，避免普通浏览器 fetch 的 CORS 限制。
- 预览期间原文档变化、关闭或切换时阻止写入，保留结果以便复制。确认应用使用单次编辑替换，可撤销。
- 关闭窗口或超时停止等待，不再应用迟到响应。Obsidian `requestUrl` 不提供底层请求中断，供应商可能继续执行并计费。
- 不自动重试以避免重复请求和费用；错误提示不回显密钥或完整供应商错误正文。
- 排版预览由 Obsidian MarkdownRenderer 渲染，内容中的远程图片等可能在打开该页签时加载。

## 本地开发

需要 Node.js 22+：

```sh
npm ci
npm run check
npm run dev
```

`npm run build` 执行 TypeScript 检查并打包 `main.js`。`npm run release` 先测试与构建，再生成 `dist/easy-paste/`，可直接复制到笔记库。

源代码：

- `src/rules.ts`：纯函数规则与 Markdown 语法保护。
- `src/api.ts`：可注入传输层的 OpenAI 兼容接口、取消与超时。
- `src/preview.ts`：差异高亮、结果编辑、排版预览和图片输入。
- `src/target.ts`：异步编辑目标保护。
- `src/main.ts`：Obsidian 事件与命令接入。
- `src/settings-tab.ts`：开关、规则表、供应商与密钥设置。

测试使用 Node test runner，API 请求全部使用 mock，不需要密钥。覆盖规则、请求格式、错误处理和异步写入保护，不代表已验证所有真实供应商或移动设备。

## 官方接口资料

- [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api)
- [Nebius Quickstart](https://docs.tokenfactory.nebius.com/quickstart)
- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat)
- [DeepSeek API](https://api-docs.deepseek.com/)

MIT License。使用的 `diff` 库同样采用 BSD 许可证，安装包内含其许可证。
