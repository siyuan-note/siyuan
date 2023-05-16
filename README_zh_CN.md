<p align="center">
<img alt="SiYuan" src="https://b3log.org/images/brand/siyuan-128.png">
<br>
构建你永恒的数字花园
<br><br>
<a title="Releases" target="_blank" href="https://github.com/siyuan-note/siyuan/releases"><img src="https://img.shields.io/github/release/siyuan-note/siyuan.svg?style=flat-square&color=FF9900"></a>
<a title="Downloads" target="_blank" href="https://github.com/siyuan-note/siyuan/releases"><img src="https://img.shields.io/github/downloads/siyuan-note/siyuan/total.svg?style=flat-square&color=blueviolet"></a>
<a title="Docker Pulls" target="_blank" href="https://hub.docker.com/r/b3log/siyuan"><img src="https://img.shields.io/docker/pulls/b3log/siyuan.svg?style=flat-square&color=99CCFF"></a>
<a title="Hits" target="_blank" href="https://github.com/siyuan-note/siyuan"><img src="https://hits.b3log.org/siyuan-note/siyuan.svg"></a>
</p>

<p align="center">
<a href="README.md">English</a>
</p>

## 💡 简介

思源笔记是一款本地优先的个人知识管理系统， 支持细粒度块级引用和 Markdown 所见即所得。

