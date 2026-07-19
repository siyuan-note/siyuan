<p align="center">
<img alt="SiYuan" src="https://b3log.org/images/brand/siyuan-128.png">
<br>
<em>あなたの思考をリファクタリングする</em>
<br><br>
<a title="Build Status" target="_blank" href="https://github.com/siyuan-note/siyuan/actions/workflows/cd.yml"><img src="https://img.shields.io/github/actions/workflow/status/siyuan-note/siyuan/cd.yml?style=flat-square"></a>
<a title="Releases" target="_blank" href="https://github.com/siyuan-note/siyuan/releases"><img src="https://img.shields.io/github/release/siyuan-note/siyuan.svg?style=flat-square&color=9CF"></a>
<a title="Downloads" target="_blank" href="https://github.com/siyuan-note/siyuan/releases"><img src="https://img.shields.io/github/downloads/siyuan-note/siyuan/total.svg?style=flat-square&color=blueviolet"></a>
<br>
<a title="Docker Pulls" target="_blank" href="https://hub.docker.com/r/b3log/siyuan"><img src="https://img.shields.io/docker/pulls/b3log/siyuan.svg?style=flat-square&color=green"></a>
<a title="Docker Image Size" target="_blank" href="https://hub.docker.com/r/b3log/siyuan"><img src="https://img.shields.io/docker/image-size/b3log/siyuan.svg?style=flat-square&color=ff96b4"></a>
<a title="Hits" target="_blank" href="https://github.com/siyuan-note/siyuan"><img src="https://hits.b3log.org/siyuan-note/siyuan.svg"></a>
<br>
<a title="AGPLv3" target="_blank" href="https://www.gnu.org/licenses/agpl-3.0.txt"><img src="http://img.shields.io/badge/license-AGPLv3-orange.svg?style=flat-square"></a>
<a title="Code Size" target="_blank" href="https://github.com/siyuan-note/siyuan"><img src="https://img.shields.io/github/languages/code-size/siyuan-note/siyuan.svg?style=flat-square&color=yellow"></a>
<a title="GitHub Pull Requests" target="_blank" href="https://github.com/siyuan-note/siyuan/pulls"><img src="https://img.shields.io/github/issues-pr-closed/siyuan-note/siyuan.svg?style=flat-square&color=FF9966"></a>
<br>
<a title="GitHub Commits" target="_blank" href="https://github.com/siyuan-note/siyuan/commits/master"><img src="https://img.shields.io/github/commit-activity/m/siyuan-note/siyuan.svg?style=flat-square"></a>
<a title="Last Commit" target="_blank" href="https://github.com/siyuan-note/siyuan/commits/master"><img src="https://img.shields.io/github/last-commit/siyuan-note/siyuan.svg?style=flat-square&color=FF9900"></a>
<br><br>
<a title="Twitter" target="_blank" href="https://twitter.com/b3logos"><img alt="Twitter Follow" src="https://img.shields.io/twitter/follow/b3logos?label=Follow&style=social"></a>
<a title="Discord" target="_blank" href="https://discord.gg/dmMbCqVX7G"><img alt="Chat on Discord" src="https://img.shields.io/discord/808152298789666826?label=Discord&logo=Discord&style=social"></a>
<br><br>
<a href="https://trendshift.io/repositories/3949" target="_blank"><img src="https://trendshift.io/api/badge/repositories/3949" alt="siyuan-note%2Fsiyuan | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
<a href="README.md">English</a>
| <a href="README.zh-CN.md">中文</a>
| <b>日本語</b>
| <a href="README.tr.md">Türkçe</a>
</p>

---

## 目次

