<p align="center">
<img alt="SiYuan" src="https://b3log.org/images/brand/siyuan-128.png">
<br>
<em>あなたの思考をリファクタリングする</em>
<br><br>
<a title="Build Status" target="_blank" href="https://github.com/siyuan-note/siyuan/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/siyuan-note/siyuan/cd.yml?style=flat-square"></a>
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
| <a href="README_zh-CN.md">中文</a>
| <b>日本�?/b>
| <a href="README_tr.md">Türkçe</a>
</p>

---

## 目次

- [💡 紹介](#-紹介)
- [🔮 特徴](#-特徴)
- [🏗�?アーキテクチャとエコシステム](#�?アーキテクチャとエコシステム)
- [🌟 スター履歴](#-スター履�?
- [🗺�?ロードマップ](#�?ロードマップ)
- [🚀 ダウンロードとセットアップ](#-ダウンロードとセットアップ)
  - [アプリマーケット](#アプリマーケット)
  - [インストールパッケージ](#インストールパッケー�?
  - [パッケージマネージャー](#パッケージマネージャ�?
  - [Docker ホスティング](#docker-ホスティング)
  - [Unraid ホスティング](#unraid-ホスティング)
  - [TrueNAS ホスティング](#truenas-ホスティング)
  - [インサイダープレビュー](#インサイダープレビュー)
- [⌨️ コマンドラインインターフェース](#-コマンドラインインターフェー�?
- [🏘�?コミュニティ](#�?コミュニティ)
- [🛠�?開発ガイド](#�?開発ガイ�?
- [�?FAQ](#-faq)
  - [SiYuanはどのようにデータを保存しますか？](#siyuanはどのようにデータを保存しますか)
  - [サードパーティの同期ディスクを介したデータ同期をサポートしていますか？](#サードパーティの同期ディスクを介したデータ同期をサポートしていますか)
  - [SiYuanはオープンソースですか？](#siyuanはオープンソースです�?
  - [新しいバージョンにアップグレードするにはどうすればよいですか？](#新しいバージョンにアップグレードするにはどうすればよいですか)
  - [一部のブロック（リスト項目内の段落ブロックなど）がブロックアイコンを見つけられない場合はどうすればよいですか？](#一部のブロックリスト項目内の段落ブロックなどがブロックアイコンを見つけられない場合はどうすればよいです�?
  - [データリポジトリキーを紛失した場合はどうすればよいですか？](#データリポジトリキーを紛失した場合はどうすればよいですか)
  - [支払いが必要ですか？](#支払いが必要です�?
- [🙏 謝辞](#-謝辞)
  - [貢献者](#貢献�?

---

## 💡 紹介

SiYuanは、プライバシーを最優先とする個人の知識管理システムであり、細かいブロックレベルの参照とMarkdown WYSIWYGをサポートしています�?

詳細については、[SiYuan英語ディスカッションフォーラム](https://liuyun.io)をご覧ください�?

オンラインユーザーガイド：[English](https://siyuan-en.b3log.org/)

![feature0.png](https://b3logfile.com/file/2025/11/feature0-GfbhEqf.png)

![feature51.png](https://b3logfile.com/file/2025/11/feature5-1-7DJSfEP.png)

## 🔮 特徴

ほとんどの機能は無料で、商業利用も可能です�?

- コンテンツブロッ�?
  - ブロックレベルの参照と双方向リン�?
  - カスタム属�?
  - SQLクエリ埋め込�?
  - プロトコ�?`siyuan://`
- エディタ
  - ブロックスタイル
  - Markdown WYSIWYG
  - リストアウトライ�?
  - ブロックズームイ�?
  - 百万字の大規模ドキュメント編�?
  - 数学公式、チャート、フローチャート、ガントチャート、タイミングチャート、五線譜など
  - ウェブクリッピン�?
  - PDF注釈リン�?
- エクスポート
  - ブロック参照と埋め込�?
  - アセット付きの標準Markdown
  - PDF、Word、HTML
  - WeChat MP、Zhihu、Yuqueへのコピ�?
- データベース
  - テーブルビュ�?
- フラッシュカード間隔反復
- OpenAI APIを介したAIライティングとQ/Aチャット
- Tesseract OCR
- マルチタブ、ドラッグアンドドロップで分割画�?
- テンプレートスニペッ�?
- JavaScript/CSSスニペッ�?
- Android/iOS/HarmonyOSアプ�?
- Dockerデプロイメン�?
- [API](https://github.com/siyuan-note/siyuan/blob/master/API.md)
- コミュニティマーケットプレイ�?

一部の機能は有料会員のみ利用可能です。詳細については[価格](https://b3log.org/siyuan/en/pricing.html)をご覧ください�?

## 🏗�?アーキテクチャとエコシステム

![SiYuan Arch](https://b3logfile.com/file/2023/05/SiYuan_Arch-Sgu8vXT.png "SiYuan Arch")

| プロジェクト                                                   | 説明              | フォーク                                                                           | スタ�?                                                                               | 
|----------------------------------------------------------|-----------------|---------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| [lute](https://github.com/88250/lute)                    | エディタエンジン        | ![GitHub forks](https://img.shields.io/github/forks/88250/lute)                 | ![GitHub Repo stars](https://img.shields.io/github/stars/88250/lute)                 |
| [chrome](https://github.com/siyuan-note/siyuan-chrome)   | Chrome/Edge拡張   | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-chrome)  | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-chrome)  |
| [bazaar](https://github.com/siyuan-note/bazaar)          | コミュニティマーケットプレイ�?| ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/bazaar)         | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/bazaar)         |
| [dejavu](https://github.com/siyuan-note/dejavu)          | データリポジトリ        | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/dejavu)         | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/dejavu)         |
| [petal](https://github.com/siyuan-note/petal)            | プラグインAPI        | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/petal)          | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/petal)          |
| [android](https://github.com/siyuan-note/siyuan-android) | Androidアプ�?     | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-android) | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-android) |
| [ios](https://github.com/siyuan-note/siyuan-ios)         | iOSアプ�?         | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-ios)     | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-ios)     |
| [harmony](https://github.com/siyuan-note/siyuan-harmony)     | HarmonyOSアプ�?   | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-harmony)     | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-harmony)     |
| [riff](https://github.com/siyuan-note/riff)              | 間隔反復            | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/riff)           | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/riff)           |

## 🌟 スター履�?

<a href="https://star-history.com/#siyuan-note/siyuan&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=siyuan-note/siyuan&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=siyuan-note/siyuan&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=siyuan-note/siyuan&type=Date" />
 </picture>
</a>

## 🗺�?ロードマップ

- [SiYuanの開発計画と進捗](https://github.com/orgs/siyuan-note/projects/1)
- [SiYuanの変更履歴](CHANGELOG.md)

## 🚀 ダウンロードとセットアップ

デスクトップとモバイルでは、アプリマーケットからのインストールを優先的にお勧めします。これにより、将来的にワンクリックでバージョンをアップグレードできます�?

### アプリマーケット

モバイル�?

- [App Store](https://apps.apple.com/us/app/siyuan/id1583226508)
- [Google Play](https://play.google.com/store/apps/details?id=org.b3log.siyuan)
- [F-Droid](https://f-droid.org/packages/org.b3log.siyuan)

デスクトップ�?

- [Microsoft Store](https://apps.microsoft.com/detail/9p7hpmxp73k4)

### インストールパッケー�?

- [B3log](https://b3log.org/siyuan/en/download.html)
- [GitHub](https://github.com/siyuan-note/siyuan/releases)

### パッケージマネージャ�?

#### `siyuan`

[![梱包状態](https://repology.org/badge/vertical-allrepos/siyuan.svg)](https://repology.org/project/siyuan/versions)

#### `siyuan-note`

[![梱包状態](https://repology.org/badge/vertical-allrepos/siyuan-note.svg)](https://repology.org/project/siyuan-note/versions)

### Docker ホスティング

<details>
<summary>Dockerデプロイメン�?/summary>

#### 概要

サーバーでSiYuanを提供する最も簡単な方法は、Dockerを使用してデプロイすることです�?

- イメージ�?`b3log/siyuan`
- [イメージURL](https://hub.docker.com/r/b3log/siyuan)

#### ファイル構�?

全体のプログラム�?`/opt/siyuan/` にあり、基本的にはElectronインストールパッケージのresourcesフォルダーの構造です：

- appearance: アイコン、テーマ、言�?
- guide: ユーザーガイドドキュメン�?
- stage: インターフェースと静的リソー�?
- kernel: カーネルプログラ�?

#### エントリポイント

エントリポイントはDockerイメージのビルド時に設定されます：`ENTRYPOINT ["/opt/siyuan/entrypoint.sh"]`。このスクリプトを使用すると、コンテナ内で実行されるユーザー�?`PUID` �?`PGID` を変更できます。これは、ホストからディレクトリをマウントする際の権限の問題を解決するために特に重要です。`PUID`（ユーザーID）と `PGID`（グループID）は環境変数として渡すことができ、ホストマウントディレクトリにアクセスする際に正しい権限を確保するのが容易になります�?

`docker run b3log/siyuan` を使用してコンテナを実行する場合、次のパラメータを使用します�?

- `--workspace`: ワークスペースフォルダーのパスを指定し、ホスト上で `-v` を使用してコンテナにマウントしま�?
- `--accessAuthCode`: ロック画面パスワードを指定します

詳細なパラメータ�?`--help` を参照してください。以下は新しい環境変数を使用した起動コマンドの例です�?

```bash
docker run -d \
  -v workspace_dir_host:workspace_dir_container \
  -p 6806:6806 \
  -e PUID=1001 -e PGID=1002 \
  -e SIYUAN_LANG=ja \
  b3log/siyuan \
  --workspace=workspace_dir_container \
  --accessAuthCode=xxx
```

- `PUID`: カスタムユーザーID（オプション、指定しない場合はデフォルト�?`1000`�?
- `PGID`: カスタムグループID（オプション、指定しない場合はデフォルト�?`1000`�?
- `workspace_dir_host`: ホスト上のワークスペースフォルダーのパス
- `workspace_dir_container`: コンテナ内のワークスペースフォルダーのパス、`--workspace` で指定されたものと同�?
  - あるいは、`SIYUAN_WORKSPACE_PATH` 環境変数を使用してパスを設定することもできます。両方が設定されている場合は、コマンドラインの値が優先されます
- `accessAuthCode`: ロック画面パスワード�?*必ず変更してください**、そうしないと誰でもデータにアクセスできます�?
  - また、`SIYUAN_ACCESS_AUTH_CODE` 環境変数を設定することでロック画面パスワードを指定することもできます。両方が設定されている場合、コマンドラインの値が優先されます
  - 環境変数 `SIYUAN_ACCESS_AUTH_CODE_BYPASS=true` を設定することで、ロック画面パスワードを無効にすることができます
- `SIYUAN_LANG`：インターフェース言語（オプション、Docker で未設定の場合はデフォルトで `en`）。以下の例では、BCP 47 タグ（`zh-CN`/`zh-TW`/`en`/`ja`/`pt-BR` など）を受け付けます。従来のアンダースコア形式（`zh_CN`/`en_US` など）も互換性のため受け付けます。このドキュメントの言語に合わせて `ja` を使用します�?*設定**で選択した言語を再起動後も維持したい場合は、デプロイ時にこの変数を省略してください。設定した場合は、起動のたびにその値が適用され、保存済みの言語設定を上書きします
  - `--lang` コマンドライン引数でも設定できます。両方が設定されている場合は、コマンドラインの値が優先されます

簡略化するために、ホストとコンテナでワークスペースフォルダーのパスを一致させることをお勧めします。たとえば、`workspace_dir_host` �?`workspace_dir_container` の両方を `/siyuan/workspace` に設定します。対応する起動コマンドは次のようになります：

```bash
docker run -d \
  -v /siyuan/workspace:/siyuan/workspace \
  -p 6806:6806 \
  -e PUID=1001 -e PGID=1002 \
  -e SIYUAN_LANG=ja \
  b3log/siyuan \
  --workspace=/siyuan/workspace/ \
  --accessAuthCode=xxx
```

#### Docker Compose

Docker Composeを使用してSiYuanを実行するユーザー向けに、環境変�?`PUID` �?`PGID` を使用してユーザーとグループのIDをカスタマイズできます。以下はDocker Composeの設定例です�?

```yaml
version: "3.9"
services:
  main:
    image: b3log/siyuan
    command: ['--workspace=/siyuan/workspace/', '--accessAuthCode=${AuthCode}']
    ports:
      - 6806:6806
    volumes:
      - /siyuan/workspace:/siyuan/workspace
    restart: unless-stopped
    environment:
      - TZ=${YOUR_TIME_ZONE}    # タイムゾーン識別子のリストは https://en.wikipedia.org/wiki/List_of_tz_database_time_zones を参照してくださ�?
      - PUID=${YOUR_USER_PUID}  # カスタムユーザーID
      - PGID=${YOUR_USER_PGID}  # カスタムグループID
      - SIYUAN_LANG=ja       # インターフェース言語（このドキュメントに合わせる）
```

この設定では�?

- `PUID` �?`PGID` は動的に設定され、コンテナに渡されま�?
- これらの変数が提供されていない場合、デフォルト�?`1000` が使用されま�?

環境�?`PUID` �?`PGID` を指定することで、composeファイル�?`user` ディレクティブ（`user: '1000:1000'`）を明示的に設定する必要がなくなります。コンテナは起動時にこれらの環境変数に基づいてユーザーとグループを動的に調整します�?

#### ユーザー権限

イメージ内で、`entrypoint.sh` スクリプトは指定され�?`PUID` �?`PGID` �?`siyuan` ユーザーとグループを作成することを保証します。したがって、ホストがワークスペースフォルダーを作成する際には、フォルダーのユーザーとグループの所有権を設定し、使用する予定の `PUID` �?`PGID` に一致させることに注意してください。たとえば：

```bash
chown -R 1001:1002 /siyuan/workspace
```

カスタム�?`PUID` �?`PGID` 値を使用する場合、エントリポイントスクリプトはコンテナ内で正しいユーザーとグループを作成し、マウントされたボリュームの所有権を適切に調整します。`docker run` また�?`docker-compose` �?`-u` を手動で渡す必要はありません。環境変数がカスタマイズを処理します�?

#### 隠しポー�?

NGINXリバースプロキシを使用してポート6806を隠します。注意点�?

- WebSocketリバースプロキシ `/ws` を設定します

#### 注意

- マウントボリュームの正確性を確認してください。そうしないと、コンテナが削除された後にデータが失われます
- URLリライトを使用してリダイレクトしないでください。認証に問題が発生する可能性があるため、リバースプロキシの設定をお勧めしま�?
- 権限の問題が発生した場合、`PUID` �?`PGID` 環境変数がホストシステム上のマウントされたディレクトリの所有権と一致していることを確認してください

#### 制限

- デスクトップおよびモバイルアプリケーションの接続はサポートされておらず、ブラウザでの使用のみサポートされていま�?
- PDF、HTML、Word形式へのエクスポートはサポートされていません
- Markdownファイルのインポートはサポートされていません

</details>

### Unraid ホスティング

<details>
<summary>Unraidデプロイメン�?/summary>

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
Publish parameters: --accessAuthCode=******（ロック画面パスワード）
```

</details>

### TrueNAS ホスティング

<details>
<summary>TrueNasデプロイメン�?/summary>

注意：ま�?TrueNAS Shell で以下のコマンドを実行してください。`Pool_1/Apps_Data/siyuan` をアプリ用のデータセットパスに合わせて更新してください�?

```shell
zfs create Pool_1/Apps_Data/siyuan
chown -R 1001:1002 /mnt/Pool_1/Apps_Data/siyuan
chmod 755 /mnt/Pool_1/Apps_Data/siyuan
```

Apps - DiscoverApps - More Options（右上、Custom App を除く）- YAML でインストー�?に移動してくださ�?

テンプレート例：

```yaml
services:
  siyuan:
    image: b3log/siyuan
    container_name: siyuan
    command: ['--workspace=/siyuan/workspace/', '--accessAuthCode=2222']
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

主要な更新前にインサイダープレビューをリリースします。詳細は[https://github.com/siyuan-note/insider](https://github.com/siyuan-note/insider)をご覧ください�?

## ⌨️ コマンドラインインターフェー�?

組み込み CLI で、サーバー起動なしにワークスペースデータへ直接アクセスできます�?

### クイックスタート

```bash
siyuan notebook list -w ~/SiYuan
siyuan search "keyword" -w ~/SiYuan -f json
siyuan export md --id <block-id> -w ~/SiYuan
```

### 利用可能なコマン�?

| カテゴリ | コマンド |
|----------|----------|
| ノートと文書 | `notebook`, `document` �?CRUD |
| コンテン�?| `block`, `attr` �?読み書き、カスタム属�?|
| メタデー�?| `tag`, `bookmark` |
| クエ�?| `search`, `sql` �?全文検索�?SQL |
| 参照 | `ref` �?バックリンクと言�?|
| インポー�?エクスポート | `export`, `import` �?Markdown, HTML, PDF, Word, .sy.zip |
| データ管�?| `repo`, `history`, `sync` �?スナップショット、履歴、クラウド同�?|
| ユーティリテ�?| `asset`, `file` �?リソースとファイルシステ�?|
| データベース | `database` �?属性ビュー管理 |
| ワークスペー�?| `workspace` �?一覧と確認 |

詳細�?`siyuan --help` を実行してください。スクリプト向け出力には `-f json` を使用します�?

### セットアップ

CLI バイナリ�?`<インストール�?/resources/kernel/SiYuan-Kernel` です�?
Windows インストーラーが自動�?PATH に追加します�?
macOS/Linux では手動でシンボリックリンクを作成してください�?

```bash
# macOS
ln -s /Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel /usr/local/bin/siyuan

# Linux
ln -s /インストール�?SiYuan/resources/kernel/SiYuan-Kernel /usr/local/bin/siyuan
```

## 🏘�?コミュニティ

- [英語ディスカッションフォーラム](https://liuyun.io)
- [ユーザーコミュニティのまとめ](https://liuyun.io/article/1687779743723)
- [Awesome SiYuan](https://github.com/siyuan-note/awesome)

## 🛠�?開発ガイ�?

[開発ガイド](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING.md)をご覧ください�?

## �?FAQ

### SiYuanはどのようにデータを保存しますか�?

データはワークスペースフォルダーに保存され、ワークスペースデータフォルダーに保存されます�?

- `assets` はすべての挿入されたアセットを保存するために使用されます
- `emojis` は絵文字画像を保存するために使用されます
- `snippets` はコードスニペットを保存するために使用されま�?
- `storage` はクエリ条件、レイアウト、フラッシュカードなどを保存するために使用されま�?
- `templates` はテンプレートスニペットを保存するために使用されます
- `widgets` はウィジェットを保存するために使用されま�?
- `plugins` はプラグインを保存するために使用されます
- `public` は公開データを保存するために使用されます
- 残りのフォルダーはユーザーが作成したノートブックフォルダーであり、ノートブックフォルダー内�?`.sy` サフィックスのファイルはドキュメントデータを保存するために使用され、データ形式はJSONです

### サードパーティの同期ディスクを介したデータ同期をサポートしていますか�?

サードパーティの同期ディスクを介したデータ同期はサポートされていません。そうしないとデータが破損する可能性があります�?

サードパーティの同期ディスクをサポートしていない場合でも、サードパーティのクラウドストレージと接続することはサポートされています（会員特典）�?

また、データのエクスポートとインポートを手動で行うことでデータ同期を実現することもできます：

- デスクトップ�?kbd>設定</kbd> - <kbd>エクスポート</kbd> - <kbd>データのエクスポート</kbd> / <kbd>データのインポー�?/kbd>
- モバイル�?kbd>右カラム</kbd> - <kbd>情報</kbd> - <kbd>データのエクスポート</kbd> / <kbd>データのインポー�?/kbd>

### SiYuanはオープンソースですか？

SiYuanは完全にオープンソースであり、貢献を歓迎します：

- [ユーザーインターフェースとカーネル](https://github.com/siyuan-note/siyuan)
- [Android](https://github.com/siyuan-note/siyuan-android)
- [iOS](https://github.com/siyuan-note/siyuan-ios)
- [HarmonyOS](https://github.com/siyuan-note/siyuan-harmony)
- [Chromeクリッピング拡張](https://github.com/siyuan-note/siyuan-chrome)

詳細については[開発ガイド](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING.md)をご覧ください�?

### 新しいバージョンにアップグレードするにはどうすればよいですか�?

- アプリストアからインストールした場合は、アプリストアから更新してくださ�?
- デスクトップでインストールパッケージを使用してインストールした場合は�?kbd>設定</kbd> - <kbd>情報</kbd> - <kbd>自動的に更新インストールパッケージをダウンロー�?/kbd> オプションを開くことができます。これにより、SiYuanは最新バージョンのインストールパッケージを自動的にダウンロードし、インストールを促します
- 手動でインストールパッケージを使用してインストールした場合は、再度インストールパッケージをダウンロードしてインストールしてくださ�?

<kbd>設定</kbd> - <kbd>情報</kbd> - <kbd>現在のバージョン</kbd> �?<kbd>更新を確�?/kbd> できます。また、[公式ダウンロード](https://b3log.org/siyuan/en/download.html) また�?[GitHub Releases](https://github.com/siyuan-note/siyuan/releases) をフォローして新しいバージョンを入手することもできます�?

### 一部のブロック（リスト項目内の段落ブロックなど）がブロックアイコンを見つけられない場合はどうすればよいですか？

リスト項目の最初のサブブロックはブロックアイコンが省略されています。このブロックにカーソルを移動し�?kbd>Ctrl+/</kbd> を使用してそのブロックメニューをトリガーできます�?

### データリポジトリキーを紛失した場合はどうすればよいですか�?

- データリポジトリキーが以前に複数のデバイスで正しく初期化されている場合、キーはすべてのデバイスで同じであり�?kbd>設定</kbd> - <kbd>情報</kbd> - <kbd>データリポジトリキー</kbd> - <kbd>キー文字列をコピ�?/kbd> で見つけることができます
- 以前に正しく構成されていない場合（たとえば、複数のデバイスでキーが一致しない場合）またはすべてのデバイスが使用できず、キー文字列を取得できない場合は、以下の手順でキーをリセットできます�?

  1. データを手動でバックアップします�?kbd>データのエクスポート</kbd> を使用するか、ファイルシステム上�?<kbd>ワークスペー�?data/</kbd> フォルダーをコピーします
  2. <kbd>設定</kbd> - <kbd>情報</kbd> - <kbd>データリポジトリキー</kbd> - <kbd>データリポジトリをリセッ�?/kbd>
  3. データリポジトリキーを再初期化します�?台のデバイスでキーを初期化した後、他のデバイスでキーをインポートしま�?
  4. クラウドは新しい同期ディレクトリを使用します。古い同期ディレクトリは使用できなくなり、削除できま�?
  5. 既存のクラウドスナップショットは使用できなくなり、削除できま�?

### 支払いが必要ですか？

ほとんどの機能は無料で、商業利用も可能です�?

会員特典は支払い後にのみ利用可能です。詳細については[価格](https://b3log.org/siyuan/en/pricing.html)をご覧ください�?

## 🙏 謝辞

SiYuanの誕生は、多くのオープンソースプロジェクトと貢献者なしでは実現できませんでした。プロジェクトのソースコード kernel/go.mod、app/package.json、およびプロジェクトのホームページをご覧ください�?

SiYuanの成長は、ユーザーのフィードバックとプロモーションなしでは実現できませんでした。SiYuanへのすべての支援に感謝します ❤️

### 貢献�?

私たちに参加し、一緒にSiYuanにコードを貢献することを歓迎します�?

<a href="https://github.com/siyuan-note/siyuan/graphs/contributors">
   <img src="https://contrib.rocks/image?repo=siyuan-note/siyuan" />
</a>
