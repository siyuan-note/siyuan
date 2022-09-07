<p align="center">
<img alt="SiYuan" src="https://b3log.org/images/brand/siyuan-128.png">
<br>
Build Your Eternal Digital Garden
<br><br>
<a title="Releases" target="_blank" href="https://github.com/siyuan-note/siyuan/releases"><img src="https://img.shields.io/github/release/siyuan-note/siyuan.svg?style=flat-square&color=FF9900"></a>
<a title="Downloads" target="_blank" href="https://github.com/siyuan-note/siyuan/releases"><img src="https://img.shields.io/github/downloads/siyuan-note/siyuan/total.svg?style=flat-square&color=blueviolet"></a>
<a title="Docker Pulls" target="_blank" href="https://hub.docker.com/r/b3log/siyuan"><img src="https://img.shields.io/docker/pulls/b3log/siyuan.svg?style=flat-square&color=99CCFF"></a>
<a title="Hits" target="_blank" href="https://github.com/siyuan-note/siyuan"><img src="https://hits.b3log.org/siyuan-note/siyuan.svg"></a>
</p>

<p align="center">
<a href="README_zh_CN.md">中文</a>
</p>

## 💡 Introduction

SiYuan is a local-first personal knowledge management system, support fine-grained block-level reference and Markdown
WYSIWYG.

