# EasyPaste

[English](README.md) | **简体中文**

将 PDF、网页或图片中的内容整理为 Obsidian Markdown / LaTeX。支持基于规则的离线修改，或基于LLM的智能转换。

## 安装

要求 **Obsidian 1.11.4+**。

1. 将安装包中的 `easy-paste` 文件夹放入笔记库的 `.obsidian/plugins/`。
2. 在 Obsidian → 设置 → 第三方插件中启用 EasyPaste。
3. 若使用 LLM/OCR，在 EasyPaste 设置的「智能转换」和「图片转换」分区分别填写 Base URL、API Key 和 Model Name。离线规则不需要密钥。

## 使用

| 入口 | 操作 |
| --- | --- |
| 自动粘贴 | 已启用的内置或自定义规则使文本发生变化时将弹出预览。 |
| 编辑器右键 | 使用「离线清洗」调用离线清洗，或用「智能转换」处理文本或图片。 |
| 快捷键 / 命令面板 | 在设置 → 快捷键中搜索 `EasyPaste`，绑定「离线清洗」或「智能转换」。 |
| 智能转换 | 选中纯文本时使用文本 API；选区包含图片时使用视觉 API，同时发送选区文本。无选区时，可在窗口内粘贴文本、图片或添加图片文件，确认后插入原光标处。 |
| 图片右键 | 在文件列表中右键图片，使用「EasyPaste：智能转换」打开智能转换窗口。 |

智能转换窗口支持修改待转换文本、添加多张图片和移除添加的图片。支持选区内的 `![[image.png]]` / `![](image.png)` 图片嵌入（包括文字与多张图片混合）；HTTPS 图片链接直接交给视觉 API。

在 EasyPaste 设置的「插件语言」中可选择简体中文、英语或韩语。已打开的预览保留打开时的语言，切换不改写正文和自定义 Prompt。

## 离线规则

### 自定义规则

- 点击「新增规则」可添加自定义正则规则，填写名称、匹配表达式、替换文本和匹配标志，再开启规则。
- 表达式使用 JavaScript 正则语法，不带两侧 `/`；默认标志 `g` 表示全部替换，可搭配 `i` 忽略大小写、`m` 多行或 `s` 跨行。替换文本支持 `$1` 等捕获组，以及 `\n` 换行、`\r` 回车、`\t` 制表符；`\\` 表示字面反斜杠，留空表示删除。
- 自带两个用于google ppt的示例规则，可自行开关。

### 粘连词拆分和连词符移除

- 内置英美英语拼写词典和词频，默认自动处理，无需自行提供词表。
- `ofthe` → `of the`，`neuralnetwork` → `neural network`，`Iam` → `I am`：对未知词尝试两词拆分，支持常见短词。候选须有词典与词频依据；多个候选得分接近时不修改。自动拆分只插入空格，不改字母。
- 已知完整词（如 `another`、`therapist`）、全大写缩写、混合大小写名称、标识符及带撇号的词不自动拆分。不拆分需要三个或更多词的连续字符串。
- 「额外词表」为可选补充，保留原有配置，可加入专业术语、品牌或姓名以防拆分。
- 「精确替换表」优先于自动拆分和完整词保护，可强制指定结果。即使清空两张自定义表，内置自动处理仍可使用。

### 英美拼写转换

可以将常见词的英美拼写自动转换，默认关闭。

- 使用固定版本 ESDB 数据生成的 1,640 对明确词形，目前只转换 `or/our`、`ize/ise` 及派生形式，例如 `color/colour`、`colored/coloured`、`organize/organise`、`organization/organisation`。
- 默认先还原断词、拆分粘连词，再统一拼写；拖动规则可调整顺序。可以在白名单中添加保护词。

### 列表与缩进

将从其他软件复制的列表自动转化为obsidian接受的列表格式，并推断丢失的换行和缩进。

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

多行列表被复制成一段时，也会为确认的行中项目符号添加换行并还原层级。：

```text
简介 • infor-mation 1) First 2) Second • repre-sentation
```

转换为：

```markdown
简介
- information
    1. First
    2. Second
- representation
```

当源文本已丢失层级信息时，这种推断可能有歧义，可在预览视图内进行编辑修正。字母 `i)` 等与罗马序号存在歧义，按常见罗马形式处理。

## API 配置

使用 `POST {Base URL}/chat/completions`，也接受完整的 `/chat/completions` URL。无需安装 OpenAI SDK。

设置分为「智能转换」和「图片转换」两个独立分区，各自填写：

- **Base URL**：兼容 OpenAI Chat Completions 的服务地址；本地 `localhost` 可使用 HTTP。
- **API Key**：服务的访问密钥，保存在 **Obsidian SecretStorage**，不写入插件 `data.json`。仍应按 Obsidian 自身的密钥存储和设备安全方式管理。
- **Model Name**：服务提供的准确模型名称或 ID，分别用于文本转换和图片识别。

统一入口下的文本 API 与视觉 API 仍使用独立配置，可使用不同服务、密钥、模型和基础 Prompt，修改或清除一个分区的密钥不会影响另一个。「智能转换」分区用于纯文本，「图片转换」分区用于含图片的输入。点击各分区的「编辑 Prompt」可展开编辑基础 system prompt，修改后自动保存到插件 `data.json`，下次发送时读取最新配置。

智能转换窗口中的「临时要求」会附加在所用 API 的基础 Prompt 后，作为同一条 system 消息发送；纯文本、图片和规则预览中的「使用 LLM 智能转换」都使用此要求。临时要求自动保存，下次打开窗口或重启插件后继续保留。

图片使用标准 `image_url` content part 和 Base64 data URL；要求「图片转换」中所填模型支持此输入格式。支持 PNG、JPEG、WebP、GIF，插件限制为 10 MB，供应商可能有更严格限制。若模型不支持视觉，请在「图片转换」分区更换支持图片输入的模型和相应 API 配置。

模型提示词要求保留标题、列表、缩进、**加粗**、*斜体*、`==高亮==`、表格及公式；公式使用 `$...$` / `$$...$$`。识别正确率、文字格式和公式准确性受图片质量与模型影响。

### 数据与异步保护

- 离线规则不联网；手动 API 操作仅发送窗口中的文本、引用或添加的图片及转换指令，不发送整本笔记库。
- 使用 Obsidian `requestUrl`，避免普通浏览器 fetch 的 CORS 限制。
- 预览期间原文档变化、关闭或切换时阻止写入，保留结果以便复制。确认应用使用单次编辑替换，可撤销。
- 关闭窗口或超时停止等待，不应用迟到响应。Obsidian `requestUrl` 不提供底层请求中断，供应商可能继续执行并计费。
- 不自动重试以避免重复请求和费用；错误提示不回显密钥或完整供应商错误正文。
- 排版预览由 Obsidian MarkdownRenderer 渲染，内容中的远程图片等可能在打开该页签时加载。

开发说明、源码索引与更新记录见 [开发日志](DEVELOPMENT_LOG.md)。

## 官方接口资料

- [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api)
- [Nebius Quickstart](https://docs.tokenfactory.nebius.com/quickstart)
- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat)
- [DeepSeek API](https://api-docs.deepseek.com/)

项目代码采用 MIT License。安装包包含 `diff`、`nspell`、`is-buffer`、英语词典、词频数据和 ESDB 拼写白名单的许可及署名；词频数据来源于 SymSpell，原始来源包括 Google Books Ngrams（CC BY 3.0）和 SCOWL，详情见 `data/README.md`。
