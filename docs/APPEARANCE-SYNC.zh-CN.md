# 主题和图标同步

[English](APPEARANCE-SYNC.md)

相关议题：[#18883](https://github.com/siyuan-note/siyuan/issues/18883)、[#19634](https://github.com/siyuan-note/siyuan/issues/19634)、[#19635](https://github.com/siyuan-note/siyuan/issues/19635)

## 文件同步

第三方主题位于 `data/themes/<name>/`，图标包位于 `data/icons/<name>/`，与插件、挂件、模板共用文件级同步、删除、冲突处理及快照逻辑。删除包目录就会删除对应的同步文件。同一个包中不同文件的修改可以合并；单个文件的不同版本发生冲突时，遵循普通文件的同步规则和数据历史行为。

内置的 `daylight`、`midnight`、`litheness` 仍属于程序资源。各设备在 `conf/conf.json` 中独立保存外观选择，收到一个包不会自动选用它。同步和恢复快照后，会刷新包列表及当前选择使用的资源。包缺失、不兼容或必要文件不完整时，回退到内置资源。主题的前端兼容性及 `minAppVersion` 检查保持有效。

快照恢复针对整个数据目录。快照中不存在的主题或图标包会被删除，包括恢复主题、图标尚未参与同步时创建的旧快照。

## 资源文件及忽略规则

按需下载只适用于 `/assets/`、`/<笔记本ID>/assets/` 和 `/<笔记本ID>/<文档ID>/.../assets/`，笔记本和文档目录名必须符合正常的块 ID 格式。主题、图标、插件、挂件及模板中的资源随普通文件完整下载。OCR 元数据及标注文件继续保持原有的完整下载行为。

旧版下载状态中已经延期的包资源仍通过原有格式认证读取。索引和同步会先下载这些文件，再移除对应的延期记录。下载失败时保留记录供重试，已存在的本地修改不会被覆盖。

普通 `.siyuan/syncignore` 规则同时适用于单个文件和目录。例如，`/themes/example/` 忽略整个主题，`/themes/example/assets/draft.png` 只忽略一个文件。用于本地开发的符号链接继续保留在本机，由普通同步路径策略排除。

## 迁移

启动时将旧外观目录中的第三方包移入 `data/themes/` 和 `data/icons/`，已有目标目录优先。迁移成功后移除源目录，避免删除包或恢复旧快照后又从原目录复活。内置资源仍保留在程序外观目录中。

升级时移除 `.siyuan/syncignore` 中完整的 `siyuan-appearance-isolation:v1` 系统规则块；重新加载忽略规则时，也会清除同步或快照恢复带回的隔离块，保留块外用户规则的内容和顺序。此后不再生成或维护隔离块。

正式实现不再生成逐包摘要及删除记录、不可变包归档、恢复标签，也不再使用外观专用事务协议。安装信息复用共享的 `storage/bazaar.json` 机制。Alpha 版本遗留的 `data/storage/appearance-v1/`、`data/storage/bazaar/themes/`、`data/storage/bazaar/icons/`、`conf/appearance-migration.json` 及已有的 `.siyuan-appearance-v1` 标签不做自动清理，也不用于恢复外观包。已有标签按普通标签处理。

## 验证

使用对应的本地 DejaVu 依赖执行：

```text
# dejavu/
go test ./... -run "TestAsset|TestPackageFiles|TestIndexReused|TestSyncReused|TestSnapshot|TestDownload|TestUploadTag" -count=1

# siyuan/kernel/
go test -tags "fts5 sqlcipher" ./model ./bazaar ./util ./server -run "Test.*Appearance|Test.*ThemesWatch|Test.*SyncIgnore" -count=1
```
