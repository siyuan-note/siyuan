[中文](https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md)

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
* [Assets](#Assets)
    * [Upload assets](#Upload-assets)
* [Blocks](#Blocks)
    * [Insert blocks](#Insert-blocks)
    * [Prepend blocks](#Prepend-blocks)
    * [Append blocks](#Append-blocks)
    * [Update a block](#Update-a-block)
    * [Delete a block](#Delete-a-block)
    * [Move a block](#Move-a-block)
    * [Get a block kramdown](#Get-a-block-kramdown)
    * [Get child blocks](#get-child-blocks)
    * [Transfer block ref](#transfer-block-ref)
* [Attributes](#Attributes)
    * [Set block attributes](#Set-block-attributes)
    * [Get block attributes](#Get-block-attributes)
* [SQL](#SQL)
    * [Execute SQL query](#Execute-SQL-query)
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
* [Conversion](#Conversion)
    * [Pandoc](#Pandoc)
* [Notification](#Notification)
    * [Push message](#Push-message)
    * [Push error message](#Push-error-message)
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
    "title": "Document new title"
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

### Get human readable path based on path

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

### Get human readable path based on ID

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

## Assets

### Upload assets

* `/api/asset/upload`
* The parameter is an HTTP Multipart form

    * `assetsDirPath`: The folder path where assets are stored, with the data folder as the root path, for example:
        * `"/assets/"`: workspace/data/assets/ folder
        * `"/assets/sub/"`: workspace/data/assets/sub/ folder

      Under normal circumstances, it is recommended to use the first method, which is stored in the assets folder
      of the workspace, putting in a subdirectory has some side effects, please refer to the assets chapter of the user guide.
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

  `nextID`, `previousID`, and `parentID` must have at least one value, using
  priority: `nextID` > `previousID` > `parentID`
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

  File content

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
    "path": "/data/20210808180117-6v0mkxr/20200923234011-ieuun1p.sy"
  }
  ```
    * `path`: the file path under the workspace path
* Return value

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
        {
            "isDir": true,
            "name": "20210808180320-abz7w6k"
        },
        {
            "isDir": false,
            "name": "20210808180320-abz7w6k.sy"
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

## Conversion

### Pandoc

* `/api/convert/pandoc`
* Working directory
    * Executing the pandoc command will set the working directory to `workspace/temp/convert/pandoc/`
    * API [`Put file`](#put-file) can be used to write the file to be converted to this directory first
    * Then call the API for conversion, and the converted file will also be written to this directory
    * Finally, call the API [`Get file`](#get-file) to get the converted file
        * Or call the API [Create a document with Markdown](#Create-a-document-with-Markdown)
        * Or call the internal API `importStdMd` to import the converted folder directly
* Parameters

  ```json
  {
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
    "data": null
  }
  ```

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
