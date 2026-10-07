---
name: siyuan-plugin-development
description: 官方前端插件开发流程：在用户明确选择后澄清缺失要求、确认简短方案、使用受管副本实现、验证和打包；安装与启用另行授权
---

# 思源前端插件开发

这是随思源发布的只读官方技能。当前范围是前端插件的新建和修改；默认采用无第三方运行依赖的 CommonJS JavaScript。kernel.js 的完整开发、验证与恢复不在此流程范围内。

示例占位符（如 ${PLUGIN_NAME}）需要按照已确认的方案替换，不把用户变量设置当作官方内容。

## 先取得真实选择，再确认方案

- 仅在用户明确要求开发或修改插件时使用。普通模板、文档和主题需求不自动升级为插件
- 官方选择由 question 工具的 workflow.action="choose" 发起，questions 可传空数组；服务器显示固定的本地化是／否问题。不要把普通问题、聊天文字、模型自己的 consent 或用户旧答案当作该任务的许可
- 用户选择是之后，以 skill 的 action="load"、source="builtin"、name="siyuan-plugin-development" 加载正文。只有服务器确认成功加载后才继续。拒绝、取消或禁用时不要读取官方正文；仍可按原权限处理用户要求的自定义开发
- 从当前对话提取已知需求，仅补问会改变实现的缺口：功能、入口、触发方式、目标前端、数据读取与写入影响、交付内容。不要重复问已经明确的内容，也不要猜笔记本或扩大到全部平台
- 通过 question 的 workflow.action="plan" 提交短方案，绑定选择返回的 taskId。方案全文清楚说明插件名称、前端、功能与入口、数据变化、交付范围、导入来源及允许打包的文件。服务器冻结并显示整份方案；真正接受确认前不写源码
- 修改已经确认的目标、源码来源、数据影响或打包范围时更新方案并取得新的确认。不要伪造 taskId、方案摘要或已确认状态；旧问题和旧版本不作为新任务授权

选择调用示例：{"questions":[],"workflow":{"action":"choose"}}。用户明确要求另一个插件时才用 newTask=true；明确更改当前流程选择时可用 reconsider=true。普通重复调用沿用当前选择，不重复询问。

方案字段：taskId、proposal（不超过 2000 字符）、packageName、frontend（desktop、desktop-window、browser-desktop、mobile 或 browser-mobile 中一个）、dataEffects 与 deliverables（各不超过 1000 字符）、files（最多 200 个准确的相对文件路径）。导入现有插件前，调用 bazaar 的 project_status，提供 taskId、sourcePath 和准确的 sourceFiles；sourceFiles 必须与待确认的 workflow.files 一致。宿主返回所选现存安全文件的 sourceRevision，方案中一并提供该摘要与 sourcePath；不要隐式读取或计算整个仓库的摘要。排除的 .git、node_modules、config 等路径只列出而不读取内容。新建时省略来源字段。技术清单也会显示给用户，不在确认后增加未批准文件；允许清单可包含尚未存在的可选文件，但入口、manifest 和声明资源不能因此省略。

## 先核实工具和接口

先读 references/development.md，所有资源均通过 skill 的 source="builtin" 和 name="siyuan-plugin-development/相对路径" 读取。检查当前可用工具和目标思源版本，按需核实官方 plugin-sample、petal 与目标版本源码。不把类型声明、README 的旧版本或未发布接口当作当前宿主已支持。

默认使用 CommonJS JavaScript。只有实际存在并获准使用的依赖与构建工具时才采用 TypeScript；源码不等于可运行的 index.js。原生智能体不保证拥有 shell、依赖安装或任意代码执行能力。缺工具时准确报告阻塞步骤，不编造执行结果，不绕过工具拒绝。若用户指定 TypeScript，先确认替代路线，不擅自改成 JavaScript。

## 在受管副本中实现

1. 方案确认后调用 bazaar 的 prepare_project，以 taskId 由宿主创建源码副本和基线检查点；不要自己指定绝对写入目录。导入项目先按明确的 sourceFiles 只读检查，批准来源和所选文件的基线摘要后导入副本；原目录保持原样。已有受管项目重新确认方案后，先用 project_status(taskId) 取得当前源码版本，再调用 prepare_project(taskId, expectedSourceRevision) 建立新检查点；该动作保留当前源码，不重新导入或覆盖它
2. 新文件使用 file.write 的 ifAbsent=true。编辑已有文本之前使用 file.read 的 withMetadata=true；按同一 expectedRevision 和 nextOffsetByte 续读，直到完整覆盖需要修改的原始内容。truncated=true 不是完整文件
3. 局部修改优先使用 file.edit，提供 expectedRevision 与唯一、不重叠的 oldText/newText；需要全文替换才使用带 expectedRevision 的 file.write，且必须先在同一 revision 下完整读取整个文件。遇到冲突先重读并核对，不重试盲写、不把找不到或多处匹配降级为整文件覆盖
4. 使用宿主返回的路径和项目版本；通过 bazaar 的 project_status 核实当前源码、方案和检查点。无法建立检查点就停止写入，部分失败须如实报告；需要恢复时使用 restore_project 并遵守当前版本和工具确认
5. 不使用 copy、unzip、目录改名或 HTTP 文件接口绕过受管源码的条件写入；不触碰宿主控制、备份或制品目录，不直接覆盖真实插件安装目录

取消流程不会自动回退；取消、写入结果未知或部分准备使普通方案无法继续时，用 question 的 questions=[]、workflow.action="recover" 和 taskId 请求仅恢复授权，由服务器展示并绑定最近真正批准的方案及摘要。
确认后可调用 restore_project，或仅为同一冻结的中断准备重试 prepare_project；恢复不回退笔记、运行时数据或其他配置，也不授权继续修改源码，后续普通源码修改仍需正常的方案确认。

参考 examples/index.js 的最小入口模式，按实际功能调整。通过公开 Plugin API 创建入口，通过内核 API 修改笔记，禁止用 fs 或 Electron 直接改 data 文件。界面文案放 i18n，检查返回码、目标缺失、关闭的笔记本、重复点击与迟到响应。onunload 必须处理部分初始化，并清理自有监听器、定时器、观察器和请求；卸载不能撤销已发送的写请求。

## 验证、打包和交付

先读 references/verification.md。仅声明实际实现和已验证的前端；没有 kernel.js 不声明 kernels。不要照搬示例作者、仓库、赞助或数据权限，不为本地原型虚构发布身份。

通过 bazaar 的 package_local，以 taskId 和最新 expectedSourceRevision 请求确定性本地 ZIP。宿主只冻结允许清单中实际存在的安全文件，允许可选路径不存在，但必须存在 plugin.json、index.js 和 manifest 声明的资源；不执行项目脚本、不下载依赖。缺入口、缺声明资源或命中秘密文件时先修正源码或重新确认范围。保留返回的 packageHash、sourceRevision 和验证结果。打包成功不代表 JavaScript 语法、真实安装、前端加载或业务运行通过。

分项交付源码、静态检查、构建、ZIP、模拟测试、真实安装、启用配置、前端加载和业务运行的结果与依据。纯 JavaScript 构建写“不适用”；没运行的步骤写“未验证”和原因。SDK 替身或独立 Electron DOM 测试不能称为思源集成测试；桌面 Electron 与桌面浏览器单独验证。

安装和启用均需用户明确授权对应动作与目标。已启用插件的覆盖可能立即执行代码；disable 通知没有所有前端卸载确认，不能声称自动保证停止。获得授权后仅使用原生安装接口并绑定宿主返回的包摘要、目标版本，不靠通用文件写入安装。回退旧代码不等于回退用户笔记与配置。
