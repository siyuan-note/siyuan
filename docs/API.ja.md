[English](API.md)
| [中文](API.zh-CN.md)
| **日本語**

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
* [データベース](#データベース)
    * [レンダリング](#レンダリング)
    * [取得](#取得)
    * [主キー値を取得](#主キー値を取得)
    * [検索](#検索)
    * [セル値を設定](#セル値を設定)
    * [アイテムを追加](#アイテムを追加)
    * [アイテムを削除](#アイテムを削除)
    * [レイアウトを切り替え](#レイアウトを切り替え)
    * [グループ化を設定](#グループ化を設定)
    * [フィルターとソートを取得](#フィルターとソートを取得)
    * [フィルターを設定](#フィルターを設定)
    * [ソートを設定](#ソートを設定)
    * [フィールドを追加](#フィールドを追加)
    * [フィールドを削除](#フィールドを削除)
    * [グローバルのフィールドソートを設定](#グローバルのフィールドソートを設定)
    * [ビュー内のフィールドソートを設定](#ビュー内のフィールドソートを設定)
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

注：データセキュリティを確保するため、パブリッシュモードでの本インターフェースへのアクセスは禁止されています。

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

## データベース

データベース（内部では「属性ビュー」）は、フィールド（列）とアイテム（行）として構造化データを格納します。各データベースは `avID` で識別され、1 つ以上のデータベースブロック（`blockID`）を通じてドキュメントに埋め込めます。1 つのデータベースは複数の異なるレイアウトタイプのビュー（`viewID`）を持てます：`table`（テーブル）、`gallery`（ギャラリー）、`kanban`（カンバン）。

フィールドタイプ（`keyType`）は以下の通りです：

| 値          | 説明                   |
|-------------|------------------------|
| `block`     | 主キー（紐づくブロック）|
| `text`      | テキスト               |
| `number`    | 数値                   |
| `date`      | 日付                   |
| `select`    | 単一選択               |
| `mSelect`   | 複数選択               |
| `url`       | URL                    |
| `email`     | メール                 |
| `phone`     | 電話                   |
| `mAsset`    | アセット               |
| `template`  | テンプレート           |
| `created`   | 作成日時               |
| `updated`   | 更新日時               |
| `checkbox`  | チェックボックス       |
| `relation`  | 関連                   |
| `rollup`    | ロールアップ           |
| `lineNumber`| 行番号                 |

### レンダリング

* `/api/av/renderAttributeView`
* パラメータ

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

    * `id`: データベース ID
    * `blockID`: このデータベースを埋め込むデータベースブロック。アクティブなビューや公開権限の解決に使用します。独立したデータベースをレンダリングする場合は省略します
    * `viewID`: レンダリングするビュー。省略時は現在のビュー（`viewID` フィールド）を使用
    * `page`: ページ番号（1 始まり）。デフォルトは `1`
    * `pageSize`: 1 ページあたりのアイテム数。`-1` または省略時はビューのデフォルト（`50`）を使用
    * `query`: 主キー値に対する任意の全文フィルターキーワード
    * `groupPaging`: グループ化（カンバン）ビューの任意のページング設定
    * `createIfNotExist`: `true`（デフォルト）の場合、データベースにビューが無ければデフォルトビューを作成
* 戻り値（実際のレスポンス、テーブルレイアウト、1 行を表示）：

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "name": "API テスト",
      "id": "20240118120204-kwyzf77",
      "viewType": "table",
      "viewID": "20240118120204-7rnmyc1",
      "isMirror": false,
      "views": [
        {
          "id": "20240118120204-7rnmyc1",
          "icon": "",
          "name": "テーブル",
          "desc": "",
          "hideAttrViewName": false,
          "type": "table",
          "pageSize": 50
        }
      ],
      "view": {
        "id": "20240118120204-7rnmyc1",
        "icon": "",
        "name": "テーブル",
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
            "name": "主キー",
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

    * `data.view`: レンダリングされたビューインスタンス。形状は `viewType` により異なります——`table` は `columns`/`rows`/`rowCount`、`gallery` は `columns`/`rows`、`kanban` は `columns`/`groups`（各グループ自体が `groupKey`/`groupValue` を持つビューインスタンス）を返します。`view` は `filters`/`sorts`/`group`/`showIcon`/`wrapField`/`groupFolded`/`groupHidden` も含みます。注意：有効なフィルター/グループ化により、`rowCount` > 0 でも `rows` が空になることがあります
    * `data.view.columns[]`: 各列は `id`/`name`/`type`/`icon`/`wrap`/`hidden`/`desc`/`calc`/`numberFormat`/`template`/`pin`/`width` を持ちます；`select`/`mSelect` 列はさらに `options` を含みます
    * `data.view.rows[].id`: **行 ID**（アイテム ID）。紐づく行の場合は紐づくブロック ID と同じです；独立行の場合は生成されたアイテム ID で、いかなるブロックとも異なります
    * `data.view.rows[].cells[].value`: `Value` オブジェクト——すべての value 形状は [セル値を設定](#セル値を設定) を参照。`createdAt`/`updatedAt` は int64 ミリ秒タイムスタンプ
    * `data.views`: 全ビューのメタデータ（行データなし）
    * `data.isMirror`: データベースブロックがデータベースのミラー（読み取り専用コピー）の場合 `true`

### 取得

* `/api/av/getAttributeView`
* パラメータ

  ```json
  {
    "id": "20240118120204-kwyzf77"
  }
  ```

    * `id`: データベース ID
* 戻り値（実際のレスポンス、トリム済み——`keyValues`/`views` 配列は省略）：

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "av": {
        "spec": 4,
        "id": "20240118120204-kwyzf77",
        "name": "API テスト",
        "keyValues": [
          {
            "key": {
              "id": "20240118120204-w6cggab",
              "name": "主キー",
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
            "name": "テーブル",
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

    * `data.av`: 完全な `AttributeView` 定義——フィールド（`keyValues`）、フィールド順序（`keyIDs`、`null` の場合あり）、現在のビュー（`viewID`）、および全ビューの生のレイアウト設定（`table`/`gallery`/`kanban`）とアイテム順序（`itemIds`）。生の定義を返します（レンダリング後の行やページングを含まない）；計算後の行データが必要な場合は [レンダリング](#レンダリング) を使用してください

### 主キー値を取得

* `/api/av/getAttributeViewPrimaryKeyValues`
* パラメータ

  ```json
  {
    "id": "20240118120204-kwyzf77",
    "keyword": "",
    "page": 1,
    "pageSize": 16
  }
  ```

    * `id`: データベース ID
    * `keyword`: 主キーテキストに対する任意の部分一致フィルター（大文字小文字を区別しない）
    * `page`: ページ番号（1 始まり）。デフォルトは `1`
    * `pageSize`: 1 ページあたりのアイテム数。`-1` または省略時は `16`。結果は `block.updated` の降順
* 戻り値（実際のレスポンス、1 値を表示）：

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "name": "API テスト",
      "blockIDs": ["20240118120201-kldj15t"],
      "rows": {
        "key": {
          "id": "20240118120204-w6cggab",
          "name": "主キー",
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

    * `data.rows`: 主キー（`block`）フィールドとそのページングされた値を保持する `KeyValues` オブジェクト
    * `data.blockIDs`: このデータベースを参照する全データベースブロック（ミラー）の ID

### 検索

* `/api/av/searchAttributeView`
* パラメータ

  ```json
  {
    "keyword": "API",
    "excludes": []
  }
  ```

    * `keyword`: 検索キーワード（データベース名に一致）
    * `excludes`: 任意。結果から除外するデータベース ID のリスト
* 戻り値（実際のレスポンス）：

  ```json
  {
    "code": 0,
    "msg": "",
    "data": {
      "results": [
        {
          "avID": "20240118120204-kwyzf77",
          "avName": "API テスト",
          "viewName": "",
          "viewID": "",
          "viewLayout": "",
          "blockID": "20240118120201-kldj15t",
          "hPath": "正在跟进的问题/数据库/API",
          "children": [
            {
              "avID": "20240118120204-kwyzf77",
              "avName": "API テスト",
              "viewName": "テーブル",
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

    * `data.results[]`: 各トップレベル結果は `avID` ごとにデータベースを集約します；その `children[]` が各ビュー（`viewName`/`viewID`/`viewLayout`）を列挙します

### セル値を設定

1 つのセル（1 行の 1 フィールド）を更新します。セル値の主要な書き込みエンドポイントです。リクエストの `value` はフィールドの `keyType` に応じた部分 `Value` オブジェクトです。主な value の形状は以下の通りです：

| `keyType`  | `value` の形状                                                                                                       |
|------------|----------------------------------------------------------------------------------------------------------------------|
| `block`    | `{"block": {"content": "1行目", "id": "<紐づくブロックID>"}, "isDetached": false}`                                  |
| `text`     | `{"text": {"content": "テキスト"}}`                                                                                  |
| `number`   | `{"number": {"content": 42, "isNotEmpty": true}}`（クリアは `{"isNotEmpty": false}`）                                |
| `date`     | `{"date": {"content": 1676042451000, "isNotEmpty": true}}`（ミリ秒タイムスタンプ）                                   |
| `select`   | `{"mSelect": [{"content": "完了", "color": "1"}]}`（最大1つ）                                                         |
| `mSelect`  | `{"mSelect": [{"content": "A", "color": "1"}, {"content": "B", "color": "2"}]}`                                      |
| `url`      | `{"url": {"content": "https://siyuan.com"}}`                                                                         |
| `email`    | `{"email": {"content": "a@b.com"}}`                                                                                  |
| `phone`    | `{"phone": {"content": "1234567890"}}`                                                                               |
| `checkbox` | `{"checkbox": {"checked": true}}`                                                                                    |

> ⚠️ `itemID` は**行 ID**（[レンダリング](#レンダリング) が返す `rows[].id`）です。紐づく行の場合は行 ID は紐づくブロック ID と等しく、独立行の場合は生成されたアイテム ID です。誤った ID を渡すと、値はレンダリングされたセルに現れない孤立データとして保存されます。

* `/api/av/setAttributeViewBlockAttr`
* パラメータ

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

    * `avID`: データベース ID
    * `keyID`: フィールド ID（更新対象の列）
    * `itemID`: **行 ID**（[レンダリング](#レンダリング) が返す `rows[].id`）。従来の `rowID` パラメータは非推奨で 2026-12-01 以降に削除されるため、`itemID` を使用してください
    * `value`: 部分 `Value` オブジェクト（上記表を参照）。未知または未サポートのキーは無視されます
* 戻り値（実際のレスポンス、数値）：

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

    * `data.value`: 更新後に正規化された値（`number.formattedContent` などの計算フィールドを含む）。リクエストペイロードを再送せず、この戻り値で UI を更新してください

### アイテムを追加

1つ以上のアイテム（行）を追加します。各ソースは既存ブロックを紐づける（`isDetached: false`）か、ビュー内にのみ存在する独立行を作成（`isDetached: true`）できます。

* `/api/av/addAttributeViewBlocks`
* パラメータ

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
        "content": "新しい行"
      }
    ],
    "ignoreDefaultFill": false
  }
  ```

    * `avID`: データベース ID
    * `blockID`: このデータベースを所有するデータベースブロック（ターゲットビュー/グループの解決に使用）
    * `viewID`: ターゲットビュー。省略時は現在のビューを使用
    * `groupID`: カンバンビューのターゲットグループ ID。テーブル/ギャラリーでは省略可
    * `previousID`: このアイテム ID の後に挿入。空の場合は末尾に追加
    * `srcs[].id`: ブロックを紐づける場合（`isDetached: false`）、紐づけるブロック ID。ノード ID 形式である必要があります
    * `srcs[].isDetached`: `true` で独立行を作成、`false` で既存ブロックを紐づけ
    * `srcs[].content`: 主キーの表示テキスト（`isDetached: true` の場合、または紐づくブロックの内容を上書きする場合に使用）
    * `srcs[].itemID`: 任意。アイテム ID を明示指定。省略時は自動生成
    * `ignoreDefaultFill`: `true` の場合、フィルター/グループフィールドへのデフォルト値の自動入力をスキップ
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

    * このエンドポイントは `null` を返します。成功後、[レンダリング](#レンダリング) を呼び出して更新された行（セル更新に必要な新しい行 ID を含む）を取得してください

### アイテムを削除

1つ以上のアイテム（行）を削除します。独立行は削除され、紐づくブロックは紐付け解除されます（元のドキュメントブロックは削除されません）。

* `/api/av/removeAttributeViewBlocks`
* パラメータ

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "srcIDs": ["20240118203831-fkfvvtx"]
  }
  ```

    * `avID`: データベース ID
    * `srcIDs`: 削除する行 ID（[レンダリング](#レンダリング) が返す `rows[].id`）のリスト
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### レイアウトを切り替え

現在のビューのレイアウトタイプを `table`（テーブル）、`gallery`（ギャラリー）、`kanban`（カンバン）の間で切り替えます。成功時、サーバーはビューを再レンダリングして返します（[レンダリング](#レンダリング) と同じ形状）。

* `/api/av/changeAttrViewLayout`
* パラメータ

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t",
    "layoutType": "kanban"
  }
  ```

    * `avID`: データベース ID
    * `blockID`: このビューを所有するデータベースブロック
    * `layoutType`: ターゲットレイアウト——`table`、`gallery`、`kanban` のいずれか
* 戻り値：[レンダリング](#レンダリング) の戻り値と同じ形状。`kanban` に切り替えてグループが設定されている場合、`data.view` は `groups[]` 配列を持ちます；各グループはビューインスタンスで、`groupKey`、`groupValue`、およびカンバン固有フィールド（`coverFrom`、`cardAspectRatio`、`cardSize`、`fitImage`、`displayFieldName`、`fillColBackgroundColor`、`fields`）を含みます

### グループ化を設定

カンバンビューのグループ化ルールを設定またはクリアします。`group.field` が空の場合、グループ化を削除します。成功時、サーバーはビューを再レンダリングして返します。

* `/api/av/setAttrViewGroup`
* パラメータ

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

    * `avID`: データベース ID
    * `blockID`: このビューを所有するデータベースブロック
    * `group`: グループ化ルール
    * `group.field`: グループ化の基準フィールド（列）ID。空文字列でグループ化を削除
    * `group.method`: グループ化方式——`0` 値ごと、`1` 数値範囲、`2` 相対日付、`3` 日ごと、`4` 週ごと、`5` 月ごと、`6` 年ごと
    * `group.range`: 任意。`method` が `1`（数値範囲）の場合は必須：`{ "numStart": 0, "numEnd": 100, "numStep": 10 }`
    * `group.order`: グループの並び順——`0` 昇順、`1` 降順、`2` 手動、`3` 選択肢の順序に従う
    * `group.hideEmpty`: 空のグループを非表示にするか
* 戻り値：[レンダリング](#レンダリング) の戻り値と同じ形状

### フィルターとソートを取得

データベースブロックに紐づくビューの現在のフィルターおよびソートルールを返します。

* `/api/av/getAttributeViewFilterSort`
* パラメータ

  ```json
  {
    "id": "20240118120204-kwyzf77",
    "blockID": "20240118120201-kldj15t"
  }
  ```

    * `id`: データベース ID
    * `blockID`: このビューを所有するデータベースブロック
* 戻り値（実際のレスポンス、フィルター/ソート未設定）：

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

  設定後（実際に取得したレスポンス）、フィルターとソートは以下の形になります：

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
              { "content": "完了", "color": "1" }
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

    * `data.filters`: `ViewFilter` の配列。最上位は単一のルートグループノード `{ "combination": "and"|"or", "filters": [...] }` で、配列要素はリーフフィルターまたはネストされたグループノードのいずれかで、再帰的な AND/OR 組み合わせをサポートします
    * `data.filters[].column`: フィルターが適用されるフィールド（列）ID（リーフノードのみ）
    * `data.filters[].operator`: フィルター演算子（下記の演算子表を参照；リーフノードのみ）
    * `data.filters[].value`: フィルター値。`Value` オブジェクト（形状は [セル値を設定](#セル値を設定) を参照；リーフノードのみ）
    * `data.filters[].relativeDate`: 任意。日付フィルターが使用する相対日時記述子（`{ "count": 7, "unit": 0, "direction": -1 }`、`unit`：`0` 日、`1` 週、`2` 月、`3` 年、`direction`：`-1` 前、`0` 今期、`1` 後；リーフノードのみ）
    * `data.filters[].combination`: グループの組み合わせ方法、`"and"` または `"or"`（グループノードのみ）
    * `data.filters[].filters`: 子フィルターノード、再帰的な `ViewFilter`（グループノードのみ）
    * `data.sorts`: `ViewSort` の配列
    * `data.sorts[].column`: ソートが適用されるフィールド（列）ID
    * `data.sorts[].order`: `ASC` または `DESC`

  フィルター演算子：

  | 値                   | 説明                   |
  |----------------------|------------------------|
  | `=`                  | 等しい                 |
  | `!=`                 | 等しくない             |
  | `>`                  | より大きい             |
  | `>=`                 | 以上                   |
  | `<`                  | より小さい             |
  | `<=`                 | 以下                   |
  | `Contains`           | 含む                   |
  | `Does not contains`  | 含まない               |
  | `Is empty`           | 空である               |
  | `Is not empty`       | 空でない               |
  | `Starts with`        | 〜で始まる             |
  | `Ends with`          | 〜で終わる             |
  | `Is between`         | の間である             |
  | `Is true`            | 真（チェックボックス） |
  | `Is false`           | 偽（チェックボックス） |

### フィルターを設定

* `/api/av/setAttrViewFilters`
* パラメータ

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
            { "content": "完了", "color": "1" }
          ]
        }
      }
    ]
  }
  ```

    * `avID`: データベース ID
    * `blockID`: このビューを所有するデータベースブロック
    * `data`: 完全な新しい `ViewFilter` の配列。ビューの既存フィルターを**完全に置換**します（形状は [フィルターとソートを取得](#フィルターとソートを取得) を参照）。`[]` を渡して全フィルターをクリア。最上位は単一のルートグループノード `{ "combination": "and"|"or", "filters": [...] }` で、配列要素はリーフフィルターまたはネストされたグループノードのいずれかで、再帰的な AND/OR 組み合わせをサポートします
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ソートを設定

* `/api/av/setAttrViewSorts`
* パラメータ

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

    * `avID`: データベース ID
    * `blockID`: このビューを所有するデータベースブロック
    * `data`: 完全な新しい `ViewSort` の配列。ビューの既存ソートを**完全に置換**します（形状は [フィルターとソートを取得](#フィルターとソートを取得) を参照）。`[]` を渡して全ソートをクリア
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### フィールドを追加

新しいフィールド（列）を追加します。フィールドは全ビュー（テーブル/ギャラリー/カンバン）の `previousKeyID` の後の位置に追加されます（空の場合はデフォルト位置）。

* `/api/av/addAttributeViewKey`
* パラメータ

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "keyID": "20240118120204-7k9wzbp",
    "keyName": "ステータス",
    "keyType": "select",
    "keyIcon": "",
    "previousKeyID": "20240118120204-w6cggab"
  }
  ```

    * `avID`: データベース ID
    * `keyID`: 新しいフィールドの ID。`Lute.NewNodeID()` で生成された有効なノード ID（14 桁のタイムスタンプ + `-` + 7 文字のランダム英数字、例：`20240118120204-abc1234`）である必要があります
    * `keyName`: フィールドの表示名
    * `keyType`: フィールドタイプ——`text`、`number`、`date`、`select`、`mSelect`、`url`、`email`、`phone`、`mAsset`、`template`、`created`、`updated`、`checkbox`、`relation`、`rollup`、`lineNumber` のいずれか。`block`（主キー）はこのエンドポイントから追加できません
    * `keyIcon`: 任意のフィールドアイコン（emoji または空文字列）
    * `previousKeyID`: このフィールド ID の後に新しい列を挿入。空文字列の場合はレイアウトのデフォルト位置（テーブルは先頭、ギャラリー/カンバンは末尾）を使用
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### フィールドを削除

フィールド（列）とその全ての値を削除します。`keyID` が存在しない場合、`code: -1`、`msg: "key not found"` を返します。

* `/api/av/removeAttributeViewKey`
* パラメータ

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "keyID": "20240118120204-7k9wzbp",
    "removeRelationDest": false
  }
  ```

    * `avID`: データベース ID
    * `keyID`: 削除するフィールド ID
    * `removeRelationDest`: `true` かつフィールドが関連型の場合、宛先データベースの対応する逆関連フィールドも削除します。デフォルトは `false`
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### グローバルのフィールドソートを設定

フィールド（列）を全体として並べ替えます——`keyID` をフィールド順序の `previousKeyID` の後の位置に移動し、全ビューに影響します。

* `/api/av/sortAttributeViewKey`
* パラメータ

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "keyID": "20240118203822-io6ofxb",
    "previousKeyID": "20240118120204-w6cggab"
  }
  ```

    * `avID`: データベース ID
    * `keyID`: 移動するフィールド ID
    * `previousKeyID`: `keyID` をその後に配置するフィールド ID。空文字列で先頭に移動
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```

### ビュー内のフィールドソートを設定

全体のフィールド順序を変えずに、単一ビューのレイアウト内で列を並べ替えます（例：テーブルの列順序）。

* `/api/av/sortAttributeViewViewKey`
* パラメータ

  ```json
  {
    "avID": "20240118120204-kwyzf77",
    "viewID": "20240118120204-7rnmyc1",
    "keyID": "20240118203822-io6ofxb",
    "previousKeyID": "20240118120204-w6cggab"
  }
  ```

    * `avID`: データベース ID
    * `viewID`: ターゲットビュー。空の場合は現在のビューを使用
    * `keyID`: 移動するフィールド ID
    * `previousKeyID`: `keyID` をその後に配置するフィールド ID。空文字列で先頭に移動
* 戻り値

  ```json
  {
    "code": 0,
    "msg": "",
    "data": null
  }
  ```
