**English**
| [中文](API.zh-CN.md)
| [日本語](API.ja.md)

* [Specification](#Specification)
    * [Parameters and return values](#Parameters-and-return-values)
    * [Authentication](#Authentication)
* [Notebooks](#Notebooks)
    * [List notebooks](#List-notebooks)
    * [Open a notebook](#Open-a-notebook)
    * [Close a notebook](#Close-a-notebook)
    * [Rename a notebook](#Rename-a-notebook)
    * [Create a notebook](#Create-a-notebook)
    * [Remove a notebook](#Remove-a-notebook)
    * [Get notebook configuration](#Get-notebook-configuration)
    * [Save notebook configuration](#Save-notebook-configuration)
* [Documents](#Documents)
    * [Create a document with Markdown](#Create-a-document-with-Markdown)
    * [Rename a document](#Rename-a-document)
    * [Remove a document](#Remove-a-document)
    * [Move documents](#Move-documents)
    * [Get human-readable path based on path](#Get-human-readable-path-based-on-path)
    * [Get human-readable path based on ID](#Get-human-readable-path-based-on-ID)
    * [Get storage path based on ID](#Get-storage-path-based-on-ID)
    * [Get IDs based on human-readable path](#Get-IDs-based-on-human-readable-path)
* [Assets](#Assets)
    * [Upload assets](#Upload-assets)
* [Blocks](#Blocks)
    * [Insert blocks](#Insert-blocks)
    * [Prepend blocks](#Prepend-blocks)
    * [Append blocks](#Append-blocks)
    * [Update a block](#Update-a-block)
    * [Delete a block](#Delete-a-block)
    * [Move a block](#Move-a-block)
    * [Fold a block](#Fold-a-block)
    * [Unfold a block](#Unfold-a-block)
    * [Get a block kramdown](#Get-a-block-kramdown)
    * [Get child blocks](#get-child-blocks)
    * [Transfer block ref](#transfer-block-ref)
* [Attributes](#Attributes)
    * [Set block attributes](#Set-block-attributes)
    * [Get block attributes](#Get-block-attributes)
* [Database](#Database)
    * [Render](#Render)
    * [Get](#Get)
    * [Get primary key values](#Get-primary-key-values)
    * [Search](#Search)
    * [Set a cell value](#Set-a-cell-value)
    * [Add items](#Add-items)
    * [Remove items](#Remove-items)
    * [Change layout](#Change-layout)
    * [Set grouping](#Set-grouping)
    * [Get filter and sort](#Get-filter-and-sort)
    * [Set filter](#Set-filter)
    * [Set sort](#Set-sort)
    * [Add a field](#Add-a-field)
    * [Remove a field](#Remove-a-field)
    * [Set global field sort](#Set-global-field-sort)
    * [Set per-view field sort](#Set-per-view-field-sort)
* [SQL](#SQL)
    * [Execute SQL query](#Execute-SQL-query)
    * [Flush transaction](#Flush-transaction)
* [Templates](#Templates)
    * [Render a template](#Render-a-template)
    * [Render Sprig](#Render-Sprig)
* [File](#File)
    * [Get file](#Get-file)
    * [Put file](#Put-file)
    * [Remove file](#Remove-file)
    * [Rename file](#Rename-file)
    * [List files](#List-files)
* [Export](#Export)
    * [Export Markdown](#Export-Markdown)
    * [Export Files and Folders](#Export-files-and-folders)
* [Conversion](#Conversion)
    * [Pandoc](#Pandoc)
* [Notification](#Notification)
    * [Push message](#Push-message)
    * [Push error message](#Push-error-message)
* [Network](#Network)
    * [Forward proxy](#Forward-proxy)
* [System](#System)
    * [Get boot progress](#Get-boot-progress)
    * [Get system version](#Get-system-version)
    * [Get the current time of the system](#Get-the-current-time-of-the-system)

---

## Specification

### Parameters and return values

* Endpoint: `http://127.0.0.1:6806`
* Both are POST methods
* An interface with parameters is required, the parameter is a JSON string, placed in the body, and the header
  Content-Type is `application/json`
* Return value

   ````json
   {
     "code": 0,
     "msg": "",
     "data": {}
   }
   ````

    * `code`: non-zero for exceptions
    * `msg`: an empty string under normal circumstances, an error text will be returned under abnormal conditions
    * `data`: may be `{}`, `[]` or `NULL`, depending on the interface

### Authentication

View API token in <kbd>Settings - About</kbd>, request header: `Authorization: Token xxx`

## Notebooks

### List notebooks

* `/api/notebook/lsNotebooks`
* No parameters
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "notebooks": [
        {
          "id": "20210817205410-2kvfpfn", 
          "name": "Test Notebook",
          "icon": "1f41b",
          "sort": 0,
          "closed": false
        },
        {
          "id": "20210808180117-czj9bvb",
          "name": "SiYuan User Guide",
          "icon": "1f4d4",
          "sort": 1,
          "closed": false
        }
      ]
    }
  }
  ```

### Open a notebook

* `/api/notebook/openNotebook`
* Parameters

  ```json
  {
    "notebook": "20210831090520-7dvbdv0"
  }
  ```

    * `notebook`: Notebook ID
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Close a notebook

* `/api/notebook/closeNotebook`
* Parameters

  ```json
  {
    "notebook": "20210831090520-7dvbdv0"
  }
  ```

    * `notebook`: Notebook ID
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Rename a notebook

* `/api/notebook/renameNotebook`
* Parameters

  ```json
  {
    "notebook": "20210831090520-7dvbdv0",
    "name": "New name for notebook"
  }
  ```

    * `notebook`: Notebook ID
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Create a notebook

* `/api/notebook/createNotebook`
* Parameters

  ```json
  {
    "name": "Notebook name"
  }
  ```
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "notebook": {
        "id": "20220126215949-r1wvoch",
        "name": "Notebook name",
        "icon": "",
        "sort": 0,
        "closed": false
      }
    }
  }
  ```

### Remove a notebook

* `/api/notebook/removeNotebook`
* Parameters

  ```json
  {
    "notebook": "20210831090520-7dvbdv0"
  }
  ```

    * `notebook`: Notebook ID
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Get notebook configuration

* `/api/notebook/getNotebookConf`
* Parameters

  ```json
  {
    "notebook": "20210817205410-2kvfpfn"
  }
  ```

    * `notebook`: Notebook ID
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "box": "20210817205410-2kvfpfn",
      "conf": {
        "name": "Test Notebook",
        "closed": false,
        "refCreateSavePath": "",
        "createDocNameTemplate": "",
        "dailyNoteSavePath": "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}",
        "dailyNoteTemplatePath": ""
      },
      "name": "Test Notebook"
    }
  }
  ```

### Save notebook configuration

* `/api/notebook/setNotebookConf`
* Parameters

  ```json
  {
    "notebook": "20210817205410-2kvfpfn",
    "conf": {
        "name": "Test Notebook",
        "closed": false,
        "refCreateSavePath": "",
        "createDocNameTemplate": "",
        "dailyNoteSavePath": "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}",
        "dailyNoteTemplatePath": ""
      }
  }
  ```

    * `notebook`: Notebook ID
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "name": "Test Notebook",
      "closed": false,
      "refCreateSavePath": "",
      "createDocNameTemplate": "",
      "dailyNoteSavePath": "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}",
      "dailyNoteTemplatePath": ""
    }
  }
  ```

## Documents

### Create a document with Markdown

* `/api/filetree/createDocWithMd`
* Parameters

  ```json
  {
    "notebook": "20210817205410-2kvfpfn",
    "path": "/foo/bar",
    "markdown": ""
  }
  ```

    * `notebook`: Notebook ID
    * `path`: Document path, which needs to start with / and separate levels with / (path here corresponds to the
      database hpath field)
    * `markdown`: GFM Markdown content
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "20210914223645-oj2vnx2"
  }
  ```

    * `data`: Created document ID
    * If you use the same `path` to call this interface repeatedly, the existing document will not be overwritten

### Rename a document

* `/api/filetree/renameDoc`
* Parameters

  ```json
  {
    "notebook": "20210831090520-7dvbdv0",
    "path": "/20210902210113-0avi12f.sy",
    "title": "New document title"
  }
  ```

    * `notebook`: Notebook ID
    * `path`: Document path
    * `title`: New document title
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

Rename a document by `id`:

* `/api/filetree/renameDocByID`
* Parameters

  ```json
  {
    "id": "20210902210113-0avi12f",
    "title": "New document title"
  }
  ```

    * `id`: Document ID
    * `title`: New document title
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Remove a document

* `/api/filetree/removeDoc`
* Parameters

  ```json
  {
    "notebook": "20210831090520-7dvbdv0",
    "path": "/20210902210113-0avi12f.sy"
  }
  ```

    * `notebook`: Notebook ID
    * `path`: Document path
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

Remove a document by `id`:

* `/api/filetree/removeDocByID`
* Parameters

  ```json
  {
    "id": "20210902210113-0avi12f"
  }
  ```

    * `id`: Document ID
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Move documents

* `/api/filetree/moveDocs`
* Parameters

  ```json
  {
    "fromPaths": ["/20210917220056-yxtyl7i.sy"],
    "toNotebook": "20210817205410-2kvfpfn",
    "toPath": "/"
  }
  ```

    * `fromPaths`: Source paths
    * `toNotebook`: Target notebook ID
    * `toPath`: Target path
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

Move documents by `id`:

* `/api/filetree/moveDocsByID`
* Parameters

  ```json
  {
    "fromIDs": ["20210917220056-yxtyl7i"],
    "toID": "20210817205410-2kvfpfn"
  }
  ```

    * `fromIDs`: Source docs' IDs
    * `toID`: Target parent doc's ID or notebook ID
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Get human-readable path based on path

* `/api/filetree/getHPathByPath`
* Parameters

  ```json
  {
    "notebook": "20210831090520-7dvbdv0",
    "path": "/20210917220500-sz588nq/20210917220056-yxtyl7i.sy"
  }
  ```

    * `notebook`: Notebook ID
    * `path`: Document path
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "/foo/bar"
  }
  ```

### Get human-readable path based on ID

* `/api/filetree/getHPathByID`
* Parameters

  ```json
  {
    "id": "20210917220056-yxtyl7i"
  }
  ```

    * `id`: Block ID
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "/foo/bar"
  }
  ```

### Get storage path based on ID

* `/api/filetree/getPathByID`
* Parameters

  ```json
  {
    "id": "20210808180320-fqgskfj"
  }
  ```

    * `id`: Block ID
* Return value

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

### Get IDs based on human-readable path

* `/api/filetree/getIDsByHPath`
* Parameters

  ```json
  {
    "path": "/foo/bar",
    "notebook": "20210808180117-czj9bvb"
  }
  ```

    * `path`: Human-readable path
    * `notebook`: Notebook ID
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
        "20200813004931-q4cu8na"
    ]
  }
  ```

## Assets

### Upload assets

* `/api/asset/upload`
* The parameter is an HTTP Multipart form

    * `assetsDirPath`: The folder path where assets are stored, with the data folder as the root path, for example:
        * `"/assets/"`: workspace/data/assets/ folder
        * `"/assets/sub/"`: workspace/data/assets/sub/ folder

      Under normal circumstances, it is recommended to use the first method, which is stored in the assets folder of the
      workspace, putting in a subdirectory has some side effects, please refer to the assets chapter of the user guide.
    * `file[]`: Uploaded file list
* Return value

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

    * `errFiles`: List of filenames with errors in upload processing
    * `succMap`: For successfully processed files, the key is the file name when uploading, and the value is
      assets/foo-id.png, which is used to replace the asset link address in the existing Markdown content with the
      uploaded address

## Blocks

### Insert blocks

* `/api/block/insertBlock`
* Parameters

  ```json
  {
    "dataType": "markdown",
    "data": "foo**bar**{: style=\"color: var(--b3-font-color8);\"}baz",
    "nextID": "",
    "previousID": "20211229114650-vrek5x6",
    "parentID": ""
  }
  ```

    * `dataType`: The data type to be inserted, the value can be `markdown` or `dom`
    * `data`: Data to be inserted
    * `nextID`: The ID of the next block, used to anchor the insertion position
    * `previousID`: The ID of the previous block, used to anchor the insertion position
    * `parentID`: The ID of the parent block, used to anchor the insertion position

  `nextID`, `previousID`, and `parentID` must have at least one value, using priority: `nextID` > `previousID` >
  `parentID`
* Return value

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

    * `action.data`: DOM generated by the newly inserted block
    * `action.id`: ID of the newly inserted block

### Prepend blocks

* `/api/block/prependBlock`
* Parameters

  ```json
  {
    "data": "foo**bar**{: style=\"color: var(--b3-font-color8);\"}baz",
    "dataType": "markdown",
    "parentID": "20220107173950-7f9m1nb"
  }
  ```

    * `dataType`: The data type to be inserted, the value can be `markdown` or `dom`
    * `data`: Data to be inserted
    * `parentID`: The ID of the parent block, used to anchor the insertion position
* Return value

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

    * `action.data`: DOM generated by the newly inserted block
    * `action.id`: ID of the newly inserted block

### Append blocks

* `/api/block/appendBlock`
* Parameters

  ```json
  {
    "data": "foo**bar**{: style=\"color: var(--b3-font-color8);\"}baz",
    "dataType": "markdown",
    "parentID": "20220107173950-7f9m1nb"
  }
  ```

    * `dataType`: The data type to be inserted, the value can be `markdown` or `dom`
    * `data`: Data to be inserted
    * `parentID`: The ID of the parent block, used to anchor the insertion position
* Return value

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

    * `action.data`: DOM generated by the newly inserted block
    * `action.id`: ID of the newly inserted block

### Update a block

* `/api/block/updateBlock`
* Parameters

  ```json
  {
    "dataType": "markdown",
    "data": "foobarbaz",
    "id": "20211230161520-querkps"
  }
  ```

    * `dataType`: The data type to be updated, the value can be `markdown` or `dom`
    * `data`: Data to be updated
    * `id`: ID of the block to be updated
* Return value

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

    * `action.data`: DOM generated by the updated block

### Delete a block

* `/api/block/deleteBlock`
* Parameters

  ```json
  {
    "id": "20211230161520-querkps"
  }
  ```

    * `id`: ID of the block to be deleted
* Return value

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

### Move a block

* `/api/block/moveBlock`
* Parameters

  ```json
  {
    "id": "20230406180530-3o1rqkc",
    "previousID": "20230406152734-if5kyx6",
    "parentID": "20230404183855-woe52ko"
  }
  ```

    * `id`: Block ID to move
    * `previousID`: The ID of the previous block, used to anchor the insertion position
    * `parentID`: The ID of the parent block, used to anchor the insertion position, `previousID` and `parentID` cannot
      be empty at the same time, if they exist at the same time, `previousID` will be used first
* Return value

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

### Fold a block

* `/api/block/foldBlock`
* Parameters

  ```json
  {
    "id": "20231224160424-2f5680o"
  }
  ```

    * `id`: Block ID to fold
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Unfold a block

* `/api/block/unfoldBlock`
* Parameters

  ```json
  {
    "id": "20231224160424-2f5680o"
  }
  ```

    * `id`: Block ID to unfold
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Get a block kramdown

* `/api/block/getBlockKramdown`
* Parameters

  ```json
  {
    "id": "20201225220954-dlgzk1o"
  }
  ```

    * `id`: ID of the block to be got
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "id": "20201225220954-dlgzk1o",
      "kramdown": "* {: id=\"20201225220954-e913snx\"}Create a new notebook, create a new document under the notebook\n  {: id=\"20210131161940-kfs31q6\"}\n* {: id=\"20201225220954-ygz217h\"}Enter <kbd>/</kbd> in the editor to trigger the function menu\n  {: id=\"20210131161940-eo0riwq\"}\n* {: id=\"20201225220954-875yybt\"}((20200924101200-gss5vee \"Navigate in the content block\")) and ((20200924100906-0u4zfq3 \"Window and tab\"))\n  {: id=\"20210131161940-b5uow2h\"}"
    }
  }
  ```

### Get child blocks

* `/api/block/getChildBlocks`
* Parameters

  ```json
  {
    "id": "20230506212712-vt9ajwj"
  }
  ```

    * `id`: Parent block ID
    * The blocks below a heading are also counted as child blocks
* Return value

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

### Transfer block ref

* `/api/block/transferBlockRef`
* Parameters

  ```json
  {
    "fromID": "20230612160235-mv6rrh1",
    "toID": "20230613093045-uwcomng",
    "refIDs": ["20230613092230-cpyimmd"]
  }
  ```

    * `fromID`: Def block ID
    * `toID`: Target block ID
    * `refIDs`: Ref block IDs point to def block ID, optional, if not specified, all ref block IDs will be transferred
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

## Attributes

### Set block attributes

* `/api/attr/setBlockAttrs`
* Parameters

  ```json
  {
    "id": "20210912214605-uhi5gco",
    "attrs": {
      "custom-attr1": "line1\nline2"
    }
  }
  ```

    * `id`: Block ID
    * `attrs`: Block attributes, custom attributes must be prefixed with `custom-`
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Get block attributes

* `/api/attr/getBlockAttrs`
* Parameters

  ```json
  {
    "id": "20210912214605-uhi5gco"
  }
  ```

    * `id`: Block ID
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "custom-attr1": "line1\nline2",
      "id": "20210912214605-uhi5gco",
      "title": "PDF Annotation Demo",
      "type": "doc",
      "updated": "20210916120715"
    }
  }
  ```

## SQL

### Execute SQL query

* `/api/query/sql`
* Parameters

  ```json
  {
    "stmt": "SELECT * FROM blocks WHERE content LIKE'%content%' LIMIT 7"
  }
  ```

    * `stmt`: SQL statement
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
      { "col": "val" }
    ]
  }
  ```

Note: To ensure data security, access to this interface is prohibited in Publish Mode.

### Flush transaction

* `/api/sqlite/flushTransaction`
* No parameters
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

## Templates

### Render a template

* `/api/template/render`
* Parameters

  ```json
  {
    "id": "20220724223548-j6g0o87",
    "path": "F:\\SiYuan\\data\\templates\\foo.md"
  }
  ```

    * `id`: The ID of the document where the rendering is called
    * `path`: Template file absolute path
* Return value

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

### Render Sprig

* `/api/template/renderSprig`
* Parameters

  ```json
  {
    "template": "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}"
  }
  ```
    * `template`: template content
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "/daily note/2023/03/2023-03-24"
  }
  ```

## File

### Get file

* `/api/file/getFile`
* Parameters

  ``json {
  "path": "/data/20210808180117-6v0mkxr/20200923234011-ieuun1p.sy"
  }
  ``
    * `path`: the file path under the workspace path
* Return value

    * Response status code `200`: File content
    * Response status code `202`: Exception information

      ```json
      {
        "code": 404,
        "msg": "",
        "data": null
      }
      ```

        * `code`: non-zero for exceptions

            * `-1`: Parameter parsing error
            * `403`: Permission denied (file is not in the workspace)
            * `404`: Not Found (file doesn't exist)
            * `405`: Method Not Allowed (it's a directory)
            * `500`: Server Error (stat file failed / read file failed)
        * `msg`: a piece of text describing the error

### Put file

* `/api/file/putFile`
* The parameter is an HTTP Multipart form

    * `path`: the file path under the workspace path
    * `isDir`: whether to create a folder, when `true` only create a folder, ignore `file`
    * `modTime`: last access and modification time, Unix time
    * `file`: the uploaded file
* Return value

   ```json
   {
     "code": 0,
     "msg": "",
     "data": null
   }
   ```

### Remove file

* `/api/file/removeFile`
* Parameters

  ```json
  {
    "path": "/data/20210808180117-6v0mkxr/20200923234011-ieuun1p.sy"
  }
  ```
    * `path`: the file path under the workspace path
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Rename file

* `/api/file/renameFile`
* Parameters

  ```json
  {
    "path": "/data/assets/image-20230523085812-k3o9t32.png",
    "newPath": "/data/assets/test-20230523085812-k3o9t32.png"
  }
  ```
    * `path`: the file path under the workspace path
    * `newPath`: the new file path under the workspace path
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### List files

* `/api/file/readDir`
* Parameters

  ```json
  {
    "path": "/data/20210808180117-6v0mkxr/20200923234011-ieuun1p"
  }
  ```
    * `path`: the dir path under the workspace path
* Return value

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

## Export

### Export Markdown

* `/api/export/exportMdContent`
* Parameters

  ```json
  {
    "id": ""
  }
  ```

    * `id`: ID of the doc block to export
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "hPath": "/Please Start Here",
      "content": "## 🍫 Content Block\n\nIn SiYuan, the only important core concept is..."
    }
  }
  ```

    * `hPath`: human-readable path
    * `content`: Markdown content

### Export files and folders

* `/api/export/exportResources`
* Parameters

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

    * `paths`: A list of file or folder paths to be exported, the same filename/folder name will be overwritten
    * `name`: (Optional) The exported file name, which defaults to `export-YYYY-MM-DD_hh-mm-ss.zip` when not set
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "path": "temp/export/zip-file-name.zip"
    }
  }
  ```

    * `path`: The path of `*.zip` file created
        * The directory structure in `zip-file-name.zip` is as follows:
            * `zip-file-name`
                * `boot`
                * `langs`
                * `conf.json`
                * `index.html`

## Conversion

### Pandoc

* `/api/convert/pandoc`
* Working directory
    * Executing the pandoc command will set the working directory to `workspace/temp/convert/pandoc/${dir}`
    * API [`Put file`](#put-file) can be used to write the file to be converted to this directory first
    * Then call the API for conversion, and the converted file will also be written to this directory
    * Finally, call the API [`Get file`](#get-file) to get the converted file
        * Or call the API [Create a document with Markdown](#Create-a-document-with-Markdown)
        * Or call the internal API `importStdMd` to import the converted folder directly
* Parameters

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

    * `args`: Pandoc command line parameters
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
       "path": "/temp/convert/pandoc/test"
    }
  }
  ```
    * `path`: the path under the workspace

## Notification

### Push message

* `/api/notification/pushMsg`
* Parameters

  ```json
  {
    "msg": "test",
    "timeout": 7000
  }
  ```
    * `timeout`: The duration of the message display in milliseconds. This field can be omitted, the default is 7000
      milliseconds
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
        "id": "62jtmqi"
    }
  }
  ```
    * `id`: Message ID

### Push error message

* `/api/notification/pushErrMsg`
* Parameters

  ```json
  {
    "msg": "test",
    "timeout": 7000
  }
  ```
    * `timeout`: The duration of the message display in milliseconds. This field can be omitted, the default is 7000
      milliseconds
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
        "id": "qc9znut"
    }
  }
  ```
    * `id`: Message ID

## Network

### Forward proxy

* `/api/network/forwardProxy`
* Parameters

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

    * `url`: URL to forward
    * `method`: HTTP method, default is `POST`
    * `timeout`: timeout in milliseconds, default is `7000`
    * `contentType`: Content-Type, default is `application/json`
    * `headers`: HTTP headers
    * `payload`: HTTP payload, object or string
    * `payloadEncoding`: The encoding scheme used by `pyaload`, default is `text`, optional values are as follows

        * `text`
        * `base64` | `base64-std`
        * `base64-url`
        * `base32` | `base32-std`
        * `base32-hex`
        * `hex`
    * `responseEncoding`: The encoding scheme used by `body` in response data, default is `text`, optional values are as
      follows

        * `text`
        * `base64` | `base64-std`
        * `base64-url`
        * `base32` | `base32-std`
        * `base32-hex`
        * `hex`
* Return value

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

    * `bodyEncoding`: The encoding scheme used by `body`, is consistent with field `responseEncoding` in request,
      default is `text`, optional values are as follows

        * `text`
        * `base64` | `base64-std`
        * `base64-url`
        * `base32` | `base32-std`
        * `base32-hex`
        * `hex`

## System

### Get boot progress

* `/api/system/bootProgress`
* No parameters
* Return value

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

### Get system version

* `/api/system/version`
* No parameters
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "1.3.5"
  }
  ```

### Get the current time of the system

* `/api/system/currentTime`
* No parameters
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": 1631850968131
  }
  ```

    * `data`: Precision in milliseconds

## Database

A database (internally an "attribute view") stores structured data as fields (columns) and items (rows). Each database is identified by an `avID` and can be embedded into a document through one or more database blocks (`blockID`). A single database may contain multiple views (`viewID`) of different layout types: `table`, `gallery`, and `kanban`.

The field types (`keyType`) are:

| Value        | Description                |
|--------------|----------------------------|
| `block`      | Primary key (bound block)  |
| `text`       | Text                       |
| `number`     | Number                     |
| `date`       | Date                       |
| `select`     | Single select              |
| `mSelect`    | Multi-select               |
| `url`        | URL                        |
| `email`      | Email                      |
| `phone`      | Phone                      |
| `mAsset`     | Asset                      |
| `template`   | Template                   |
| `created`    | Creation time              |
| `updated`    | Update time                |
| `checkbox`   | Checkbox                   |
| `relation`   | Relation                   |
| `rollup`     | Rollup                     |
| `lineNumber` | Line number                |

### Render

* `/api/av/renderAttributeView`
* Parameters

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

    * `id`: Database ID
    * `blockID`: The database block that embeds this database. Used to resolve the active view and publish access. Omit when rendering a detached database.
    * `viewID`: The view to render. When omitted, the current view (`viewID` field) is used
    * `page`: Page number, 1-based. Defaults to `1`
    * `pageSize`: Items per page. `-1` or omitted means use the view's default (`50`)
    * `query`: Optional full-text filter for the primary-key values
    * `groupPaging`: Optional paging configuration for grouped (kanban) views
    * `createIfNotExist`: When `true` (default), create a default view if the database has none
* Return value (real response, table layout, one row shown):

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

    * `data.view`: The rendered viewable instance. Shape depends on `viewType` — `table` returns `columns`/`rows`/`rowCount`, `gallery` returns `columns`/`rows`, `kanban` returns `columns`/`groups` (each group is itself a view instance with `groupKey`/`groupValue`). `view` also carries `filters`, `sorts`, `group`, `showIcon`, `wrapField`, `groupFolded`, `groupHidden`. Note: active filters/grouping can make `rows` empty even when `rowCount` > 0
    * `data.view.columns[]`: Each has `id`, `name`, `type`, `icon`, `wrap`, `hidden`, `desc`, `calc`, `numberFormat`, `template`, `pin`, `width`; `select`/`mSelect` columns additionally carry `options`
    * `data.view.rows[].id`: The **row ID** (an item ID). For a bound row this is the same as the bound block ID; for a detached row it is a generated item ID distinct from any block
    * `data.view.rows[].cells[].value`: A `Value` object — see [Set a cell value](#Set-a-cell-value) for all value shapes. `createdAt`/`updatedAt` are int64 millisecond timestamps
    * `data.views`: Metadata of every view (no rows)
    * `data.isMirror`: `true` when the database block is a mirror (read-only copy) of the database

### Get

* `/api/av/getAttributeView`
* Parameters

  ```json
  {
    "id": "20240118120204-kwyzf77"
  }
  ```

    * `id`: Database ID
* Return value (real response, trimmed — `keyValues`/`views` arrays truncated):

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

    * `data.av`: The full `AttributeView` definition — fields (`keyValues`), field ordering (`keyIDs`, may be `null`), current view (`viewID`), and all views with their raw layout config (`table`/`gallery`/`kanban`) and item ordering (`itemIds`). Returns the raw definition (no rendered rows or pagination); use [Render](#Render) for computed rows

### Get primary key values

* `/api/av/getAttributeViewPrimaryKeyValues`
* Parameters

  ```json
  {
    "id": "20240118120204-kwyzf77",
    "keyword": "",
    "page": 1,
    "pageSize": 16
  }
  ```

    * `id`: Database ID
    * `keyword`: Optional substring filter against primary-key text (case-insensitive)
    * `page`: Page number, 1-based. Defaults to `1`
    * `pageSize`: Items per page. `-1` or omitted means `16`. Values are sorted by `block.updated` descending
* Return value (real response, one value shown):

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

    * `data.rows`: A `KeyValues` object holding the primary-key (`block`) field and its paginated values
    * `data.blockIDs`: IDs of all database blocks (mirrors) that reference this database

### Search

* `/api/av/searchAttributeView`
* Parameters

  ```json
  {
    "keyword": "API",
    "excludes": []
  }
  ```

    * `keyword`: Search keyword (matches database name)
    * `excludes`: Optional list of database IDs to exclude from the results
* Return value (real response):

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

    * `data.results[]`: Each top-level result groups a database by `avID`; its `children[]` list the individual views (`viewName`/`viewID`/`viewLayout`)

### Set a cell value

Updates a single cell (one field of one row). This is the primary write endpoint for cell values. The request `value` is a partial `Value` object whose shape depends on the field's `keyType`. The most common value shapes are:

| `keyType`  | `value` shape                                                                                                        |
|------------|----------------------------------------------------------------------------------------------------------------------|
| `block`    | `{"block": {"content": "First row", "id": "<boundBlockID>"}, "isDetached": false}`                                  |
| `text`     | `{"text": {"content": "Some text"}}`                                                                                 |
| `number`   | `{"number": {"content": 42, "isNotEmpty": true}}` (clear with `{"isNotEmpty": false}`)                               |
| `date`     | `{"date": {"content": 1676042451000, "isNotEmpty": true}}` (millisecond timestamp)                                  |
| `select`   | `{"mSelect": [{"content": "Done", "color": "1"}]}` (at most one option)                                             |
| `mSelect`  | `{"mSelect": [{"content": "A", "color": "1"}, {"content": "B", "color": "2"}]}`                                      |
| `url`      | `{"url": {"content": "https://siyuan.com"}}`                                                                         |
| `email`    | `{"email": {"content": "a@b.com"}}`                                                                                  |
| `phone`    | `{"phone": {"content": "1234567890"}}`                                                                               |
| `checkbox` | `{"checkbox": {"checked": true}}`                                                                                    |

> ⚠️ `itemID` is the **row ID** (`rows[].id` from [Render](#Render)). For a bound row the row ID equals the bound block ID; for a detached row it is a generated item ID. Passing the wrong ID stores the value as an orphan that does not appear in the rendered cell.

* `/api/av/setAttributeViewBlockAttr`
* Parameters

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

    * `avID`: Database ID
    * `keyID`: Field ID (the column being updated)
    * `itemID`: **Row ID** (`rows[].id` from [Render](#Render)). The legacy `rowID` parameter is deprecated and will be removed after 2026-12-01; use `itemID` instead
    * `value`: Partial `Value` object (see the table above). Unknown or unsupported keys are ignored
* Return value (real response, number value):

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

    * `data.value`: The fully-normalized value after the update (with computed fields such as `number.formattedContent`). Use this to refresh the UI rather than re-sending the request payload

### Add items

Adds one or more items (rows). Each source can either bind an existing block (`isDetached: false`) or create a detached row that only lives inside the view (`isDetached: true`).

* `/api/av/addAttributeViewBlocks`
* Parameters

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
        "content": "New row"
      }
    ],
    "ignoreDefaultFill": false
  }
  ```

    * `avID`: Database ID
    * `blockID`: The database block that owns this database (resolves target view/group)
    * `viewID`: Target view. When omitted, the current view is used
    * `groupID`: Target group ID for kanban views. Omit for table/gallery
    * `previousID`: Insert after this item ID. Empty means append to the end
    * `srcs[].id`: For bound blocks (`isDetached: false`), the block ID to bind. Must match the node ID pattern
    * `srcs[].isDetached`: `true` to create a detached row; `false` to bind an existing block
    * `srcs[].content`: Display text for the primary key (used when `isDetached: true`, or to override the bound block's content)
    * `srcs[].itemID`: Optional explicit item ID. Auto-generated when omitted
    * `ignoreDefaultFill`: When `true`, skip auto-filling default values into filter/group fields
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

    * The endpoint returns `null`; after it succeeds, call [Render](#Render) to fetch the updated rows (including the new row IDs needed for cell updates)

### Remove items

Removes one or more items (rows). Detached rows are deleted; bound blocks are unbound (the underlying document block is not deleted).

* `/api/av/removeAttributeViewBlocks`
* Parameters

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "srcIDs": ["20240118203831-fkfvvtx"]
  }
  ```

    * `avID`: Database ID
    * `srcIDs`: Row IDs (`rows[].id` from [Render](#Render)) to remove
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Change layout

Switches the layout type of the current view between `table`, `gallery`, and `kanban`. On success the server re-renders the view and returns it (same shape as [Render](#Render)).

* `/api/av/changeAttrViewLayout`
* Parameters

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t",
    "layoutType": "kanban"
  }
  ```

    * `avID`: Database ID
    * `blockID`: The database block that owns the view
    * `layoutType`: Target layout — one of `table`, `gallery`, `kanban`
* Return value: same shape as [Render](#Render). When switching to `kanban` and a group is configured, `data.view` carries a `groups[]` array; each group is a view instance with `groupKey`, `groupValue`, plus kanban-specific fields (`coverFrom`, `cardAspectRatio`, `cardSize`, `fitImage`, `displayFieldName`, `fillColBackgroundColor`, `fields`)

### Set grouping

Sets or clears the grouping rule for a kanban view. When `group.field` is empty, grouping is removed. On success the server re-renders the view and returns it.

* `/api/av/setAttrViewGroup`
* Parameters

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

    * `avID`: Database ID
    * `blockID`: The database block that owns the view
    * `group`: Grouping rule
    * `group.field`: Field (column) ID to group by. Empty string removes grouping
    * `group.method`: Group method — `0` by value, `1` by number range, `2` by relative date, `3` by day, `4` by week, `5` by month, `6` by year
    * `group.range`: Optional. Required when `method` is `1` (number range): `{ "numStart": 0, "numEnd": 100, "numStep": 10 }`
    * `group.order`: Group ordering — `0` ascending, `1` descending, `2` manual, `3` follow select-option order
    * `group.hideEmpty`: Whether to hide empty groups
* Return value: same shape as [Render](#Render)

### Get filter and sort

Returns the current filter and sort rules of the view bound to a database block.

* `/api/av/getAttributeViewFilterSort`
* Parameters

  ```json
  {
    "id": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t"
  }
  ```

    * `id`: Database ID
    * `blockID`: The database block that owns the view
* Return value (real response, no filters/sorts configured):

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

  When configured (real captured response), a filter and sort look like:

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
              { "content": "Done", "color": "1" }
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

    * `data.filters`: Array of `ViewFilter`. The top level holds a single root group node `{ "combination": "and"|"or", "filters": [...] }`; the array elements are either leaf filters or nested group nodes, enabling recursive AND/OR combinations.
    * `data.filters[].column`: Field (column) ID the filter applies to (leaf node only)
    * `data.filters[].operator`: Filter operator (see the operator table below; leaf node only)
    * `data.filters[].value`: Filter value, a `Value` object (see [Set a cell value](#Set-a-cell-value) for the value shapes; leaf node only)
    * `data.filters[].relativeDate`: Optional relative-date descriptor used by date filters (`{ "count": 7, "unit": 0, "direction": -1 }`; `unit`: `0` day, `1` week, `2` month, `3` year; `direction`: `-1` before, `0` this, `1` after; leaf node only)
    * `data.filters[].combination`: Group combinator, `"and"` or `"or"` (group node only)
    * `data.filters[].filters`: Child filter nodes, recursively `ViewFilter` (group node only)
    * `data.sorts`: Array of `ViewSort`
    * `data.sorts[].column`: Field (column) ID the sort applies to
    * `data.sorts[].order`: `ASC` or `DESC`

  Filter operators:

  | Value                | Description          |
  |----------------------|----------------------|
  | `=`                  | Equals               |
  | `!=`                 | Not equals           |
  | `>`                  | Greater than         |
  | `>=`                 | Greater or equal     |
  | `<`                  | Less than            |
  | `<=`                 | Less or equal        |
  | `Contains`           | Contains             |
  | `Does not contains`  | Does not contain     |
  | `Is empty`           | Is empty             |
  | `Is not empty`       | Is not empty         |
  | `Starts with`        | Starts with          |
  | `Ends with`          | Ends with            |
  | `Is between`         | Is between           |
  | `Is true`            | Is true (checkbox)   |
  | `Is false`           | Is false (checkbox)  |

### Set filter

* `/api/av/setAttrViewFilters`
* Parameters

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
            { "content": "Done", "color": "1" }
          ]
        }
      }
    ]
  }
  ```

    * `avID`: Database ID
    * `blockID`: The database block that owns the view
    * `data`: Full new array of `ViewFilter` objects that **replaces** the view's existing filters entirely (see [Get filter and sort](#Get-filter-and-sort)). Pass `[]` to clear all filters. The top level holds a single root group node `{ "combination": "and"|"or", "filters": [...] }`; the array elements are either leaf filters or nested group nodes, enabling recursive AND/OR combinations
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Set sort

* `/api/av/setAttrViewSorts`
* Parameters

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

    * `avID`: Database ID
    * `blockID`: The database block that owns the view
    * `data`: Full new array of `ViewSort` objects that **replaces** the view's existing sorts entirely (see [Get filter and sort](#Get-filter-and-sort)). Pass `[]` to clear all sorts
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

    * After a successful call, verify persistence via [Get filter and sort](#Get-filter-and-sort)

### Add a field

Adds a new field (column). The field is appended to every view (table/gallery/kanban) at the position after `previousKeyID` (or at the default position when empty).

* `/api/av/addAttributeViewKey`
* Parameters

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

    * `avID`: Database ID
    * `keyID`: ID for the new field. Must be a valid node ID generated by `Lute.NewNodeID()` (14-digit timestamp + `-` + 7-char random alphanumerics, e.g. `20240118120204-abc1234`)
    * `keyName`: Field display name
    * `keyType`: Field type — one of `text`, `number`, `date`, `select`, `mSelect`, `url`, `email`, `phone`, `mAsset`, `template`, `created`, `updated`, `checkbox`, `relation`, `rollup`, `lineNumber`. `block` (primary key) cannot be added through this endpoint
    * `keyIcon`: Optional field icon (emoji or empty string)
    * `previousKeyID`: Insert the new column after this field ID. Empty string uses the layout default (first column for table, last for gallery/kanban)
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Remove a field

Removes a field (column) and all of its values. Returns `code: -1` with `msg: "key not found"` if `keyID` does not exist.

* `/api/av/removeAttributeViewKey`
* Parameters

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "keyID": "20240118120204-7k9wzbp",
    "removeRelationDest": false
  }
  ```

    * `avID`: Database ID
    * `keyID`: Field ID to remove
    * `removeRelationDest`: When `true` and the field is a relation, also remove the corresponding back-relation field from the destination database. Defaults to `false`
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Set global field sort

Reorders a field (column) globally — moves `keyID` to the position after `previousKeyID` in the field ordering, affecting every view.

* `/api/av/sortAttributeViewKey`
* Parameters

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "keyID": "20240118203822-io6ofxb",
    "previousKeyID": "20240118120204-w6cggab"
  }
  ```

    * `avID`: Database ID
    * `keyID`: Field ID to move
    * `previousKeyID`: Field ID after which `keyID` should be placed. Empty string moves it to the first position
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### Set per-view field sort

Reorders a column within a single view's layout (e.g. a table's column order), without changing the global field ordering.

* `/api/av/sortAttributeViewViewKey`
* Parameters

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "viewID": "20240118120204-7rnmyc1",
    "keyID": "20240118203822-io6ofxb",
    "previousKeyID": "20240118120204-w6cggab"
  }
  ```

    * `avID`: Database ID
    * `viewID`: Target view. When empty, uses the current view
    * `keyID`: Field ID to move
    * `previousKeyID`: Field ID after which `keyID` should be placed. Empty string moves it to the first position
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```
