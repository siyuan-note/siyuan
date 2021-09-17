* [参数和返回值](#参数和返回值)
* [鉴权](#鉴权)
* [Webhook](#Webhook)
* [笔记本](#笔记本)
  * [列出笔记本](#列出笔记本)
  * [打开笔记本](#打开笔记本)
  * [关闭笔记本](#关闭笔记本)
  * [重命名笔记本](#重命名笔记本)
  * [删除笔记本](#删除笔记本)
  * [获取笔记本配置](#获取笔记本配置)
* [SQL](#SQL)
  * [SQL 查询](#sql-查询)
* [文档](#文档)
  * [通过 Markdown 创建文档](#通过-markdown-创建文档)
  * [重命名文档](#重命名文档)
  * [删除文档](#删除文档)
* [资源文件](#资源文件)
  * [上传资源文件](#上传资源文件)
* [属性](#属性)
  * [设置块属性](#设置块属性)
  * [获取块属性](#获取块属性)
* [搜索](#搜索)
  * [搜索标签](#搜索标签)
  * [搜索模板](#搜索模板)
  * [搜索引用块](#搜索引用块)
  * [搜索嵌入块](#搜索嵌入块)
  * [搜索块](#搜索块)
* [模板](#模板)
  * [渲染模板](#渲染模板)
* [导出](#导出)
  * [导出 Markdown 文本](#导出-markdown-文本)
* [系统](#系统)
  * [获取系统版本](#获取系统版本)

---

## 参数和返回值

* 端点：`http://127.0.0.1:6806`
* 均是 POST 方法
* 需要带参的接口，参数为 JSON 字符串，放置到 body 里，标头 Content-Type 为 `application/json`
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

## 鉴权

在 <kbd>设置 - 关于</kbd> 里查看 API token，请求标头：`Authorization: Token xxx`

## Webhook

TBD

https://ld246.com/article/1627956688432

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
      "files": [
        "F:\\SiYuan\\data/思源笔记用户指南",
        "F:\\SiYuan\\data/测试笔记本"
      ]
    }
  }
  ```

    * `files`：笔记本路径，截取最后一个 `/` 后面的字符串即笔记本名称

### 打开笔记本

/notebook/openNotebook

### 关闭笔记本

/notebook/closeNotebook

### 重命名笔记本

/notebook/renameNotebook

### 删除笔记本

/notebook/removeNotebook

### 获取笔记本配置

/notebook/getNotebookConf

## SQL

### SQL 查询

* `/api//query/sql`
* 参数

  ```json
  {
    "stmt": "SELECT * FROM blocks WHERE content LIKE'%content%' LIMIT 7"
  }
  ```

    * `stmt`：SQL 脚本
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
      { "列": "值" }
    ]
  }
  ```

## 文档

### 通过 Markdown 创建文档

* `/api/filetree/createDocWithMd`
* 参数

  ```json
  {
    "notebook": "测试笔记本",
    "path": "/foo/bar",
    "markdown": ""
  }
  ```

    * `notebook`：笔记本名称
    * `path`：文档路径，需要以 / 开头，中间使用 / 分隔层级
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

### 重命名文档

/api/filetree/renameDoc

### 删除文档

/api/filetree/removeDoc

## 资源文件

### 上传资源文件

* `/api/asset/upload`
* 参数为 HTTP Multipart 表单

    * `assetsDirPath`：资源文件存放的文件夹路径，实参有以下三种情况

        1. `"/assets/"`：工作空间 assets 文件夹
        2. `"/测试笔记本/assets/"`：测试笔记本下的 assets 文件夹
        3. `"/测试笔记本/foo/assets/"`：测试笔记本下 foo 文件夹下的 assets 文件夹

      建议用第三种，其中文件夹 foo 是创建文档时的文件夹，如果没有文件夹的话就是第二种情况。
    * `file[]`：上传的文件列表
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "errFiles": [""],
      "succMap": {
        "foo.png": "assets/foo-20210719092549-9j5y79r.png"
      }
    }
  }
  ```

    * `errFiles`：处理时遇到错误的文件名
    * `succMap`：处理成功的文件，key 为上传时的文件名，value 为 assets/foo-id.png，用于将已有 Markdown 内容中的资源文件链接地址替换为上传后的地址

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

## 搜索

### 搜索标签

/search/searchTag

### 搜索模板

/search/searchTemplate

### 搜索引用块

/search/searchRefBlock

### 搜索嵌入块

/search/searchEmbedBlock

### 搜索块

/search/searchBlock

## 模板

### 渲染模板

/template/render

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
    * `content`：Markdown 内容

## 系统

### 获取系统版本

/system/version

