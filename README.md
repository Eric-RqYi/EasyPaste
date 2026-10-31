# EasyPaste

**English** | [简体中文](README.zh-CN.md)

Turn content from PDFs, web pages or images into Obsidian Markdown / LaTeX with offline rules or LLM-powered smart conversion.

## Installation

Requires **Obsidian 1.11.4+**.

1. Place the `easy-paste` folder from the release package in your vault’s `.obsidian/plugins/` directory.
2. Enable EasyPaste under Obsidian → Settings → Community plugins.
3. To use LLM/OCR features, enter a Base URL, API Key and Model Name separately in the **Smart conversion** and **Image conversion** sections of EasyPaste settings. Offline rules do not require an API key.

## Usage

| Entry point | Action |
| --- | --- |
| Automatic paste | Opens a preview when enabled built-in or custom rules change the pasted text. |
| Editor context menu | Choose **Offline cleanup** to run offline rules, or **Smart conversion** to process text or images. |
| Hotkeys / command palette | Search for `EasyPaste` under Settings → Hotkeys to assign shortcuts to **Offline cleanup** or **Smart conversion**. |
| Smart conversion | Plain text uses the text API. A selection containing images uses the vision API, with the selected text sent alongside the images. With no selection, paste text or images, or add image files in the conversion window; the confirmed result is inserted at the original cursor position. |
| Image context menu | Right-click an image in the file explorer and choose **EasyPaste: Smart conversion**. |

The smart conversion window lets you edit the source text, add multiple images and remove added images. It recognizes `![[image.png]]` / `![](image.png)` image embeds in a selection, including mixed text and multiple images. HTTPS image links are passed directly to the vision API.

Choose Simplified Chinese, English or Korean under **Plugin language** in EasyPaste settings. An open preview keeps the language it used when opened. Changing the interface language does not rewrite your content or custom prompts.

## Offline rules

### Custom rules

- Click **Add rule**, enter a name, match pattern, replacement text and match flags, then enable the rule.
- Patterns use JavaScript regular expression syntax without the surrounding `/` characters. The default `g` flag replaces all matches; combine it with `i` to ignore case, `m` for multiline matching or `s` to match across line breaks. Replacement text supports capture groups such as `$1`, as well as `\n` for a line break, `\r` for a carriage return and `\t` for a tab. `\\` represents a literal backslash. Leave the replacement blank to delete matches.
- Two example rules for content copied from Google Slides are included and can be toggled individually.

### Splitting joined words and repairing hyphenation

- Built-in British and American English spelling dictionaries and word-frequency data work automatically. You do not need to provide your own word list.
- `ofthe` → `of the`, `neuralnetwork` → `neural network`, `Iam` → `I am`: unknown words are considered for splitting into two words, including common short words. Candidates need dictionary and frequency support; ambiguous candidates with similar scores are left unchanged. Automatic splitting only inserts spaces and does not change letters.
- Known whole words such as `another` and `therapist`, all-uppercase abbreviations, mixed-case names, identifiers and words containing apostrophes are not split automatically. Strings requiring three or more words are not split.
- **Additional English vocabulary** is an optional supplement. Existing entries are preserved; add technical terms, brands or names to prevent splitting.
- **Exact replacements** take precedence over automatic splitting and whole-word protection, allowing you to specify an exact result. Built-in processing still works when both custom lists are empty.

### British/American spelling conversion

Convert common British and American spellings automatically. Disabled by default.

- Uses 1,640 unambiguous word pairs generated from a fixed ESDB version. Currently covers only `or/our`, `ize/ise` and their derived forms, such as `color/colour`, `colored/coloured`, `organize/organise` and `organization/organisation`.
- By default, word-break repair and joined-word splitting run before spelling conversion. Drag rules to change their order. Add words to the allowlist to preserve them.

### Lists and indentation

Converts lists copied from other applications into a format Obsidian accepts, inferring missing line breaks and indentation.

Supports unordered markers such as `• · ● ○ ◦ ▪ ▫ ‣ ⁃ ∙ – — −`, as well as numbered, alphabetical and Roman-numeral lists. Number delimiters such as `)`, `、` and full-width periods are normalized to `.`.

```text
· Parent
wrapped content
○ Child
child content
· Next parent
```

