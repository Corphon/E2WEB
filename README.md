# E2Web

[![Edge MV3](https://img.shields.io/badge/Edge-MV3-0078D7?logo=microsoftedge&logoColor=white)](https://learn.microsoft.com/microsoft-edge/extensions-chromium/)
[![JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E?logo=javascript&logoColor=000)](https://developer.mozilla.org/docs/Web/JavaScript)
[![SheetJS](https://img.shields.io/badge/Excel-SheetJS-2EA44F)](https://sheetjs.com/)
[![License: ISC](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Web form automation extension for Microsoft Edge (MV3).

用于 Microsoft Edge (MV3) 的网页表单自动化扩展。

## Overview | 项目简介

E2Web identifies fillable fields on the current page, maps page fields to Excel cells, and writes spreadsheet data back to the page.

E2Web 可以识别当前页面可填字段，将页面字段映射到 Excel 单元格，并把表格数据回填到页面中。


## Features | 核心功能

- Identify fillable controls and overlay ordered index labels.
- 识别可填控件并在页面显示顺序编号。
- Edit mapping in popup: Index -> Sheet -> Cell.
- 在弹窗中编辑映射：Index -> Sheet -> Cell。
- - Ignore detected fields without removing them, and preserve ignored status across refresh/re-identify.
- 在映射表中忽略识别字段而不删除，忽略状态在页面刷新和重新识别后保留。
- Save, load, overwrite, and delete named configs.
- 支持命名配置的保存、加载、覆盖与删除。
- Auto-load non-template config on popup initialization (when available).
- 弹窗初始化时自动加载非模板配置（若存在）。
- Upload Excel and fill values into text, textarea, select, checkbox, and radio.
- 上传 Excel 并回填文本框、文本域、下拉框、复选框和单选框。

## Project Status | 当前状态

- Phrase 2 completed: 20+ defects fixed across React/Vue compatibility, Shadow DOM, iframe support, label inference, selector stability, and more.
- Phrase 2 完成：修复 React/Vue 兼容性、Shadow DOM 支持、iframe 支持、标签推断、选择器稳定性等 20+ 缺陷。
- Core flow: Identify -> Map -> Save/Load -> Upload -> Fill.
- 核心流程已可用：识别 -> 映射 -> 保存/加载 -> 上传 -> 回填。

## Tech Stack | 技术栈

- Microsoft Edge Extension (Manifest V3)
- JavaScript
- SheetJS (bundled local xlsx.js)

## Project Structure | 目录结构

- manifest.json: extension manifest and permissions
- popup.html: popup UI
- popup.js: popup workflow and config management
- content.js: field identification and page filling
- background.js: service worker
- configs/catalog.json: built-in config index
- configs/default/template-empty.json: empty template config

## Installation | 安装与调试

1. Open Edge and navigate to edge://extensions.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select this repository folder.
5. Pin the extension and open it on a normal http/https page.

1. 打开 Edge，进入 edge://extensions。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择本仓库目录。
5. 固定扩展图标，并在普通 http/https 页面使用。

## Quick Start | 快速开始

1. Click Identify Form.
2. Review and adjust Field Mapping.
3. Optionally save as a named config.
4. Upload Excel and fill the form.

1. 点击 Identify Form。
2. 检查并调整 Field Mapping。
3. 可选：保存为命名配置。
4. 上传 Excel 并回填表单。

## Mapping Defaults | 默认映射规则

Newly identified fields map by columns on row 2:

- Index 1 -> A2
- Index 2 -> B2
- Index 3 -> C2
- ...

新识别字段默认按第 2 行递增列映射：A2、B2、C2、...

## Input Compatibility | 输入兼容说明

### React / Vue Compatibility

Values are set using native property setters (bypassing framework overrides) and a full event chain (focus → keydown → keyup → input → change → blur) is dispatched to trigger React/Vue state updates.

填值使用原生 setter（绕过框架覆写）并触发完整事件链（focus → keydown → keyup → input → change → blur）以驱动 React/Vue 状态更新。

### Shadow DOM

Open shadow roots are recursively traversed during field identification. Elements inside shadow DOM are tagged with `data-e2web-idx` attributes for stable selector resolution.

识别阶段递归遍历所有 open shadow root，Shadow DOM 内元素通过 `data-e2web-idx` 属性稳定定位。

### iframe

Same-origin iframes are supported for both identification and filling. Cross-origin iframes are skipped due to browser security restrictions.

支持同源 iframe 的识别和填充，跨域 iframe 因浏览器安全限制自动跳过。

### Select

Percentage conversion (e.g., Excel value `0.5` → `50%`) only activates when the select element contains percentage-style options, preventing false matches on non-percentage dropdowns.

百分比转换（如 Excel 值 `0.5` → `50%`）仅在下拉框选项含百分比时触发，避免非百分比下拉误匹配。

Fuzzy text matching picks the shortest matching option to reduce ambiguity.

模糊文本匹配选取最短选项以减少歧义。

### Radio

Radio matching prioritizes text/label matching before boolean keyword fallback, preventing conflicts when a radio's display text happens to be "Yes" or "True".

单选框匹配优先文本/标签匹配，再回退到布尔关键词，避免显示文本恰好为 "Yes"/"True" 时的冲突。

Boolean style values are also supported:

- true, yes, on, 1, checked
- false, no, off, 0, unchecked

同时支持布尔风格取值：true/yes/on/1/checked 与 false/no/off/0/unchecked。

## Config Storage | 配置存储说明

Built-in config index is defined in configs/catalog.json.

内置配置索引定义在 configs/catalog.json。

User configs are stored in extension local storage.

用户配置保存在扩展本地存储中。

Project matching supports wildcard hostnames (e.g., `*.example.com`) and URL-encoded path prefixes.

项目匹配支持通配符主机名（如 `*.example.com`）和 URL 编码的路径前缀。

MV3 note: packaged files are read-only at runtime, so user edits are not written back to packaged JSON.

MV3 说明：打包文件运行时只读，用户配置不会回写到打包 JSON。

## Field Label Inference | 标签推断

Labels are inferred in the following priority order:

标签按以下优先级推断：

1. `aria-label` attribute
2. `aria-labelledby` reference
3. `placeholder` attribute
4. `<label for="id">` element
5. Nested `<label>` wrapping the input
6. `title` attribute
7. `name` attribute
8. Fallback: `"<tag> field"`

## Badge Overlay | 编号标记

Numbered badges automatically reposition on page scroll, window resize, and DOM mutations (via MutationObserver with 150ms debounce).

编号标记在页面滚动、窗口缩放和 DOM 变化时自动重新定位（MutationObserver，150ms debounce）。

## Roadmap | 路线图

- [ ] Add screenshot assets and GIF demo for README.
- [ ] Add export/import for user configs.
- [ ] Add optional validation preview before filling.
- [ ] Add automated test page and basic regression checks.
- [ ] Support closed shadow roots (requires page-specific adapters).
- [ ] Multi-level iframe coordinate resolution.

## Contributing | 参与贡献

Contributions are welcome.

欢迎贡献改进。

1. Fork the repository.
2. Create a feature branch.
3. Commit with clear messages.
4. Open a Pull Request with before/after notes.

1. Fork 仓库。
2. 新建功能分支。
3. 提交清晰的 commit 信息。
4. 发起 Pull Request，并说明改动前后行为。

### Suggested PR Checklist | 建议 PR 检查项

- [ ] Verify popup workflow manually on a normal http/https page.
- [ ] Confirm identify/fill behavior on select and radio cases.
- [ ] Keep README and process record synchronized.
- [ ] Avoid editing vendor bundle internals unless necessary.

## License

MIT
