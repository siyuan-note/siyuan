# @siyuan-note/cli

启动本机思源桌面客户端内置的 `SiYuan-Kernel` CLI，提供跨平台的 `siyuan` 命令。

这个包**不包含**内核二进制，也不复制它——只在安装时（运行时）定位已安装的思源客户端，并把参数转发给内核。内核需要从可执行文件所在目录向上找到 `appearance/langs` 才能工作，所以就地执行是唯一可靠的方式。

## 前置条件

思源桌面客户端 3.8+ 已安装。支持的安装位置：

- Windows：`%ProgramFiles%\SiYuan\resources\kernel\SiYuan-Kernel.exe`、`%LOCALAPPDATA%\Programs\SiYuan\...`，以及 PATH 中的内核目录
- macOS：`/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel`、`~/Applications/SiYuan.app/...`
- Linux：`/opt/siyuan/kernel/SiYuan-Kernel`，或 PATH 中已有的 `siyuan`

找不到时可通过 `SIYUAN_CLI_BIN` 环境变量显式指定内核可执行文件。

## 用法

```bash
npm install -g @siyuan-note/cli
siyuan --version
siyuan -f json notebook list
siyuan -w /path/to/workspace -f json search "关键词"
```

所有参数原样转发给内核 CLI；命令清单见思源码 `kernel/cli/cmd/`。

## 发布

代码在主库 `scripts/npm-cli/`，使用 GitHub Actions Trusted Publishing，不需要长期 npm token。

1. 首次发布：在 `scripts/npm-cli/` 下手动执行 `npm login` 和 `npm publish --access public`（需有 `@siyuan-note` org 发布权限），先创建 `@siyuan-note/cli` 包页面。
2. 打开新包的 `npmjs.com → Packages → @siyuan-note/cli → Settings → Trusted publishing`，添加 GitHub Actions publisher：Organization/user `siyuan-note`，Repository `siyuan`，Workflow filename `npm-cli-publish.yml`，Environment name `npm-publish`；Allowed actions 勾选 `npm publish`。
3. 更新 `scripts/npm-cli/package.json` 的 `version` 至 `0.1.1`（`0.1.0` 已用于首次发布），推送 `npm-cli-v<version>` tag；也可在 Actions 里手动触发。
4. 发布目录为 `scripts/npm-cli/`，主库发版 tag（`v*`）不会触发此工作流。

工作流要求 npm CLI >= 11.5.1、Node >= 22.14.0；新配置的 trusted publisher 必须在 2 天内完成一次成功发布，否则会过期。
