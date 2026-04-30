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
- Save, load, overwrite, and delete named configs.
- 支持命名配置的保存、加载、覆盖与删除。
- Auto-load non-template config on popup initialization (when available).
- 弹窗初始化时自动加载非模板配置（若存在）。
- Upload Excel and fill values into text, textarea, select, checkbox, and radio.
- 上传 Excel 并回填文本框、文本域、下拉框、复选框和单选框。

## Project Status | 当前状态

- Production-ready core flow: Identify -> Map -> Save/Load -> Upload -> Fill.
- 核心流程已可用：识别 -> 映射 -> 保存/加载 -> 上传 -> 回填。
- Popup startup binding issue has been fixed.
- 弹窗启动绑定问题已修复。
- Default mapping cells now follow A2, B2, C2 ...
- 默认映射单元格改为 A2、B2、C2 递增。
- Select/radio compatibility improved for common real-world values.
- 已增强 select/radio 的实际值兼容能力。

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

### Select

For option values like 25%, 50%, 75%, 100%, these Excel values can match:

- 50%
- 50
- 0.5
- Set to 50%

当 option 值为 25%、50%、75%、100% 时，Excel 中以下值可匹配：50%、50、0.5、Set to 50%。

### Radio

Radio matching supports value, id, name, and inferred label.

单选框支持按 value、id、name 以及推断标签匹配。

Boolean style values are also supported:

- true, yes, on, 1, checked
- false, no, off, 0, unchecked

同时支持布尔风格取值：true/yes/on/1/checked 与 false/no/off/0/unchecked。

## Config Storage | 配置存储说明

Built-in config index is defined in configs/catalog.json.

内置配置索引定义在 configs/catalog.json。

User configs are stored in extension local storage.

用户配置保存在扩展本地存储中。

MV3 note: packaged files are read-only at runtime, so user edits are not written back to packaged JSON.

MV3 说明：打包文件运行时只读，用户配置不会回写到打包 JSON。

## Roadmap | 路线图

- [ ] Add screenshot assets and GIF demo for README.
- [ ] Support custom sheet names discovered from uploaded workbook.
- [ ] Add export/import for user configs.
- [ ] Add selector resilience strategy for dynamic pages.
- [ ] Add optional validation preview before filling.
- [ ] Add automated test page and basic regression checks.

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

# Third-Party Dependencies and License Information

This project depends on the following open source packages. The licenses for these dependencies are listed below.

## List of Dependencies

- **xlsx** (Apache License 2.0)
- **adler-32** (Apache License 2.0)
- **cfb** (Apache License 2.0)
- **codepage** (Apache License 2.0)
- **crc-32** (Apache License 2.0)
- **frac** (Apache License 2.0)
- **ssf** (Apache License 2.0)
- **wmf** (Apache License 2.0)
- **word** (Apache License 2.0)

## LicenseTexts

The full text of each of the licenses for the dependencies listed above can be found in the respective module directories or from their official repositories.

### License Location

- The license for `xlsx`, `adler-32`, `cfb`, `codepage`, `crc-32`, `frac`, `ssf`,`wmf`, and `word` can be found in their respective directories inside `node_modules/` or from their official repositories:
  - **xlsx**: [GitHub Repository](https://github.com/SheetJS/sheetjs)
  - **adler-32**: [GitHub Repository](https://github.com/alexgorbatchev/node-adler-32)
  - **cfb**: [GitHub Repository](https://github.com/guyonroche/cfb.js)
  - **codepage**: [GitHub Repository](https://github.com/guyonroche/codepage)
  - **crc-32**: [GitHub Repository](https://github.com/alexgorbatchev/node-crc-32)
  - **frac**: [GitHub Repository](https://github.com/alexgorbatchev/node-frac)
  - **ssf**: [GitHub Repository](https://github.com/SheetJS/ssf)
  - **wmf**: [GitHub Repository](https://github.com/SheetJS/wmf)
  - **word**: [GitHub Repository](https://github.com/SheetJS/word)

### Acknowledgement

This project includes open-source packages that are licensed under the Apache License 2.0. Wethank the authors and contributors of these libraries for their hard work and dedication.

---

## Important Notes

As required by the Apache License 2.0, thefollowing are included in this project:

- **Notices**: Thefull license text of the dependencies can be found in the respective repositories linked above.
- **Redistribution**: Ifyou modify or redistribute this project, you must comply with the terms and conditions outlined in the Apache License 2.0for the included dependencies.
- **Patent Grant**: ApacheLicense 2.0includes a patent grant, which ensures that users are not at risk of patent litigation based on the use of these libraries.

For more information on the specific terms of the Apache License 2.0, pleaserefer to the full text of the license at [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

