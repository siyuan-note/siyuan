[English](API.md)
| **中文**
| [日本語](API.ja.md)

* [规范](#规范)
    * [参数和返回值](#参数和返回值)
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
* [系统](#系统)
    * [获取启动进度](#获取启动进度)
    * [获取系统版本](#获取系统版本)
    * [获取系统当前时间](#获取系统当前时间)

---

## 规范

### 参数和返回值

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

### 鉴权

在 <kbd>设置 - 关于</kbd> 里查看 API token，请求标头：`Authorization: Token xxx`

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
    * `path`：文档路径，需要以 / 开头，中间使用 / 分隔层级（这里的 path 对应数据库 hpath 字段）
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

    * `assetsDirPath`：资源文件存放的文件夹路径，以 data 文件夹作为根路径，比如：
        * `"/assets/"`：工作空间/data/assets/ 文件夹
        * `"/assets/sub/"`：工作空间/data/assets/sub/ 文件夹

      常规情况下建议用第一种，统一存放到工作空间资源文件夹下，放在子目录有一些副作用，请参考用户指南资源文件章节。
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
    * `action.id`：新插入块的 ID

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
    * `action.id`：新插入块的 ID

### 更新块

* `/api/block/updateBlock`
* 参数

  ```json
  {
    "dataType": "markdown",
    "data": "foobarbaz",
    "id": "20211230161520-querkps"
  }
  ```

    * `dataType`：待更新数据类型，值可选择 `markdown` 或者 `dom`
    * `data`：待更新的数据
    * `id`：待更新块的 ID
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

## 模板

### 渲染模板

* `/api/template/render`
* 参数

  ```json
  {
    "id": "20220724223548-j6g0o87",
    "path": "F:\\SiYuan\\data\\templates\\foo.md"
  }
  ```
    * `id`：调用渲染所在的文档 ID
    * `path`：模板文件绝对路径
* 返回值

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "content": "<div data-node-id=\"20220729234848-dlgsah7\" data-node-index=\"1\" data-type=\"NodeParagraph\" class=\"p\" updated=\"20220729234840\"><div contenteditable=\"true\" spellcheck=\"false\">foo</div><div class=\"protyle-attr\" contenteditable=\"false\">​</div></div>",
      "path": "F:\\SiYuan\\data\\templates\\foo.md"
    }
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
    * 执行调用 pandoc 命令时工作目录会被设置在 `工作空间/temp/convert/pandoc/${test}` 下
    * 可先通过 API [`写入文件`](#写入文件) 将待转换文件写入该目录
    * 然后再调用该 API 进行转换，转换后的文件也会被写入该目录
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
    "payload": {},
    "payloadEncoding": "text",
    "responseEncoding": "text"
  }
  ```

    * `url`：转发的 URL
    * `method`：HTTP 方法，默认为 `GET`
    * `timeout`：超时时间，单位为毫秒，默认为 `7000` 毫秒
    * `contentType`：HTTP Content-Type，默认为 `application/json`
    * `headers`：HTTP 请求标头
    * `payload`：HTTP 请求体，对象或者是字符串
    * `payloadEncoding`：`pyaload` 所使用的编码方案，默认为 `text`，可选值如下所示

        * `text`
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
      "url": "https://b3log.org/siyuan"
    }
  }
  ```

    * `bodyEncoding`：`body` 所使用的编码方案，与请求中 `responseEncoding` 字段一致，默认为 `text`，可能的值如下所示

        * `text`
        * `base64` | `base64-std`
        * `base64-url`
        * `base32` | `base32-std`
        * `base32-hex`
        * `hex`

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

数据库（内核中为“属性视图”）以字段（列）和条目（行）的形式存储结构化数据。每个数据库由 `avID` 标识，可通过一个或多个数据库块（`blockID`）嵌入到文档中。一个数据库可包含多个不同布局类型的视图（`viewID`）：`table`（表格）、`gallery`（卡片）和 `kanban`（看板）。

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
    "createIfNotExist": true
  }
  ```

    * `id`: 数据库 ID
    * `blockID`: 嵌入该数据库的数据库块，用于解析当前视图和发布权限。渲染独立数据库时可省略
    * `viewID`: 要渲染的视图。省略时使用当前视图（`viewID` 字段）
    * `page`: 页码，从 1 开始。默认为 `1`
    * `pageSize`: 每页条目数。`-1` 或省略表示使用视图默认值（`50`）
    * `query`: 可选的主键值全文过滤关键字
    * `groupPaging`: 分组（看板）视图的可选分页配置
    * `createIfNotExist`: 为 `true`（默认）时，若数据库不存在视图则创建默认视图
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

    * `data.view`: 渲染后的视图实例。结构随 `viewType` 而变——`table` 返回 `columns`/`rows`/`rowCount`，`gallery` 返回 `columns`/`rows`，`kanban` 返回 `columns`/`groups`（每个分组本身也是视图实例，含 `groupKey`/`groupValue`）。`view` 还包含 `filters`/`sorts`/`group`/`showIcon`/`wrapField`/`groupFolded`/`groupHidden`。注意：启用的过滤/分组可能使 `rows` 为空，即使 `rowCount` > 0
    * `data.view.columns[]`: 每列含 `id`/`name`/`type`/`icon`/`wrap`/`hidden`/`desc`/`calc`/`numberFormat`/`template`/`pin`/`width`；`select`/`mSelect` 列还额外包含 `options`
    * `data.view.rows[].id`: **行 ID**（一个条目 ID）。对于绑定行，它等于绑定的块 ID；对于独立行，它是生成的条目 ID，与任何块都不同
    * `data.view.rows[].cells[].value`: 一个 `Value` 对象——所有 value 形态见 [设置单元格值](#设置单元格值)。`createdAt`/`updatedAt` 为 int64 毫秒时间戳
    * `data.views`: 所有视图的元数据（不含行数据）
    * `data.isMirror`: 当数据库块为数据库的镜像（只读副本）时为 `true`

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
              ],
              "rowIds": null
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

    * `data.av`: 完整的 `AttributeView` 定义——字段（`keyValues`）、字段顺序（`keyIDs`，可能为 `null`）、当前视图（`viewID`）、以及所有视图的原始布局配置（`table`/`gallery`/`kanban`）和条目顺序（`itemIds`）。返回原始定义（不含渲染后的行或分页）；需要计算后的行数据请使用 [渲染](#渲染)

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

### 搜索

* `/api/av/searchAttributeView`
* 参数

  ```json
  {
    "keyword": "API",
    "excludes": []
  }
  ```

    * `keyword`: 搜索关键字（匹配数据库名称）
    * `excludes`: 可选，需从结果中排除的数据库 ID 列表
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
              "blockID": "20240118120201-kldj15t",
              "hPath": "正在跟进的问题/数据库/API"
            }
          ]
        }
      ]
    }
  }
  ```

    * `data.results[]`: 每个顶层结果按 `avID` 聚合一个数据库；其 `children[]` 列出该数据库的各个视图（`viewName`/`viewID`/`viewLayout`）

### 设置单元格值

更新单个单元格（某一行的某个字段）。这是单元格值的主要写入接口。请求中的 `value` 是一个部分 `Value` 对象，其结构取决于字段的 `keyType`。常见 value 结构如下：

| `keyType`  | `value` 结构                                                                                                         |
|------------|----------------------------------------------------------------------------------------------------------------------|
| `block`    | `{"block": {"content": "第一行", "id": "<绑定块ID>"}, "isDetached": false}`                                          |
| `text`     | `{"text": {"content": "文本"}}`                                                                                      |
| `number`   | `{"number": {"content": 42, "isNotEmpty": true}}`（清空用 `{"isNotEmpty": false}`）                                  |
| `date`     | `{"date": {"content": 1676042451000, "isNotEmpty": true}}`（毫秒时间戳）                                             |
| `select`   | `{"mSelect": [{"content": "已完成", "color": "1"}]}`（至多一个选项）                                                 |
| `mSelect`  | `{"mSelect": [{"content": "A", "color": "1"}, {"content": "B", "color": "2"}]}`                                      |
| `url`      | `{"url": {"content": "https://siyuan.com"}}`                                                                         |
| `email`    | `{"email": {"content": "a@b.com"}}`                                                                                  |
| `phone`    | `{"phone": {"content": "1234567890"}}`                                                                               |
| `checkbox` | `{"checkbox": {"checked": true}}`                                                                                    |

> ⚠️ `itemID` 是**行 ID**（[渲染](#渲染) 返回的 `rows[].id`）。对于绑定行，行 ID 等于绑定的块 ID；对于独立行，它是生成的条目 ID。传入错误的 ID 会把值存为孤儿数据，不会出现在渲染后的单元格中。

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
    * `viewID`: 目标视图。省略时使用当前视图
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

在 `table`（表格）、`gallery`（卡片）和 `kanban`（看板）之间切换当前视图的布局类型。成功时服务端会重新渲染并返回视图（结构与 [渲染](#渲染) 相同）。

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
    * `layoutType`: 目标布局——`table`、`gallery`、`kanban` 之一
* 返回值：与 [渲染](#渲染) 返回结构相同。当切换到 `kanban` 且已配置分组时，`data.view` 携带 `groups[]` 数组；每个分组是视图实例，含 `groupKey`、`groupValue`，以及看板特有字段（`coverFrom`、`cardAspectRatio`、`cardSize`、`fitImage`、`displayFieldName`、`fillColBackgroundColor`、`fields`）

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

  配置后（真实抓取的响应），过滤与排序形如：

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
    * `data.filters[].operator`: 过滤操作符（见下方操作符表；仅叶子节点）
    * `data.filters[].value`: 过滤值，一个 `Value` 对象（结构见 [设置单元格值](#设置单元格值)；仅叶子节点）
    * `data.filters[].relativeDate`: 可选，日期过滤使用的相对时间描述（`{ "count": 7, "unit": 0, "direction": -1 }`；`unit`：`0` 天、`1` 周、`2` 月、`3` 年；`direction`：`-1` 前、`0` 当前、`1` 后；仅叶子节点）
    * `data.filters[].combination`: 分组组合方式，`"and"` 或 `"or"`（仅分组节点）
    * `data.filters[].filters`: 子过滤节点，递归的 `ViewFilter`（仅分组节点）
    * `data.sorts`: `ViewSort` 数组
    * `data.sorts[].column`: 排序规则作用的字段（列）ID
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

添加新字段（列）。该字段会被添加到每个视图（表格/卡片/看板）中 `previousKeyID` 之后的位置（为空时使用默认位置）。

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
    * `keyType`: 字段类型——`text`、`number`、`date`、`select`、`mSelect`、`url`、`email`、`phone`、`mAsset`、`template`、`created`、`updated`、`checkbox`、`relation`、`rollup`、`lineNumber` 之一。`block`（主键）不能通过该接口添加
    * `keyIcon`: 可选字段图标（emoji 或空字符串）
    * `previousKeyID`: 在此字段 ID 之后插入新列。为空字符串时使用布局默认位置（表格插入到首位，卡片/看板插入到末尾）
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
    * `viewID`: 目标视图。为空时使用当前视图
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
