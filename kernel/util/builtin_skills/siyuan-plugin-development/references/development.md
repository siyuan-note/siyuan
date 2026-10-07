# 开发依据与边界

## 官方依据

- 插件示例：https://github.com/siyuan-note/plugin-sample
- Plugin API 声明：https://github.com/siyuan-note/petal
- 思源目标版本实现：https://github.com/siyuan-note/siyuan

核实当前运行版本及目标前端，再使用该版本的公开接口。前端插件入口 index.js 由宿主加载，CommonJS 使用 require("siyuan") 和 module.exports；不要仅因为 npm 包有某个类型就假设宿主导出了它。目标前端取自当前 manifest 规范，不盲目复用全平台数组。

## 最小文件与构建

最小前端包需要 plugin.json 与真实的 index.js，并纳入实际使用的 i18n、README、index.css 及其他资源。manifest 的名称、版本、最低宿主版本和前端声明须符合当前原生安装解析规则。发布元信息需要真实身份；本地原型不虚构作者或仓库。

examples/index.js 和 examples/en_US.json 是原创的小型无依赖示例，只展示公开入口和生命周期，不是已完成的用户插件，不要把示例文案当用户需求。根据目标版本核实 addTopBar、showMessage 和语言文件键名。布局相关入口在 onLayoutReady 注册，避免重复注册。

TypeScript 只有经过实际可用的构建链才能产生可安装的 index.js；不能把 .ts 改后缀冒充构建。package_local 仅冻结并打包文件，不构建、不执行任意项目脚本。缺构建能力时准确交付源码及阻塞信息，或经用户同意改用纯 JavaScript。

## 导入与再次确认

导入前以 project_status(taskId, sourcePath, sourceFiles) 检查候选来源。sourceFiles 是准确的相对文件允许清单，必须与方案的 workflow.files 一致；sourceRevision 绑定所选现存安全文件，不是整个仓库。宿主仅列出被排除的路径，不读取其中的 .git、node_modules、config 等内容。允许清单中可选路径尚未存在时可以留待创建，不把它当作已导入文件。

已经存在的受管项目重新确认方案后，先通过 project_status(taskId) 取得当前 sourceRevision，再使用 prepare_project(taskId, expectedSourceRevision) 建立新检查点；不覆盖当前源码，不重新导入旧来源。版本不符时先只读检查变化，再按实际影响处理。

打包只冻结已确认允许清单中实际存在的安全文件。可选文件缺失可不入包；plugin.json、index.js 及 manifest 声明资源必须完整，不能用可选清单绕过入口或资源校验。

## 数据与生命周期

通过公开内核 API 读取和修改笔记，检查 code 后才宣告成功；不直接改 .sy、数据库或真实 data 目录。明确目标及影响范围，按现有权限访问加密笔记本，锁定或拒绝时不绕过。

耗时写入防重复点击，保留请求及实例状态。onunload 清理自有事件、定时器和观察器，取消可取消的读取；异步返回后检查实例仍有效。取消请求或卸载不能保证服务器端写入尚未执行，结果未知时先只读核实。

## 安装

生成本地 ZIP 不授予安装或启用许可。安装使用原生本地包接口，绑定包 hash 和预期安装目标 revision；不可变安装快照与开发源码分开。授权可能执行代码前说明已启用插件覆盖的影响。用户只批准文件交付时停在源码与制品层。

安装数据恢复使用既有 repo 快照与恢复工具，遵循用户的同步忽略规则。快照覆盖未忽略的 data/plugins 代码与 data/storage/petal 数据，不包含工作空间 conf 或受管项目源码；受管源码仍由 restore_project 恢复。智能体每轮对话的首个本地写入前创建快照，不为每次安装单独创建恢复点，安装器也不另行保留插件代码备份。整库签出会回退全部纳入快照的数据，关闭同步并重载界面；单文件恢复只覆盖所选文件，不删除后来新增的文件。恢复 petals.json 会影响整份插件配置。先核实快照内容及恢复范围，遵循现有工具确认，不自动签出整库，也不承诺停止正在运行的插件代码。