Becomes:

```markdown
- Parent
  wrapped content
    - Child
      child content
- Next parent
```

Original indentation takes priority when determining nesting. The configured nested-list indentation, 4 spaces by default, normalizes the result. At the same original indentation, a new line-start marker is inferred as the next nesting level; a previously seen marker returns to its corresponding level. Continuation lines align with the list item’s **text start column**, including items with multi-digit numbers. A regular paragraph after a blank line ends continuation indentation.

When a multiline list is copied as a single paragraph, confirmed inline list markers are also split onto new lines and nesting is restored:

```text
Introduction • infor-mation 1) First 2) Second • repre-sentation
```

Becomes:

```markdown
Introduction
- information
    1. First
    2. Second
- representation
```

Inferring structure can be ambiguous when the source has lost its nesting information. Review and edit the result in the preview. Markers such as `i)` can represent either letters or Roman numerals; common Roman-numeral forms take precedence.

## API configuration

Uses `POST {Base URL}/chat/completions` and also accepts a complete `/chat/completions` URL. No OpenAI SDK installation is required.

The **Smart conversion** and **Image conversion** settings sections are independent. Configure each with:

- **Base URL**: the address of an OpenAI Chat Completions-compatible service. Local `localhost` services may use HTTP.
- **API Key**: the service access key, saved in **Obsidian SecretStorage**, not in the plugin’s `data.json`. Manage it according to Obsidian’s key-storage behavior and your device’s security settings.
- **Model Name**: the exact model name or ID provided by your service, for text conversion or image recognition respectively.

The unified conversion window still uses separate text and vision API configurations. Each can use a different service, key, model and base prompt. Changing or clearing one section’s key does not affect the other. **Smart conversion** handles text-only input; **Image conversion** handles input containing images. Click **Edit prompt** in either section to edit its base system prompt. Changes are saved automatically to the plugin’s `data.json` and take effect on the next request.

The **Temporary smart conversion instructions** field in the conversion window is appended to the selected API’s base prompt in the same system message. These instructions are shared by text conversion, image conversion and **Use LLM smart conversion** in the offline preview. They are saved automatically and remain available when you reopen the window or restart the plugin.

Images use standard `image_url` content parts and Base64 data URLs. The model configured under **Image conversion** must support this input format. PNG, JPEG, WebP and GIF are supported, with a plugin limit of 10 MB per image; providers may impose stricter limits. If the model does not support vision input, choose a compatible model and API configuration under **Image conversion**.

The model prompts request preservation of headings, lists, indentation, **bold**, *italic*, `==highlight==`, tables and formulas. Formulas use `$...$` / `$$...$$`. Recognition accuracy, formatting and formula quality depend on the images and the model.

### Data and asynchronous safeguards

- Offline rules do not use the network. Manual API operations send only the text, referenced or added images, and conversion instructions from the window, not the entire vault.
- Uses Obsidian’s `requestUrl` to avoid the CORS restrictions of a normal browser fetch.
- If the original note is edited, closed or switched while the preview is open, applying the result is blocked. The result remains available to copy. Applying uses a single edit that can be undone.
- Closing the window or reaching the timeout stops waiting and prevents late responses from being applied. Obsidian’s `requestUrl` cannot abort the underlying request, so the provider may continue processing and charge for it.
- Requests are not retried automatically, avoiding duplicate requests and charges. Error messages do not expose keys or full provider error bodies.
- The formatted preview uses Obsidian’s MarkdownRenderer. Remote images and similar content may load when that tab opens.

Development instructions, a source index and change records are in the [development log (Chinese)](DEVELOPMENT_LOG.md).

## Official API references

- [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api)
- [Nebius Quickstart](https://docs.tokenfactory.nebius.com/quickstart)
- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat)
- [DeepSeek API](https://api-docs.deepseek.com/)

Project code is licensed under the MIT License. The release package includes licenses and attribution for `diff`, `nspell`, `is-buffer`, the English dictionaries, word-frequency data and the ESDB spelling allowlist. Word-frequency data comes from SymSpell, with original sources including Google Books Ngrams (CC BY 3.0) and SCOWL. See [data/README.md (Chinese)](data/README.md) for details.