![feature0.png](https://b3logfile.com/file/2022/10/feature0-EHMFc7T.png)

欢迎到[思源笔记官方讨论区](https://ld246.com/domain/siyuan)了解更多。同时也欢迎关注 B3log 开源社区微信公众号 `B3log开源`：

![b3logos.jpg](https://b3logfile.com/file/2020/08/b3logos-032af045.jpg)

## 🔮 特性

### 免费

所有本地功能都是免费的，即使是在商业环境下使用。

* 内容块
  * 块级引用和双向链接
  * 自定义属性
  * SQL 查询嵌入
  * 协议 `siyuan://`
* 编辑器
  * Block 风格
  * Markdown 所见即所得
  * 列表大纲
  * 块缩放聚焦
  * 块横向排版
  * 百万字大文档编辑
  * 数学公式、图表、流程图、甘特图、时序图、五线谱等
  * 网页剪藏
  * PDF 标注双链
* 导出
  * 引用块和嵌入块 
  * 带 assets 文件夹的标准 Markdown
  * PDF、Word 和 HTML
  * 复制到微信公众号、知乎和语雀
* 通过第三方云端存储服务实现端到端加密数据同步和备份
  * S3 
  * WebDAV
* 间隔重复
* 模板片段
* JavaScript/CSS 代码片段
* Android/iOS APP
* Docker 部署
* [API](API_zh_CN.md)
* 社区集市

### 付费订阅

云端服务需要付费订阅。

* 尊贵身份标识
* 端到端加密数据同步和备份
* 云端图床服务
* 定时微信提醒
* 云端收集箱

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=siyuan-note/siyuan&type=Date)](https://star-history.com/#siyuan-note/siyuan&Date)


## 🗺️ 路线图

* [思源笔记开发计划和进度](https://github.com/orgs/siyuan-note/projects/1)
* [思源笔记版本变更和公告](https://ld246.com/tag/siyuan-announcement)

## 🚀 下载安装

桌面端和移动端建议优先考虑通过应用市场安装，这样以后升级版本时可以一键更新。

### 应用市场

* [App Store](https://apps.apple.com/cn/app/siyuan/id1583226508)
* [Google Play](https://play.google.com/store/apps/details?id=org.b3log.siyuan)
* [Microsoft Store](https://www.microsoft.com/store/apps/9P7HPMXP73K4)
* [华为应用市场](https://appgallery.huawei.com/app/C105558879)
* [小米应用商店](https://app.mi.com/details?id=org.b3log.siyuan)
* [酷安](https://www.coolapk.com/apk/292664)

### Docker 部署

<details>
<summary>Docker 部署文档</summary>

#### 概述

在服务器上伺服思源最简单的方案是通过 Docker 部署。

* 镜像名称 `b3log/siyuan`
* [镜像地址](https://hub.docker.com/r/b3log/siyuan)

#### 文件结构

整体程序位于 `/opt/siyuan/` 下，基本上就是 Electron 安装包 resources 文件夹下的结构：

* appearance：图标、主题、多语言
* guide：帮助文档
* stage：界面和静态资源
* kernel：内核程序

#### 启动入口

构建 Docker 镜像时设置了入口：`ENTRYPOINT [ "/opt/siyuan/kernel" ]`，使用 `docker run b3log/siyuan` 并带参即可启动：

* `--workspace` 指定工作空间文件夹路径，在宿主机上通过 `-v` 挂载到容器中

更多的参数可参考 `--help`。下面是一条启动命令示例：`docker run -v workspace_dir_host:workspace_dir_container -p 6806:6806 b3log/siyuan --workspace=workspace_dir_container`

* `workspace_dir_host`：宿主机上的工作空间文件夹路径
* `workspace_dir_container`：容器内工作空间文件夹路径，和后面 `--workspace` 指定成一样的

为了简化，建议将 workspace 文件夹路径在宿主机和容器上配置为一致的，比如将 `workspace_dir_host` 和 `workspace_dir_container` 都配置为 `/siyuan/workspace`，对应的启动命令示例：`docker run -v /siyuan/workspace:/siyuan/workspace -p 6806:6806 -u 1000:1000 b3log/siyuan --workspace=/siyuan/workspace/`。

#### 用户权限

镜像中是使用默认创建的普通用户 `siyuan`（uid 1000/gid 1000）来启动内核进程的，所以在宿主机创建工作空间文件夹时请注意设置该文件夹所属用户组：`chown -R 1000:1000 /siyuan/workspace`，在启动容器时需要带参数 `-u 1000:1000`。

#### 隐藏端口

使用 NGINX 反向代理可以隐藏 6806 端口，请注意：

* 配置 WebSocket 反代 `/ws`

#### 注意

* 请务必确认挂载卷的正确性，否则容器删除后数据会丢失
* 不要使用 URL 重写进行重定向，否则鉴权可能会有问题，建议配置反向代理

#### 限制

* 不支持桌面端和移动端应用连接，仅支持在浏览器上使用
* 不支持导出 PDF、HTML 和 Word 格式
* 不支持导入 Markdown 文件

</details>

### 安装包

* [B3log](https://b3log.org/siyuan/download.html)
* [GitHub](https://github.com/siyuan-note/siyuan/releases)

### 内部预览版

我们会在有重大更新前发布内部预览版，请访问 [https://github.com/siyuan-note/insider](https://github.com/siyuan-note/insider)。

## 🏘️ 社区

* [中文讨论区](https://ld246.com/domain/siyuan) 官方支持渠道
* [用户社区汇总](https://ld246.com/article/1640266171309) 由热心用户建立的社区
* [Awesome SiYuan](https://github.com/siyuan-note/awesome) 由热心用户整理的资源

## 🛠️ 开发指南

见：[开发指南](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING_zh_CN.md)。

## ❓ 常见问题和解答

### 听说思源笔记会通过用户电脑挖矿？

以前不会、现在不会，将来也不会。详情请看[如何评价思源笔记? - 知乎](https://www.zhihu.com/question/434530733/answer/2644563326)。

### 思源适合我吗？或者说我应该如何选择笔记软件？

这个问题因人而异，很难统一回答。如果你不太确定思源是否适合你，请看如下建议：

* 如果你需要经常分享笔记或者与别人协作编辑，并且需要数据表格功能，推荐使用：

  * [FlowUs 息流 - 新一代知识管理与协作平台](https://flowus.cn/)
  * [我来 wolai - 不仅仅是未来的云端协作平台与个人笔记](https://www.wolai.com/)
  * [Notion - One workspace. Every team.](https://www.notion.so/)
* 如果你喜欢使用纯文本 Markdown 文件存储笔记，推荐使用：

  * [Obsidian - A second brain, for you, forever.](https://obsidian.md/)
  * [Logseq - A privacy-first, open-source knowledge base](https://logseq.com/)

### 思源是如何存储数据的？

数据保存在工作空间文件夹下，在工作空间 data 文件夹下：

* `assets` 用于保存所有插入的资源文件
* `emojis` 用于保存自定义图标表情图片
* `snippets` 用于保存代码片段
* `storage` 用于保存查询条件、布局和闪卡数据等
* `templates` 用于保存模板片段
* `widgets` 用于保存挂件
* `plugins` 用于保存插件
* 其余文件夹就是用户自己创建的笔记本文件夹，笔记本文件夹下 `.sy` 后缀的文件用于保存文档数据，数据格式为 JSON

### 支持通过第三方同步盘进行数据同步吗？

不支持通过第三方同步盘进行数据同步，否则可能会导致数据损坏。

虽然不支持第三方同步盘，但是支持第三方云端存储服务，可在 <kbd>设置</kbd> - <kbd>云端</kbd> - <kbd>云端存储服务提供商</kbd> 中进行选择和配置，目前已经支持：

* S3 兼容的对象存储服务，比如[七牛云](https://s.qiniu.com/VbQfeu)、[阿里云 OSS](https://www.aliyun.com/product/oss?userCode=yqovuas2)、[Cloudflare R2](https://www.cloudflare.com/)
* WebDAV 协议，比如 [TeraCLOUD](https://teracloud.jp/)

通过第三方云端存储服务同步数据同样是端到端加密的，第三方云端存储服务提供商无法获得我们的明文数据。

另外，也可以考虑手动导出导入 Data 实现数据同步：

* 桌面端：<kbd>设置</kbd> - <kbd>导出</kbd> - <kbd>导出 Data</kbd> / <kbd>导入 Data</kbd>
* 移动端：<kbd>右侧栏</kbd> - <kbd>关于</kbd> - <kbd>导出 Data</kbd> / <kbd>导入 Data</kbd>

### 思源是开源的吗？

思源笔记是完全开源的，欢迎参与贡献：

* [界面和内核](https://github.com/siyuan-note/siyuan)
* [Android 端](https://github.com/siyuan-note/siyuan-android)
* [iOS 端](https://github.com/siyuan-note/siyuan-ios)
* [Chrome 剪藏扩展](https://github.com/siyuan-note/siyuan-chrome)

更多细节请参考[开发指南](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING_zh_CN.md)。

### 如何升级到新版本？

* 如果是通过应用商店安装的，请通过应用商店更新
* 如果是桌面端通过安装包安装的，可打开 <kbd>设置</kbd> - <kbd>关于</kbd> - <kbd>自动下载更新安装包</kbd> 选项，这样思源会自动下载最新版安装包并提示安装
* 如果是通过手动安装包安装的，请再次下载安装包安装

可在 <kbd>设置</kbd> - <kbd>关于</kbd> - <kbd>当前版本</kbd> 中 <kbd>检查更新</kbd>，也可以通过关注 [GitHub Releases](https://github.com/siyuan-note/siyuan/releases) 或者[思源笔记公告](https://ld246.com/tag/siyuan-announcement)来获取新版本。

**注意**：切勿将工作空间放置于安装目录下，因为更新版本会清空安装目录下的所有文件

### 删除文档有什么注意事项吗？

文档被删除后不会出现在操作系统回收站中，而是直接删除，删除时思源会生成数据历史。

### 如何才能只换行不新起段落？

请使用 <kbd>Shift+Enter</kbd>。

## 有的块（比如在列表项中的段落块）找不到块标怎么办？

在列表项下的第一个子块是省略块标的。可以将光标移到这个块中，然后通过 <kbd>Ctrl+/</kbd> 触发它的块标菜单。

### 如何分享笔记？

* 分享文档到链滴
* 导出导入 `.sy.zip` 数据包
* 通过网络伺服
* 导出导入 Markdown
* <kbd>导出预览</kbd> 中复制到第三方在线服务

### 数据仓库密钥遗失怎么办？

* 如果之前在多个设备上正确初始化过数据仓库密钥的话，那么该密钥在所有设备上都是相同的，可以在 <kbd>设置</kbd> - <kbd>关于</kbd> - <kbd>数据仓库密钥</kbd> - <kbd>复制密钥字符串</kbd> 找回
* 如果之前没有正确配置（比如多个设备上密钥不一致）或者所有设备均不可用，已经无法获得密钥字符串，则可通过如下步骤重置密钥：

  1. 手动备份好数据，可通过 <kbd>导出 Data</kbd> 或者直接在文件系统上复制 <kbd>工作空间/data/</kbd> 文件夹
  2. <kbd>设置</kbd> - <kbd>关于</kbd> - <kbd>数据仓库密钥</kbd> - <kbd>重置数据仓库</kbd>
  3. 重新初始化数据仓库密钥，在一台设备上初始化密钥以后，其他设备导入密钥
  4. 云端使用新的同步目录，旧的同步目录已经无法使用，可以删除
  5. 已有的云端快照已经无法使用，可以删除

### 使用需要付费吗？

所有本地功能都是免费的，即使是在商业环境下使用。

[云端服务](https://b3log.org/siyuan/pricing.html)需要年付订阅。目前仅支持中国大陆地区用户订阅，非中国大陆地区用户请勿订阅。

如果你没有订阅需求但又想支持开发，欢迎进行捐赠：

* [靠爱发电 - 链滴](https://ld246.com/sponsor)

## 🙏 鸣谢

### 贡献者列表

欢迎加入我们，一起为思源贡献代码。

<a href="https://github.com/siyuan-note/siyuan/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=siyuan-note/siyuan" />
</a>

### 开源项目依赖列表

思源的诞生离不开下列开源项目。

* [https://github.com/golang/go](https://github.com/golang/go) `BSD-3-Clause License`
* [https://github.com/atotto/clipboard](https://github.com/atotto/clipboard) `BSD-3-Clause License`
* [https://github.com/vanng822/css](https://github.com/vanng822/css) `MIT License`
* [https://github.com/gofrs/flock](https://github.com/gofrs/flock) `BSD-3-Clause License`
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
* [https://github.com/go-ole/go-ole](https://github.com/go-ole/go-ole) `MIT License`
* [https://github.com/imroc/req](https://github.com/imroc/req) `MIT License`
* [https://github.com/jinzhu/copier](https://github.com/jinzhu/copier) `MIT License`
* [https://github.com/mattn/go-sqlite3](https://github.com/mattn/go-sqlite3) `MIT License`
* [https://github.com/mitchellh/go-ps](https://github.com/mitchellh/go-ps) `MIT License`
* [https://github.com/mssola/user_agent](https://github.com/mssola/user_agent) `MIT License`
* [https://github.com/panjf2000/ants](https://github.com/panjf2000/ants) `MIT License`
* [https://github.com/patrickmn/go-cache](https://github.com/patrickmn/go-cache) `MIT License`
* [https://github.com/radovskyb/watcher](https://github.com/radovskyb/watcher) `BSD-3-Clause License`
* [https://github.com/sabhiram/go-gitignore](https://github.com/sabhiram/go-gitignore) `MIT License`
* [https://github.com/steambap/captcha](https://github.com/steambap/captcha) `MIT License`
* [https://github.com/vmihailenco/msgpack](https://github.com/vmihailenco/msgpack) `BSD-2-Clause License`
* [https://github.com/xrash/smetrics](https://github.com/xrash/smetrics) `MIT License`
* [https://github.com/jgm/pandoc](https://github.com/jgm/pandoc) `GPL-2.0 License`
* [https://github.com/microsoft/TypeScript](https://github.com/microsoft/TypeScript) `Apache-2.0 License`
* [https://github.com/electron/electron](https://github.com/electron/electron) `MIT License`
* [https://github.com/visjs/vis-network](https://github.com/visjs/vis-network) `Apache-2.0 License`
* [https://github.com/mozilla/pdf.js](https://github.com/mozilla/pdf.js) `Apache-2.0 License`
* [https://github.com/blueimp/JavaScript-MD5](https://github.com/blueimp/JavaScript-MD5) `MIT License`
