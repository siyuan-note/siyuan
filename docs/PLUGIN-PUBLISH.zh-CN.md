# 插件发布

[English](PLUGIN-PUBLISH.md)

发布权限授予访问者，不区分同一页面中的浏览器插件。公开数据也能被访问者下载或被页面中的其他代码读取。不要公开令牌、密码、注册码或私有笔记本内容。

## 资源声明

已启用插件的标准前端入口 `index.js`、`index.css` 及 `i18n` 下直接存放的 `.json` 语言文件继续可用。额外的前端文件必须在 `plugin.json` 中声明：

```json
{
  "name": "example",
  "version": "1.0.0",
  "minAppVersion": "3.8.4",
  "publish": {
    "resources": ["images/logo.png", "views/index.html"],
    "data": ["theme", "showAuthor"]
  }
}
```

资源采用完整相对文件名，分隔符为 `/`，不支持目录、通配符、绝对路径、上级目录跳转、百分号编码及链接。不得声明 `plugin.json` 或 `kernel.js`。最多声明 4096 个资源文件及 128 个数据字段。加载额外脚本、图片、字体或 HTML 的插件需列出文件，只使用标准入口的插件无需补充资源声明。

静态路由、文件接口和插件加载接口使用一致的发布状态检查。关闭插件总开关、禁用插件、卸载、作者禁止发布或用户关闭发布后，拒绝后续读取。发布加载响应不包含内核代码。发布读取拒绝数据目录内的资源链接，包括插件目录链接和 Windows 目录联接；管理员原有访问行为保持兼容。

已发布文档保留现有权限。挂件保留发布状态及可访问文档引用检查。`data/public` 保持明确公开的语义，不受单篇文档密码保护。`/api/file/readDir` 仍仅允许管理员调用，`data/storage/petal` 仍为私有存储。

## 数据授权与迁移

`publish.data` 声明公开的标量字段。字段名只包含 ASCII 字母、数字、`_` 或 `-`，最多 128 个字符。值只允许字符串、数字、布尔值或 `null`，不允许对象和数组。请把选择的公开内容整理成独立字段，避免嵌套对象增加字段时悄悄扩大授权；不要把私有对象序列化成字符串来代替筛选公开内容。单个快照的字段值编码后总大小不得超过 1 MiB。

在已下载插件卡片中点击「插件发布数据」，查看字段清单并授权。该权限与发布服务开关独立，默认关闭。新增字段需要重新授权，已授权字段的日常更新无需反复确认。授权或撤销会清空旧快照，插件需在授权后重新生成。

插件接口提供 `loadPublishData(): Promise<Record<string, string | number | boolean | null>>` 与 `savePublishData(data: Record<string, string | number | boolean | null>): Promise<void>`。保存要求管理员权限，完整替换快照，省略的字段会被移除，空对象表示发布空快照。读取要求插件已安装、已启用、允许发布且授权有效。失败时拒绝 Promise，不会回退读取私有存储。现有 `loadData` 和 `saveData` 的私有存储语义不变。

管理员授权后，在管理员环境中选择公开值：

```typescript
const settings = await this.loadData("settings.json");
await this.savePublishData({
    theme: settings.theme === "dark" ? "dark" : "light",
    showAuthor: settings.showAuthor === true,
});
```

发布页面改为调用 `await this.loadPublishData()`，不再读取私有配置。插件可以提供生成操作，或在设置变化、管理员端重新加载时生成。首次成功生成前应处理「尚未生成」错误，避免整个插件加载失败，也不要尝试回退到私有存储。

带版本号的授权与快照保存在 `conf/plugin-publish/<name>.json`，与公开目录及同步的插件存储分离，不应直接编辑或暴露。授权属于当前工作空间安装，不随数据同步转移。声明移除的字段在下次访问状态时清理。卸载会删除授权与快照，重装不能继承。未知格式、损坏及更新失败时保留原始数据并返回错误。撤销无法收回已经下载的副本。

## HTTP 接口

以下接口均使用 POST 和标准的 `{code, msg, data}` 信封。成功为 `0`，严格参数解析失败为 `-1`，声明、范围或值无效为 `400`，未授权或插件不可发布为 `403`，已授权但尚未生成快照为 `404`，存储失败为 `500`。认证、管理员及只读中间件保留既有 HTTP 拒绝响应。

| 接口 | 权限 | 请求 | 成功数据 |
| --- | --- | --- | --- |
| `/api/petal/getPluginPublishInfo` | 管理员 | `{ "packageName": "example" }` | `{ "resources": ["images/logo.png", "views/index.html"], "fields": ["showAuthor", "theme"], "granted": false }` |
| `/api/petal/setPluginPublishDataGrant` | 管理员、可写 | `{ "packageName": "example", "fields": ["showAuthor", "theme"], "enabled": true }` | `null` |
| `/api/petal/savePluginPublishData` | 管理员、可写 | `{ "packageName": "example", "data": { "theme": "dark" } }` | `null` |
| `/api/petal/loadPluginPublishData` | 已认证，插件允许发布且数据已授权 | `{ "packageName": "example" }` | `{ "theme": "dark" }` |

信息响应只列出额外资源，标准入口隐式提供。启用授权时必须提交与当前声明完全一致的字段集合，防止通过过期对话框批准已变化的范围。撤销时提交 `enabled: false` 和 `fields: []`。管理员读取快照也使用同一公开视图。请求和响应类型由 `siyuan` 导出。
