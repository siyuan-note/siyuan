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

![feature0.png](https://b3logfile.com/file/2022/05/feature0-a82bdd3f.png)

![feature1-1.png](https://b3logfile.com/file/2022/05/feature1-1-740d9a02.png)

欢迎到[思源笔记官方讨论区](https://ld246.com/domain/siyuan)了解更多。同时也欢迎关注 B3log 开源社区微信公众号 `B3log开源`：

![b3logos.jpg](https://b3logfile.com/file/2020/08/b3logos-032af045.jpg)

## ✨  特性

### 免费

所有本地功能都是免费的。

* 内容块
  * 块级引用和双向链接
  * 文档关系图、全局关系图
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
* 社区集市
  * 主题
  * 图标
  * 模板
  * 挂件
* 层级标签
* 多页签拖拽分屏
* 全文搜索
* 模板片段
* 快捷键
* 主题和图标
* Android APP
* iOS APP
* Docker 部署
* [API](API_zh_CN.md)

### 付费订阅

云端服务需要付费订阅。

* 尊贵身份标识
* 端到端加密数据同步
* 端到端加密数据备份
* 云端图床服务
* 定时微信提醒
* 云端收集箱

## 🗺️ 路线图

* [思源笔记开发计划和进度](https://github.com/siyuan-note/siyuan/projects)
* [思源笔记版本变更和公告](https://ld246.com/tag/siyuan-announcement)

## 🛠️ 下载安装

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

</details>

### 安装包

* [B3log](https://b3log.org/siyuan/download.html)
* [GitHub](https://github.com/siyuan-note/siyuan/releases)

### 内部预览版

获取最新内部预览版（Insider Preview），请将你的 GitHub 登录名发送邮件至 845765@qq.com，我们将邀请你加入 SiYuan 内部预览团队。

## 🏘️ 社区

* [中文讨论区](https://ld246.com/domain/siyuan)
* [GitHub Issues](https://github.com/siyuan-note/siyuan/issues)
* [用户社群汇总](https://ld246.com/article/1640266171309)

## ❓ 常见问题和解答

### 思源是如何存储数据的？

数据保存在工作空间文件夹下（默认位于用户家目录 Documents/SiYuan，可在 <kbd>设置</kbd> - <kbd>关于</kbd> 中进行修改），在工作空间 data 文件夹下：

* `assets` 用于保存所有插入的资源文件
* `templates` 用于保存模板片段
* `widgets` 用于保存挂件
* `emojis` 用于保存 Emoji 图片
* 其余文件夹就是用户自己创建的笔记本文件夹，笔记本文件夹下 `.sy` 后缀的文件用于保存文档数据，数据格式为 JSON

### 思源是开源的吗？

思源笔记是完全开源的，欢迎参与贡献：

* [界面和内核](https://github.com/siyuan-note/siyuan)
* [用户指南](https://github.com/siyuan-note/user-guide-zh_CN)
* [外观](https://github.com/siyuan-note/appearance)
* [数据解析器](https://github.com/88250/protyle)
* [编辑器引擎](https://github.com/88250/lute)
* [端到端加密](https://github.com/siyuan-note/encryption)
* [Chrome 剪藏扩展](https://github.com/siyuan-note/siyuan-chrome)
* [Android 端](https://github.com/siyuan-note/siyuan-android)
* [iOS 端](https://github.com/siyuan-note/siyuan-ios)

更多细节请参考[开发指南](.github/CONTRIBUTING_zh_CN.md)。

### 删除文档有什么注意事项吗？

文档被删除后不会出现在操作系统回收站中，而是直接删除，删除时思源会生成编辑历史。

### 如何才能只换行不新起段落？

请使用 <kbd>Shift+Enter</kbd>。

### 移动标题时如何带下方块一起移动？

将标题折叠以后再移动。

### 如何跨页多选内容块？

在开始的地方单击，滚动页面以后在结束的地方按住 <kbd>Shift</kbd> 单击。

### 如何调整表格行列？

表格块的块标菜单中有操作入口。

### 如何使用第三方同步盘进行数据同步？

* 请仅同步 `工作空间/data/`，切勿同步整个工作空间
* 思源运行期间请暂停第三方同步，否则可能会出现数据损坏，细节请参考[这里](https://ld246.com/article/1626537583158)
* Android 端数据文件夹路径为 `内部存储设备/Android/data/org.b3log.siyuan/files/siyuan/data/`，该路径是应用私有路径，其他程序无法读取，只能手动复制
* 第三方同步和思源同步存在冲突，切勿同时使用

### 端到端密码忘记了怎么办？

* 主力设备上使用新的工作空间，将旧的工作空间 data 文件夹手动复制到新的工作空间下
* 新的工作空间可以重新设置密码
* 云端使用新的云端同步目录

如果是移动端的话卸载重装即可（注意：移动端卸载应用时，本地工作空间数据会被一并删除）。

### 使用需要付费吗？

本地功能完全免费使用，[云端服务](https://b3log.org/siyuan/pricing.html)需要年付订阅。

非中国大陆地区的用户请勿付费订阅，因为思源云端服务器无法保证非中国大陆地区可用。

## 💌 参与贡献

思源笔记是完全开源的，欢迎参与贡献：

* [界面和内核](https://github.com/siyuan-note/siyuan)
* [用户指南](https://github.com/siyuan-note/user-guide-zh_CN)
* [外观](https://github.com/siyuan-note/appearance)
* [数据解析器](https://github.com/88250/protyle)
* [编辑器引擎](https://github.com/88250/lute)
* [端到端加密](https://github.com/siyuan-note/encryption)
* [Chrome 剪藏扩展](https://github.com/siyuan-note/siyuan-chrome)
* [Android 端](https://github.com/siyuan-note/siyuan-android)
* [iOS 端](https://github.com/siyuan-note/siyuan-ios)

更多细节请参考[开发指南](.github/CONTRIBUTING_zh_CN.md)。

## 🙏 鸣谢

思源的诞生离不开下列开源项目。

* [https://github.com/golang/go](https://github.com/golang/go) `BSD-3-Clause License`
* [https://github.com/atotto/clipboard](https://github.com/atotto/clipboard) `BSD-3-Clause License`
* [https://github.com/vanng822/css](https://github.com/vanng822/css) `MIT License`
* [https://github.com/gofrs/flock](https://github.com/gofrs/flock) `BSD-3-Clause License`
* [https://github.com/88250/gulu](https://github.com/88250/gulu) `Mulan PSL v2`
* [https://github.com/88250/lute](https://github.com/88250/lute) `Mulan PSL v2`
* [https://github.com/olahol/melody](https://github.com/olahol/melody) `BSD-2-Clause License`
* [https://github.com/pdfcpu/pdfcpu](https://github.com/pdfcpu/pdfcpu) `Apache-2.0 License`
* [https://github.com/88250/protyle](https://github.com/88250/protyle) `Mulan PSL v2`
* [https://github.com/blastrain/vitess-sqlparser](https://github.com/blastrain/vitess-sqlparser) `Apache-2.0 License`
* [https://github.com/ConradIrwin/font](https://github.com/ConradIrwin/font) `MIT License`
* [https://github.com/Masterminds/sprig](https://github.com/Masterminds/sprig) `MIT License`
* [https://github.com/PuerkitoBio/goquery](https://github.com/PuerkitoBio/goquery) `BSD-3-Clause License`
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
* [https://github.com/mattn/go-zglob](https://github.com/mattn/go-zglob) `MIT License`
* [https://github.com/mitchellh/go-ps](https://github.com/mitchellh/go-ps) `MIT License`
* [https://github.com/mssola/user_agent](https://github.com/mssola/user_agent) `MIT License`
* [https://github.com/panjf2000/ants](https://github.com/panjf2000/ants) `MIT License`
* [https://github.com/patrickmn/go-cache](https://github.com/patrickmn/go-cache) `MIT License`
* [https://github.com/radovskyb/watcher](https://github.com/radovskyb/watcher) `BSD-3-Clause License`
* [https://github.com/siyuan-note/encryption](https://github.com/siyuan-note/encryption) `Mulan PSL v2`
* [https://github.com/vmihailenco/msgpack](https://github.com/vmihailenco/msgpack) `BSD-2-Clause License`
* [https://github.com/xrash/smetrics](https://github.com/xrash/smetrics) `MIT License`
* [https://github.com/microsoft/TypeScript](https://github.com/microsoft/TypeScript) `Apache-2.0 License`
* [https://github.com/electron/electron](https://github.com/electron/electron) `MIT License`
* [https://github.com/Vanessa219/vditor](https://github.com/Vanessa219/vditor) `MIT License`
* [https://github.com/visjs/vis-network](https://github.com/visjs/vis-network) `Apache-2.0 License`
* [https://github.com/mozilla/pdf.js](https://github.com/mozilla/pdf.js) `Apache-2.0 License`
* [https://github.com/blueimp/JavaScript-MD5](https://github.com/blueimp/JavaScript-MD5) `MIT License`