![feature0.png](https://b3logfile.com/file/2022/05/feature0-a82bdd3f.png)

![feature1-1.png](https://b3logfile.com/file/2022/05/feature1-1-740d9a02.png)

## ✨ Features

### Free

All local features are free.

* Content block
  * Block-level reference and two-way links
  * Document relationship diagram, global relationship diagram
  * Custom attributes
  * SQL query embed
  * Protocol `siyuan://`
* Editor
  * Block-style
  * Markdown WYSIWYG
  * List outline
  * Block zoom-in
  * Block horizontal layout
  * Million-word large document editing
  * Mathematical formulas, charts, flowcharts, Gantt charts, timing charts, staffs, etc.
  * Web clipping
  * PDF Annotation link
* Export
  * Block ref and embed
  * Standard Markdown with assets
  * PDF, Word and HTML
  * Copy to WeChat MP, Zhihu and Yuque
* Community bazaar
  * Themes
  * Icons
  * Templates
  * Widgets
* Hierarchical tag
* Multi-tab, drag and drop to split screen
* Fulltext search
* Template snippet
* Keymap
* Themes and icons
* Android APP
* iOS APP
* Docker deployment
* [API](https://github.com/siyuan-note/siyuan/blob/master/API.md)

### Paid subscription

Cloud services require a paid subscription.

* VIP identity
* End-to-end encrypted data synchronization
* End-to-end encrypted data backup
* Cloud assets serving
* WeChat notification
* Cloud inbox

## 🗺️ Roadmap

* [SiYuan development plan and progress](https://github.com/orgs/siyuan-note/projects/1)
* [SiYuan Change logs](CHANGELOG.md)

## 🛠️ Download Setup

It is recommended to give priority to installing through the application market on the desktop and mobile, so that you can upgrade the version with one click in the future.

### App Market

* [App Store](https://apps.apple.com/us/app/siyuan/id1583226508)
* [Google Play](https://play.google.com/store/apps/details?id=org.b3log.siyuan)
* [Microsoft Store](https://www.microsoft.com/store/apps/9P7HPMXP73K4)

### Docker Hosting

<details>
<summary>Docker Deployment</summary>

#### Overview

The easiest way to serve SiYuan on a server is to deploy it through Docker.

* Image name `b3log/siyuan`
* [Image URL](https://hub.docker.com/r/b3log/siyuan)

#### File structure

The overall program is located under `/opt/siyuan/`, which is basically the structure under the resources folder of the Electron installation package:

* appearance: icon, theme, languages
* guide: user guide document
* stage: interface and static resources
* kernel: kernel program

#### Entrypoint

The entry point is set when building the Docker image: `ENTRYPOINT ["/opt/siyuan/kernel" ]`, use `docker run b3log/siyuan` with parameters to start:

* `--workspace` specifies the workspace folder path, mounted to the container via `-v` on the host

More parameters can refer to `--help`. The following is an example of a startup command: `docker run -v workspace_dir_host:workspace_dir_container -p 6806:6806 b3log/siyuan --workspace=workspace_dir_container`

* `workspace_dir_host`: the workspace folder path on the host
* `workspace_dir_container`: The path of the workspace folder in the container, which is the same as specified in `--workspace`

To simplify, it is recommended to configure the workspace folder path to be consistent on the host and container, such as: `workspace_dir_host` and `workspace_dir_container` are configured as `/siyuan/workspace`, the corresponding startup commands is: `docker run -v /siyuan/workspace:/siyuan/workspace -p 6806:6806 -u 1000:1000 b3log/siyuan --workspace=/siyuan/workspace/`.

#### User permissions

In the image, the normal user `siyuan` (uid 1000/gid 1000) created by default is used to start the kernel process. Therefore, when the host creates a workspace folder, please pay attention to setting the user group of the folder:  `chown -R 1000:1000 /siyuan/workspace`. The parameter `-u 1000:1000` is required when starting the container.

#### Hidden port

Use NGINX reverse proxy to hide port 6806, please note:

* Configure WebSocket reverse proxy `/ws`

</details>

### Installation Package

* [B3log](https://b3log.org/siyuan/en/download.html)
* [GitHub](https://github.com/siyuan-note/siyuan/releases)

### Insider Preview

We release insider preview before major updates, please visit [https://github.com/siyuan-note/insider](https://github.com/siyuan-note/insider).

## 🏘️ Community

* [Issues](https://github.com/siyuan-note/siyuan/issues) Official support channels
* [Discord](https://discord.com/invite/bzfCBwMzdP) A community built by enthusiastic users
* [Awesome SiYuan](https://github.com/siyuan-note/awesome) Resources organized by enthusiastic users

## ❓ FAQ

### Is SiYuan right for me? Or how should I choose note-taking software?

This question varies from person to person and is difficult to answer uniformly. If you're not sure if Siyuan is right for you, here are some suggestions:

* If you need to frequently share notes or edit collaboratively with others, and need the data table function, it is recommended to use:

  * [Notion - One workspace. Every team.](https://www.notion.so/)
* If you like to use plain text Markdown files to store your notes, it is recommended to use:

  * [Obsidian - A second brain, for you, forever.](https://obsidian.md/)
  * [Logseq - A privacy-first, open-source knowledge base](https://logseq.com/)

### How does SiYuan store data?

The data is saved in the workspace folder (the default is in the user's home directory Documents/SiYuan, which can be modified in <kbd>Settings</kbd> - <kbd>About</kbd>), in the workspace data folder:

* `assets` are used to save all inserted asset files
* `templates` are used to save template snippets
* `widgets` are used to save widgets
* `emojis` are used to save emoji images
* The rest of the folders are the notebook folders created by the user, files with the suffix of `.sy` in the notebook folder are used to save the document data, and the data format is JSON

### Is SiYuan open source?

SiYuan is completely open source, and contributions are welcome:

* [User Interface and Kernel](https://github.com/siyuan-note/siyuan)
* [User Guide](https://github.com/siyuan-note/user-guide-en_US) and [Appearance](https://github.com/siyuan-note/appearance)
* [Editor Engine](https://github.com/88250/lute)
* [End-to-end encryption](https://github.com/siyuan-note/encryption) and [Data repo](https://github.com/siyuan-note/dejavu)
* [Chrome Clipping Extension](https://github.com/siyuan-note/siyuan-chrome)
* [Android](https://github.com/siyuan-note/siyuan-android) and [iOS](https://github.com/siyuan-note/siyuan-ios)

For more details, please refer to [Development Guide](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING.md).

### Is there any note for deleting docs?

After deletion, the doc will not appear in the operating system's recycle bin, but will be deleted directly. When deleted, SiYuan will generate edit history.

### How can I just wrap and not start a new paragraph?

Please use <kbd>Shift+Enter</kbd>.

### How to move the heading and blocks below it?

Fold the heading and move it later.

### How to select multiple blocks across pages?

Click at the beginning, hold down <kbd>Shift</kbd> and click at the end after scrolling the page.

### How to do find and replace?

Press <kbd>Ctrl+R</kbd> after selecting the keyword in the editor.

### What if some blocks (such as paragraph blocks in list items) cannot find the block icon?

The first sub-block under the list item is the block icon omitted. You can move the cursor into this block and trigger its block menu with <kbd>Ctrl+/</kbd> .

### How to share notes?

* Export and import `.sy.zip` package
* Via network hosting
* Export and import Markdown
* <kbd>Export Preview</kbd> to copy to third-party online services

The first two methods can guarantee the original semantics of the data.

### Does it support data synchronization through a third-party sync disk?

Data synchronization through third-party synchronization disks is not supported, otherwise data may be damaged. Consider manually exporting and importing Data for data synchronization:

* Desktop: <kbd>Settings</kbd> - <kbd>Export</kbd> - <kbd>Export Data</kbd> / <kbd>Import Data</kbd>
* Mobile: <kbd>Right column</kbd> - <kbd>About</kbd> - <kbd>Export Data</kbd> / <kbd>Import Data</kbd>

### What should I do if the data repo key is lost?

* If the data repo key is correctly initialized on multiple devices before, the key is the same on all devices and can be set in <kbd>Settings</kbd> - <kbd>About</kbd> - <kbd>Data repo key</kbd> - <kbd>Copy key string</kbd> retrieve
* If it has not been configured correctly before (for example, the keys on multiple devices are inconsistent) or all devices are unavailable and the key string cannot be obtained, you can reset the key by following the steps below:

  1. Manually back up the data, you can use <kbd>Export Data</kbd> or directly copy the <kbd>workspace/data/</kbd> folder on the file system
  2. <kbd>Settings</kbd> - <kbd>About</kbd> - <kbd>Data rep key</kbd> - <kbd>Reset data repo</kbd>
  3. Reinitialize the data repo key. After initializing the key on one device, other devices import the key
  4. The cloud uses the new synchronization directory, the old synchronization directory is no longer available and can be deleted
  5. The existing cloud snapshots are no longer available and can be deleted

### Do I need to pay for it?

Local functions are completely free to use, [Cloud services](https://b3log.org/siyuan/en/pricing.html) requires annual subscription.

Currently, only users in mainland China are supported to subscribe. For users in non-mainland China regions, please follow [Cloud service supports non-mainland China regions](https://github.com/siyuan-note/siyuan/issues/5331).

## 🙏 Acknowledgement

SiYuan is made possible by the following open source projects.

* [https://github.com/golang/go](https://github.com/golang/go) `BSD-3-Clause License`
* [https://github.com/atotto/clipboard](https://github.com/atotto/clipboard) `BSD-3-Clause License`
* [https://github.com/vanng822/css](https://github.com/vanng822/css) `MIT License`
* [https://github.com/gofrs/flock](https://github.com/gofrs/flock) `BSD-3-Clause License`
* [https://github.com/88250/gulu](https://github.com/88250/gulu) `Mulan PSL v2`
* [https://github.com/88250/lute](https://github.com/88250/lute) `Mulan PSL v2`
* [https://github.com/olahol/melody](https://github.com/olahol/melody) `BSD-2-Clause License`
* [https://github.com/pdfcpu/pdfcpu](https://github.com/pdfcpu/pdfcpu) `Apache-2.0 License`
* [https://github.com/blastrain/vitess-sqlparser](https://github.com/blastrain/vitess-sqlparser) `Apache-2.0 License`
* [https://github.com/ConradIrwin/font](https://github.com/ConradIrwin/font) `MIT License`
* [https://github.com/Masterminds/sprig](https://github.com/Masterminds/sprig) `MIT License`
* [https://github.com/PuerkitoBio/goquery](https://github.com/PuerkitoBio/goquery) `BSD-3-Clause License`
* [https://github.com/Xuanwo/go-locale](https://github.com/Xuanwo/go-locale) `Apache-2.0 License` 
* [https://github.com/araddon/dateparse](https://github.com/araddon/dateparse) `MIT License`
* [https://github.com/common-nighthawk/go-figure](https://github.com/common-nighthawk/go-figure) `MIT License`
* [https://github.com/denisbrodbeck/machineid](https://github.com/denisbrodbeck/machineid) `MIT License`
* [https://github.com/dgraph-io/ristretto](https://github.com/dgraph-io/ristretto) `Apache-2.0 License`
* [https://github.com/dustin/go-humanize](https://github.com/dustin/go-humanize) `MIT License`
* [https://github.com/emirpasic/gods](https://github.com/emirpasic/gods) `BSD-2-Clause License`
* [https://github.com/facette/natsort](https://github.com/facette/natsort) `BSD-3-Clause License`
* [https://github.com/flopp/go-findfont](https://github.com/flopp/go-findfont) `MIT License`
* [https://github.com/fsnotify/fsnotify](https://github.com/fsnotify/fsnotify) `BSD-3-Clause License`
* [https://github.com/gabriel-vasile/mimetype](https://github.com/gabriel-vasile/mimetype) `MIT License`
* [https://github.com/gin-contrib/cors](https://github.com/gin-contrib/cors) `MIT License`
* [https://github.com/gin-contrib/gzip](https://github.com/gin-contrib/gzip) `MIT License`
* [https://github.com/gin-contrib/sessions](https://github.com/gin-contrib/sessions) `MIT License`
* [https://github.com/gin-gonic/gin](https://github.com/gin-gonic/gin) `MIT License`
* [https://github.com/imroc/req](https://github.com/imroc/req) `MIT License`
* [https://github.com/jinzhu/copier](https://github.com/jinzhu/copier) `MIT License`
* [https://github.com/mattn/go-sqlite3](https://github.com/mattn/go-sqlite3) `MIT License`
* [https://github.com/mitchellh/go-ps](https://github.com/mitchellh/go-ps) `MIT License`
* [https://github.com/mssola/user_agent](https://github.com/mssola/user_agent) `MIT License`
* [https://github.com/panjf2000/ants](https://github.com/panjf2000/ants) `MIT License`
* [https://github.com/patrickmn/go-cache](https://github.com/patrickmn/go-cache) `MIT License`
* [https://github.com/radovskyb/watcher](https://github.com/radovskyb/watcher) `BSD-3-Clause License`
* [https://github.com/sabhiram/go-gitignore](https://github.com/sabhiram/go-gitignore) `MIT License`
* [https://github.com/siyuan-note/dejavu](https://github.com/siyuan-note/dejavu) `Mulan PSL v2`
* [https://github.com/siyuan-note/encryption](https://github.com/siyuan-note/encryption) `Mulan PSL v2`
* [https://github.com/siyuan-note/filelock](https://github.com/siyuan-note/filelock) `Mulan PSL v2`
* [https://github.com/siyuan-note/httpclient](https://github.com/siyuan-note/httpclient) `Mulan PSL v2`
* [https://github.com/steambap/captcha](https://github.com/steambap/captcha) `MIT License`
* [https://github.com/vmihailenco/msgpack](https://github.com/vmihailenco/msgpack) `BSD-2-Clause License`
* [https://github.com/xrash/smetrics](https://github.com/xrash/smetrics) `MIT License`
* [https://github.com/microsoft/TypeScript](https://github.com/microsoft/TypeScript) `Apache-2.0 License`
* [https://github.com/electron/electron](https://github.com/electron/electron) `MIT License`
* [https://github.com/Vanessa219/vditor](https://github.com/Vanessa219/vditor) `MIT License`
* [https://github.com/visjs/vis-network](https://github.com/visjs/vis-network) `Apache-2.0 License`
* [https://github.com/mozilla/pdf.js](https://github.com/mozilla/pdf.js) `Apache-2.0 License`
* [https://github.com/blueimp/JavaScript-MD5](https://github.com/blueimp/JavaScript-MD5) `MIT License`
