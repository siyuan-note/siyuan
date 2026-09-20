# 文档索引与写作约定

[English](README.md)

## 文档索引

| 文档 | English | 中文 |
|---|---|---|
| 内核接口类型契约 | [API-CONTRACTS.md](API-CONTRACTS.md) | [API-CONTRACTS.zh-CN.md](API-CONTRACTS.zh-CN.md) |
| 主题和图标同步 | [APPEARANCE-SYNC.md](APPEARANCE-SYNC.md) | [APPEARANCE-SYNC.zh-CN.md](APPEARANCE-SYNC.zh-CN.md) |
| 资源文件按需下载 | [ASSET-DOWNLOAD.md](ASSET-DOWNLOAD.md) | [ASSET-DOWNLOAD.zh-CN.md](ASSET-DOWNLOAD.zh-CN.md) |
| 加密笔记本 | [ENCRYPTED-NOTEBOOK.md](ENCRYPTED-NOTEBOOK.md) | [ENCRYPTED-NOTEBOOK.zh-CN.md](ENCRYPTED-NOTEBOOK.zh-CN.md) |
| 文档树面板置顶区 | [PINNED-DOCUMENTS.md](PINNED-DOCUMENTS.md) | [PINNED-DOCUMENTS.zh-CN.md](PINNED-DOCUMENTS.zh-CN.md) |
| 页签块 | [TAB-BLOCK.md](TAB-BLOCK.md) | [TAB-BLOCK.zh-CN.md](TAB-BLOCK.zh-CN.md) |
| 模板管理 | [TEMPLATE-MANAGER.md](TEMPLATE-MANAGER.md) | [TEMPLATE-MANAGER.zh-CN.md](TEMPLATE-MANAGER.zh-CN.md) |
| `.sy` 文件结构 | [SY-FORMAT.md](SY-FORMAT.md) | [SY-FORMAT.zh-CN.md](SY-FORMAT.zh-CN.md) |
| 工作区文件布局 | [WORKSPACE.md](WORKSPACE.md) | [WORKSPACE.zh-CN.md](WORKSPACE.zh-CN.md) |

公开 API 文档保留现有语言版本：[English](API.md)、[中文](API.zh-CN.md)、[日本語](API.ja.md)。

## 双语约定

除公开 API 文档外，文档以英文 `NAME.md` 和简体中文 `NAME.zh-CN.md` 成对维护，并在标题下提供另一语言的相对链接。两版使用对应的章节顺序，接口、路径、字段、兼容要求和验证范围保持一致。修改功能语义时同时更新两版，不以简写摘要替代完整译文。

## 功能设计文档结构

主题和图标同步、资源按需下载、加密笔记本、文档置顶、页签块和模板管理使用以下二级章节，专题细节置于对应章节的三级标题下。

| 章节 | 内容 |
|---|---|
| 功能范围 | 功能目的、适用平台、前提条件和不支持的范围 |
| 用户交互 | 入口、操作结果、状态变化和用户可见的失败行为 |
| 数据与存储 | 数据模型、持久化位置、标识、同步范围和本地状态 |
| 实现与接口 | 实现规则、关键调用入口、权限、并发及接口行为 |
| 兼容与恢复 | 已有数据支持、版本规则、失败保留、中断恢复和安全边界 |
| 验证范围 | 正常、异常、并发、跨端和旧数据场景的检查要求 |

接口契约维护、文件格式和工作区布局属于维护规范或参考手册，因此按主题组织章节，不套用功能设计结构。

## 文风与格式

使用客观陈述说明现有行为，使用「必须」「不得」表达约束，并明确区分支持能力、限制和验证要求。避免评审过程、阶段性进度、宣传性结论和重复强调。数量、版本和性能值需说明适用范围；可由源码直接确定的接口覆盖范围以源码为准。

标识、字段、文件路径和命令使用代码格式，操作对比使用表格，顺序步骤使用编号列表。界面导航层级使用 ` - ` 分隔。中文采用中文标点，英文采用英文标点；每个段落或列表项保持在单行，不手工折行。

整理文档不得缩减已有数据的认证读取和恢复保证。涉及加密格式、密钥、历史或备份时，中英文必须同时保留兼容基线、失败处理和恢复材料要求。
