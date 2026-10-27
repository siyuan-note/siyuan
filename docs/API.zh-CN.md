[English](API.md)
| **中文**
| [日本語](API.ja.md)

插件资源声明、数据授权与相关接口详见[插件发布](PLUGIN-PUBLISH.zh-CN.md)。

* [规范](#规范)
    * [参数和返回值](#参数和返回值)
    * [TypeScript 类型契约](#typescript-类型契约)
    * [行为语义](#行为语义)
    * [鉴权](#鉴权)
* [笔记本](#笔记本)
    * [列出笔记本](#列出笔记本)
    * [打开笔记本](#打开笔记本)
    * [关闭笔记本](#关闭笔记本)
    * [重命名笔记本](#重命名笔记本)
    * [创建笔记本](#创建笔记本)
    * [删除笔记本](#删除笔记本)
    * [获取笔记本配置](#获取笔记本配置)
    * [保存笔记本配置](#保存笔记本配置)
* [文档](#文档)
    * [通过 Markdown 创建文档](#通过-markdown-创建文档)
    * [重命名文档](#重命名文档)
    * [删除文档](#删除文档)
    * [移动文档](#移动文档)
    * [设置笔记本和文档排序值](#设置笔记本和文档排序值)
    * [设置文档的子文档排序方式](#设置文档的子文档排序方式)
    * [根据路径获取人类可读路径](#根据路径获取人类可读路径)
    * [根据 ID 获取人类可读路径](#根据-ID-获取人类可读路径)
    * [根据 ID 获取存储路径](#根据-ID-获取存储路径)
    * [根据人类可读路径获取 IDs](#根据人类可读路径获取-IDs)
* [资源文件](#资源文件)
    * [上传资源文件](#上传资源文件)
* [块](#块)
    * [插入块](#插入块)
    * [插入前置子块](#插入前置子块)
    * [插入后置子块](#插入后置子块)
    * [更新块](#更新块)
    * [删除块](#删除块)
    * [移动块](#移动块)
    * [折叠块](#折叠块)
    * [展开块](#展开块)
    * [获取块 kramdown 源码](#获取块-kramdown-源码)
    * [获取子块](#获取子块)
    * [转移块引用](#转移块引用)
* [属性](#属性)
    * [设置块属性](#设置块属性)
    * [获取块属性](#获取块属性)
* [数据库](#数据库)
    * [渲染](#渲染)
    * [获取](#获取)
    * [获取主键值](#获取主键值)
    * [搜索](#搜索)
    * [设置单元格值](#设置单元格值)
    * [添加条目](#添加条目)
    * [移除条目](#移除条目)
    * [切换布局](#切换布局)
    * [设置分组](#设置分组)
    * [获取过滤与排序](#获取过滤与排序)
    * [设置过滤](#设置过滤)
    * [设置排序](#设置排序)
    * [添加字段](#添加字段)
    * [移除字段](#移除字段)
    * [设置全局字段排序](#设置全局字段排序)
    * [设置视图内字段排序](#设置视图内字段排序)
* [搜索](#搜索)
    * [获取已保存的搜索条件组](#获取已保存的搜索条件组)
    * [保存搜索条件组](#保存搜索条件组)
    * [移除搜索条件组](#移除搜索条件组)
* [SQL](#SQL)
    * [执行 SQL 查询](#执行-SQL-查询)
    * [提交事务](#提交事务)
* [模板](#模板)
    * [渲染模板](#渲染模板)
    * [渲染 Sprig](#渲染-Sprig)
* [文件](#文件)
    * [获取文件](#获取文件)
    * [写入文件](#写入文件)
    * [删除文件](#删除文件)
    * [重命名文件](#重命名文件)
    * [列出文件](#列出文件)
* [导出](#导出)
    * [导出 Markdown 文本](#导出-markdown-文本)
    * [导出文件与目录](#导出文件与目录)
* [转换](#转换)
    * [Pandoc](#Pandoc)
* [通知](#通知)
    * [推送消息](#推送消息)
    * [推送报错消息](#推送报错消息)
* [网络](#网络)
    * [正向代理](#正向代理)
        * [JSON 正向代理](#JSON-正向代理)
        * [HTTP 正向代理](#HTTP-正向代理)
        * [WebSocket 正向代理](#WebSocket-正向代理)
        * [EventSource 正向代理](#EventSource-正向代理)
* [系统](#系统)
    * [获取启动进度](#获取启动进度)
    * [获取系统版本](#获取系统版本)
    * [获取系统当前时间](#获取系统当前时间)

---

## 规范

### 参数和返回值

* 端点：`http://127.0.0.1:6806`
* 除非接口中另有说明，否则 API 接口均使用 POST 方法
* 使用 JSON 入参的接口，参数为 JSON 字符串，写入 body 里，标头 Content-Type 为 `application/json`
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {}
  }
  ```

    * `code`：非 0 为异常情况
    * `msg`：正常情况下是空字符串，异常情况下会返回错误文案
    * `data`：可能为 `{}`、`[]` 或者 `NULL`，根据不同接口而不同

### TypeScript 类型契约

插件的 `fetchPost`、`fetchSyncPost` 和 `fetchGet` 声明会根据已迁移的接口路径，从内核生成的契约推导请求与响应类型。覆盖范围持续扩展，包含系统基础接口、块属性批量读写、标签及书签操作、部分块查询、笔记本列表、历史搜索和快照操作。存量未迁移接口及动态 URL 继续支持。读取异步返回值中的成功数据前须检查响应码，并显式处理可空字段。

```typescript
import {fetchSyncPost} from "siyuan";

const response = await fetchSyncPost("/api/attr/getBlockAttrs", {id: blockID});
if (response.code === 0 && response.data) {
    const value = response.data["custom-value"];
}
```

准确覆盖范围见[生成的路由声明](../app/src/types/api/index.d.ts)，生成与兼容规则见[契约维护说明](API-CONTRACTS.md)。类型声明本身不执行运行时 JSON 校验。

### 行为语义

* 只有在本文档中设有独立接口说明的接口属于公开 API。其他内核路由和 `/api/transactions` 操作属于内部实现，除非另有说明，否则不承诺兼容性和行为稳定性
* `code: 0` 表示接口处理请求时未报告错误，只保证该接口明确说明的结果，不表示相关索引、缓存、WebSocket 广播或同步状态均已更新
* 省略字段、`null`、空对象和空数组的含义由各接口定义。对象或数组是替换、合并还是局部修改现有状态，以及顺序是否具有意义，也以各接口说明为准
* 接口可能裁剪、忽略、填充或转换输入。接口说明会返回规范化结果时，调用方应将返回的 `data` 作为实际接受的结果
* 不要根据操作名称推断其为只读操作。存在持久化副作用时，各接口会说明其影响范围
* 只有接口明确说明时，相同请求才保证幂等或可以安全重试。响应中断或结果无法确定时，应尽可能先读取当前状态再决定是否重试

### 鉴权

在 <kbd>设置 - 鉴权 - API token</kbd> 中查看 API token，请求标头：`Authorization: Token xxx`

## 笔记本

### 列出笔记本

* `/api/notebook/lsNotebooks`
* 不带参
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "notebooks": [
        {
          "id": "20210817205410-2kvfpfn", 
          "name": "测试笔记本",
          "icon": "1f41b",
          "sort": 0,
          "closed": false
        },
        {
          "id": "20210808180117-czj9bvb",
          "name": "思源笔记用户指南",
          "icon": "1f4d4",
          "sort": 1,
          "closed": false
        }
      ]
    }
  }
  ```

### 打开笔记本

* `/api/notebook/openNotebook`
* 参数

  ```json
  {
    "notebook": "20210831090520-7dvbdv0"
  }
  ```

    * `notebook`：笔记本 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 关闭笔记本

* `/api/notebook/closeNotebook`
* 参数

  ```json
  {
    "notebook": "20210831090520-7dvbdv0"
  }
  ```

    * `notebook`：笔记本 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

关闭接口校验笔记本 ID 时不会去除两端空白。请求与响应类型声明生成于 `app/src/types/api/index.d.ts`，并同步到 `petal`。

### 重命名笔记本

* `/api/notebook/renameNotebook`
* 参数

  ```json
  {
    "notebook": "20210831090520-7dvbdv0",
    "name": "笔记本的新名称"
  }
  ```

    * `notebook`：笔记本 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 创建笔记本

* `/api/notebook/createNotebook`
* 参数

  ```json
  {
    "name": "笔记本的名称"
  }
  ```
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "notebook": {
        "id": "20220126215949-r1wvoch",
        "name": "笔记本的名称",
        "icon": "",
        "sort": 0,
        "closed": false
      }
    }
  }
  ```

### 删除笔记本

* `/api/notebook/removeNotebook`
* 参数

  ```json
  {
    "notebook": "20210831090520-7dvbdv0"
  }
  ```

    * `notebook`：笔记本 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 获取笔记本配置

管理员响应还可包含只读的 `documentCapabilities` 对象，用于报告结构化接口支持、标题格式、索引状态和能力摘要。所有笔记本使用结构化标题规则，无需模式设置或迁移；`literalSlash` 仅在索引就绪时为 `true`。使用前须将所有同步设备统一升级到支持本次功能的版本。既有权限过滤保持不变。

* `/api/notebook/getNotebookConf`
* 参数

  ```json
  {
    "notebook": "20210817205410-2kvfpfn"
  }
  ```

    * `notebook`：笔记本 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "box": "20210817205410-2kvfpfn",
      "conf": {
        "name": "测试笔记本",
        "closed": false,
        "refCreateSavePath": "",
        "createDocNameTemplate": "",
        "dailyNoteSavePath": "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}",
        "dailyNoteTemplatePath": ""
      },
      "name": "测试笔记本"
    }
  }
  ```

管理员响应还包含可选只读对象 `documentCapabilities`。`structuredPaths` 表示服务端支持 ID 与路径段接口，不授予关闭或锁定笔记本的访问权限。`titleFormats` 列出支持的标题格式，`indexState` 报告索引状态，`revision` 标识能力声明。`literalSlash` 仅在索引就绪时为 `true`。使用前须将所有同步设备统一升级到支持本次功能的版本。旧服务端缺少此对象与请求失败含义不同，不能在请求失败后回退到旧路径接口继续写入。

### 保存笔记本配置

* `/api/notebook/setNotebookConf`
* 参数

  ```json
  {
    "notebook": "20210817205410-2kvfpfn",
    "conf": {
        "name": "测试笔记本",
        "closed": false,
        "refCreateSavePath": "",
        "createDocNameTemplate": "",
        "dailyNoteSavePath": "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}",
        "dailyNoteTemplatePath": ""
      }
  }
  ```

    * `notebook`：笔记本 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "name": "测试笔记本",
      "closed": false,
      "refCreateSavePath": "",
      "createDocNameTemplate": "",
      "dailyNoteSavePath": "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}",
      "dailyNoteTemplatePath": ""
    }
  }
  ```

## 文档

### 通过 Markdown 创建文档

旧字符串创建接口在写入前检查全部父路径前缀。祖先含斜杠或空标题时返回 `code: -1`、`data.reason: "pathAmbiguous"`；多个干净父级需要有效且匹配的 `parentID`，否则同样报歧义。元数据未就绪返回 `indexUnavailable`。建议使用 `/api/filetree/createDocByParent`，分别传递父身份和标题。

* `/api/filetree/createDocWithMd`
* 参数

  ```json
  {
    "notebook": "20210817205410-2kvfpfn",
    "path": "/foo/bar",
    "markdown": ""
  }
  ```

    * `notebook`：笔记本 ID
    * `path`：文档路径，需要以 `/` 开头，中间使用 `/` 分隔层级（对应数据库 `hpath` 字段）
        * `/` 是层级分隔符，不能表示文档标题中的斜杠；不存在的父文档会自动创建
        * 例如，`/Notes/Programming in C/C++` 会在 `Notes` 下的 `Programming in C` 下创建标题为 `C++` 的文档
        * 导入程序应在拼接路径前逐个处理标题，例如将 ASCII `/` 替换为全角 `／`（U+FF0F）：`/Notes/Programming in C／C++` 会在 `Notes` 下创建标题为 `Programming in C／C++` 的文档。此替换会改变标题文本
    * `markdown`：GFM Markdown 内容
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "20210914223645-oj2vnx2"
  }
  ```

    * `data`：创建好的文档 ID
    * 如果使用同一个 `path` 重复调用该接口，不会覆盖已有文档

### 重命名文档

* `/api/filetree/renameDoc`
* 参数

  ```json
  {
    "notebook": "20210831090520-7dvbdv0",
    "path": "/20210902210113-0avi12f.sy",
    "title": "文档新标题"
  }
  ```

    * `notebook`：笔记本 ID
    * `path`：文档路径
    * `title`：新标题
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

通过 `id` 重命名文档：

* `/api/filetree/renameDocByID`
* 参数

  ```json
  {
    "id": "20210902210113-0avi12f",
    "title": "文档新标题"
  }
  ```

    * `id`：文档 ID
    * `title`：新标题
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 删除文档

* `/api/filetree/removeDoc`
* 参数

  ```json
  {
    "notebook": "20210831090520-7dvbdv0",
    "path": "/20210902210113-0avi12f.sy"
  }
  ```

    * `notebook`：笔记本 ID
    * `path`：文档路径
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

通过 `id` 删除文档：

* `/api/filetree/removeDocByID`
* 参数

  ```json
  {
    "id": "20210902210113-0avi12f"
  }
  ```

    * `id`：文档 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 移动文档

两个移动接口都会为进入监听范围的文档及子文档判断块收集规则，并保留已有数据库行和字段值。若文档移动后收集失败，接口返回错误，已移动的文档保留在新位置。

* `/api/filetree/moveDocs`
* 参数

  ```json
  {
    "fromPaths": ["/20210917220056-yxtyl7i.sy"],
    "toNotebook": "20210817205410-2kvfpfn",
    "toPath": "/"
  }
  ```

    * `fromPaths`：源路径
    * `toNotebook`：目标笔记本 ID
    * `toPath`：目标路径
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

通过 `id` 移动文档：

* `/api/filetree/moveDocsByID`
* 参数

  ```json
  {
    "fromIDs": ["20210917220056-yxtyl7i"],
    "toID": "20210817205410-2kvfpfn"
  }
  ```

    * `fromIDs`：源文档 ID
    * `toID`：目标父文档 ID 或笔记本 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 相对调整文档顺序

* `/api/filetree/reorderDocs`
* 参数

  ```json
  {
    "sourceIDs": ["20210917220056-yxtyl7i"],
    "targetID": "20210917220057-abcdefg",
    "position": "before"
  }
  ```

    * `sourceIDs`：按数组顺序插入的源文档 ID
    * `targetID`：目标兄弟文档 ID
    * `position`：`before` 或 `after`
    * 源文档必须在移动后与目标文档属于同一笔记本和父文档；排序基于包含隐藏文档和未列出文档的完整子文档列表
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "changed": true,
      "notebook": "20210817205410-2kvfpfn",
      "parentPath": "/"
    }
  }
  ```

### 相对调整笔记本顺序

* `/api/notebook/reorder`
* 参数

  ```json
  {
    "sourceIDs": ["20210817205410-2kvfpfn"],
    "targetID": "20210817205411-abcdefg",
    "position": "after"
  }
  ```

    * `sourceIDs`：按数组顺序插入的源笔记本 ID
    * `targetID`：目标笔记本 ID
    * `position`：`before` 或 `after`
    * 排序基于包含已关闭笔记本的完整列表
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "changed": true
    }
  }
  ```

### 设置笔记本和文档排序值

* `/api/filetree/setSort`
* 参数

  ```json
  {
    "notebookSorts": [
      {
        "id": "20210817205410-2kvfpfn",
        "sort": -10
      }
    ],
    "docSorts": [
      {
        "id": "20210917220056-yxtyl7i",
        "sort": -8
      }
    ]
  }
  ```

    * `notebookSorts`：笔记本 ID 及其排序值，可选
    * `docSorts`：文档 ID 及其排序值，可选
    * `docSorts` 中的文档必须属于已打开且已解锁的笔记本，不接受笔记本根文档 ID
    * `notebookSorts` 和 `docSorts` 至少有一个非空；数组顺序不影响排序，每个 `sort` 值会直接存储
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "notebookIDs": ["20210817205410-2kvfpfn"],
      "docIDs": ["20210917220056-yxtyl7i"]
    }
  }
  ```

### 设置文档的子文档排序方式

* `/api/filetree/setDocSortMode`
* 参数

  ```json
  {
    "id": "20210917220056-yxtyl7i",
    "sortMode": 4
  }
  ```

    * `id`：声明子文档排序方式的普通文档 ID，不接受笔记本根文档 ID
    * `sortMode`：`0` 到 `14` 的整数；传入 `null` 会清除该文档的显式设置，并依次继承最近父文档、笔记本或全局文档树的排序规则
    * 取值：`0`/`1` 文件名升序/降序；`2`/`3` 更新时间升序/降序；`4`/`5` 文件名自然数升序/降序；`6` 自定义排序；`7`/`8` 引用数升序/降序；`9`/`10` 创建时间升序/降序；`11`/`12` 大小升序/降序；`13`/`14` 子文档数升序/降序
    * 声明的排序方式会由更深层后代继承，直到其他文档声明自己的排序方式
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "box": "20210817205410-2kvfpfn",
      "id": "20210917220056-yxtyl7i",
      "path": "/20210917220056-yxtyl7i.sy",
      "sortMode": 4,
      "effectiveSortMode": 4
    }
  }
  ```

    * `sortMode` 为显式设置值（继承时为 `null`），`effectiveSortMode` 为解析继承后的实际生效值

### 根据路径获取人类可读路径

* `/api/filetree/getHPathByPath`
* 参数

  ```json
  {
    "notebook": "20210831090520-7dvbdv0",
    "path": "/20210917220500-sz588nq/20210917220056-yxtyl7i.sy"
  }
  ```

    * `notebook`：笔记本 ID
    * `path`：路径
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "/foo/bar"
  }
  ```

### 根据 ID 获取人类可读路径

* `/api/filetree/getHPathByID`
* 参数

  ```json
  {
    "id": "20210917220056-yxtyl7i"
  }
  ```

    * `id`：块 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "/foo/bar"
  }
  ```

### 根据 ID 获取存储路径

* `/api/filetree/getPathByID`
* 参数

  ```json
  {
    "id": "20210808180320-fqgskfj"
  }
  ```

    * `id`：块 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
    "notebook": "20210808180117-czj9bvb",
    "path": "/20200812220555-lj3enxa/20210808180320-fqgskfj.sy"
    }
  }
  ```

### 根据人类可读路径获取 IDs

旧查询接口按每个候选的真实祖先链判断。仅有干净候选时返回全部 ID；干净与斜杠或空标题候选并存时返回 `pathAmbiguous`；仅有不兼容候选时返回 `legacyPathUnsupported`；无候选时返回空数组。元数据未就绪或不一致返回 `indexUnavailable`。错误候选字段为 `cleanIDs` 和 `unsupportedIDs`，仍受访问过滤保护。建议使用 `/api/filetree/resolveDocPath`，传入独立标题段。

* `/api/filetree/getIDsByHPath`
* 参数

  ```json
  {
    "path": "/foo/bar",
    "notebook": "20210808180117-czj9bvb"
  }
  ```

    * `path`：人类可读路径
    * `notebook`：笔记本 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
        "20200813004931-q4cu8na"
    ]
  }
  ```

## 资源文件

### 上传资源文件

* `/api/asset/upload`
* 参数为 HTTP Multipart 表单

    * `assetsDirPath`：资源文件保存的文件夹路径，以 data 文件夹作为根路径，比如：
        * `"/assets/"`：工作空间/data/assets/ 文件夹
        * `"/assets/sub/"`：工作空间/data/assets/sub/ 文件夹

      常规情况下建议用第一种，统一保存在工作空间资源文件夹下，因为写入子目录有一些副作用，请参考用户指南资源文件章节。
    * `file[]`：上传的文件列表
* 返回值

  ```json
  {
    "code": 0,
    "msg": "disk full",
    "data": {
      "errFiles": ["bar.png"],
      "failedFiles": [
        {
          "index": 1,
          "name": "bar.png",
          "error": "disk full"
        }
      ],
      "succFiles": [
        {
          "index": 0,
          "name": "foo.png",
          "path": "assets/foo-20210719092549-9j5y79r.png"
        }
      ],
      "succMap": {
        "foo.png": "assets/foo-20210719092549-9j5y79r.png"
      }
    }
  }
  ```

    * `errFiles`：处理时遇到错误的文件名
    * `failedFiles`：记录明确报告失败的文件，`index` 为文件在 `file[]` 中的索引，`name` 为上传时的文件名，`error` 为失败信息；该字段可能不包含未尝试或未逐项报告的文件，需要无歧义地确认每个输入项时应使用 `succFiles`
    * `succFiles`：按输入顺序记录处理成功的文件，`index` 为文件在 `file[]` 中的索引，`name` 为上传时的文件名，`path` 为上传后的资源文件路径；同一批文件包含同名文件时应使用该字段
    * `succMap`：为兼容现有调用方保留的成功文件映射，key 为上传时的文件名，value 为 assets/foo-id.png；同一批文件包含同名文件时，同名 key 仅保留最后一项

## 块

### 插入块

* `/api/block/insertBlock`
* 参数

  ```json
  {
    "dataType": "markdown",
    "data": "foo**bar**{: style=\"color: var(--b3-font-color8);\"}baz",
    "nextID": "",
    "previousID": "20211229114650-vrek5x6",
    "parentID": ""
  }
  ```

    * `dataType`：待插入数据类型，值可选择 `markdown` 或者 `dom`
    * `data`：待插入的数据
    * `nextID`：后一个块的 ID，用于锚定插入位置
    * `previousID`：前一个块的 ID，用于锚定插入位置
    * `parentID`：父块 ID，用于锚定插入位置

  `nextID`、`previousID`、`parentID` 三个参数必须至少存在一个有值，优先级为 `nextID` > `previousID` > `parentID`
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
      {
        "doOperations": [
          {
            "action": "insert",
            "data": "<div data-node-id=\"20211230115020-g02dfx0\" data-node-index=\"1\" data-type=\"NodeParagraph\" class=\"p\"><div contenteditable=\"true\" spellcheck=\"false\">foo<strong style=\"color: var(--b3-font-color8);\">bar</strong>baz</div><div class=\"protyle-attr\" contenteditable=\"false\"></div></div>",
            "id": "20211230115020-g02dfx0",
            "parentID": "",
            "previousID": "20211229114650-vrek5x6",
            "retData": null
          }
        ],
        "undoOperations": null
      }
    ]
  }
  ```

    * `action.data`：新插入块生成的 DOM
    * `action.id`：首个插入的顶层块 ID；如果一次插入多个顶层块且需要逐个取得 ID，请每次请求只插入一个块

### 插入前置子块

* `/api/block/prependBlock`
* 参数

  ```json
  {
    "data": "foo**bar**{: style=\"color: var(--b3-font-color8);\"}baz",
    "dataType": "markdown",
    "parentID": "20220107173950-7f9m1nb"
  }
  ```

    * `dataType`：待插入数据类型，值可选择 `markdown` 或者 `dom`
    * `data`：待插入的数据
    * `parentID`：父块的 ID，用于锚定插入位置
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
      {
        "doOperations": [
          {
            "action": "insert",
            "data": "<div data-node-id=\"20220108003710-hm0x9sc\" data-node-index=\"1\" data-type=\"NodeParagraph\" class=\"p\"><div contenteditable=\"true\" spellcheck=\"false\">foo<strong style=\"color: var(--b3-font-color8);\">bar</strong>baz</div><div class=\"protyle-attr\" contenteditable=\"false\"></div></div>",
            "id": "20220108003710-hm0x9sc",
            "parentID": "20220107173950-7f9m1nb",
            "previousID": "",
            "retData": null
          }
        ],
        "undoOperations": null
      }
    ]
  }
  ```

    * `action.data`：新插入块生成的 DOM
    * `action.id`：新插入块的 ID

### 插入后置子块

* `/api/block/appendBlock`
* 参数

  ```json
  {
    "data": "foo**bar**{: style=\"color: var(--b3-font-color8);\"}baz",
    "dataType": "markdown",
    "parentID": "20220107173950-7f9m1nb"
  }
  ```

    * `dataType`：待插入数据类型，值可选择 `markdown` 或者 `dom`
    * `data`：待插入的数据
    * `parentID`：父块的 ID，用于锚定插入位置
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
      {
        "doOperations": [
          {
            "action": "insert",
            "data": "<div data-node-id=\"20220108003642-y2wmpcv\" data-node-index=\"1\" data-type=\"NodeParagraph\" class=\"p\"><div contenteditable=\"true\" spellcheck=\"false\">foo<strong style=\"color: var(--b3-font-color8);\">bar</strong>baz</div><div class=\"protyle-attr\" contenteditable=\"false\"></div></div>",
            "id": "20220108003642-y2wmpcv",
            "parentID": "20220107173950-7f9m1nb",
            "previousID": "20220108003615-7rk41t1",
            "retData": null
          }
        ],
        "undoOperations": null
      }
    ]
  }
  ```

    * `action.data`：新插入块生成的 DOM
    * `action.id`：首个追加的顶层块 ID；如果一次追加多个顶层块且需要逐个取得 ID，请每次请求只追加一个块

### 更新块

* `/api/block/updateBlock`
* 参数

  ```json
  {
    "dataType": "markdown",
    "data": "foobarbaz",
    "id": "20211230161520-querkps",
    "lockType": false
  }
  ```

    * `dataType`：待更新数据类型，值可选择 `markdown` 或者 `dom`
    * `data`：待更新的数据
    * `id`：待更新块的 ID
    * `lockType`：解析后的块类型与原块类型不同时是否拒绝更新；非法父子结构始终会被拒绝，空段落可转换为任意有效块类型；默认为 `false`
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
      {
        "doOperations": [
          {
            "action": "update",
            "data": "<div data-node-id=\"20211230161520-querkps\" data-node-index=\"1\" data-type=\"NodeParagraph\" class=\"p\"><div contenteditable=\"true\" spellcheck=\"false\">foo<strong>bar</strong>baz</div><div class=\"protyle-attr\" contenteditable=\"false\"></div></div>",
            "id": "20211230161520-querkps",
            "parentID": "",
            "previousID": "",
            "retData": null
            }
          ],
        "undoOperations": null
      }
    ]
  }
  ```

    * `action.data`：更新块生成的 DOM

### 删除块

* `/api/block/deleteBlock`
* 参数

  ```json
  {
    "id": "20211230161520-querkps"
  }
  ```

    * `id`：待删除块的 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
      {
        "doOperations": [
          {
            "action": "delete",
            "data": null,
            "id": "20211230162439-vtm09qo",
            "parentID": "",
            "previousID": "",
            "retData": null
          }
        ],
       "undoOperations": null
      }
    ]
  }
  ```

### 移动块

* `/api/block/moveBlock`
* 参数

  ```json
  {
    "id": "20230406180530-3o1rqkc",
    "previousID": "20230406152734-if5kyx6",
    "parentID": "20230404183855-woe52ko"
  }
  ```

    * `id`：待移动块 ID
    * `previousID`：前一个块的 ID，用于锚定插入位置
    * `parentID`：父块的 ID，用于锚定插入位置，`previousID` 和 `parentID` 不能同时为空，同时存在的话优先使用 `previousID`
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
        {
            "doOperations": [
                {
                    "action": "move",
                    "data": null,
                    "id": "20230406180530-3o1rqkc",
                    "parentID": "20230404183855-woe52ko",
                    "previousID": "20230406152734-if5kyx6",
                    "nextID": "",
                    "retData": null,
                    "srcIDs": null,
                    "name": "",
                    "type": ""
                }
            ],
            "undoOperations": null
        }
    ]
  }
  ```

### 折叠块

* `/api/block/foldBlock`
* 参数

  ```json
  {
    "id": "20231224160424-2f5680o"
  }
  ```

    * `id`：待折叠块的 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 展开块

* `/api/block/unfoldBlock`
* 参数

  ```json
  {
    "id": "20231224160424-2f5680o"
  }
  ```

    * `id`：待展开块的 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 获取块 kramdown 源码

* `/api/block/getBlockKramdown`
* 参数

  ```json
  {
    "id": "20201225220955-l154bn4"
  }
  ```

    * `id`：待获取块的 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "id": "20201225220955-l154bn4",
      "kramdown": "* {: id=\"20201225220955-2nn1mns\"}新建笔记本，在笔记本下新建文档\n  {: id=\"20210131155408-3t627wc\"}\n* {: id=\"20201225220955-uwhqnug\"}在编辑器中输入 <kbd>/</kbd> 触发功能菜单\n  {: id=\"20210131155408-btnfw88\"}\n* {: id=\"20201225220955-04ymi2j\"}((20200813131152-0wk5akh \"在内容块中遨游\"))、((20200822191536-rm6hwid \"窗口和页签\"))\n  {: id=\"20210131155408-hh1z442\"}"
    }
  }
  ```

* 确定性：返回的 Kramdown 会规范化块级 IAL 属性顺序；块内容和属性未变化时，属性顺序保持稳定

### 获取子块

* `/api/block/getChildBlocks`
* 参数

  ```json
  {
    "id": "20230506212712-vt9ajwj"
  }
  ```

    * `id`：父块 ID
    * 标题下方块也算作子块
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
      {
        "id": "20230512083858-mjdwkbn",
        "type": "h",
        "subType": "h1"
      },
      {
        "id": "20230513213727-thswvfd",
        "type": "s"
      },
      {
        "id": "20230513213633-9lsj4ew",
        "type": "l",
        "subType": "u"
      }
    ]
  }
  ```

### 转移块引用

* `/api/block/transferBlockRef`
* 参数

  ```json
  {
    "fromID": "20230612160235-mv6rrh1",
    "toID": "20230613093045-uwcomng",
    "refIDs": ["20230613092230-cpyimmd"]
  }
  ```

    * `fromID`：定义块 ID
    * `toID`：目标块 ID
    * `refIDs`：指向定义块 ID 的引用所在块 ID，可选，如果不指定，所有指向定义块 ID 的块引用 ID 都会被转移
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

## 属性

### 设置块属性

* `/api/attr/setBlockAttrs`
* 参数

  ```json
  {
    "id": "20210912214605-uhi5gco",
    "attrs": {
      "custom-attr1": "line1\nline2"
    }
  }
  ```

    * `id`：块 ID
    * `attrs`：块属性，自定义属性必须以 `custom-` 作为前缀
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 获取块属性

* `/api/attr/getBlockAttrs`
* 参数

  ```json
  {
    "id": "20210912214605-uhi5gco"
  }
  ```

    * `id`：块 ID
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "custom-attr1": "line1\nline2",
      "id": "20210912214605-uhi5gco",
      "title": "PDF 标注双链演示",
      "type": "doc",
      "updated": "20210916120715"
    }
  }
  ```

## SQL

### 执行 SQL 查询

* `/api/query/sql`
* 参数

  ```json
  {
    "stmt": "SELECT * FROM blocks WHERE content LIKE'%content%' LIMIT 7"
  }
  ```

    * `stmt`：SQL 脚本
    * `mode`：可选模式，省略、`null` 或 `""` 允许单条读写语句；`"readonly"` 仅允许单条只读 `SELECT` 或 `WITH` 查询；`"multiple"` 按顺序执行多条语句并返回最后一条的结果

没有结果列的语句（包括 `INSERT`、`UPDATE`、`DELETE` 和 DDL）也会执行，成功时返回 `data: []`；`RETURNING` 保留结果行。校验失败返回 `code: -1`，执行失败返回 `code: 1`。多语句在首次失败时停止，已完成的写入不会自动回滚。直接 SQL 写入作用于派生索引库，不会更新源文档，也不维护全文索引和块缓存；编辑文档内容请使用块接口。

未显式指定外层 `LIMIT` 时，默认最多返回 `search.limit` 行，即设置中的搜索结果条数。因此，请使用显式的 `LIMIT` 和 `OFFSET` 分页，并采用稳定且唯一的排序，例如 `ORDER BY hpath, id`。显式外层 `LIMIT` 会覆盖默认限制，可以大于 `search.limit`。

* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
      { "列": "值" }
    ],
    "limit": 0,
    "truncated": false
  }
  ```

成功时，`data` 仍为数组。`limit` 表示本次查询应用的服务端默认上限；SQL 显式指定外层 `LIMIT` 时为 `0`，不表示该子句指定的数值。仅当服务端默认限制导致至少一行结果未返回时，`truncated` 才为 `true`；结果恰好达到上限不算截断。上例显式指定了 `LIMIT 7`，因此 `limit` 为 `0`，`truncated` 为 `false`。错误响应不包含这两个字段。

注意：为保证数据安全，发布模式下禁止访问该接口。

### 提交事务

* `/api/sqlite/flushTransaction`
* 不带参
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

写块接口可能在块树事务已提交、异步 SQL 索引尚未完成时返回。如需随后通过 `/api/query/sql` 立即读取该写入，请在写入后调用 `POST /api/sqlite/flushTransaction`，等待返回 `code: 0`，再查询 SQL。例如，`getBlockKramdown` 读取块树，可能比 SQL 索引更早显示新写入的内容。Kramdown、DOM 和 SQL 列是不同的内容表示，均非规范化纯文本。

## 模板

### 渲染模板

* `/api/template/render`
* 参数

  ```json
  {
    "id": "20220724223548-j6g0o87",
    "path": "F:\\SiYuan\\data\\templates\\foo.md",
    "mode": "editorInsert"
  }
  ```

    * `id`：调用渲染所在的文档 ID
    * `path`：模板文件绝对路径
    * `mode`：可选渲染模式。目前仅支持 `"preview"` 和 `"editorInsert"`。预览模式生成文档树计划但不写入文件；编辑器插入模式生成可在确认后通过对应编辑器事务应用的计划
    * 省略 `mode` 时，仍支持旧的布尔参数 `preview`：`preview: true` 等价于 `mode: "preview"`；否则模板按普通内容渲染，并禁用 `createDocTree`
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "content": "<div data-node-id=\"20220729234848-dlgsah7\" data-node-index=\"1\" data-type=\"NodeParagraph\" class=\"p\" updated=\"20220729234840\"><div contenteditable=\"true\" spellcheck=\"false\">foo</div><div class=\"protyle-attr\" contenteditable=\"false\">​</div></div>",
      "path": "F:\\SiYuan\\data\\templates\\foo.md",
      "docTreePlan": {
        "id": "template-plan-token",
        "count": 2,
        "nodes": [
          {
            "id": "20260830150000-abc1234",
            "title": "Materials",
            "parentID": "20220724223548-j6g0o87",
            "hPath": "/Parent/Materials",
            "depth": 1
          },
          {
            "id": "20260830150001-def5678",
            "title": "Review",
            "parentID": "20260830150000-abc1234",
            "hPath": "/Parent/Materials/Review",
            "depth": 2
          }
        ]
      }
    }
  }
  ```

    * `docTreePlan`：模板通过 `createDocTree` 声明子文档树时返回
        * `id`：预览模式下为空，且不会写入文件。编辑器插入模式下为短期有效的一次性计划令牌；确认后，将其作为对应事务对象的顶层 `templateDocTreePlanID` 字段提交
        * `count`：计划中的子文档总数
        * `nodes`：计划文档的静态描述
            * `id`：计划文档 ID
            * `title`：计划文档标题
            * `parentID`：计划父文档 ID
            * `hPath`：计划文档的人类可读路径
            * `depth`：相对于模板插入所在文档的深度
        * 单个计划最多包含 128 个文档，声明的子文档树最多为 16 层。最终文件树的绝对深度仍受是否允许创建 7 层以上子文档的设置约束

### 将文档保存为模板

* `/api/template/docSaveAsTemplate`
* 参数

  ```json
  {
    "id": "20220724223548-j6g0o87",
    "name": "项目",
    "overwrite": false,
    "databaseMode": "copy"
  }
  ```

    * `id`: 源文档 ID
    * `name`: 模板名称。内核会清理名称并添加 `.md` 扩展名
    * `overwrite`: 是否覆盖同名模板。为 `false` 且模板已存在时，响应 `code` 为 `1`
    * `databaseMode`: 文档中所有数据库块的可选处理方式。`copy`（默认值）在每次使用模板时创建独立数据库，并清除块级上下文筛选；`reference` 保留原有数据库 ID 和上下文筛选，使渲染出的块成为与源数据库共享数据和视图配置的镜像。若目标文档的加密边界内无法访问源数据库，引用模式的模板渲染会失败
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 渲染 Sprig

* `/api/template/renderSprig`
* 参数

  ```json
  {
    "template": "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}"
  }
  ```
    * `template`：模板内容
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "/daily note/2023/03/2023-03-24"
  }
  ```

## 文件

### 获取文件

* `/api/file/getFile`
* 参数

  ```json
  {
    "path": "/data/20210808180117-6v0mkxr/20200923234011-ieuun1p.sy"
  }
  ```
    * `path`：工作空间路径下的文件路径
* 返回值

    * 响应状态码 `200`: 文件内容
    * 响应状态码 `202`: 异常信息

      ```json
      {
        "code": 404,
        "msg": "",
        "data": null
      }
      ```

        * `code`: 非零的异常值

            * `-1`: 参数解析错误
            * `403`: 无访问权限 (文件不在工作空间下)
            * `404`: 未找到 (文件不存在)
            * `405`: 方法不被允许 (这是一个目录)
            * `500`: 服务器错误 (文件查询失败 / 文件读取失败)
        * `msg`: 一段描述错误的文本

### 写入文件

* `/api/file/putFile`

写入由笔记本及文档 ID 组成的 `.sy` 文档路径时，同时检查传入内容和已有文档。未知格式、损坏的文档源或标题含 `/` 但未声明所需的 Spec 6 时返回 `code: -1`，保留原文件及修改时间；成功写入保留请求中的原始字节，不规范化标题。附件或插件目录中的 `.sy` 文件不作为文档解析。

新传入的标题含 ASCII `/` 时，必须声明 `Spec` 至少为 `6`，否则返回 `code: -1`、`msg: "document title requires spec 6"`，不自动改写内容。已有低 Spec 源仍可读取，也可以由版本标记合法的内容替换。

* 参数为 HTTP Multipart 表单

    * `path`：工作空间路径下的文件路径
    * `isDir`：是否为创建文件夹，为 `true` 时仅创建文件夹，忽略 `file`
    * `modTime`：最近访问和修改时间，Unix time
    * `file`：上传的文件
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 删除文件

* `/api/file/removeFile`

删除沿用规范路径、敏感文件和加密笔记本限制，校验失败返回 `code: -1`；已撤销的寻址模式记录不参与删除判定。
* 参数

  ```json
  {
    "path": "/data/20210808180117-6v0mkxr/20200923234011-ieuun1p.sy"
  }
  ```
    * `path`：工作空间路径下的文件路径
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 重命名文件

* `/api/file/renameFile`

创建目标目录或移动文件之前会检查完整操作的规范路径及目标文档源兼容性，校验失败返回 `code: -1`；既有敏感路径和加密笔记本限制继续生效。

目标包含由笔记本及文档 ID 组成的 `.sy` 文档路径时，也会预检全部传入文档；未知格式、损坏的文档源或标题冲突返回 `code: -1`，不创建目标目录，也不移动来源。

新移入的标题含 ASCII `/` 时，必须声明 `Spec` 至少为 `6`，否则返回 `code: -1`、`msg: "document title requires spec 6"`，保留来源和目标。

* 参数

  ```json
  {
    "path": "/data/assets/image-20230523085812-k3o9t32.png",
    "newPath": "/data/assets/test-20230523085812-k3o9t32.png"
  }
  ```
    * `path`：工作空间路径下的文件路径
    * `newPath`：新的文件路径
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 列出文件

* `/api/file/readDir`
* 参数

  ```json
  {
    "path": "/data/20210808180117-6v0mkxr/20200923234011-ieuun1p"
  }
  ```
    * `path`：工作空间路径下的文件夹路径
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
      {
        "isDir": true,
        "isSymlink": false,
        "name": "20210808180303-6yi0dv5",
        "updated": 1691467624
      },
      {
        "isDir": false,
        "isSymlink": false,
        "name": "20210808180303-6yi0dv5.sy",
        "updated": 1663298365
      }
    ]
  }
  ```

## 导出

### 导出 Markdown 文本

* `/api/export/exportMdContent`
* 参数

  ```json
  {
    "id": ""
  }
  ```

    * `id`：要导出的文档块 ID
    * `preserveTaskMarkers`：用于复制 Markdown 的可选布尔值，`true` 时保留 `[/]`、`[-]` 等任务标记；省略、`null` 或 `false` 时保持标准 Markdown 兼容行为，将非标准标记归一化为 `[X]`
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "hPath": "/0 请从这里开始",
      "content": "## 🍫 内容块\n\n在思源中，唯一重要的核心概念是..."
    }
  }
  ```

    * `hPath`：人类可读的路径
    * `content`：Markdown 内容，文档启用标题自动编号时包含编号（文档设置优先于编辑器默认设置）；使用编辑器编号格式，局部导出保留原文档编号

### 导出文件与目录

* `/api/export/exportResources`
* 参数

  ```json
  {
    "paths": [
      "/conf/appearance/boot",
      "/conf/appearance/langs",
      "/conf/appearance/emojis/conf.json",
      "/conf/appearance/icons/index.html"
    ],
    "name": "zip-file-name"
  }
  ```

    * `paths`：要导出的文件或文件夹路径列表，相同名称的文件/文件夹会被覆盖
    * `name`：（可选）导出的文件名，未设置时默认为 `export-YYYY-MM-DD_hh-mm-ss.zip`
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "path": "temp/export/zip-file-name.zip"
    }
  }
  ```

    * `path`：创建的 `*.zip` 文件路径
        * `zip-file-name.zip` 中的目录结构如下所示：
            * `zip-file-name`
                * `boot`
                * `langs`
                * `conf.json`
                * `index.html`

## 转换

### Pandoc

* `/api/convert/pandoc`
* 工作目录
    * 执行 pandoc 命令时工作目录会被设置在 `工作空间/temp/convert/pandoc/${test}` 下
    * 可先通过 API [`写入文件`](#写入文件) 将待转换文件写入该目录
    * 然后再调用该 API 转换，转换后的文件也会被写入该目录
    * 最后调用 API [`获取文件`](#获取文件) 获取转换后的文件内容
        * 或者调用 API [`通过 Markdown 创建文档`](#通过-markdown-创建文档)
        * 或者调用内部 API `importStdMd` 将转换后的文件夹直接导入
* 参数

  ```json
  {
    "dir": "test",
    "args": [
      "--to", "markdown_strict-raw_html",
      "foo.epub",
      "-o", "foo.md"
   ]
  }
  ```

    * `args`：Pandoc 命令行参数
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
       "path": "/temp/convert/pandoc/test"
    }
  }
  ```
    * `path`：工作空间下的路径

## 通知

### 推送消息

* `/api/notification/pushMsg`
* 参数

  ```json
  {
    "msg": "test",
    "timeout": 7000
  }
  ```
    * `timeout`：消息持续显示时间，单位为毫秒。可以不传入该字段，默认为 7000 毫秒
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
        "id": "62jtmqi"
    }
  }
  ```
    * `id`：消息 ID

### 推送报错消息

* `/api/notification/pushErrMsg`
* 参数

  ```json
  {
    "msg": "test",
    "timeout": 7000
  }
  ```
    * `timeout`：消息持续显示时间，单位为毫秒。可以不传入该字段，默认为 7000 毫秒
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
        "id": "qc9znut"
    }
  }
  ```
    * `id`：消息 ID

## 网络

### 正向代理

#### JSON 正向代理

* `/api/network/forwardProxy`
* 参数

  ```json
  {
    "url": "https://b3log.org/siyuan/",
    "method": "GET",
    "timeout": 7000,
    "contentType": "text/html",
    "headers": [
        {
            "Cookie": ""
        }
    ],
    "redirect": true,
    "payload": {},
    "payloadEncoding": "json",
    "responseEncoding": "text"
  }
  ```

    * `url`：转发的 URL
    * `method`：HTTP 方法，默认为 `POST`
    * `timeout`：超时时间，单位为毫秒，默认为 `7000` 毫秒
    * `contentType`：HTTP Content-Type，默认为 `application/json`
    * `headers`：HTTP 请求标头数组，每个对象中的键值对都会设置为请求标头
    * `redirect`：是否跟随重定向，默认为 `true`，最多跟随 2 次；设置为 `false` 时不跟随重定向
    * `payload`：HTTP 请求体，可以是对象或者字符串
    * `payloadEncoding`：`payload` 所使用的编码方案，默认为 `json`；`json` 会直接发送 `payload`，二进制请求体可使用以下编码字符串

        * `json`
        * `base64` | `base64-std`
        * `base64-url`
        * `base32` | `base32-std`
        * `base32-hex`
        * `hex`
    * `responseEncoding`：响应数据中 `body` 字段所使用的编码方案，默认为 `text`，可选值如下所示

        * `text`
        * `base64` | `base64-std`
        * `base64-url`
        * `base32` | `base32-std`
        * `base32-hex`
        * `hex`

      `text` 保持现有行为，在适用时将字符集转换为 UTF-8。二进制编码作用于字符集转换前的响应正文数据；gzip 解压等现有 HTTP 内容解码行为不变。

      HTTP 内容解码后的响应正文上限为 32 MiB，超限时返回错误码 `10` 且不返回部分正文。因此，大文件或流式响应请使用 `/api/network/proxy`。
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "body": "",
      "bodyEncoding": "text",
      "contentType": "text/html",
      "elapsed": 1976,
      "headers": {
      },
      "status": 200,
      "url": "https://b3log.org/siyuan/"
    }
  }
  ```

    * `body`：响应体
    * `bodyEncoding`：`body` 所使用的编码方案，与请求中 `responseEncoding` 字段一致，默认为 `text`，可能的值如下所示

        * `text`
        * `base64` | `base64-std`
        * `base64-url`
        * `base32` | `base32-std`
        * `base32-hex`
        * `hex`
    * `contentType`：响应标头 `Content-Type`
    * `elapsed`：请求耗时，单位为毫秒
    * `headers`：目标服务返回的响应标头
    * `status`：目标服务返回的 HTTP 状态码
    * `url`：转发的 URL

#### HTTP 正向代理

* `/api/network/proxy`
* 请求方法：任意 HTTP 方法
* 查询参数

    * `u`：必填，目标 `http` 或 `https` URL 使用 Go `base64.RawURLEncoding` 编码后的字符串，也就是 URL 安全且不带 `=` 填充的 Base64
    * `h`：可选，请求标头 JSON 使用同样方式编码后的字符串，JSON 类型为 `map[string][]string`，例如 `{"Authorization":["Bearer token"]}`
    * `t`：可选，连接超时时间，使用 Go `time.ParseDuration` 格式，例如 `30s`、`1500ms`
* 请求体：原样转发当前请求体，当前请求的完整 `Content-Type` 标头会转发到目标请求
* 返回值：直接返回目标服务的 HTTP 状态码和响应体，不封装 `code`、`msg`、`data`；目标服务响应标头会添加 `Siyuan-Proxy-` 前缀后返回，例如 `Content-Type` 会返回为 `Siyuan-Proxy-Content-Type`

#### WebSocket 正向代理

* `/ws/network/proxy`
* 请求方法：`GET`
* 查询参数

    * `u`：必填，目标 `ws` 或 `wss` URL 使用 Go `base64.RawURLEncoding` 编码后的字符串
    * `h`：可选，握手请求标头 JSON 使用同样方式编码后的字符串，JSON 类型为 `map[string][]string`
    * `t`：可选，握手超时时间，使用 Go `time.ParseDuration` 格式，例如 `30s`、`1500ms`
* 返回值：升级为 WebSocket 后双向转发消息；目标服务握手响应标头会添加 `Siyuan-Proxy-` 前缀后返回

#### EventSource 正向代理

* `/es/network/proxy`
* 请求方法：`GET`
* 查询参数

    * `u`：必填，目标 `http` 或 `https` URL 使用 Go `base64.RawURLEncoding` 编码后的字符串
    * `h`：可选，请求标头 JSON 使用同样方式编码后的字符串，JSON 类型为 `map[string][]string`
    * `t`：可选，连接超时时间，使用 Go `time.ParseDuration` 格式，例如 `30s`、`1500ms`
* 返回值：直接流式返回目标服务的 HTTP 状态码和响应体，不封装 `code`、`msg`、`data`；如果请求标头中没有 `Accept`，会自动使用 `text/event-stream`；目标服务响应标头会添加 `Siyuan-Proxy-` 前缀后返回

## 系统

### 获取启动进度

* `/api/system/bootProgress`
* 不带参
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "details": "Finishing boot...",
      "progress": 100
    }
  }
  ```

### 获取系统版本

* `/api/system/version`
* 不带参
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "1.3.5"
  }
  ```

### 获取系统当前时间

* `/api/system/currentTime`
* 不带参
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": 1631850968131
  }
  ```

    * `data`: 精度为毫秒

## 数据库

数据库（内核中为“属性视图”）以字段（列）和条目（行）的形式存储结构化数据。每个数据库由 `avID` 标识，可通过一个或多个数据库块（`blockID`）嵌入到文档中。一个数据库可包含多个不同布局类型的视图（`viewID`）：`table`（表格）、`list`（列表）、`gallery`（卡片）和 `kanban`（看板）。

字段类型（`keyType`）如下：

| 取值         | 说明                 |
|--------------|----------------------|
| `block`      | 主键（绑定的块）     |
| `text`       | 文本                 |
| `number`     | 数字                 |
| `date`       | 日期                 |
| `select`     | 单选                 |
| `mSelect`    | 多选                 |
| `url`        | URL                  |
| `email`      | 邮箱                 |
| `phone`      | 电话                 |
| `location` | 位置 |
| `mAsset`     | 资源                 |
| `template`   | 模板                 |
| `created`    | 创建时间             |
| `updated`    | 更新时间             |
| `checkbox`   | 复选框               |
| `relation`   | 关联                 |
| `rollup`     | 汇总                 |
| `lineNumber` | 行号                 |

### 渲染

* `/api/av/renderAttributeView`
* 参数

  ```json
  {
    "id": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t",
    "viewID": "",
    "page": 1,
    "pageSize": 50,
    "query": "",
    "groupPaging": {},
    "targetItemID": "",
    "targetGroupID": "",
    "createIfNotExist": true,
    "persistView": true
  }
  ```

    * `id`: 数据库 ID
    * `blockID`: 嵌入该数据库的数据库块，用于解析当前视图、发布权限和块级上下文筛选。其 `custom-sy-av-view` 缺失或无效时使用第一个可用视图。渲染独立数据库时可省略；已配置上下文筛选时必须传入有效的数据库块实例
    * `viewID`: 明确指定要渲染的视图。值无效时返回错误；省略时先通过 `blockID` 解析，无法解析则使用第一个可用视图
    * `page`: 页码，从 1 开始。默认为 `1`
    * `pageSize`: 每页条目数。`-1` 或省略表示使用视图默认值（`50`）
    * `query`: 可选的主键值全文过滤关键字
    * `groupPaging`: 分组（看板）视图的可选分页配置
    * `targetItemID`: 可选的待定位数据库条目 ID。指定后，返回值中包含目标定位信息
    * `targetGroupID`: 与 `targetItemID` 配合使用的可选分组提示
    * `temporarySort`: 可选的单字段排序，例如 `{"column":"field-id","order":"DESC"}`。省略或为 `null` 时使用已保存规则；指定时仅覆盖本次请求的排序，在分页前生效，不创建或保存数据库，也不改变载体默认视图。`order` 必须为 `ASC` 或 `DESC`；字段缺失或不支持排序时恢复已保存规则。支持现有的 `valueSource` 和 `dateEndpoint` 选项
    * `createIfNotExist`: 为 `true`（默认）时，若数据库不存在则创建包含默认视图的数据库
    * `persistView`: 已废弃的兼容参数。接口仍接受该参数但会忽略，因为数据库定义不再存储顶层当前视图
* 返回值（真实响应，表格布局，展示一行）：

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "name": "API 测试",
      "id": "20240118120204-kwyzf77",
      "viewType": "table",
      "viewID": "20240118120204-7rnmyc1",
      "isMirror": false,
      "contextFilter": null,
      "contextFilterFields": [],
      "views": [
        {
          "id": "20240118120204-7rnmyc1",
          "icon": "",
          "name": "表格",
          "desc": "",
          "hideAttrViewName": false,
          "type": "table",
          "pageSize": 50
        }
      ],
      "view": {
        "id": "20240118120204-7rnmyc1",
        "icon": "",
        "name": "表格",
        "desc": "",
        "hideAttrViewName": false,
        "filters": [],
        "sorts": [],
        "group": null,
        "pageSize": 50,
        "showIcon": true,
        "wrapField": false,
        "groupFolded": false,
        "groupHidden": 0,
        "columns": [
          {
            "id": "20240118120204-w6cggab",
            "name": "主键",
            "type": "block",
            "icon": "",
            "wrap": false,
            "hidden": false,
            "desc": "",
            "calc": null,
            "numberFormat": "",
            "template": "",
            "pin": false,
            "width": ""
          }
        ],
        "rows": [
          {
            "id": "20240118203831-fkfvvtx",
            "cells": [
              {
                "id": "20240118203911-xrg9obl",
                "value": {
                  "id": "20240118203911-xrg9obl",
                  "keyID": "20240118120204-w6cggab",
                  "blockID": "20240118203831-fkfvvtx",
                  "type": "block",
                  "createdAt": 1706843791000,
                  "updatedAt": 1706843791000,
                  "block": {
                    "id": "20240118203831-fkfvvtx",
                    "content": "3",
                    "created": 1706843791000,
                    "updated": 1706843791000
                  }
                },
                "valueType": "block",
                "color": "",
                "bgColor": ""
              }
            ]
          }
        ],
        "rowCount": 5
      }
    }
  }
  ```

    * `data.view`: 渲染后的视图实例。结构随 `viewType` 而变：`table` 和 `list` 返回 `columns`/`rows`/`rowCount`，`gallery` 和 `kanban` 返回 `fields`/`cards`/`cardCount`。启用分组时，`groups` 包含各分组的视图实例，每个实例含 `groupKey`/`groupValue`。`view` 还包含 `filters`/`sorts`/`group`/`showIcon`/`wrapField`/`groupFolded`/`groupHidden`。注意：启用的过滤或分组可能使条目列表为空，即使条目总数大于 0
    * `data.view.columns[]`: 每列含 `id`/`name`/`type`/`icon`/`wrap`/`hidden`/`desc`/`calc`/`numberFormat`/`template`/`renderTemplate`/`pin`/`width`；`select`/`mSelect` 列还额外包含 `options`。画廊和看板字段在 `data.view.fields[]` 中返回相同的字段元数据
    * `data.view.columns[].renderTemplate`: 普通字段可选的显示模板，仅改变显示内容，字段原有类型的存储值保持不变
    * `data.view.rows[].id`: 表格行的**条目 ID**（`itemID`），也等于该行主键单元格的 `value.blockID`。对于绑定行，绑定块 ID 位于主键单元格的 `value.block.id`；二者是不同概念，不能假设相等
    * `data.view.cards[].id`: 卡片或看板卡片的**条目 ID**（`itemID`）。启用分组时，表格行或卡片位于 `groups[]` 的对应视图实例中
    * `data.view.rows[].cells[].value`: 一个 `Value` 对象——所有 value 形态见 [设置单元格值](#设置单元格值)。`createdAt`/`updatedAt` 为 int64 毫秒时间戳。当普通字段配置了非空 `renderTemplate` 时，可选属性 `renderedContent` 包含运行时显示模板结果；该属性不会持久化，原有类型属性仍包含存储值。`data.view.cards[]` 中的值遵循相同规则
    * `data.views`: 所有视图的元数据（不含行数据）
    * `data.isMirror`: 当数据库块为数据库的镜像（只读副本）时为 `true`
    * `data.contextFilter`: 当前数据库块配置的上下文筛选；禁用时为 `null`。当前规格为 `{ "spec": 1, "keyID": "<关联字段 ID>" }`，它会在所有视图中筛选出所选关联字段包含 `blockID` 所在根文档所绑定数据库条目的行，并与当前视图的筛选条件通过“且”组合。所选字段被删除、改为非关联字段或关联目标失效时，该块级配置会保留，但渲染结果为空，直至修复字段、更换字段或禁用上下文筛选
    * `data.contextFilterFields`: 数据库中所有已配置关联字段的轻量元数据，不受当前所选视图影响。每项包含 `id`、`name`、`icon` 和 `targetAvID`，用于配置 `contextFilter`。发布只读响应会将 `contextFilter` 隐藏为 `null`，并将此列表隐藏为 `[]`，但已保存的上下文筛选仍会应用于渲染结果

### 设置数据库块上下文筛选

* `/api/av/setAttrViewContextFilter`
* 参数

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t",
    "keyID": "20240118120300-relation"
  }
  ```

    * `avID`: 数据库 ID
    * `blockID`: 要修改上下文筛选的具体数据库块 ID，必须是 `avID` 的实例
    * `keyID`: 数据库中已配置的关联字段 ID，筛选语义固定等同于 `包含任一 - 当前文档`。传入空字符串可禁用上下文筛选
* 返回值：`data.contextFilter` 中的规范化配置；禁用后为 `null`

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "contextFilter": {
        "spec": 1,
        "keyID": "20240118120300-relation"
      }
    }
  }
  ```

### 获取当前数据库视图中的图片

* `/api/av/getCurrentAttrViewImages`
* 参数

  ```json
  {
    "id": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t",
    "viewID": "20240118120204-7rnmyc1",
    "query": ""
  }
  ```

    * `id`: 数据库 ID
    * `blockID`: 嵌入该数据库的数据库块，用于解析当前视图、发布权限和块级上下文筛选。仅在独立数据库且不需要块上下文时省略
    * `viewID`: 可选的明确视图 ID。省略时先通过 `blockID` 解析，无法解析则使用第一个可用视图
    * `query`: 可选的主键值全文过滤关键字
    * `groupID`: 可选的分组 ID。省略、null 或空字符串时保持整个视图行为；指定时仅返回该分组图片，先按组内条目顺序排列，再应用视图排序，不受分页限制。分组不存在时返回错误
* 返回值：应用数据库块上下文筛选、视图筛选与排序后，可见资源字段中的图片资源路径数组

  ```json
  {
    "code": 0,
    "msg": "",
    "data": ["assets/example-20240118120201-abc1234.png"]
  }
  ```

### 获取

* `/api/av/getAttributeView`
* 参数

  ```json
  {
    "id": "20240118120204-kwyzf77"
  }
  ```

    * `id`: 数据库 ID
* 返回值（真实响应，已裁剪——`keyValues`/`views` 数组做了截断）：

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "av": {
        "spec": 4,
        "id": "20240118120204-kwyzf77",
        "name": "API 测试",
        "keyValues": [
          {
            "key": {
              "id": "20240118120204-w6cggab",
              "name": "主键",
              "type": "block",
              "icon": "",
              "desc": "",
              "numberFormat": "",
              "template": ""
            },
            "values": [
              {
                "id": "20240118203911-xrg9obl",
                "keyID": "20240118120204-w6cggab",
                "blockID": "20240118203831-fkfvvtx",
                "type": "block",
                "createdAt": 1706843791000,
                "updatedAt": 1706843791000,
                "block": {
                  "id": "20240118203831-fkfvvtx",
                  "content": "3",
                  "created": 1706843791000,
                  "updated": 1706843791000
                }
              }
            ]
          }
        ],
        "keyIDs": null,
        "viewID": "20240118120204-7rnmyc1",
        "views": [
          {
            "id": "20240118120204-7rnmyc1",
            "icon": "",
            "name": "表格",
            "hideAttrViewName": false,
            "desc": "",
            "pageSize": 50,
            "type": "table",
            "table": {
              "spec": 0,
              "id": "20240118120204-grokgmm",
              "showIcon": true,
              "wrapField": false,
              "columns": [
                {
                  "id": "20240118120204-w6cggab",
                  "wrap": false,
                  "hidden": false,
                  "pin": false,
                  "width": ""
                }
              ]
            },
            "itemIds": ["20240118203818-ct041hj", "20240118203855-sqzbja0", "20240118203831-fkfvvtx", "20240118203842-kc31ovy", "20240531235026-uiap07y"],
            "groupCreated": 0,
            "groupItemIds": null,
            "groupFolded": false,
            "groupHidden": 0,
            "groupSort": 0
          }
        ]
      }
    }
  }
  ```

    * `data.av`: 完整的 `AttributeView` 定义——字段（`keyValues`）、字段顺序（`keyIDs`，可能为 `null`），以及所有视图的原始布局配置（`table`/`list`/`gallery`/`kanban`）和条目顺序（`itemIds`）。兼容字段 `viewID` 动态取第一个可用视图，不会持久化。返回值不含渲染后的行或分页；需要计算后的行数据请使用 [渲染](#渲染)

    * `data.av.automations` 可选，保存数据库共享的规则（`spec: 1` 至 `8`）。`block` 触发器通过 `blockSource` 指定笔记本/文档范围、块类型、标签和自定义属性，`collect` 动作将符合条件的原块绑定到当前数据库。通过 `setAttrViewAutomations` 保存新增范围时，笔记本与文档分别去重后合计最多 32 项。既有超限范围仍可读取和使用，可保留或删减；超限时新增范围会被拒绝。撤销重做保留原范围。主类型包含全部子类型；格式 3 支持 `h:h1` 至 `h:h6`、`l:u/o/t`、`i:u/o/t` 和 `callout:TYPE`（区分大小写，允许自定义提示类型）。类型为空不限制，多个类型取任一匹配。自动创建的主键值可能包含由内核维护的 `block.collectionRuleID`。自动收集只添加条目，原文变化及规则条件、范围、对象或启用状态变化均保留已有条目和字段，再次匹配仍使用原条目。主动清理按全部启用的收集规则统一检查手动和自动绑定条目，保留匹配或无法判断的条目，执行前复查后仅移出确认不匹配的条目；撤销恢复原条目及全部字段。 `blockSource.tagMatch` 和 `attributeMatch` 缺省为 `and`，格式 3 支持各组独立设置 `or`；组间仍取与关系，空组不限制。 每条规则的可选 `notifyOnSuccess` 缺省或 `null` 为 `true`，实际变更在事务提交成功后合并通知；关闭不影响错误提示。无变化、手动收集、撤销重做及回滚事务不发送成功通知。 格式 4 增加可选的 `blockSource.tagTarget`：缺省或空字符串使用默认选择，优先收集合格列表项而非其首个内容块，`block` 收集标签所在块，`container` 选择最近的符合类型和属性条件的容器并按块 ID 去重；文档需显式选择 `d`。全部标签须在同一个来源块中，无标签条件时此选项不影响筛选。预览与实际收集对象一致，切换保留已有条目及字段。 格式 5 增加可选的 `blockSource.documentDepth`：缺省或 `null` 表示不限，`0` 仅包含每个选中文档本身，`1` 还包含一级子文档，其他非负整数指定最大相对后代深度。该设置统一限制文档范围，不影响笔记本范围，各范围仍取并集。修改深度保留已有条目和字段，不自动补收存量内容。 格式 6 为每条属性条件增加可选的 `nameOperator`：缺省、空字符串或 `equals` 保持完整名称精确匹配，`contains` 按字面子串匹配且无需输入 `custom-` 前缀，`regex` 使用 Go 正则语法匹配包含该前缀的完整名称。仅匹配自定义属性，名称和值区分大小写，且必须由同一条属性同时满足；`exists` 要求至少一个名称匹配，`notExists` 要求没有名称匹配，两者忽略属性值。名称模式最多 256 字节，非法正则拒绝保存。既有格式 1–5 的行为保持不变，旧读取器拒绝格式 6 且不改写数据库。 格式 7 增加可选的 `blockSource.includeSelectedDocuments`：缺省、`null` 或 `true` 包含每个所选文档自身；`false` 排除该文档及其内部所有块，子文档仍按 `documentDepth` 匹配。该设置由所有文档范围共用，不影响笔记本范围或其他重叠文档范围，各范围仍取并集。`false` 与深度 `0` 组合时，对应文档范围为空。修改后保留已有条目和字段，不自动补收或移出。格式 1–6 仍可读取，旧读取器拒绝格式 7 且不改写数据库。 格式 8 增加可选的 `blockSource.referenceID`：匹配正文中指向该块的块引用，文档目标还包含内部内容块，不含子文档；不包含嵌入块、普通链接和数据库富文本字段中的引用。标签约束同一引用来源块，来源按反链父块规则归并后再匹配类型和属性，`tagTarget` 不参与选择。目标必须位于同一加密边界。移除引用或更改目标会保留已有条目和字段，历史内容需预览后显式补收。既有格式 1–7 仍可读取，旧客户端会拒绝格式 8 且不改写数据库。

### 获取主键值

* `/api/av/getAttributeViewPrimaryKeyValues`
* 参数

  ```json
  {
    "id": "20240118120204-kwyzf77",
    "keyword": "",
    "page": 1,
    "pageSize": 16
  }
  ```

    * `id`: 数据库 ID
    * `keyword`: 可选的主键文本子串过滤（不区分大小写）
    * `page`: 页码，从 1 开始。默认为 `1`
    * `pageSize`: 每页条目数。`-1` 或省略表示 `16`。结果按 `block.updated` 倒序排序
* 返回值（真实响应，展示一个值）：

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "name": "API 测试",
      "blockIDs": ["20240118120201-kldj15t"],
      "total": 1,
      "rows": {
        "key": {
          "id": "20240118120204-w6cggab",
          "name": "主键",
          "type": "block",
          "icon": "",
          "desc": "",
          "numberFormat": "",
          "template": ""
        },
        "values": [
          {
            "id": "20240118203911-xrg9obl",
            "keyID": "20240118120204-w6cggab",
            "blockID": "20240118203831-fkfvvtx",
            "type": "block",
            "createdAt": 1706843791000,
            "updatedAt": 1706843791000,
            "block": {
              "id": "20240118203831-fkfvvtx",
              "content": "3",
              "created": 1706843791000,
              "updated": 1706843791000
            }
          }
        ]
      }
    }
  }
  ```

    * `data.rows`: 一个 `KeyValues` 对象，包含主键（`block`）字段及其分页后的值
    * `data.blockIDs`: 引用该数据库的所有数据库块（镜像）ID
    * `data.total`: 过滤后、分页前的主键值数量

### 搜索

* `/api/av/searchAttributeView`
* 参数

  ```json
  {
    "keyword": "API",
    "excludes": [],
    "includeViewMatches": true
  }
  ```

    * `keyword`: 搜索关键字（匹配数据库名称）
    * `excludes`: 可选，需从结果中排除的数据库 ID 列表
    * `includeViewMatches`: 可选，设为 `true` 时同时搜索视图名称，命中的子视图包含 `"matched": true`
* 返回值（真实响应）：

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "results": [
        {
          "avID": "20240118120204-kwyzf77",
          "avName": "API 测试",
          "viewName": "",
          "viewID": "",
          "viewLayout": "",
          "blockID": "20240118120201-kldj15t",
          "hPath": "正在跟进的问题/数据库/API",
          "children": [
            {
              "avID": "20240118120204-kwyzf77",
              "avName": "API 测试",
              "viewName": "表格",
              "viewID": "20240118120204-7rnmyc1",
              "viewLayout": "table",
              "matched": true,
              "blockID": "20240118120201-kldj15t",
              "hPath": "正在跟进的问题/数据库/API"
            }
          ]
        }
      ]
    }
  }
  ```

    * `data.results[]`: 每个顶层结果按 `avID` 聚合一个数据库；其 `children[]` 列出该数据库的各个视图（`viewName`/`viewID`/`viewLayout`），启用 `includeViewMatches` 时由 `matched` 标识名称命中的视图

### 设置单元格值

更新单个单元格（某一行的某个字段）。这是单元格值的主要写入接口。请求中的 `value` 是一个部分 `Value` 对象，其结构取决于字段的 `keyType`。常见 value 结构如下：

| `keyType`  | `value` 结构                                                                                                         |
|------------|----------------------------------------------------------------------------------------------------------------------|
| `block`    | `{"block": {"content": "第一行", "id": "<绑定块ID>"}, "isDetached": false}`                                          |
| `text`     | `{"text": {"content": "文本"}}`                                                                                      |
| `text`（富文本） | `{"text": {"content": "文本", "rich": {"spec": 1, "format": "kramdown", "content": "**文本**"}}}`     |
| `number`   | `{"number": {"content": 42, "isNotEmpty": true}}`（清空用 `{"isNotEmpty": false}`）                                  |
| `date`     | `{"date": {"content": 1676042451000, "isNotEmpty": true}}`（毫秒时间戳）                                             |
| `select`   | `{"mSelect": [{"content": "已完成", "color": "1"}]}`（至多一个选项）                                                 |
| `mSelect`  | `{"mSelect": [{"content": "A", "color": "1"}, {"content": "B", "color": "2"}]}`                                      |
| `url`      | `{"url": {"content": "https://siyuan.com"}}`                                                                         |
| `email`    | `{"email": {"content": "a@b.com"}}`                                                                                  |
| `phone`    | `{"phone": {"content": "1234567890"}}`                                                                               |
| `location` | `{"location":{"name":"Home","latitude":0,"longitude":0,"originalInput":"0, 0"}}` |
| `mAsset`   | `{"mAsset": [{"type": "image", "name": "图片", "content": "https://example.com/image"}]}` |
| `checkbox` | `{"checkbox": {"checked": true}}`                                                                                    |

对于 `mAsset`，每项使用 `type: "image"` 渲染图片，或使用 `type: "file"` 渲染文件链接。更新值会替换整个 `mAsset` 数组，因此追加资源时必须包含已有条目。

> ⚠️ `itemID` 是**条目 ID**，即[渲染](#渲染)返回的条目 `id`：表格和列表为 `rows[].id`，卡片和看板为 `cards[].id`，启用分组时位于 `groups[]` 的对应视图实例中。它也等于主键值的 `value.blockID`。对于绑定条目，绑定块 ID 位于主键值的 `value.block.id`；二者是不同概念，不能假设相等。传入错误的 ID 会把值存为孤儿数据，不会出现在渲染后的单元格中。

对于富文本，`text.rich.content` 是权威的 Kramdown 源。内核会校验其受支持的结构并派生 `text.content` 纯文本投影；调用方提供的纯文本投影会被忽略。为兼容现有 API 客户端，省略 `text.rich` 时，如果 `text.content` 未改变则保留已存储的富文本载荷，如果 `text.content` 改变则以纯文本替换。即使纯文本投影未改变，也可以发送 `"rich": null` 明确移除富文本格式。包含富文本的数据库使用存储规范 9，无法由仅支持更早数据库规范的内核打开。

`location` 的 `name` 可选。`latitude` 和 `longitude` 必须同时缺省或为 null，或者同时为有限数值，范围分别为 [-90, 90] 和 [-180, 180]；零是有效坐标。所有坐标隐式使用 WGS84，保存时不自动转换。位置值不接受显式坐标系属性，字段不提供默认坐标系设置。`originalInput` 保留来源文本，不参与筛选和排序。更新时省略成员会保留已有值；清空位置可发送 `{"location":null}`，或显式清空名称并将两个坐标都设为 null。坐标变化时，省略的 `originalInput` 会自动清空；显式提供的来源文本会被保留。文本筛选使用 `{"type":"location","text":{"content":"查询词"}}`，匹配名称和坐标。位置字段使用数据库存储版本 13，旧版内核无法打开；未使用位置字段的数据库保留原有存储版本。

* `/api/av/setAttributeViewBlockAttr`
* 参数

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "keyID": "20240531232156-ahsyx8l",
    "itemID": "20240118203831-fkfvvtx",
    "value": {
      "type": "number",
      "number": {
        "content": 42,
        "isNotEmpty": true
      }
    }
  }
  ```

    * `avID`: 数据库 ID
    * `keyID`: 字段 ID（被更新的列）
    * `itemID`: **行 ID**（[渲染](#渲染) 返回的 `rows[].id`）。旧参数 `rowID` 已弃用，将于 2026-12-01 后删除，请改用 `itemID`
    * `value`: 部分 `Value` 对象（见上表）。未知或不支持的键会被忽略
* 返回值（真实响应，数字值）：

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "value": {
        "id": "20240531235048-4zisj1p",
        "keyID": "20240531232156-ahsyx8l",
        "blockID": "20240118203831-fkfvvtx",
        "type": "number",
        "createdAt": 1717170648596,
        "updatedAt": 1781610266432,
        "number": {
          "content": 42,
          "isNotEmpty": true,
          "format": "",
          "formattedContent": "42"
        }
      }
    }
  }
  ```

    * `data.value`: 更新后规范化完成的值（含 `number.formattedContent` 等计算字段）。请使用该返回值刷新 UI，无需重新发送请求体

### 添加条目

添加一个或多个条目（行）。每个来源既可绑定已有块（`isDetached: false`），也可创建仅存在于视图内的独立行（`isDetached: true`）。

* `/api/av/addAttributeViewBlocks`
* 参数

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t",
    "viewID": "",
    "groupID": "",
    "previousID": "",
    "srcs": [
      {
        "id": "20240118120201-kldj15t",
        "isDetached": false,
        "content": "新行"
      }
    ],
    "ignoreDefaultFill": false
  }
  ```

    * `avID`: 数据库 ID
    * `blockID`: 拥有该数据库的数据库块（用于解析目标视图/分组）
    * `viewID`: 明确指定目标视图。省略时使用 `blockID` 选择的视图，无法解析则使用第一个可用视图
    * `groupID`: 看板视图的目标分组 ID。表格/卡片视图可省略
    * `previousID`: 在此条目 ID 之后插入。为空表示追加到末尾
    * `srcs[].id`: 绑定块时（`isDetached: false`）为要绑定的块 ID，需符合节点 ID 格式
    * `srcs[].isDetached`: `true` 创建独立行；`false` 绑定已有块
    * `srcs[].content`: 主键的显示文本（`isDetached: true` 时使用，或覆盖绑定块的内容）
    * `srcs[].itemID`: 可选，显式指定条目 ID。省略时自动生成
    * `ignoreDefaultFill`: 为 `true` 时，跳过向过滤/分组字段自动填充默认值
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

    * 该接口返回 `null`；成功后请调用 [渲染](#渲染) 获取更新后的行（含更新单元格所需的新行 ID）

### 移除条目

移除一个或多个条目（行）。独立行会被删除；绑定块会解绑（不会删除底层文档块）。

* `/api/av/removeAttributeViewBlocks`
* 参数

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "srcIDs": ["20240118203831-fkfvvtx"]
  }
  ```

    * `avID`: 数据库 ID
    * `srcIDs`: 要移除的行 ID（[渲染](#渲染) 返回的 `rows[].id`）列表
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 切换布局

在 `table`（表格）、`list`（列表）、`gallery`（卡片）和 `kanban`（看板）之间切换数据库块所选视图的布局类型。成功时服务端会重新渲染并返回视图（结构与 [渲染](#渲染) 相同）。

首次切换到 `list` 时，会初始化独立布局，默认仅显示主键字段。之后切换回该布局会保留字段显隐和顺序。隐藏字段的值保持不变，仍可用于过滤和排序；其他布局保留各自的显示设置。

* `/api/av/changeAttrViewLayout`
* 参数

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t",
    "layoutType": "kanban"
  }
  ```

    * `avID`: 数据库 ID
    * `blockID`: 拥有该视图的数据库块
    * `layoutType`: 目标布局——`table`、`list`、`gallery`、`kanban` 之一
* 返回值：与 [渲染](#渲染) 返回结构相同。当切换到 `kanban` 且已配置分组时，`data.view` 包含 `groups[]` 数组；每个分组是视图实例，含 `groupKey`、`groupValue`，以及看板特有字段（`coverFrom`、`cardAspectRatio`、`cardSize`、`fitImage`、`displayFieldName`、`fillColBackgroundColor`、`fields`）

### 设置分组

为看板视图设置或清除分组规则。当 `group.field` 为空时移除分组。成功时服务端会重新渲染并返回视图。

* `/api/av/setAttrViewGroup`
* 参数

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t",
    "group": {
      "field": "20240118203822-io6ofxb",
      "method": 0,
      "order": 0,
      "hideEmpty": false
    }
  }
  ```

    * `avID`: 数据库 ID
    * `blockID`: 拥有该视图的数据库块
    * `group`: 分组规则
    * `group.field`: 用于分组的字段（列）ID。为空字符串表示移除分组
    * `group.valueSource`: 可选的值来源——`stored` 使用字段存储值，省略时默认为该值；`rendered` 使用字段的显示模板结果，并按文本值分组
    * `group.method`: 分组方式——`0` 按值、`1` 按数字范围、`2` 按相对日期、`3` 按天、`4` 按周、`5` 按月、`6` 按年
    * `group.range`: 可选。`method` 为 `1`（数字范围）时必填：`{ "numStart": 0, "numEnd": 100, "numStep": 10 }`
    * `group.order`: 分组排序——`0` 升序、`1` 降序、`2` 手动、`3` 按选项顺序
    * `group.hideEmpty`: 是否隐藏空分组
* 返回值：与 [渲染](#渲染) 返回结构相同

### 获取过滤与排序

返回绑定到数据库块的视图当前的过滤和排序规则。

* `/api/av/getAttributeViewFilterSort`
* 参数

  ```json
  {
    "id": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t"
  }
  ```

    * `id`: 数据库 ID
    * `blockID`: 拥有该视图的数据库块
* 返回值（真实响应，未配置过滤/排序）：

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "filters": [],
      "sorts": []
    }
  }
  ```

  配置后（真实获取的响应），过滤与排序形如：

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "filters": [
        {
          "column": "20240118203822-io6ofxb",
          "operator": "=",
          "value": {
            "type": "select",
            "mSelect": [
              { "content": "已完成", "color": "1" }
            ]
          }
        }
      ],
      "sorts": [
        {
          "column": "20240118120204-w6cggab",
          "order": "DESC"
        }
      ]
    }
  }
  ```

    * `data.filters`: `ViewFilter` 数组。顶层为单个根组节点 `{ "combination": "and"|"or", "filters": [...] }`，数组元素既可以是叶子过滤条件，也可以是嵌套的分组节点，支持递归的且/或组合
    * `data.filters[].column`: 过滤规则作用的字段（列）ID（仅叶子节点）
    * `data.filters[].valueSource`: 叶子节点可选的值来源——省略时默认为 `stored`，`rendered` 表示过滤字段的显示模板结果
    * `data.filters[].operator`: 过滤操作符（见下方操作符表；仅叶子节点）
    * `data.filters[].value`: 过滤操作数，一个 `Value` 对象（结构见 [设置单元格值](#设置单元格值)；仅叶子节点）。当 `valueSource` 为 `rendered` 时，使用 `{ "type": "template", "template": { "content": "..." } }` 形式的模板值
    * `data.filters[].relativeDate`: 可选，日期过滤使用的相对时间描述（`{ "count": 7, "unit": 0, "direction": -1 }`；`unit`：`0` 天、`1` 周、`2` 月、`3` 年；`direction`：`-1` 前、`0` 当前、`1` 后；仅叶子节点）
    * `data.filters[].combination`: 分组组合方式，`"and"` 或 `"or"`（仅分组节点）
    * `data.filters[].filters`: 子过滤节点，递归的 `ViewFilter`（仅分组节点）
    * `data.sorts`: `ViewSort` 数组
    * `data.sorts[].column`: 排序规则作用的字段（列）ID
    * `data.sorts[].valueSource`: 可选的值来源——省略时默认为 `stored`，`rendered` 表示按字段的显示模板结果排序
    * `data.sorts[].order`: `ASC` 或 `DESC`

  过滤操作符：

  | 取值                | 说明           |
  |---------------------|----------------|
  | `=`                 | 等于           |
  | `!=`                | 不等于         |
  | `>`                 | 大于           |
  | `>=`                | 大于等于       |
  | `<`                 | 小于           |
  | `<=`                | 小于等于       |
  | `Contains`          | 包含           |
  | `Does not contains` | 不包含         |
  | `Is empty`          | 为空           |
  | `Is not empty`      | 不为空         |
  | `Starts with`       | 以...开头      |
  | `Ends with`         | 以...结尾      |
  | `Is between`        | 介于之间       |
  | `Is true`           | 为真（复选框） |
  | `Is false`          | 为假（复选框） |

### 设置过滤

* `/api/av/setAttrViewFilters`
* 参数

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t",
    "data": [
      {
        "column": "20240118203822-io6ofxb",
        "operator": "=",
        "value": {
          "type": "select",
          "mSelect": [
            { "content": "已完成", "color": "1" }
          ]
        }
      }
    ]
  }
  ```

    * `avID`: 数据库 ID
    * `blockID`: 拥有该视图的数据库块
    * `data`: 完整的 `ViewFilter` 新数组，将**整体替换**视图现有过滤规则（结构见 [获取过滤与排序](#获取过滤与排序)）。传 `[]` 可清空全部过滤规则。顶层为单个根组节点 `{ "combination": "and"|"or", "filters": [...] }`，数组元素既可以是叶子过滤条件，也可以是嵌套的分组节点，支持递归的且/或组合
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 设置排序

* `/api/av/setAttrViewSorts`
* 参数

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t",
    "data": [
      {
        "column": "20240118120204-w6cggab",
        "order": "DESC"
      }
    ]
  }
  ```

    * `avID`: 数据库 ID
    * `blockID`: 拥有该视图的数据库块
    * `data`: 完整的 `ViewSort` 新数组，将**整体替换**视图现有排序规则（结构见 [获取过滤与排序](#获取过滤与排序)）。传 `[]` 可清空全部排序规则
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 添加字段

添加新字段（列）。该字段会被添加到每个视图（表格/列表/卡片/看板）中 `previousKeyID` 之后的位置（为空时使用默认位置）。

* `/api/av/addAttributeViewKey`
* 参数

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "keyID": "20240118120204-7k9wzbp",
    "keyName": "状态",
    "keyType": "select",
    "keyIcon": "",
    "previousKeyID": "20240118120204-w6cggab"
  }
  ```

    * `avID`: 数据库 ID
    * `keyID`: 新字段 ID。需为 `Lute.NewNodeID()` 生成的合法节点 ID（14 位时间戳 + `-` + 7 位随机字母数字，如 `20240118120204-abc1234`）
    * `keyName`: 字段显示名
    * `keyType`: 字段类型——`text`、`number`、`date`、`select`、`mSelect`、`url`、`email`、`phone`、`location`、`mAsset`、`template`、`created`、`updated`、`checkbox`、`relation`、`rollup`、`lineNumber` 之一。`block`（主键）不能通过该接口添加
    * `keyIcon`: 可选字段图标（emoji 或空字符串）
    * `previousKeyID`: 在此字段 ID 之后插入新列。为空字符串时使用布局默认位置（表格插入到首位，列表/卡片/看板插入到末尾）
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 移除字段

移除字段（列）及其所有值。若 `keyID` 不存在，返回 `code: -1`、`msg: "key not found"`。

* `/api/av/removeAttributeViewKey`
* 参数

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "keyID": "20240118120204-7k9wzbp",
    "removeRelationDest": false
  }
  ```

    * `avID`: 数据库 ID
    * `keyID`: 要移除的字段 ID
    * `removeRelationDest`: 为 `true` 且字段为关联类型时，同时移除目标数据库中对应的反向关联字段。默认为 `false`
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 设置全局字段排序

全局重排字段（列）——将 `keyID` 移动到字段顺序中 `previousKeyID` 之后的位置，影响所有视图。

* `/api/av/sortAttributeViewKey`
* 参数

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "keyID": "20240118203822-io6ofxb",
    "previousKeyID": "20240118120204-w6cggab"
  }
  ```

    * `avID`: 数据库 ID
    * `keyID`: 要移动的字段 ID
    * `previousKeyID`: `keyID` 应置于其后的字段 ID。为空字符串表示移动到首位
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 设置视图内字段排序

在单个视图的布局内重排列（例如表格的列顺序），不改变全局字段顺序。

* `/api/av/sortAttributeViewViewKey`
* 参数

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "viewID": "20240118120204-7rnmyc1",
    "keyID": "20240118203822-io6ofxb",
    "previousKeyID": "20240118120204-w6cggab"
  }
  ```

    * `avID`: 数据库 ID
    * `viewID`: 目标视图。为空时使用第一个可用视图
    * `keyID`: 要移动的字段 ID
    * `previousKeyID`: `keyID` 应置于其后的字段 ID。为空字符串表示移动到首位
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

## 搜索

已保存的搜索条件组使用以下字段：

* `name`：条件组名称，同时也是条件组的唯一键
* `sort`：结果排序方式，`0` 为按块类型，`1` 为按创建时间升序，`2` 为按创建时间降序，`3` 为按更新时间升序，`4` 为按更新时间降序，`5` 为按内容顺序，`6` 为按相关度升序，`7` 为按相关度降序
* `group`：分组方式，`0` 为不分组，`1` 为按文档分组
* `hasReplace`：是否启用替换
* `method`：搜索方式，`0` 为关键字，`1` 为查询语法，`2` 为 SQL，`3` 为正则表达式，`4` 为语义搜索
* `hPath`：人类可读的搜索范围路径
* `idPath`：搜索范围路径数组
* `k`：搜索关键字
* `r`：替换关键字
* `types`：块类型开关，支持 `mathBlock`、`table`、`blockquote`、`superBlock`、`paragraph`、`document`、`heading`、`list`、`listItem`、`codeBlock`、`htmlBlock`、`embedBlock`、`databaseBlock`、`audioBlock`、`videoBlock`、`iframeBlock`、`widgetBlock`、`callout`、`tabs` 和 `tabItem`
* `subTypes`：独立的子类型分组，`heading` 使用 `h1` 至 `h6`，`list` 和 `listItem` 分别使用 `o`（有序）、`u`（无序）和 `t`（任务）。分组缺省、为空或所有开关为 `false` 时，不限制该父类型的子类型；父类型仍须在 `types` 中启用。未知顶层键（包括旧扁平格式的 `h1` 至 `h6` 和 `o`、`u`、`t`）会被忽略且不报错，旧格式中保存的子类型选择需要重新选择并保存
* `replaceTypes`：替换类型开关，支持 `text`、`imgText`、`imgTitle`、`imgSrc`、`aText`、`aTitle`、`aHref`、`code`、`em`、`strong`、`inlineMath`、`inlineMemo`、`blockRef`、`fileAnnotationRef`、`kbd`、`mark`、`s`、`sub`、`sup`、`tag`、`u`、`docTitle`、`codeBlock`、`mathBlock` 和 `htmlBlock`

`types`、`subTypes` 或 `replaceTypes` 中省略的布尔开关按 `false` 处理。

### 获取已保存的搜索条件组

* `/api/storage/getCriteria`
* 无参数
* 返回值：`data` 为按保存顺序排列的搜索条件组数组；没有已保存的条件组时为空数组
* 对于只读角色，条件组会根据发布访问权限进行过滤，并清空返回结果中的 `k` 和 `r`

### 保存搜索条件组

创建条件组或完整覆盖同名条件组。覆盖时保留原有位置，新增时追加到末尾。

* `/api/storage/setCriterion`
* 需要管理员角色，在只读模式下不可用
* 参数

  ```json
  {
    "criterion": {
      "name": "公开笔记",
      "sort": 0,
      "group": 1,
      "hasReplace": false,
      "method": 0,
      "hPath": "公开笔记",
      "idPath": ["20210808180117-czj9bvb"],
      "k": "",
      "r": "",
      "types": {
        "document": true,
        "paragraph": true,
        "heading": true,
        "list": true,
        "listItem": true
      },
      "subTypes": {
        "heading": {"h1": true},
        "list": {"o": true},
        "listItem": {"t": true}
      },
      "replaceTypes": {
        "text": true
      }
    }
  }
  ```

    * `criterion`：要保存的完整搜索条件组
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### 移除搜索条件组

移除指定名称的条件组。名称不存在时也视为成功。

* `/api/storage/removeCriterion`
* 需要管理员角色，在只读模式下不可用
* 参数

  ```json
  {
    "name": "公开笔记"
  }
  ```

    * `name`：条件组名称
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```
