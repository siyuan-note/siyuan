[English](https://github.com/siyuan-note/siyuan/blob/master/API.md) | [中文](https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md)

* [仕様](#仕様)
    * [パラメータと戻り値](#パラメータと戻り値)
    * [認証](#認証)
* [ノートブック](#ノートブック)
    * [ノートブック一覧を取得](#ノートブック一覧を取得)
    * [ノートブックを開く](#ノートブックを開く)
    * [ノートブックを閉じる](#ノートブックを閉じる)
    * [ノートブックの名前を変更](#ノートブックの名前を変更)
    * [ノートブックを作成](#ノートブックを作成)
    * [ノートブックを削除](#ノートブックを削除)
    * [ノートブック設定を取得](#ノートブック設定を取得)
    * [ノートブック設定を保存](#ノートブック設定を保存)
* [ドキュメント](#ドキュメント)
    * [Markdownでドキュメントを作成](#Markdownでドキュメントを作成)
    * [ドキュメントの名前を変更](#ドキュメントの名前を変更)
    * [ドキュメントを削除](#ドキュメントを削除)
    * [ドキュメントを移動](#ドキュメントを移動)
    * [パスから人間が読めるパスを取得](#パスから人間が読めるパスを取得)
    * [IDから人間が読めるパスを取得](#IDから人間が読めるパスを取得)
    * [IDからストレージパスを取得](#IDからストレージパスを取得)
    * [人間が読めるパスからIDを取得](#人間が読めるパスからIDを取得)
* [アセット](#アセット)
    * [アセットをアップロード](#アセットをアップロード)
* [ブロック](#ブロック)
    * [ブロックを挿入](#ブロックを挿入)
    * [ブロックを先頭に挿入](#ブロックを先頭に挿入)
    * [ブロックを末尾に追加](#ブロックを末尾に追加)
    * [ブロックを更新](#ブロックを更新)
    * [ブロックを削除](#ブロックを削除)
    * [ブロックを移動](#ブロックを移動)
    * [ブロックを折りたたむ](#ブロックを折りたたむ)
    * [ブロックを展開](#ブロックを展開)
    * [ブロックのkramdownを取得](#ブロックのkramdownを取得)
    * [子ブロックを取得](#子ブロックを取得)
    * [ブロック参照を移行](#ブロック参照を移行)
* [属性](#属性)
    * [ブロック属性を設定](#ブロック属性を設定)
    * [ブロック属性を取得](#ブロック属性を取得)
* [SQL](#SQL)
    * [SQLクエリを実行](#SQLクエリを実行)
    * [トランザクションをフラッシュ](#トランザクションをフラッシュ)
* [テンプレート](#テンプレート)
    * [テンプレートをレンダリング](#テンプレートをレンダリング)
    * [Sprigをレンダリング](#Sprigをレンダリング)
* [ファイル](#ファイル)
    * [ファイルを取得](#ファイルを取得)
    * [ファイルを配置](#ファイルを配置)
    * [ファイルを削除](#ファイルを削除)
    * [ファイルの名前を変更](#ファイルの名前を変更)
    * [ファイル一覧を取得](#ファイル一覧を取得)
* [エクスポート](#エクスポート)
    * [Markdownをエクスポート](#Markdownをエクスポート)
    * [ファイルとフォルダをエクスポート](#ファイルとフォルダをエクスポート)
* [変換](#変換)
    * [Pandoc](#Pandoc)
* [通知](#通知)
    * [メッセージをプッシュ](#メッセージをプッシュ)
    * [エラーメッセージをプッシュ](#エラーメッセージをプッシュ)
* [ネットワーク](#ネットワーク)
    * [フォワードプロキシ](#フォワードプロキシ)
* [システム](#システム)
    * [起動進捗を取得](#起動進捗を取得)
    * [システムバージョンを取得](#システムバージョンを取得)
    * [システムの現在時刻を取得](#システムの現在時刻を取得)

---

## 仕様

### パラメータと戻り値

* エンドポイント: `http://127.0.0.1:6806`
* すべてPOSTメソッドを使用
* パラメータを持つインターフェースでは、パラメータはJSON文字列としてbodyに配置し、ヘッダーのContent-Typeは`application/json`とする
* 戻り値

   ````json
   {
     "code": 0,
     "msg": "",
     "data": {}
   }
   ````

    * `code`: 0以外は例外を示す
    * `msg`: 通常は空文字列、異常時にはエラーテキストが返される
    * `data`: インターフェースによって`{}`、`[]`、または`NULL`となる

### 認証

<kbd>設定 - このアプリケーションについて</kbd>でAPIトークンを確認し、リクエストヘッダーに `Authorization: Token xxx` を設定

## ノートブック

### ノートブック一覧を取得

* `/api/notebook/lsNotebooks`
* パラメータなし
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "notebooks": [
        {
          "id": "20210817205410-2kvfpfn",
          "name": "テスト用ノートブック",
          "icon": "1f41b",
          "sort": 0,
          "closed": false
        },
        {
          "id": "20210808180117-czj9bvb",
          "name": "SiYuanユーザーガイド",
          "icon": "1f4d4",
          "sort": 1,
          "closed": false
        }
      ]
    }
  }
  ```

### ノートブックを開く

* `/api/notebook/openNotebook`
* パラメータ

  ```json
  {
    "notebook": "20210831090520-7dvbdv0"
  }
  ```

    * `notebook`: ノートブックID
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ノートブックを閉じる

* `/api/notebook/closeNotebook`
* パラメータ

  ```json
  {
    "notebook": "20210831090520-7dvbdv0"
  }
  ```

    * `notebook`: ノートブックID
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ノートブックの名前を変更

* `/api/notebook/renameNotebook`
* パラメータ

  ```json
  {
    "notebook": "20210831090520-7dvbdv0",
    "name": "ノートブックの新しい名前"
  }
  ```

    * `notebook`: ノートブックID
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ノートブックを作成

* `/api/notebook/createNotebook`
* パラメータ

  ```json
  {
    "name": "ノートブック名"
  }
  ```
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "notebook": {
        "id": "20220126215949-r1wvoch",
        "name": "ノートブック名",
        "icon": "",
        "sort": 0,
        "closed": false
      }
    }
  }
  ```

### ノートブックを削除

* `/api/notebook/removeNotebook`
* パラメータ

  ```json
  {
    "notebook": "20210831090520-7dvbdv0"
  }
  ```

    * `notebook`: ノートブックID
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ノートブック設定を取得

* `/api/notebook/getNotebookConf`
* パラメータ

  ```json
  {
    "notebook": "20210817205410-2kvfpfn"
  }
  ```

    * `notebook`: ノートブックID
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "box": "20210817205410-2kvfpfn",
      "conf": {
        "name": "テスト用ノートブック",
        "closed": false,
        "refCreateSavePath": "",
        "createDocNameTemplate": "",
        "dailyNoteSavePath": "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}",
        "dailyNoteTemplatePath": ""
      },
      "name": "テスト用ノートブック"
    }
  }
  ```

### ノートブック設定を保存

* `/api/notebook/setNotebookConf`
* パラメータ

  ```json
  {
    "notebook": "20210817205410-2kvfpfn",
    "conf": {
        "name": "テスト用ノートブック",
        "closed": false,
        "refCreateSavePath": "",
        "createDocNameTemplate": "",
        "dailyNoteSavePath": "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}",
        "dailyNoteTemplatePath": ""
      }
  }
  ```

    * `notebook`: ノートブックID
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "name": "テスト用ノートブック",
      "closed": false,
      "refCreateSavePath": "",
      "createDocNameTemplate": "",
      "dailyNoteSavePath": "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}",
      "dailyNoteTemplatePath": ""
    }
  }
  ```

## ドキュメント

### Markdownでドキュメントを作成

* `/api/filetree/createDocWithMd`
* パラメータ

  ```json
  {
    "notebook": "20210817205410-2kvfpfn",
    "path": "/foo/bar",
    "markdown": ""
  }
  ```

    * `notebook`: ノートブックID
    * `path`: ドキュメントパス、/で始まり/で階層を区切る（このpathはデータベースのhpathフィールドに対応）
    * `markdown`: GFM Markdownコンテンツ
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "20210914223645-oj2vnx2"
  }
  ```

    * `data`: 作成されたドキュメントID
    * 同じ`path`でこのインターフェースを繰り返し呼び出しても、既存のドキュメントは上書きされない

### ドキュメントの名前を変更

* `/api/filetree/renameDoc`
* パラメータ

  ```json
  {
    "notebook": "20210831090520-7dvbdv0",
    "path": "/20210902210113-0avi12f.sy",
    "title": "新しいドキュメントタイトル"
  }
  ```

    * `notebook`: ノートブックID
    * `path`: ドキュメントパス
    * `title`: 新しいドキュメントタイトル
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

`id`でドキュメントの名前を変更:

* `/api/filetree/renameDocByID`
* パラメータ

  ```json
  {
    "id": "20210902210113-0avi12f",
    "title": "新しいドキュメントタイトル"
  }
  ```

    * `id`: ドキュメントID
    * `title`: 新しいドキュメントタイトル
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ドキュメントを削除

* `/api/filetree/removeDoc`
* パラメータ

  ```json
  {
    "notebook": "20210831090520-7dvbdv0",
    "path": "/20210902210113-0avi12f.sy"
  }
  ```

    * `notebook`: ノートブックID
    * `path`: ドキュメントパス
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

`id`でドキュメントを削除:

* `/api/filetree/removeDocByID`
* パラメータ

  ```json
  {
    "id": "20210902210113-0avi12f"
  }
  ```

    * `id`: ドキュメントID
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ドキュメントを移動

* `/api/filetree/moveDocs`
* パラメータ

  ```json
  {
    "fromPaths": ["/20210917220056-yxtyl7i.sy"],
    "toNotebook": "20210817205410-2kvfpfn",
    "toPath": "/"
  }
  ```

    * `fromPaths`: 移動元パス
    * `toNotebook`: 移動先ノートブックID
    * `toPath`: 移動先パス
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

`id`でドキュメントを移動:

* `/api/filetree/moveDocsByID`
* パラメータ

  ```json
  {
    "fromIDs": ["20210917220056-yxtyl7i"],
    "toID": "20210817205410-2kvfpfn"
  }
  ```

    * `fromIDs`: 移動元ドキュメントのID
    * `toID`: 移動先の親ドキュメントIDまたはノートブックID
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### パスから人間が読めるパスを取得

* `/api/filetree/getHPathByPath`
* パラメータ

  ```json
  {
    "notebook": "20210831090520-7dvbdv0",
    "path": "/20210917220500-sz588nq/20210917220056-yxtyl7i.sy"
  }
  ```

    * `notebook`: ノートブックID
    * `path`: ドキュメントパス
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "/foo/bar"
  }
  ```

### IDから人間が読めるパスを取得

* `/api/filetree/getHPathByID`
* パラメータ

  ```json
  {
    "id": "20210917220056-yxtyl7i"
  }
  ```

    * `id`: ブロックID
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "/foo/bar"
  }
  ```

### IDからストレージパスを取得

* `/api/filetree/getPathByID`
* パラメータ

  ```json
  {
    "id": "20210808180320-fqgskfj"
  }
  ```

    * `id`: ブロックID
* 戻り値

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

### 人間が読めるパスからIDを取得

* `/api/filetree/getIDsByHPath`
* パラメータ

  ```json
  {
    "path": "/foo/bar",
    "notebook": "20210808180117-czj9bvb"
  }
  ```

    * `path`: 人間が読めるパス
    * `notebook`: ノートブックID
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
        "20200813004931-q4cu8na"
    ]
  }
  ```

## アセット

### アセットをアップロード

* `/api/asset/upload`
* パラメータはHTTP Multipartフォーム

    * `assetsDirPath`: アセットが保存されるフォルダパス、dataフォルダをルートパスとする、例:
        * `"/assets/"`: workspace/data/assets/ フォルダ
        * `"/assets/sub/"`: workspace/data/assets/sub/ フォルダ

      通常は最初の方法を推奨、ワークスペースのassetsフォルダに保存される。サブディレクトリに配置すると副作用があるため、ユーザーガイドのアセットの章を参照。
    * `file[]`: アップロードするファイルリスト
* 戻り値

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

    * `errFiles`: アップロード処理でエラーが発生したファイル名のリスト
    * `succMap`: 正常に処理されたファイル、キーはアップロード時のファイル名、値はassets/foo-id.pngで、既存のMarkdownコンテンツ内のアセットリンクアドレスをアップロードされたアドレスに置き換えるために使用

## ブロック

### ブロックを挿入

* `/api/block/insertBlock`
* パラメータ

  ```json
  {
    "dataType": "markdown",
    "data": "foo**bar**{: style=\"color: var(--b3-font-color8);\"}baz",
    "nextID": "",
    "previousID": "20211229114650-vrek5x6",
    "parentID": ""
  }
  ```

    * `dataType`: 挿入するデータ型、`markdown`または`dom`
    * `data`: 挿入するデータ
    * `nextID`: 次のブロックのID、挿入位置を固定するために使用
    * `previousID`: 前のブロックのID、挿入位置を固定するために使用
    * `parentID`: 親ブロックのID、挿入位置を固定するために使用

  `nextID`、`previousID`、`parentID`のうち少なくとも1つは値が必要、優先順位: `nextID` > `previousID` > `parentID`
* 戻り値

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

    * `action.data`: 新しく挿入されたブロックによって生成されたDOM
    * `action.id`: 新しく挿入されたブロックのID

### ブロックを先頭に挿入

* `/api/block/prependBlock`
* パラメータ

  ```json
  {
    "data": "foo**bar**{: style=\"color: var(--b3-font-color8);\"}baz",
    "dataType": "markdown",
    "parentID": "20220107173950-7f9m1nb"
  }
  ```

    * `dataType`: 挿入するデータ型、`markdown`または`dom`
    * `data`: 挿入するデータ
    * `parentID`: 親ブロックのID、挿入位置を固定するために使用
* 戻り値

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

    * `action.data`: 新しく挿入されたブロックによって生成されたDOM
    * `action.id`: 新しく挿入されたブロックのID

### ブロックを末尾に追加

* `/api/block/appendBlock`
* パラメータ

  ```json
  {
    "data": "foo**bar**{: style=\"color: var(--b3-font-color8);\"}baz",
    "dataType": "markdown",
    "parentID": "20220107173950-7f9m1nb"
  }
  ```

    * `dataType`: 挿入するデータ型、`markdown`または`dom`
    * `data`: 挿入するデータ
    * `parentID`: 親ブロックのID、挿入位置を固定するために使用
* 戻り値

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

    * `action.data`: 新しく挿入されたブロックによって生成されたDOM
    * `action.id`: 新しく挿入されたブロックのID

### ブロックを更新

* `/api/block/updateBlock`
* パラメータ

  ```json
  {
    "dataType": "markdown",
    "data": "foobarbaz",
    "id": "20211230161520-querkps"
  }
  ```

    * `dataType`: 更新するデータ型、`markdown`または`dom`
    * `data`: 更新するデータ
    * `id`: 更新するブロックのID
* 戻り値

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

    * `action.data`: 更新されたブロックによって生成されたDOM

### ブロックを削除

* `/api/block/deleteBlock`
* パラメータ

  ```json
  {
    "id": "20211230161520-querkps"
  }
  ```

    * `id`: 削除するブロックのID
* 戻り値

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

### ブロックを移動

* `/api/block/moveBlock`
* パラメータ

  ```json
  {
    "id": "20230406180530-3o1rqkc",
    "previousID": "20230406152734-if5kyx6",
    "parentID": "20230404183855-woe52ko"
  }
  ```

    * `id`: 移動するブロックID
    * `previousID`: 前のブロックのID、挿入位置を固定するために使用
    * `parentID`: 親ブロックのID、挿入位置を固定するために使用、`previousID`と`parentID`は同時に空にできない、両方存在する場合は`previousID`が優先
* 戻り値

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

### ブロックを折りたたむ

* `/api/block/foldBlock`
* パラメータ

  ```json
  {
    "id": "20231224160424-2f5680o"
  }
  ```

    * `id`: 折りたたむブロックID
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ブロックを展開

* `/api/block/unfoldBlock`
* パラメータ

  ```json
  {
    "id": "20231224160424-2f5680o"
  }
  ```

    * `id`: 展開するブロックID
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ブロックのkramdownを取得

* `/api/block/getBlockKramdown`
* パラメータ

  ```json
  {
    "id": "20201225220954-dlgzk1o"
  }
  ```

    * `id`: 取得するブロックのID
* 戻り値

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

### 子ブロックを取得

* `/api/block/getChildBlocks`
* パラメータ

  ```json
  {
    "id": "20230506212712-vt9ajwj"
  }
  ```

    * `id`: 親ブロックID
    * 見出しの下のブロックも子ブロックとしてカウントされる
* 戻り値

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

### ブロック参照を移行

* `/api/block/transferBlockRef`
* パラメータ

  ```json
  {
    "fromID": "20230612160235-mv6rrh1",
    "toID": "20230613093045-uwcomng",
    "refIDs": ["20230613092230-cpyimmd"]
  }
  ```

    * `fromID`: 定義ブロックID
    * `toID`: ターゲットブロックID
    * `refIDs`: 定義ブロックIDを指す参照ブロックID、オプション、指定しない場合はすべての参照ブロックIDが移行される
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

## 属性

### ブロック属性を設定

* `/api/attr/setBlockAttrs`
* パラメータ

  ```json
  {
    "id": "20210912214605-uhi5gco",
    "attrs": {
      "custom-attr1": "line1\nline2"
    }
  }
  ```

    * `id`: ブロックID
    * `attrs`: ブロック属性、カスタム属性は`custom-`プレフィックスが必要
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ブロック属性を取得

* `/api/attr/getBlockAttrs`
* パラメータ

  ```json
  {
    "id": "20210912214605-uhi5gco"
  }
  ```

    * `id`: ブロックID
* 戻り値

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

### SQLクエリを実行

* `/api/query/sql`
* パラメータ

  ```json
  {
    "stmt": "SELECT * FROM blocks WHERE content LIKE'%content%' LIMIT 7"
  }
  ```

    * `stmt`: SQL文
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": [
      { "col": "val" }
    ]
  }
  ```

### トランザクションをフラッシュ

* `/api/sqlite/flushTransaction`
* パラメータなし
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

## テンプレート

### テンプレートをレンダリング

* `/api/template/render`
* パラメータ

  ```json
  {
    "id": "20220724223548-j6g0o87",
    "path": "F:\\SiYuan\\data\\templates\\foo.md"
  }
  ```

    * `id`: レンダリングが呼び出されるドキュメントのID
    * `path`: テンプレートファイルの絶対パス
* 戻り値

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

### Sprigをレンダリング

* `/api/template/renderSprig`
* パラメータ

  ```json
  {
    "template": "/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}"
  }
  ```
    * `template`: テンプレートコンテンツ
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "/daily note/2023/03/2023-03-24"
  }
  ```

## ファイル

### ファイルを取得

* `/api/file/getFile`
* パラメータ

  ``json {
  "path": "/data/20210808180117-6v0mkxr/20200923234011-ieuun1p.sy"
  }
  ``
    * `path`: ワークスペースパス配下のファイルパス
* 戻り値

    * レスポンスステータスコード `200`: ファイルコンテンツ
    * レスポンスステータスコード `202`: 例外情報

      ```json
      {
        "code": 404,
        "msg": "",
        "data": null
      }
      ```

        * `code`: 0以外は例外

            * `-1`: パラメータ解析エラー
            * `403`: アクセス拒否（ファイルがワークスペース内にない）
            * `404`: 見つからない（ファイルが存在しない）
            * `405`: メソッド不許可（ディレクトリである）
            * `500`: サーバーエラー（ファイルのstat失敗 / ファイルの読み取り失敗）
        * `msg`: エラーを説明するテキスト

### ファイルを配置

* `/api/file/putFile`
* パラメータはHTTP Multipartフォーム

    * `path`: ワークスペースパス配下のファイルパス
    * `isDir`: フォルダを作成するかどうか、`true`の場合はフォルダのみ作成し、`file`を無視
    * `modTime`: 最終アクセス・更新時刻、Unix時間
    * `file`: アップロードするファイル
* 戻り値

   ```json
   {
     "code": 0,
     "msg": "",
     "data": null
   }
   ```

### ファイルを削除

* `/api/file/removeFile`
* パラメータ

  ```json
  {
    "path": "/data/20210808180117-6v0mkxr/20200923234011-ieuun1p.sy"
  }
  ```
    * `path`: ワークスペースパス配下のファイルパス
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ファイルの名前を変更

* `/api/file/renameFile`
* パラメータ

  ```json
  {
    "path": "/data/assets/image-20230523085812-k3o9t32.png",
    "newPath": "/data/assets/test-20230523085812-k3o9t32.png"
  }
  ```
    * `path`: ワークスペースパス配下のファイルパス
    * `newPath`: ワークスペースパス配下の新しいファイルパス
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ファイル一覧を取得

* `/api/file/readDir`
* パラメータ

  ```json
  {
    "path": "/data/20210808180117-6v0mkxr/20200923234011-ieuun1p"
  }
  ```
    * `path`: ワークスペースパス配下のディレクトリパス
* 戻り値

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

## エクスポート

### Markdownをエクスポート

* `/api/export/exportMdContent`
* パラメータ

  ```json
  {
    "id": ""
  }
  ```

    * `id`: エクスポートするドキュメントブロックのID
* 戻り値

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

    * `hPath`: 人間が読めるパス
    * `content`: Markdownコンテンツ

### ファイルとフォルダをエクスポート

* `/api/export/exportResources`
* パラメータ

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

    * `paths`: エクスポートするファイルまたはフォルダパスのリスト、同じファイル名/フォルダ名は上書きされる
    * `name`: （オプション）エクスポートするファイル名、設定しない場合はデフォルトで`export-YYYY-MM-DD_hh-mm-ss.zip`
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "path": "temp/export/zip-file-name.zip"
    }
  }
  ```

    * `path`: 作成された`*.zip`ファイルのパス
        * `zip-file-name.zip`内のディレクトリ構造は以下の通り:
            * `zip-file-name`
                * `boot`
                * `langs`
                * `conf.json`
                * `index.html`

## 変換

### Pandoc

* `/api/convert/pandoc`
* 作業ディレクトリ
    * pandocコマンドの実行時、作業ディレクトリは`workspace/temp/convert/pandoc/${dir}`に設定される
    * API [`ファイルを配置`](#ファイルを配置)を使用して、変換するファイルをこのディレクトリに先に書き込むことができる
    * その後、APIを呼び出して変換し、変換されたファイルもこのディレクトリに書き込まれる
    * 最後に、API [`ファイルを取得`](#ファイルを取得)を呼び出して変換されたファイルを取得
        * または、API [Markdownでドキュメントを作成](#Markdownでドキュメントを作成)を呼び出す
        * または、内部API `importStdMd`を呼び出して変換されたフォルダを直接インポート
* パラメータ

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

    * `args`: Pandocコマンドラインパラメータ
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
       "path": "/temp/convert/pandoc/test"
    }
  }
  ```
    * `path`: ワークスペース配下のパス

## 通知

### メッセージをプッシュ

* `/api/notification/pushMsg`
* パラメータ

  ```json
  {
    "msg": "test",
    "timeout": 7000
  }
  ```
    * `timeout`: メッセージ表示時間（ミリ秒）。このフィールドは省略可能、デフォルトは7000ミリ秒
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
        "id": "62jtmqi"
    }
  }
  ```
    * `id`: メッセージID

### エラーメッセージをプッシュ

* `/api/notification/pushErrMsg`
* パラメータ

  ```json
  {
    "msg": "test",
    "timeout": 7000
  }
  ```
    * `timeout`: メッセージ表示時間（ミリ秒）。このフィールドは省略可能、デフォルトは7000ミリ秒
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
        "id": "qc9znut"
    }
  }
  ```
    * `id`: メッセージID

## ネットワーク

### フォワードプロキシ

* `/api/network/forwardProxy`
* パラメータ

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

    * `url`: 転送するURL
    * `method`: HTTPメソッド、デフォルトは`POST`
    * `timeout`: タイムアウト（ミリ秒）、デフォルトは`7000`
    * `contentType`: Content-Type、デフォルトは`application/json`
    * `headers`: HTTPヘッダー
    * `payload`: HTTPペイロード、オブジェクトまたは文字列
    * `payloadEncoding`: `payload`で使用されるエンコーディングスキーム、デフォルトは`text`、選択可能な値は以下の通り

        * `text`
        * `base64` | `base64-std`
        * `base64-url`
        * `base32` | `base32-std`
        * `base32-hex`
        * `hex`
    * `responseEncoding`: レスポンスデータの`body`で使用されるエンコーディングスキーム、デフォルトは`text`、選択可能な値は以下の通り

        * `text`
        * `base64` | `base64-std`
        * `base64-url`
        * `base32` | `base32-std`
        * `base32-hex`
        * `hex`
* 戻り値

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

    * `bodyEncoding`: `body`で使用されるエンコーディングスキーム、リクエストの`responseEncoding`フィールドと一致、デフォルトは`text`、選択可能な値は以下の通り

        * `text`
        * `base64` | `base64-std`
        * `base64-url`
        * `base32` | `base32-std`
        * `base32-hex`
        * `hex`

## システム

### 起動進捗を取得

* `/api/system/bootProgress`
* パラメータなし
* 戻り値

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

### システムバージョンを取得

* `/api/system/version`
* パラメータなし
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": "1.3.5"
  }
  ```

### システムの現在時刻を取得

* `/api/system/currentTime`
* パラメータなし
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": 1631850968131
  }
  ```

    * `data`: ミリ秒精度
