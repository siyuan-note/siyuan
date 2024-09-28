<p align="center">
<img alt="SiYuan" src="https://b3log.org/images/brand/siyuan-128.png">
<br>
<em>重构你的思维</em>
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
<a href="https://www.producthunt.com/products/siyuan/reviews?utm_source=badge-product_rating&utm_medium=badge&utm_souce=badge-siyuan" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/product_rating.svg?product_id=534576&theme=light" alt="SiYuan - A&#0032;privacy&#0045;first&#0032;personal&#0032;knowledge&#0032;management&#0032;software | Product Hunt" style="width: 242px; height: 108px;" width="242" height="108" /></a>
</p>

<p align="center">
<a href="README.md">English</a>
</p>

---

## 目录

* [💡 简介](#-简介)
* [🔮 特性](#-特性)
* [🏗️ 架构和生态](#️-架构和生态)
* [🌟 星标历史](#-星标历史)
* [🗺️ 路线图](#️-路线图)
* [🚀 下载安装](#-下载安装)
  * [应用市场](#应用市场)
  * [安装包](#安装包)
  * [Docker 部署](#docker-部署)
  * [Unraid 部署](#unraid-部署)
  * [内部预览版](#内部预览版)
* [🏘️ 社区](#️-社区)
* [🛠️ 开发指南](#️-开发指南)
* [❓ 常见问题和解答](#-常见问题和解答)
  * [思源是如何存储数据的？](#思源是如何存储数据的)
  * [支持通过第三方同步盘进行数据同步吗？](#支持通过第三方同步盘进行数据同步吗)
  * [思源是开源的吗？](#思源是开源的吗)
  * [如何升级到新版本？](#如何升级到新版本)
  * [有的块（比如在列表项中的段落块）找不到块标怎么办？](#有的块比如在列表项中的段落块找不到块标怎么办)
  * [数据仓库密钥遗失怎么办？](#数据仓库密钥遗失怎么办)
  * [使用需要付费吗？](#使用需要付费吗)
* [🙏 鸣谢](#-鸣谢)
  * [贡献者列表](#贡献者列表)

---

## 💡 简介

思源笔记是一款隐私优先的个人知识管理系统，支持细粒度块级引用和 Markdown 所见即所得。

![feature0.png](https://b3logfile.com/file/2024/01/feature0-1orBRlI.png)

![feature51.png](https://b3logfile.com/file/2024/02/feature5-1-uYYjAqy.png)

欢迎到[思源笔记官方讨论区](https://ld246.com/domain/siyuan)了解更多。同时也欢迎关注 B3log 开源社区微信公众号 `B3log开源`：

![b3logos.jpg](https://b3logfile.com/file/2020/08/b3logos-032af045.jpg)

## 🔮 特性

大部分功能是免费的，即使是在商业环境下使用。

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
  * 百万字大文档编辑
  * 数学公式、图表、流程图、甘特图、时序图、五线谱等
  * 网页剪藏
  * PDF 标注双链
* 导出
  * 块引用和嵌入块 
  * 带 assets 文件夹的标准 Markdown
  * PDF、Word 和 HTML
  * 复制到微信公众号、知乎和语雀
* 数据库
  * 表格视图
* 闪卡间隔重复
* 接入 OpenAI 接口支持人工智能写作和问答聊天
* Tesseract OCR
* 模板片段
* JavaScript/CSS 代码片段
* Android/iOS App
* Docker 部署
* [API](API_zh_CN.md)
* 社区集市

部分功能需要付费会员才能使用，更多细节请参考[定价](https://b3log.org/siyuan/pricing.html)。

## 🏗️ 架构和生态

![思源笔记架构设计](https://b3logfile.com/file/2023/05/SiYuan_Arch-Sgu8vXT.png "思源笔记架构设计")

| Project                                                  | Description    | Forks                                                                           | Stars                                                                                | 
|----------------------------------------------------------|----------------|---------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| [lute](https://github.com/88250/lute)                    | 编辑器引擎          | ![GitHub forks](https://img.shields.io/github/forks/88250/lute)                 | ![GitHub Repo stars](https://img.shields.io/github/stars/88250/lute)                 |
| [chrome](https://github.com/siyuan-note/siyuan-chrome)   | Chrome/Edge 扩展 | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-chrome)  | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-chrome)  |
| [bazaar](https://github.com/siyuan-note/bazaar)          | 社区集市           | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/bazaar)         | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/bazaar)         |
| [dejavu](https://github.com/siyuan-note/dejavu)          | 数据仓库           | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/dejavu)         | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/dejavu)         |
| [petal](https://github.com/siyuan-note/petal)            | 插件 API         | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/petal)          | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/petal)          |
| [android](https://github.com/siyuan-note/siyuan-android) | Android App    | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-android) | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-android) |
| [ios](https://github.com/siyuan-note/siyuan-ios)         | iOS App        | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/siyuan-ios)     | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/siyuan-ios)     |
| [riff](https://github.com/siyuan-note/riff)              | 间隔重复           | ![GitHub forks](https://img.shields.io/github/forks/siyuan-note/riff)           | ![GitHub Repo stars](https://img.shields.io/github/stars/siyuan-note/riff)           |

## 🌟 星标历史

[![Star History Chart](https://api.star-history.com/svg?repos=siyuan-note/siyuan&type=Date)](https://star-history.com/#siyuan-note/siyuan&Date)

## 🗺️ 路线图

* [思源笔记开发计划和进度](https://github.com/orgs/siyuan-note/projects/1)
* [思源笔记版本变更和公告](CHANGELOG.md)

## 🚀 下载安装

桌面端和移动端建议优先考虑通过应用市场安装，这样以后升级版本时可以一键更新。

### 应用市场

移动端：

* [App Store](https://apps.apple.com/cn/app/siyuan/id1583226508)
* [Google Play](https://play.google.com/store/apps/details?id=org.b3log.siyuan)
* [F-Droid](https://f-droid.org/packages/org.b3log.siyuan)
* [华为应用市场](https://appgallery.huawei.com/app/C105558879)
* [小米应用商店](https://app.mi.com/details?id=org.b3log.siyuan)
* [酷安](https://www.coolapk.com/apk/292664)

桌面端：

* [Microsoft Store](https://apps.microsoft.com/detail/9p7hpmxp73k4)

### 安装包

* [B3log](https://b3log.org/siyuan/download.html)
* [GitHub](https://github.com/siyuan-note/siyuan/releases)

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

入口点在构建 Docker 镜像时设置：`ENTRYPOINT ["/opt/siyuan/entrypoint.sh"]`。该脚本允许更改将在容器内运行的用户的 `PUID` 和 `PGID`。这对于解决从主机挂载目录时的权限问题尤为重要。`PUID` 和 `PGID` 可以作为环境变量传递，这样在访问主机挂载的目录时就能更容易地确保正确的权限。

使用 `docker run b3log/siyuan` 运行容器时，请带入以下参数：

* `--workspace`：指定工作空间文件夹路径，在宿主机上通过 `-v` 挂载到容器中
* `--accessAuthCode`：指定访问授权码

更多的参数可参考 `--help`。下面是一条启动命令示例：

```bash
docker run -d \
  -v workspace_dir_host:workspace_dir_container \
  -p 6806:6806 \
  -e PUID=1001 -e PGID=1002 \
  b3log/siyuan \
  --workspace=workspace_dir_container \
  --accessAuthCode=xxx
```

* `PUID`: 自定义用户 ID（可选，如果未提供，默认为 `1000`）
* `PGID`: 自定义组 ID（可选，如果未提供，默认为 `1000`）
* `workspace_dir_host`：宿主机上的工作空间文件夹路径
* `workspace_dir_container`：容器内工作空间文件夹路径，和后面 `--workspace` 指定成一样的
* `accessAuthCode`：访问授权码，请**务必修改**，否则任何人都可以读写你的数据

为了简化，建议将 workspace 文件夹路径在宿主机和容器上配置为一致的，比如将 `workspace_dir_host` 和 `workspace_dir_container` 都配置为 `/siyuan/workspace`，对应的启动命令示例：

```bash
docker run -d \
  -v /siyuan/workspace:/siyuan/workspace \
  -p 6806:6806 \
  -e PUID=1001 -e PGID=1002 \
  b3log/siyuan \
  --workspace=/siyuan/workspace/ \
  --accessAuthCode=xxx
```

#### Docker Compose

对于使用 Docker Compose 运行思源的用户，可以通过环境变量 `PUID` 和 `PGID` 来自定义用户和组的 ID。下面是一个 Docker Compose 配置示例：

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
      # A list of time zone identifiers can be found at https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
      - TZ=${YOUR_TIME_ZONE}
      - PUID=${YOUR_USER_PUID}  # 自定义用户 ID
      - PGID=${YOUR_USER_PGID}  # 自定义组 ID
```

在此设置中：

* PUID “和 ”PGID "是动态设置并传递给容器的
* 如果没有提供这些变量，将使用默认的 `1000`

在环境中指定 `PUID` 和 `PGID` 后，就无需在组成文件中明确设置 `user` 指令（`user: '1000:1000'`）。容器将在启动时根据这些环境变量动态调整用户和组。

#### 用户权限

在图片中，“entrypoint.sh ”脚本确保以指定的 “PUID ”和 “PGID ”创建 “siyuan ”用户和组。因此，当主机创建工作区文件夹时，请注意设置文件夹的用户和组所有权，使其与计划使用的 `PUID` 和 `PGID` 匹配。例如

```bash
chown -R 1001:1002 /siyuan/workspace
```

如果使用自定义的 `PUID` 和 `PGID` 值，入口点脚本将确保在容器内创建正确的用户和组，并相应调整挂载卷的所有权。无需在 `docker run` 或 `docker-compose` 中手动传递 `-u`，因为环境变量会处理自定义。

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

### Unraid 部署

<details>
<summary>Unraid 部署文档</summary>

注意：首先终端运行 `chown -R 1000:1000 /mnt/user/appdata/siyuan`

模板参考：

```
Web UI: 6806
Container Port: 6806
Container Path: /home/siyuan
Host path: /mnt/user/appdata/siyuan
PUID: 1000
PGID: 1000
Publish parameters: --accessAuthCode=******（访问授权码）
```

</details>

### 内部预览版

我们会在有重大更新前发布内部预览版，请访问 [https://github.com/siyuan-note/insider](https://github.com/siyuan-note/insider)。

## 🏘️ 社区

* [中文讨论区](https://ld246.com/domain/siyuan)
* [用户社区汇总](https://ld246.com/article/1640266171309)
* [Awesome SiYuan](https://github.com/siyuan-note/awesome)

## 🛠️ 开发指南

见：[开发指南](https://github.com/siyuan-note/siyuan/blob/master/.github/CONTRIBUTING_zh_CN.md)。

## ❓ 常见问题和解答

### 思源是如何存储数据的？

数据保存在工作空间文件夹下，在工作空间 data 文件夹下：

* `assets` 用于保存所有插入的资源文件
* `emojis` 用于保存自定义图标表情图片
* `snippets` 用于保存代码片段
* `storage` 用于保存查询条件、布局和闪卡数据等
* `templates` 用于保存模板片段
* `widgets` 用于保存挂件
* `plugins` 用于保存插件
* `public` 用于保存公开的数据
* 其余文件夹就是用户自己创建的笔记本文件夹，笔记本文件夹下 `.sy` 后缀的文件用于保存文档数据，数据格式为 JSON

### 支持通过第三方同步盘进行数据同步吗？

不支持通过第三方同步盘进行数据同步，否则可能会导致数据损坏。

虽然不支持第三方同步盘，但是支持对接第三方云端存储（会员特权）。

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

可在 <kbd>设置</kbd> - <kbd>关于</kbd> - <kbd>当前版本</kbd> 中 <kbd>检查更新</kbd>，也可以通过关注[官方下载](https://b3log.org/siyuan/download.html)或者 [GitHub Releases](https://github.com/siyuan-note/siyuan/releases) 来获取新版本。

**注意**：切勿将工作空间放置于安装目录下，因为更新版本会清空安装目录下的所有文件

### 有的块（比如在列表项中的段落块）找不到块标怎么办？

在列表项下的第一个子块是省略块标的。可以将光标移到这个块中，然后通过 <kbd>Ctrl+/</kbd> 触发它的块标菜单。

### 数据仓库密钥遗失怎么办？

* 如果之前在多个设备上正确初始化过数据仓库密钥的话，那么该密钥在所有设备上都是相同的，可以在 <kbd>设置</kbd> - <kbd>关于</kbd> - <kbd>数据仓库密钥</kbd> - <kbd>复制密钥字符串</kbd> 找回
* 如果之前没有正确配置（比如多个设备上密钥不一致）或者所有设备均不可用，已经无法获得密钥字符串，则可通过如下步骤重置密钥：

  1. 手动备份好数据，可通过 <kbd>导出 Data</kbd> 或者直接在文件系统上复制 <kbd>工作空间/data/</kbd> 文件夹
  2. <kbd>设置</kbd> - <kbd>关于</kbd> - <kbd>数据仓库密钥</kbd> - <kbd>重置数据仓库</kbd>
  3. 重新初始化数据仓库密钥，在一台设备上初始化密钥以后，其他设备导入密钥
  4. 云端使用新的同步目录，旧的同步目录已经无法使用，可以删除
  5. 已有的云端快照已经无法使用，可以删除

### 使用需要付费吗？

大部分功能是免费的，即使是在商业环境下使用。

会员特权需要付费后才能使用，请参考[定价](https://b3log.org/siyuan/pricing.html)。

如果你没有会员特权需求但又想支持开发，欢迎进行捐赠：[靠爱发电 - 链滴](https://ld246.com/sponsor)

## 🙏 鸣谢

思源的诞生离不开众多的开源项目和贡献者，请参考项目源代码 kernel/go.mod、app/package.json 和项目首页。

思源的成长离不开用户的反馈和宣传推广，感谢所有人对思源的帮助 ❤️

### 贡献者列表

欢迎加入我们，一起为思源贡献代码。

<a href="https://github.com/siyuan-note/siyuan/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=siyuan-note/siyuan" />
</a>