- [💡 紹介](#-紹介)
- [🔮 特徴](#-特徴)
- [🏗️ アーキテクチャとエコシステム](#️-アーキテクチャとエコシステム)
- [🗺️ ロードマップ](#️-ロードマップ)
- [🚀 ダウンロードとセットアップ](#-ダウンロードとセットアップ)
  - [アプリマーケット](#アプリマーケット)
  - [インストールパッケージ](#インストールパッケージ)
  - [パッケージマネージャー](#パッケージマネージャー)
  - [Docker ホスティング](#docker-ホスティング)
  - [Unraid ホスティング](#unraid-ホスティング)
  - [TrueNAS ホスティング](#truenas-ホスティング)
  - [インサイダープレビュー](#インサイダープレビュー)
- [⌨️ コマンドラインインターフェース](#-コマンドラインインターフェース)
- [🏘️ コミュニティ](#️-コミュニティ)
- [🛠️ 開発ガイド](#️-開発ガイド)
- [❓ FAQ](#-faq)
  - [SiYuanはどのようにデータを保存しますか？](#siyuanはどのようにデータを保存しますか)
  - [サードパーティの同期ディスクを介したデータ同期をサポートしていますか？](#サードパーティの同期ディスクを介したデータ同期をサポートしていますか)
  - [SiYuanはオープンソースですか？](#siyuanはオープンソースですか)
  - [新しいバージョンにアップグレードするにはどうすればよいですか？](#新しいバージョンにアップグレードするにはどうすればよいですか)
  - [一部のブロック（リスト項目内の段落ブロックなど）がブロックアイコンを見つけられない場合はどうすればよいですか？](#一部のブロックリスト項目内の段落ブロックなどがブロックアイコンを見つけられない場合はどうすればよいですか)
  - [データリポジトリキーを紛失した場合はどうすればよいですか？](#データリポジトリキーを紛失した場合はどうすればよいですか)
  - [支払いが必要ですか？](#支払いが必要ですか)
- [🙏 謝辞](#-謝辞)
  - [貢献者](#貢献者)

---

## 💡 紹介

SiYuanは、プライバシーを最優先とする個人の知識管理システムであり、細かいブロックレベルの参照とMarkdown WYSIWYGをサポートしています。

詳細については、[SiYuan英語ディスカッションフォーラム](https://liuyun.io)をご覧ください。

オンラインユーザーガイド：[English](https://siyuan-en.b3log.org/)

![feature0.png](https://b3logfile.com/file/2025/11/feature0-GfbhEqf.png)

![feature51.png](https://b3logfile.com/file/2025/11/feature5-1-7DJSfEP.png)

## 🔮 特徴

ほとんどの機能は無料で、商業利用も可能です。

- コンテンツブロック
  - ブロックレベルの参照と双方向リンク
  - カスタム属性
  - SQLクエリ埋め込み
  - プロトコル `siyuan://`
- エディタ
  - ブロックスタイル
  - Markdown WYSIWYG
  - リストアウトライン
  - ブロックズームイン
  - 百万字の大規模ドキュメント編集
  - 数学公式、チャート、フローチャート、ガントチャート、タイミングチャート、五線譜など
  - ウェブクリッピング
  - PDF注釈リンク
- エクスポート
  - ブロック参照と埋め込み
  - アセット付きの標準Markdown
  - PDF、Word、HTML
  - WeChat MP、Zhihu、Yuqueへのコピー
- データベース
  - テーブルビュー
- フラッシュカード間隔反復
- OpenAI APIを介したAIライティングとQ/Aチャット
- Tesseract OCR
- マルチタブ、ドラッグアンドドロップで分割画面
- テンプレートスニペット
- JavaScript/CSSスニペット
- Android/iOS/HarmonyOSアプリ
- Dockerデプロイメント
- [API](https://github.com/siyuan-note/siyuan/blob/master/docs/API.md)
- コミュニティマーケットプレイス

一部の機能は有料会員のみ利用可能です。詳細については[価格](https://b3log.org/siyuan/en/pricing.html)をご覧ください。

## 🏗️ アーキテクチャとエコシステム

![SiYuan Arch](https://b3logfile.com/file/2023/05/SiYuan_Arch-Sgu8vXT.png "SiYuan Arch")

| プロジェクト                                                   | 説明              | フォーク                                                                           | スター                                                                                | 
|----------------------------------------------------------|-----------------|---------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| [lute](https://github.com/88250/lute)                    | エディタエンジン        | ![GitHub forks](https://img.shields.io/github/forks/88250/lute)                 | ![GitHub Repo stars](https://img.shields.io/github/stars/88250/lute)                 |
| [chrome](https://github.com/siyuan-note/siyuan-chrome)   | Chrome/Edge拡張   | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-chrome)  | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-chrome)  |
| [bazaar](https://github.com/siyuan-note/bazaar)          | コミュニティマーケットプレイス | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/bazaar)         | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/bazaar)         |
| [dejavu](https://github.com/siyuan-note/dejavu)          | データリポジトリ        | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/dejavu)         | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/dejavu)         |
| [petal](https://github.com/siyuan-note/petal)            | プラグインAPI        | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/petal)          | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/petal)          |
| [android](https://github.com/siyuan-note/siyuan-android) | Androidアプリ      | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-android) | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-android) |
| [ios](https://github.com/siyuan-note/siyuan-ios)         | iOSアプリ          | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-ios)     | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-ios)     |
| [harmony](https://github.com/siyuan-note/siyuan-harmony)     | HarmonyOSアプリ    | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-harmony)     | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-harmony)     |
| [riff](https://github.com/siyuan-note/riff)              | 間隔反復            | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/riff)           | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/riff)           |

## 🗺️ ロードマップ

- [SiYuanの開発計画と進捗](https://github.com/orgs/siyuan-note/projects/1)
- [SiYuanの変更履歴](CHANGELOG.md)

## 🚀 ダウンロードとセットアップ

デスクトップとモバイルでは、アプリマーケットからのインストールを優先的にお勧めします。これにより、将来的にワンクリックでバージョンをアップグレードできます。

### アプリマーケット

モバイル：

- [App Store](https://apps.apple.com/us/app/siyuan/id1583226508)
- [Google Play](https://play.google.com/store/apps/details?id=org.b3log.siyuan)
- [F-Droid](https://f-droid.org/packages/org.b3log.siyuan)

デスクトップ：

- [Microsoft Store](https://apps.microsoft.com/detail/9p7hpmxp73k4)

### インストールパッケージ

- [B3log](https://b3log.org/siyuan/en/download.html)
- [GitHub](https://github.com/siyuan-note/siyuan/releases)

### パッケージマネージャー

#### `siyuan`

[![梱包状態](https://repology.org/badge/vertical-allrepos/siyuan.svg)](https://repology.org/project/siyuan/versions)

#### `siyuan-note`

[![梱包状態](https://repology.org/badge/vertical-allrepos/siyuan-note.svg)](https://repology.org/project/siyuan-note/versions)

### Docker ホスティング

<details>
<summary>Dockerデプロイメント</summary>

#### 概要

サーバーでSiYuanを提供する最も簡単な方法は、Dockerを使用してデプロイすることです。

- イメージ名 `b3log/siyuan`
- [イメージURL](https://hub.docker.com/r/b3log/siyuan)

#### ファイル構造

全体のプログラムは `/opt/siyuan/` にあり、基本的にはElectronインストールパッケージのresourcesフォルダーの構造です：

- appearance: アイコン、テーマ、言語
- guide: ユーザーガイドドキュメント
- stage: インターフェースと静的リソース
- kernel: カーネルプログラム

#### エントリポイント

エントリポイントはDockerイメージのビルド時に設定されます：`ENTRYPOINT ["/opt/siyuan/entrypoint.sh"]`。このスクリプトを使用すると、コンテナ内で実行されるユーザーの `PUID` と `PGID` を変更できます。これは、ホストからディレクトリをマウントする際の権限の問題を解決するために特に重要です。`PUID`（ユーザーID）と `PGID`（グループID）は環境変数として渡すことができ、ホストマウントディレクトリにアクセスする際に正しい権限を確保するのが容易になります。

`docker run b3log/siyuan` を使用してコンテナを実行する場合、次のパラメータを使用します：

- `--workspace`: ワークスペースフォルダーのパスを指定し、ホスト上で `-v` を使用してコンテナにマウントします
- `--accessAuthCode`: ロック画面パスワードを指定します

> **注意:** v3.7.0 以降、`serve` サブコマンドを明示的に渡す必要があります（例: `docker run b3log/siyuan serve --workspace=...`）。すべてのサーブ用オプションは `docker run --rm b3log/siyuan serve --help` で確認できます。

詳細なパラメータは `--help` を参照してください。以下は新しい環境変数を使用した起動コマンドの例です：

```bash
docker run -d \
  -v workspace_dir_host:workspace_dir_container \
  -p 6806:6806 \
  -e PUID=1001 -e PGID=1002 \
  -e SIYUAN_LANG=ja \
  b3log/siyuan \
  serve \
  --workspace=workspace_dir_container \
  --accessAuthCode=xxx
```

- `PUID`: カスタムユーザーID（オプション、指定しない場合はデフォルトで `1000`）
- `PGID`: カスタムグループID（オプション、指定しない場合はデフォルトで `1000`）
- `workspace_dir_host`: ホスト上のワークスペースフォルダーのパス
- `workspace_dir_container`: コンテナ内のワークスペースフォルダーのパス、`--workspace` で指定されたものと同じ
  - あるいは、`SIYUAN_WORKSPACE_PATH` 環境変数を使用してパスを設定することもできます。両方が設定されている場合は、コマンドラインの値が優先されます
- `accessAuthCode`: ロック画面パスワード（**必ず変更してください**、そうしないと誰でもデータにアクセスできます）
  - また、`SIYUAN_ACCESS_AUTH_CODE` 環境変数を設定することでロック画面パスワードを指定することもできます。両方が設定されている場合、コマンドラインの値が優先されます
  - 環境変数 `SIYUAN_ACCESS_AUTH_CODE_BYPASS=true` を設定することで、ロック画面パスワードを無効にすることができます
- `SIYUAN_LANG`：インターフェース言語（オプション、Docker で未設定の場合はデフォルト `en`）。BCP 47 タグ（`zh-CN`/`zh-TW`/`en`/`ja`/`pt-BR` など）を受け付けます。従来のアンダースコア形式（`zh_CN`/`en_US` など）も互換性のため受け付けます。**設定**で選択した言語を再起動後も維持したい場合は、デプロイ時にこの変数を省略してください。設定した場合は起動のたびに適用され、保存済みの言語設定を上書きします
  - あるいは `--lang` コマンドライン引数でも設定できます。両方が設定されている場合、コマンドラインの値が優先されます

簡略化するために、ホストとコンテナでワークスペースフォルダーのパスを一致させることをお勧めします。たとえば、`workspace_dir_host` と `workspace_dir_container` の両方を `/siyuan/workspace` に設定します。対応する起動コマンドは次のようになります：

```bash
docker run -d \
  -v /siyuan/workspace:/siyuan/workspace \
  -p 6806:6806 \
  -e PUID=1001 -e PGID=1002 \
  -e SIYUAN_LANG=ja \
  b3log/siyuan \
  serve \
  --workspace=/siyuan/workspace/ \
  --accessAuthCode=xxx
```

#### Docker Compose

Docker Composeを使用してSiYuanを実行するユーザー向けに、環境変数 `PUID` と `PGID` を使用してユーザーとグループのIDをカスタマイズできます。以下はDocker Composeの設定例です：

```yaml
version: "3.9"
services:
  main:
    image: b3log/siyuan
    command: ['serve', '--workspace=/siyuan/workspace/', '--accessAuthCode=${AuthCode}']
    ports:
      - 6806:6806
    volumes:
      - /siyuan/workspace:/siyuan/workspace
    restart: unless-stopped
    environment:
      - TZ=${YOUR_TIME_ZONE}    # タイムゾーン識別子のリストは https://en.wikipedia.org/wiki/List_of_tz_database_time_zones を参照してください
      - PUID=${YOUR_USER_PUID}  # カスタムユーザーID
      - PGID=${YOUR_USER_PGID}  # カスタムグループID
      - SIYUAN_LANG=ja       # インターフェース言語（このドキュメントに合わせる）
```

この設定では：

- `PUID` と `PGID` は動的に設定され、コンテナに渡されます
- これらの変数が提供されていない場合、デフォルトの `1000` が使用されます

環境で `PUID` と `PGID` を指定することで、composeファイルで `user` ディレクティブ（`user: '1000:1000'`）を明示的に設定する必要がなくなります。コンテナは起動時にこれらの環境変数に基づいてユーザーとグループを動的に調整します。

#### ユーザー権限

イメージ内で、`entrypoint.sh` スクリプトは指定された `PUID` と `PGID` で `siyuan` ユーザーとグループを作成することを保証します。したがって、ホストがワークスペースフォルダーを作成する際には、フォルダーのユーザーとグループの所有権を設定し、使用する予定の `PUID` と `PGID` に一致させることに注意してください。たとえば：

```bash
chown -R 1001:1002 /siyuan/workspace
```

カスタムの `PUID` と `PGID` 値を使用する場合、エントリポイントスクリプトはコンテナ内で正しいユーザーとグループを作成し、マウントされたボリュームの所有権を適切に調整します。`docker run` または `docker-compose` で `-u` を手動で渡す必要はありません。環境変数がカスタマイズを処理します。

#### 隠しポート

NGINXリバースプロキシを使用してポート6806を隠します。注意点：

- WebSocketリバースプロキシ `/ws` を設定します

#### 注意

- マウントボリュームの正確性を確認してください。そうしないと、コンテナが削除された後にデータが失われます
- URLリライトを使用してリダイレクトしないでください。認証に問題が発生する可能性があるため、リバースプロキシの設定をお勧めします
- 権限の問題が発生した場合、`PUID` と `PGID` 環境変数がホストシステム上のマウントされたディレクトリの所有権と一致していることを確認してください

#### 制限

- デスクトップおよびモバイルアプリケーションの接続はサポートされておらず、ブラウザでの使用のみサポートされています
- PDF、HTML、Word形式へのエクスポートはサポートされていません
- Markdownファイルのインポートはサポートされていません

</details>

### Unraid ホスティング

<details>
<summary>Unraidデプロイメント</summary>

注意：最初にターミナルで `chown -R 1000:1000 /mnt/user/appdata/siyuan` を実行します

テンプレートの参考：

```
Web UI: 6806
Container Port: 6806
Container Path: /home/siyuan
Host path: /mnt/user/appdata/siyuan
PUID: 1000
PGID: 1000
SIYUAN_LANG: ja
Publish parameters: serve --accessAuthCode=******（ロック画面パスワード）
```

</details>

### TrueNAS ホスティング

<details>
<summary>TrueNasデプロイメント</summary>

注意：まず TrueNAS Shell で以下のコマンドを実行してください。`Pool_1/Apps_Data/siyuan` をアプリ用のデータセットパスに合わせて更新してください。

```shell
zfs create Pool_1/Apps_Data/siyuan
chown -R 1001:1002 /mnt/Pool_1/Apps_Data/siyuan
chmod 755 /mnt/Pool_1/Apps_Data/siyuan
```

Apps - DiscoverApps - More Options（右上、Custom App を除く）- YAML でインストール に移動してください

テンプレート例：

```yaml
services:
  siyuan:
    image: b3log/siyuan
    container_name: siyuan
    command: ['serve', '--workspace=/siyuan/workspace/', '--accessAuthCode=2222']
    ports:
      - 6806:6806
    volumes:
      - /mnt/Pool_1/Apps_Data/siyuan:/siyuan/workspace  # Adjust to your dataset path 
    restart: unless-stopped
    environment:
      - TZ=Asia/Tokyo  # 必要に応じてタイムゾーンに置き換えてください
      - PUID=1001
      - PGID=1002
      - SIYUAN_LANG=ja  # インターフェース言語（このドキュメントに合わせる）
```

</details>

### インサイダープレビュー

主要な更新前にインサイダープレビューをリリースします。詳細は[https://github.com/siyuan-note/insider](https://github.com/siyuan-note/insider)をご覧ください。

## ⌨️ コマンドラインインターフェース

組み込み CLI で、サーバー起動なしにワークスペースデータへ直接アクセスできます。

### クイックスタート

```bash
siyuan notebook list -w ~/SiYuan
siyuan search "keyword" -w ~/SiYuan -f json
# アセットファイル内を検索（PDF/Word/Excel/txt など）
siyuan search "フレーズ" --asset -w ~/SiYuan
siyuan search "フレーズ" --asset --ext pdf --ext docx -w ~/SiYuan
siyuan export md --id <block-id> -w ~/SiYuan
```

### 利用可能なコマンド

| カテゴリ | コマンド |
|----------|----------|
| ノートと文書 | `notebook`, `document`, `dailynote` — CRUD とデイリーノート |
| コンテンツ | `block`, `attr`, `outline` — ブロックの読み書き、属性、アウトライン |
| メタデータ | `tag`, `bookmark`, `template` — タグ、ブックマーク、テンプレートスニペット |
| クエリ | `search`, `sql` — 全文・セマンティック・アセット内・SQL 検索 |
| 参照 | `ref` — バックリンクと言及 |
| インポート/エクスポート | `export`, `import`, `inbox` — Markdown, HTML, preview, Word, .sy.zip, Data, クラウド受信トレイ |
| データ管理 | `repo`, `history`, `sync` — スナップショット、履歴、クラウド同期 |
| ユーティリティ | `asset`, `file` — リソースとファイルシステム |
| データベース | `database` — 属性ビュー管理 |
| サーバー | `serve` — カーネルの HTTP サーバーを起動 |
| ワークスペースとシステム | `workspace`, `system` — 一覧、確認、システム情報 |

詳細は `siyuan --help` を実行してください。スクリプト向け出力には（デフォルトの `-f table` ではなく）`-f json` を使用します。変更を伴うほとんどのコマンドは `--dry-run` にも対応しており、適用せずに変更内容をプレビューできます。

### セットアップ

CLI バイナリは `<インストール先>/resources/kernel/SiYuan-Kernel` です。
Windows インストーラーが自動で PATH に追加します。
macOS/Linux では手動でシンボリックリンクを作成してください。

```bash
# macOS
ln -s /Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel /usr/local/bin/siyuan

# Linux
ln -s /インストール先/SiYuan/resources/kernel/SiYuan-Kernel /usr/local/bin/siyuan
```

## 🏘️ コミュニティ

- [英語ディスカッションフォーラム](https://liuyun.io)
- [ユーザーコミュニティのまとめ](https://liuyun.io/article/1687779743723)
- [Awesome SiYuan](https://github.com/siyuan-note/awesome)

## 🛠️ 開発ガイド

[開発ガイド](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING.md)をご覧ください。

## ❓ FAQ

### SiYuanはどのようにデータを保存しますか？

データはワークスペースフォルダーに保存され、ワークスペースデータフォルダーに保存されます：

- `assets` はすべての挿入されたアセットを保存するために使用されます
- `emojis` は絵文字画像を保存するために使用されます
- `snippets` はコードスニペットを保存するために使用されます
- `storage` はクエリ条件、レイアウト、フラッシュカードなどを保存するために使用されます
- `templates` はテンプレートスニペットを保存するために使用されます
- `widgets` はウィジェットを保存するために使用されます
- `plugins` はプラグインを保存するために使用されます
- `public` は公開データを保存するために使用されます
- 残りのフォルダーはユーザーが作成したノートブックフォルダーであり、ノートブックフォルダー内の `.sy` サフィックスのファイルはドキュメントデータを保存するために使用され、データ形式はJSONです

### サードパーティの同期ディスクを介したデータ同期をサポートしていますか？

サードパーティの同期ディスクを介したデータ同期はサポートされていません。そうしないとデータが破損する可能性があります。

サードパーティの同期ディスクをサポートしていない場合でも、サードパーティのクラウドストレージと接続することはサポートされています（会員特典）。

### SiYuanはオープンソースですか？

SiYuanは完全にオープンソースであり、貢献を歓迎します：

- [ユーザーインターフェースとカーネル](https://github.com/siyuan-note/siyuan)
- [Android](https://github.com/siyuan-note/siyuan-android)
- [iOS](https://github.com/siyuan-note/siyuan-ios)
- [HarmonyOS](https://github.com/siyuan-note/siyuan-harmony)
- [Chromeクリッピング拡張](https://github.com/siyuan-note/siyuan-chrome)

詳細については[開発ガイド](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING.md)をご覧ください。

### 新しいバージョンにアップグレードするにはどうすればよいですか？

- アプリストアからインストールした場合は、アプリストアから更新してください
- Windows または macOS のデスクトップ版をインストールパッケージでインストールした場合は、<kbd>設定</kbd> - <kbd>情報</kbd> - <kbd>自動的に更新インストールパッケージをダウンロード</kbd> オプションを開くことができます。これにより、SiYuanは最新バージョンのインストールパッケージを自動的にダウンロードし、インストールを促します
- 手動でインストールパッケージを使用してインストールした場合は、再度インストールパッケージをダウンロードしてインストールしてください

<kbd>設定</kbd> - <kbd>情報</kbd> - <kbd>現在のバージョン</kbd> で <kbd>更新を確認</kbd> できます。また、[公式ダウンロード](https://b3log.org/siyuan/en/download.html) または [GitHub Releases](https://github.com/siyuan-note/siyuan/releases) をフォローして新しいバージョンを入手することもできます。

### 一部のブロック（リスト項目内の段落ブロックなど）がブロックアイコンを見つけられない場合はどうすればよいですか？

リスト項目の最初のサブブロックはブロックアイコンが省略されています。このブロックにカーソルを移動し、<kbd>Ctrl+/</kbd> を使用してそのブロックメニューをトリガーできます。

### データリポジトリキーを紛失した場合はどうすればよいですか？

- データリポジトリキーが以前に複数のデバイスで正しく初期化されている場合、キーはすべてのデバイスで同じであり、<kbd>設定</kbd> - <kbd>アカウントと同期</kbd> - <kbd>ローカルデータリポジトリ</kbd> - <kbd>データリポジトリキー</kbd> - <kbd>キー文字列をコピー</kbd> で見つけることができます
- 以前に正しく構成されていない場合（たとえば、複数のデバイスでキーが一致しない場合）またはすべてのデバイスが使用できず、キー文字列を取得できない場合は、以下の手順でキーをリセットできます：

  1. データを手動でバックアップします。<kbd>データのエクスポート</kbd> を使用するか、ファイルシステム上で <kbd>ワークスペース/data/</kbd> フォルダーをコピーします
  2. <kbd>設定</kbd> - <kbd>アカウントと同期</kbd> - <kbd>ローカルデータリポジトリ</kbd> - <kbd>データリポジトリキー</kbd> - <kbd>データリポジトリをリセット</kbd>
  3. データリポジトリキーを再初期化します。1台のデバイスでキーを初期化した後、他のデバイスでキーをインポートします
  4. クラウドは新しい同期ディレクトリを使用します。古い同期ディレクトリは使用できなくなり、削除できます
  5. 既存のクラウドスナップショットは使用できなくなり、削除できます

### 支払いが必要ですか？

ほとんどの機能は無料で、商業利用も可能です。

会員特典は支払い後にのみ利用可能です。詳細については[価格](https://b3log.org/siyuan/en/pricing.html)をご覧ください。

## 🙏 謝辞

SiYuanの誕生は、多くのオープンソースプロジェクトと貢献者なしでは実現できませんでした。プロジェクトのソースコード kernel/go.mod、app/package.json、およびプロジェクトのホームページをご覧ください。

SiYuanの成長は、ユーザーのフィードバックとプロモーションなしでは実現できませんでした。SiYuanへのすべての支援に感謝します ❤️

### 貢献者

私たちに参加し、一緒にSiYuanにコードを貢献することを歓迎します。

<a href="https://github.com/siyuan-note/siyuan/graphs/contributors">
   <img src="https://contrib.rocks/image?repo=siyuan-note/siyuan" />
</a>
