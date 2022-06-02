## v2.0.16 / 2022-06-02

### 改进功能

* [免费提供一个月的订阅试用](https://github.com/siyuan-note/siyuan/issues/4186)
* [代码块横向滚动条改进](https://github.com/siyuan-note/siyuan/issues/4985)
* [`Echarts` 图表块无法渲染 3D 图表](https://github.com/siyuan-note/siyuan/issues/4992)
* [桌面端资源文件链接支持菜单操作](https://github.com/siyuan-note/siyuan/issues/4998)
* [断网时能够暂停云端同步](https://github.com/siyuan-note/siyuan/issues/5035)
* [更换隐藏/显示停靠栏图标](https://github.com/siyuan-note/siyuan/issues/5037)
* [为 Mermaid 添加支持 HTML 标签功能](https://github.com/siyuan-note/siyuan/issues/5074)
* [升级 Mermaid](https://github.com/siyuan-note/siyuan/issues/5077)

### 开发重构

* [chore: update eslint deps](https://github.com/siyuan-note/siyuan/pull/5072)
* [chore: deprecate `node-sass`](https://github.com/siyuan-note/siyuan/pull/5075)

### 移除功能

* [付费订阅不再支持退款](https://github.com/siyuan-note/siyuan/issues/5031)

### 修复缺陷

* [移动端导入大于 32M 的 Data 包失败](https://github.com/siyuan-note/siyuan/issues/5067)
* [代码块语言选择列表覆盖在设置页面上](https://github.com/siyuan-note/siyuan/issues/5069)
* [Android 端状态栏在明亮模式下不正确](https://github.com/siyuan-note/siyuan/issues/5070)
* [过早提示订阅即将过期](https://github.com/siyuan-note/siyuan/issues/5081)

## v2.0.15 / 2022-06-01

### 改进功能

* [Docker 和移动端支持导出模版、Markdown 压缩包和 `.sy.zip` 数据包](https://github.com/siyuan-note/siyuan/issues/4947)
* [云端数据同步时降低交互阻塞时间](https://github.com/siyuan-note/siyuan/issues/4984)
* [书签面板 Emoji 和折叠问题](https://github.com/siyuan-note/siyuan/issues/5017)
* [通过 GitHub Actions 实现每日构建](https://github.com/siyuan-note/siyuan/issues/5033)
* [桌面端托盘图标菜单加入菜单项](https://github.com/siyuan-note/siyuan/issues/5046)
* [桌面端 `设置` - `账号` 中增加订阅续订入口](https://github.com/siyuan-note/siyuan/issues/5050)
* [改进 `网络图片转换为本地图片` 微信图片拉取](https://github.com/siyuan-note/siyuan/issues/5052)
* [改进 `网络图片转换为本地图片` 文件名后缀](https://github.com/siyuan-note/siyuan/issues/5053)
* [同步下载支持断点续传](https://github.com/siyuan-note/siyuan/issues/5056)
* [每次打开帮助文档时自动检查版本更新并提醒](https://github.com/siyuan-note/siyuan/issues/5057)
* [开放 insider 内部预览版本仓库](https://github.com/siyuan-note/siyuan/issues/5060)
* [新增内核启动参数 `mode`](https://github.com/siyuan-note/siyuan/issues/5064)
* [改进移动端打开引用缩放逻辑和桌面端一致](https://github.com/siyuan-note/siyuan/issues/5065)

### 文档相关

* [修改隐私政策](https://github.com/siyuan-note/siyuan/issues/5043)
* [使用 GitHub Projects 描绘路线图](https://github.com/siyuan-note/siyuan/issues/5061)

### 开发重构

* [前端使用 `pnpm` 管理构建](https://github.com/siyuan-note/siyuan/issues/5059)

### 修复缺陷

* [一级标题被面包屑强制省略两个汉字](https://github.com/siyuan-note/siyuan/issues/5044)
* [单元格所在行有跨行的单元格时禁止删除行](https://github.com/siyuan-note/siyuan/issues/5045)
* [标题中设置字体颜色问题](https://github.com/siyuan-note/siyuan/issues/5047)
* [打开页签时应跳过钉住的页签](https://github.com/siyuan-note/siyuan/issues/5048)
* [关闭页签后大纲没有刷新](https://github.com/siyuan-note/siyuan/issues/5051)

## v2.0.14 / 2022-05-29

### 改进功能

* [光标在文档标题位置时可使用快捷键唤出大纲、反链和关系图面板](https://github.com/siyuan-note/siyuan/issues/4999)
* [大纲面板加入文档标题](https://github.com/siyuan-note/siyuan/issues/5011)
* [完整开源界面和内核](https://github.com/siyuan-note/siyuan/issues/5013)
* [面包屑继续改进 ](https://github.com/siyuan-note/siyuan/issues/5019)
* [插入较大的资源文件时内存占用较大](https://github.com/siyuan-note/siyuan/issues/5023)
* [桌面端托盘图标菜单加入 `Hide Window`](https://github.com/siyuan-note/siyuan/issues/5025)
* [锚文本修改后 `Enter` 可退出修改层并跳转到锚文本末尾](https://github.com/siyuan-note/siyuan/issues/5036)

### 文档相关

* [公开内置密钥算法](https://github.com/siyuan-note/siyuan/issues/5012)
* [修改用户协议](https://github.com/siyuan-note/siyuan/issues/5015)

### 修复缺陷

* [文档标题处粘贴内容会选中粘贴的内容](https://github.com/siyuan-note/siyuan/issues/5006)
* [标题存在字体颜色时大纲面板异常](https://github.com/siyuan-note/siyuan/issues/5009)
* [`网络图片转换为本地图片` 链接参数处理异常](https://github.com/siyuan-note/siyuan/issues/5014)
* [表格内颜色字体不能换行](https://github.com/siyuan-note/siyuan/issues/5029)
* [文档树拖拽子文档后排序不正确](https://github.com/siyuan-note/siyuan/issues/5034)

## v2.0.13 / 2022-05-25

### 改进功能

* [更新嵌入块内容不重新渲染嵌入块](https://github.com/siyuan-note/siyuan/issues/4958)
* [更新主题后不需要对该主题进行切换](https://github.com/siyuan-note/siyuan/issues/4966)
* [新开页签应置于当前激活页签的右侧](https://github.com/siyuan-note/siyuan/issues/4967)
* [大纲面板移除顶层文档标题](https://github.com/siyuan-note/siyuan/issues/4988)
* [面包屑鼠标悬浮文字显示不全](https://github.com/siyuan-note/siyuan/issues/4989)
* [改进同步下载数据稳定性](https://github.com/siyuan-note/siyuan/issues/4994)
* [笔记本配置文件丢失后重新生成名为 `Untitled` 的笔记本配置](https://github.com/siyuan-note/siyuan/issues/4995)
* [局部关系图中添加文档链接关系](https://github.com/siyuan-note/siyuan/issues/4996)
* [文档树引用计数不使用缓存](https://github.com/siyuan-note/siyuan/issues/5001)
* [搜索页签和浮层路径长度最大调整](https://github.com/siyuan-note/siyuan/issues/5002)
* [云端数据同步和备份时忽略隐藏文件](https://github.com/siyuan-note/siyuan/issues/5005)

### 移除功能

* [移除局部关系图 `层级` 参数](https://github.com/siyuan-note/siyuan/issues/5004)

### 修复缺陷

* [表格内粘贴 HTML 时异常](https://github.com/siyuan-note/siyuan/issues/4986)
* [无法给整行文字设置样式，只能应用于行内部分文字](https://github.com/siyuan-note/siyuan/issues/4987)

## v2.0.12 / 2022-05-23

### 改进功能

* [面包屑改进：`Click` 为聚焦，聚焦返回文案修改](https://github.com/siyuan-note/siyuan/issues/4916)
* [搜索页签和全局搜索支持 `Alt+Click` 打开分屏](https://github.com/siyuan-note/siyuan/issues/4953)
* [改进启动报错窗口](https://github.com/siyuan-note/siyuan/issues/4957)
* [支持导入文档数据包 `.sy.zip`](https://github.com/siyuan-note/siyuan/issues/4961)
* [对选中的单元格支持清除内容](https://github.com/siyuan-note/siyuan/issues/4964)
* [支持导出文档数据包 `.sy.zip`](https://github.com/siyuan-note/siyuan/issues/4965)
* [选中图片后支持 `Ctrl+X` 和 `Ctrl+C`](https://github.com/siyuan-note/siyuan/issues/4974)
* [大幅提升启动速度](https://github.com/siyuan-note/siyuan/issues/4975)
* [iOS 端根据系统语言初始化外观语言](https://github.com/siyuan-note/siyuan/issues/4978)
* [增强锚文本的键盘操作](https://github.com/siyuan-note/siyuan/issues/4979)
* [在 PDF 标记和链接内可以使用 `Ctrl+/` 弹出对应的菜单](https://github.com/siyuan-note/siyuan/issues/4980)
* [桌面端在系统睡眠和唤醒时进行一次数据同步](https://github.com/siyuan-note/siyuan/issues/4983)

### 文档相关

* [README 中增加 Docker 部署说明](https://github.com/siyuan-note/siyuan/issues/4972)

### 移除功能

* [移除 `退出界面时关闭内核` 选项](https://github.com/siyuan-note/siyuan/issues/4977)

### 修复缺陷

* [iOS 端图片保存到相册导致崩溃](https://github.com/siyuan-note/siyuan/issues/4930)
* [`Alt+X` 选择状态问题](https://github.com/siyuan-note/siyuan/issues/4951)
* [窗口拉窄后顶部工具栏消失](https://github.com/siyuan-note/siyuan/issues/4956)
* [类型转换导致折叠标题下方块丢失](https://github.com/siyuan-note/siyuan/issues/4960)
* [复制内容为空的块作为块引用时粘贴无效](https://github.com/siyuan-note/siyuan/issues/4962)
* [列表项下图片删除后撤销触发状态异常](https://github.com/siyuan-note/siyuan/issues/4963)
* [代码块未显示行号时切换语言界面错位](https://github.com/siyuan-note/siyuan/issues/4969)
* [对已有颜色的文字添加不了背景](https://github.com/siyuan-note/siyuan/issues/4973)
* [聚焦后折叠会触发重建索引](https://github.com/siyuan-note/siyuan/issues/4976)
* [悬浮窗面包屑显示异常](https://github.com/siyuan-note/siyuan/issues/4982)

## v2.0.11 / 2022-05-19

### 改进功能

* [记住集市的排序状态](https://github.com/siyuan-note/siyuan/issues/4928)

### 修复缺陷

* [OPPO 移动端上超链接无法打开浏览器](https://github.com/siyuan-note/siyuan/issues/4751)
* [桌面端初次安装向导选择工作空间报错](https://github.com/siyuan-note/siyuan/issues/4946)
* [iOS 端导出 Data 无法下载](https://github.com/siyuan-note/siyuan/issues/4948)
* [iOS 端关于页未显示 IP 地址](https://github.com/siyuan-note/siyuan/issues/4949)

## v2.0.10 / 2022-05-19

### 改进功能

* [桌面端初次安装启动后向导](https://github.com/siyuan-note/siyuan/issues/4900)
* [`---` 插入分隔线后如果下方已经存在块则不生成空白段落](https://github.com/siyuan-note/siyuan/issues/4906)
* [通过链滴系统通知发放终身会员激活码](https://github.com/siyuan-note/siyuan/issues/4909)
* [子块的宽度不够填满超级块时无法调整超级块的整体布局](https://github.com/siyuan-note/siyuan/issues/4915)
* [大纲点击折叠标题跳转聚焦](https://github.com/siyuan-note/siyuan/issues/4920)
* [文档第一个块为包含嵌入块的列表时下上键无法在文档标题和第一个块之间切换](https://github.com/siyuan-note/siyuan/issues/4923)
* [优化新版主题头部及 Windows 端关闭按钮](https://github.com/siyuan-note/siyuan/issues/4924)
* [改进集市包更新版本对比](https://github.com/siyuan-note/siyuan/issues/4925)
* [内核启动参数加入 `lang`](https://github.com/siyuan-note/siyuan/issues/4929)
* [使用快捷键调出颜色面板](https://github.com/siyuan-note/siyuan/issues/4935)
* [改进云端同步 404 问题](https://github.com/siyuan-note/siyuan/issues/4940)
* [云端同步初始化默认 `main` 目录](https://github.com/siyuan-note/siyuan/issues/4943)

### 修复缺陷

* [导出 `段落开头空两格` 失效](https://github.com/siyuan-note/siyuan/issues/4917)
* [引述块下删除列表触发状态异常](https://github.com/siyuan-note/siyuan/issues/4918)
* [头部为列表时上键光标会跳到标题位置](https://github.com/siyuan-note/siyuan/issues/4922)
* [API `appendBlock` 插入渲染重复](https://github.com/siyuan-note/siyuan/issues/4926)
* [大纲点击产生动态加载后 `data-doc-type` 错误](https://github.com/siyuan-note/siyuan/issues/4938)
* [同步后文档树文档图标没有更新](https://github.com/siyuan-note/siyuan/issues/4939)
* [编辑器和标题中 `Alt+5` 会留下字符](https://github.com/siyuan-note/siyuan/issues/4941)
* [云端同步偶尔报错 `The system cannot find the path specified.`](https://github.com/siyuan-note/siyuan/issues/4942)

## v2.0.9 / 2022-05-16

### 改进功能

* [订阅激活码](https://github.com/siyuan-note/siyuan/issues/3117)
* [集市包增加下载数量统计](https://github.com/siyuan-note/siyuan/issues/4845)
* [集市包支持按下载数量排序](https://github.com/siyuan-note/siyuan/issues/4846)
* [块超链接光标定位](https://github.com/siyuan-note/siyuan/issues/4871)
* [结束推荐订阅送终身会员活动](https://github.com/siyuan-note/siyuan/issues/4872)
* [更换默认的笔记本图标](https://github.com/siyuan-note/siyuan/issues/4881)
* [云端同步传输数据使用 HTTPS](https://github.com/siyuan-note/siyuan/issues/4887)
* [回滚文档数据时保持原路径](https://github.com/siyuan-note/siyuan/issues/4890)
* [改进数据历史文档页签选择笔记本入口](https://github.com/siyuan-note/siyuan/issues/4891)
* [代码块横向滚动问题](https://github.com/siyuan-note/siyuan/issues/4903)
* [优化开启同步时的启动速度](https://github.com/siyuan-note/siyuan/issues/4904)
* [默认主题优化](https://github.com/siyuan-note/siyuan/issues/4910)
* [列表项聚焦返回和面包屑保持一致](https://github.com/siyuan-note/siyuan/issues/4914)

### 开发重构

* [块树索引加入 `HPath` 字段](https://github.com/siyuan-note/siyuan/issues/4898)

### 修复缺陷

* [块标纵向排列以后折叠小三角失效](https://github.com/siyuan-note/siyuan/issues/4876)
* [删除文档图标后默认图标不正确](https://github.com/siyuan-note/siyuan/issues/4879)
* [聚焦返回问题](https://github.com/siyuan-note/siyuan/issues/4882)
* [文档页签标题被 Emoji 覆盖](https://github.com/siyuan-note/siyuan/issues/4883)
* [API  `/api/block/updateBlock` 更新文档块为空的问题](https://github.com/siyuan-note/siyuan/issues/4884)
* [重命名文档动态锚文本未跟随](https://github.com/siyuan-note/siyuan/issues/4893)
* [创建日记问题](https://github.com/siyuan-note/siyuan/issues/4896)
* [移动端无法保存书签属性](https://github.com/siyuan-note/siyuan/issues/4899)
* [下载恢复备份问题](https://github.com/siyuan-note/siyuan/issues/4908)
* [同步过程中断导致的一致性问题](https://github.com/siyuan-note/siyuan/issues/4912)

## v2.0.8 / 2022-05-12

### 改进功能

* [块图标竖项排列时进行倒序](https://github.com/siyuan-note/siyuan/issues/4374)
* [下线旧版云端同步服务](https://github.com/siyuan-note/siyuan/issues/4749)
* [外观菜单修改为横排](https://github.com/siyuan-note/siyuan/issues/4757)
* [调整启动/退出时云端同步网络连接超时为 15s](https://github.com/siyuan-note/siyuan/issues/4847)
* [修改用户协议](https://github.com/siyuan-note/siyuan/issues/4849)
* [支持导入 Data 压缩包](https://github.com/siyuan-note/siyuan/issues/4850)
* [改进桌面端获取系统 ID 方式](https://github.com/siyuan-note/siyuan/issues/4851)
* [为超级块添加快捷键](https://github.com/siyuan-note/siyuan/issues/4853)
* [取消提示浮层移除延时](https://github.com/siyuan-note/siyuan/issues/4854)
* [云端同步接口使用 `443` 端口](https://github.com/siyuan-note/siyuan/issues/4862)
* [默认主题微调](https://github.com/siyuan-note/siyuan/issues/4869)
* [改进集市界面加载速度](https://github.com/siyuan-note/siyuan/issues/4873)
* [聚焦返回后定位到当前块](https://github.com/siyuan-note/siyuan/issues/4874)

### 开发重构

* [缓存引用元素](https://github.com/siyuan-note/siyuan/issues/4861)

### 修复缺陷

* [macOS/iOS 端监听资源文件报错导致启动卡住的问题](https://github.com/siyuan-note/siyuan/issues/4855)
* [Android 移动端导出 Data 未弹出下载](https://github.com/siyuan-note/siyuan/issues/4856)
* [嵌入块 SQL `LIMIT` 失效](https://github.com/siyuan-note/siyuan/issues/4858)
* [插入引用后立即修改定义块后引用锚文本未变化](https://github.com/siyuan-note/siyuan/issues/4859)
* [跨文档拖动列表项块后源文档状态异常](https://github.com/siyuan-note/siyuan/issues/4863)

## v2.0.7 / 2022-05-10

### 改进功能

* [钉住页签改进](https://github.com/siyuan-note/siyuan/issues/4839)
* [移动搜索带关键字时过滤笔记本](https://github.com/siyuan-note/siyuan/issues/4840)
* [文档修改时间展示使用 `updated` 属性](https://github.com/siyuan-note/siyuan/issues/4842)

### 修复缺陷

* [启动闪退](https://github.com/siyuan-note/siyuan/issues/4838)
* [全局搜索无法弹出](https://github.com/siyuan-note/siyuan/issues/4841)

## v2.0.6 / 2022-05-10

### 改进功能

* [钉住的页签使用 Emoji 或标题的第一个字](https://github.com/siyuan-note/siyuan/issues/4588)
* [文档树增加随机图标按钮](https://github.com/siyuan-note/siyuan/issues/4807)
* [改进移动端/Docker 端新版同步算法](https://github.com/siyuan-note/siyuan/issues/4818)
* [数据历史未展示最新的条目](https://github.com/siyuan-note/siyuan/issues/4820)
* [在设置外观中切换模式导致闪烁](https://github.com/siyuan-note/siyuan/issues/4824)
* [自动同步下载失败次数过多则调整同步间隔为 1 小时](https://github.com/siyuan-note/siyuan/issues/4827)
* [标签元素错误结构订正](https://github.com/siyuan-note/siyuan/issues/4829)
* [文档页签鼠标悬浮提示全路径](https://github.com/siyuan-note/siyuan/issues/4832)
* [数据变动后 30 秒进行一次同步](https://github.com/siyuan-note/siyuan/issues/4833)
* [桌面端同步加入快捷键 `F9`](https://github.com/siyuan-note/siyuan/issues/4834)
* [为合并超级块添加图标](https://github.com/siyuan-note/siyuan/issues/4835)
* [字体颜色添加多个最近使用](https://github.com/siyuan-note/siyuan/issues/4836)

### 修复缺陷

* [块标高亮无法自动消除](https://github.com/siyuan-note/siyuan/issues/4811)
* [删除文档以后数据库中的数据没有删除](https://github.com/siyuan-note/siyuan/issues/4819)
* [SQL 不支持字符串拼接操作](https://github.com/siyuan-note/siyuan/issues/4825)

## v2.0.5 / 2022-05-08

### 改进功能

* [改进反链面板标题下方块展现判断](https://github.com/siyuan-note/siyuan/issues/3438)
* [改进块引设置](https://github.com/siyuan-note/siyuan/issues/4793)
* [优化账号头像和背景图加载速度](https://github.com/siyuan-note/siyuan/issues/4801)
* [浏览器端支持导出完整 data 文件夹 zip 压缩包](https://github.com/siyuan-note/siyuan/issues/4803)
* [`Ctrl+F` 指定路径搜索加入 `包含子文档` 选项](https://github.com/siyuan-note/siyuan/issues/4805)
* [提升内核关闭速度](https://github.com/siyuan-note/siyuan/issues/4812)

### 修复缺陷

* [浏览器端锁屏后无法使用](https://github.com/siyuan-note/siyuan/issues/4794)
* [列表开头使用自定义 emojis 失效](https://github.com/siyuan-note/siyuan/issues/4795)
* [全局搜索时通过 ID 搜索不应该需要开启查询语法](https://github.com/siyuan-note/siyuan/issues/4796)
* [`Alt+1` 文档树焦点不对](https://github.com/siyuan-note/siyuan/issues/4797)
* [字体设置最近一次使用快捷键不对](https://github.com/siyuan-note/siyuan/issues/4799)
* [从搜索打开时文档树未自动定位](https://github.com/siyuan-note/siyuan/issues/4800)
* [块引排序问题](https://github.com/siyuan-note/siyuan/issues/4802)

## v2.0.4 / 2022-05-06

### 改进功能

* [支持查看和回滚资源文件历史](https://github.com/siyuan-note/siyuan/issues/3544)
* [代码块改进](https://github.com/siyuan-note/siyuan/issues/4737)
* [搜索过滤支持自定义属性开关](https://github.com/siyuan-note/siyuan/issues/4738)
* [搜索页签使用全文搜索实现](https://github.com/siyuan-note/siyuan/issues/4739)
* [数据库表 `blocks` 新增字段 `tag`](https://github.com/siyuan-note/siyuan/issues/4740)
* [搜索加入 ID 支持](https://github.com/siyuan-note/siyuan/issues/4741)
* [当光标移动到图表等块上时统一显示编辑和菜单按钮，取消其点击事件](https://github.com/siyuan-note/siyuan/issues/4742)
* [导入 Markdown 时避免所有块的 `created` 和 `updated` 一致](https://github.com/siyuan-note/siyuan/issues/4743)
* [反链提及搜索使用全文搜索实现](https://github.com/siyuan-note/siyuan/issues/4745)
* [统一历史数据存放位置为 `工作空间/history/`](https://github.com/siyuan-note/siyuan/issues/4750)
* [备份恢复时生成历史](https://github.com/siyuan-note/siyuan/issues/4752)
* [API 请求鉴权提示优化](https://github.com/siyuan-note/siyuan/issues/4753)
* [Alt+H 不在编辑器中时无效](https://github.com/siyuan-note/siyuan/issues/4756)
* [数据历史查看界面独立打开](https://github.com/siyuan-note/siyuan/issues/4764)
* [全局搜索加入单独的查询语法选项](https://github.com/siyuan-note/siyuan/issues/4767)
* [改进数据同步接口安全性](https://github.com/siyuan-note/siyuan/issues/4769)
* [使用备份恢复时自动暂停同步](https://github.com/siyuan-note/siyuan/issues/4773)
* [支持查看和回滚被删除的笔记本](https://github.com/siyuan-note/siyuan/issues/4775)
* [改进收集箱剪藏稳定性](https://github.com/siyuan-note/siyuan/issues/4777)
* [数据库 `content` 字段块级之间增加空格](https://github.com/siyuan-note/siyuan/issues/4780)
* [集市挂件名称过长遮挡星标](https://github.com/siyuan-note/siyuan/issues/4782)
* [为字体设置添加最近一次使用](https://github.com/siyuan-note/siyuan/issues/4792)

### 修复缺陷

* [使用 API `api/block/updateBlock` 更新列表项时渲染错误](https://github.com/siyuan-note/siyuan/issues/4658)
* [无法在下划线左侧粘贴](https://github.com/siyuan-note/siyuan/issues/4729)
* [搜索替换不支持包含符号的关键字](https://github.com/siyuan-note/siyuan/issues/4755)
* [嵌入块包含折叠标题时不应该显示其下方块](https://github.com/siyuan-note/siyuan/issues/4765)
* [到达文档树最大列出限制以后排序不正确](https://github.com/siyuan-note/siyuan/issues/4768)
* [在资源文件很多的情况下 macOS 端启动异常](https://github.com/siyuan-note/siyuan/issues/4770)
* [在行首输入 `$$` 数学公式无法渲染](https://github.com/siyuan-note/siyuan/issues/4774)
* [文档关系图不显示](https://github.com/siyuan-note/siyuan/issues/4776)
* [表格中行内公式使用下标时再次编辑时光标位置不对](https://github.com/siyuan-note/siyuan/issues/4784)
* [任务列表中无法使用鼠标选中文字](https://github.com/siyuan-note/siyuan/issues/4787)
* [文档转换标题时 block not found](https://github.com/siyuan-note/siyuan/issues/4791)

## v2.0.3 / 2022-04-29

### 改进功能

* [支持块引和块超链接的相互转化](https://github.com/siyuan-note/siyuan/issues/4628)
* [文档名支持搜索替换](https://github.com/siyuan-note/siyuan/issues/4667)
* [HTML 块若内容为空时无法在数据库中查询到](https://github.com/siyuan-note/siyuan/issues/4691)
* [外部修改已有资源文件后纳入云端同步](https://github.com/siyuan-note/siyuan/issues/4694)
* [改进桌面端新版同步算法](https://github.com/siyuan-note/siyuan/issues/4700)
* [全局搜索支持搜索自定义属性](https://github.com/siyuan-note/siyuan/issues/4711)
* [收集箱剪藏失败时保留链接](https://github.com/siyuan-note/siyuan/issues/4713)
* [剪藏扩展容错改进](https://github.com/siyuan-note/siyuan/issues/4716)
* [收集箱公众号输入按日期合并](https://github.com/siyuan-note/siyuan/issues/4718)
* [上架 OPPO 软件商店](https://github.com/siyuan-note/siyuan/issues/4719)
* [引用块为折叠块时，点击应缩放进入该块](https://github.com/siyuan-note/siyuan/issues/4727)
* [为订阅会员提供更快的集市包下载加速](https://github.com/siyuan-note/siyuan/issues/4728)
* [代码块语言样式改进 & 移除复制按钮](https://github.com/siyuan-note/siyuan/issues/4730)
* [ECharts 图表块将编辑代码的功能放到菜单中](https://github.com/siyuan-note/siyuan/issues/4732)
* [改进块引搜索时空格分隔多关键字处理](https://github.com/siyuan-note/siyuan/issues/4735)

### 修复缺陷

* [新版同步云端目录无法删除](https://github.com/siyuan-note/siyuan/issues/4712)
* [表格单元格中使用代码和 `|` 的问题](https://github.com/siyuan-note/siyuan/issues/4717)
* [新版同步下载报错 404 问题](https://github.com/siyuan-note/siyuan/issues/4721)
* [搜索折叠内容时面包屑显示错误](https://github.com/siyuan-note/siyuan/issues/4723)
* [在文档首插入代码块后三击后退格会删除下一个相邻块的内容](https://github.com/siyuan-note/siyuan/issues/4726)
* [引用文档时锚文本没有跟随文档重命名](https://github.com/siyuan-note/siyuan/issues/4731)
* [某些情况下缺失 `updated` 属性](https://github.com/siyuan-note/siyuan/issues/4733)
* [模板函数 `queryBlocks` 返回数量问题](https://github.com/siyuan-note/siyuan/issues/4734)

## v2.0.2 / 2022-04-27

### 改进功能

* [桌面端支持导出完整 data 文件夹 zip 压缩包 ](https://github.com/siyuan-note/siyuan/issues/4696)
* [导出时题头图放在文档标题前](https://github.com/siyuan-note/siyuan/issues/4708)

### 修复缺陷

* [旧版同步下载报错问题](https://github.com/siyuan-note/siyuan/issues/4701)
* [新版同步上传报错问题](https://github.com/siyuan-note/siyuan/issues/4702)
* [部分文档不能导出](https://github.com/siyuan-note/siyuan/issues/4704)
* [部分网页无法使用收集箱剪藏问题](https://github.com/siyuan-note/siyuan/issues/4705)
* [Windows 端悬浮菜单和顶部标题栏重合时无法点击](https://github.com/siyuan-note/siyuan/issues/4709)

## v2.0.1 / 2022-04-26

### 改进功能

* [导出时支持导出题头图](https://github.com/siyuan-note/siyuan/issues/4372)
* [公式块悬浮窗增加固定键](https://github.com/siyuan-note/siyuan/issues/4570)
* [绘图更新机制改进](https://github.com/siyuan-note/siyuan/issues/4580)
* [导出 PDF 时可选择不导出资源文件](https://github.com/siyuan-note/siyuan/issues/4649)
* [当光标不在表格区域中时表格无法被复制](https://github.com/siyuan-note/siyuan/issues/4661)
* [改进搜索过滤](https://github.com/siyuan-note/siyuan/issues/4663)
* [导出 Markdown 时去除公式内容中的首尾空格](https://github.com/siyuan-note/siyuan/issues/4666)
* [改进 `Ctrl+K` 超链接粘贴识别](https://github.com/siyuan-note/siyuan/issues/4669)
* [使用 API `getFile` 时自动解锁文件](https://github.com/siyuan-note/siyuan/issues/4674)
* [导出 PDF 文案改进及记录上一次选择](https://github.com/siyuan-note/siyuan/issues/4682)
* [新的数据同步实现](https://github.com/siyuan-note/siyuan/issues/4687)
* [全选块时弹出排版工具栏](https://github.com/siyuan-note/siyuan/issues/4688)
* [块引搜索默认使用双引号包裹](https://github.com/siyuan-note/siyuan/issues/4689)
* [提及搜索时纳入超链接锚文本](https://github.com/siyuan-note/siyuan/issues/4699)

### 移除功能

* [云端同步目录不再支持重命名](https://github.com/siyuan-note/siyuan/issues/4686)

### 修复缺陷

* [粘贴文本到带有输入框的 HTML 块后该块消失](https://github.com/siyuan-note/siyuan/issues/4600)
* [文档标题图标与文档第一个块图标重叠](https://github.com/siyuan-note/siyuan/issues/4659)
* [导出 PDF 未加载样式](https://github.com/siyuan-note/siyuan/issues/4665)
* [标题展开时进行动态加载导致重复内容](https://github.com/siyuan-note/siyuan/issues/4671)
* [搜狗输入法划选输入中文再撤销触发状态异常](https://github.com/siyuan-note/siyuan/issues/4672)
* [新工作空间初次同步下载或备份恢复时可能出现的报错](https://github.com/siyuan-note/siyuan/issues/4685)
* [跨块多选转换导致顺序错误](https://github.com/siyuan-note/siyuan/issues/4690)
* [三个空块合并的超级块导出模版后使用会变成两个块](https://github.com/siyuan-note/siyuan/issues/4692)

## v2.0.0 / 2022-04-22

### 引入特性

* [云端收集箱](https://github.com/siyuan-note/siyuan/issues/3718)
* [全局搜索支持查询语法](https://github.com/siyuan-note/siyuan/issues/4610)

### 改进功能

* [结束早鸟订阅优惠](https://github.com/siyuan-note/siyuan/issues/4286)
* [定义块引用计数浮窗高亮引用处锚文本](https://github.com/siyuan-note/siyuan/issues/4446)
* [启用伺服时显示本机所有网卡的 IP](https://github.com/siyuan-note/siyuan/issues/4526)
* [改进块引搜索排序规则](https://github.com/siyuan-note/siyuan/issues/4569)
* [公式块悬浮窗在输入时会跳回默认位置](https://github.com/siyuan-note/siyuan/issues/4572)
* [在 `DOM` 树中区分不同弹出搜索菜单](https://github.com/siyuan-note/siyuan/issues/4575)
* [表格改进](https://github.com/siyuan-note/siyuan/issues/4586)
* [支持使用 `* [ ]` 和 `* [x]` 创建任务列表](https://github.com/siyuan-note/siyuan/issues/4587)
* [为订阅续订操作提供更醒目的提示对话框](https://github.com/siyuan-note/siyuan/issues/4589)
* [网络代理支持 HTTP 协议](https://github.com/siyuan-note/siyuan/issues/4591)
* [emoji 面板中鼠标移动不会影响上下键对表情的选择](https://github.com/siyuan-note/siyuan/issues/4597)
* [增加反馈按钮](https://github.com/siyuan-note/siyuan/issues/4598)
* [为思源协议链接添加 Alt/Shift/Ctrl+Click 事件](https://github.com/siyuan-note/siyuan/issues/4602)
* [升级 KaTex 并调整其行间距](https://github.com/siyuan-note/siyuan/issues/4606)
* [浮窗改进](https://github.com/siyuan-note/siyuan/issues/4607)
* [代码块语法高亮支持  `yul`、`solidity` 和 `abap`](https://github.com/siyuan-note/siyuan/issues/4615)
* [推荐订阅送终身会员活动附加结束时间条件](https://github.com/siyuan-note/siyuan/issues/4616)
* [题头图上下调整使用百分比](https://github.com/siyuan-note/siyuan/issues/4626)
* [当存在链接时打开链接面板光标应该在锚文本上](https://github.com/siyuan-note/siyuan/issues/4627)
* [改进导出 Markdown 的请求端点](https://github.com/siyuan-note/siyuan/issues/4643)
* [改进自定义表情图片的请求端点](https://github.com/siyuan-note/siyuan/issues/4644)
* [改进静态资源请求端点](https://github.com/siyuan-note/siyuan/issues/4645)
* [废弃内核参数 `--servePath`](https://github.com/siyuan-note/siyuan/issues/4647)
* [选中图片后回车，应取消图片的选中状态](https://github.com/siyuan-note/siyuan/issues/4648)
* [改进代码块行号自适应](https://github.com/siyuan-note/siyuan/issues/4651)
* [下载集市包时展示进度](https://github.com/siyuan-note/siyuan/issues/4655)

### 开发重构

* [重制全局搜索](https://github.com/siyuan-note/siyuan/issues/4573)
* [降级 Electron](https://github.com/siyuan-note/siyuan/issues/4594)

### 修复缺陷

* [Windows 端窗口异常问题](https://github.com/siyuan-note/siyuan/issues/4545)
* [块引搜索条件为空时选择候选结果后没有创建块引](https://github.com/siyuan-note/siyuan/issues/4571)
* [不含有子项的列表项在折叠同级之后，不应带有折叠标记](https://github.com/siyuan-note/siyuan/issues/4576)
* [行级排版元素后软换行无法保存](https://github.com/siyuan-note/siyuan/issues/4583)
* [某些情况下缺失 `updated` 属性](https://github.com/siyuan-note/siyuan/issues/4584)
* [导出文档时未移除不支持的文件名符号](https://github.com/siyuan-note/siyuan/issues/4590)
* [选中文字后中文输入时删除字母后无法撤销](https://github.com/siyuan-note/siyuan/issues/4604)
* [行级公式 `$foo$1` 解析失败问题](https://github.com/siyuan-note/siyuan/issues/4605)
* [代码块使用 `Tab` 缩进后渲染异常](https://github.com/siyuan-note/siyuan/issues/4609)
* [合并过的表格无法在上方插入一行](https://github.com/siyuan-note/siyuan/issues/4613)
* [列表项和标题转换为文档后反链异常](https://github.com/siyuan-note/siyuan/issues/4625)
* [列表项-引述-列表-列表项 图标位置错误](https://github.com/siyuan-note/siyuan/issues/4631)
* [列表回车跳出后撤销光标位置不对](https://github.com/siyuan-note/siyuan/issues/4632)
* [Shift+Click 无法从下往上选](https://github.com/siyuan-note/siyuan/issues/4633)
* [从浮窗三击全选复制内容粘贴后触发状态异常](https://github.com/siyuan-note/siyuan/issues/4636)
* [PDF 标注浮窗引用重复](https://github.com/siyuan-note/siyuan/issues/4654)

## v1.9.9 / 2022-04-11

### 改进功能

* [反链提及转换为引用时支持选择静态锚文本](https://github.com/siyuan-note/siyuan/issues/4484)
* [`((` 引用时容器块显示子块内容](https://github.com/siyuan-note/siyuan/issues/4555)
* [`blocks` 表新增字段 `fcontent`](https://github.com/siyuan-note/siyuan/issues/4556)
* [改进列表折叠](https://github.com/siyuan-note/siyuan/issues/4557)
* [改进搜索排序规则](https://github.com/siyuan-note/siyuan/issues/4558)
* [自定义块属性名过长时无法完整显示](https://github.com/siyuan-note/siyuan/issues/4559)
* [移动面板路径全显示](https://github.com/siyuan-note/siyuan/issues/4564)

### 修复缺陷

* [空的行级元素删除后撤销触发状态异常](https://github.com/siyuan-note/siyuan/issues/4551)
* [云端图床部分内容删不掉](https://github.com/siyuan-note/siyuan/issues/4553)
* [调用模板 SQL 查询报错](https://github.com/siyuan-note/siyuan/issues/4554)
* [导出嵌入块时报错](https://github.com/siyuan-note/siyuan/issues/4561)
* [超级块和标题展开折叠出现问题](https://github.com/siyuan-note/siyuan/issues/4565)
* [拖拽如触发滚动后将无法进行移动](https://github.com/siyuan-note/siyuan/issues/4566)

## v1.9.8 / 2022-04-09

### 改进功能

* [支持查看和删除云端图床资源文件](https://github.com/siyuan-note/siyuan/issues/1674)
* [改进列表折叠](https://github.com/siyuan-note/siyuan/issues/4496)
* [集市 `preview.png` 图片预览不完整](https://github.com/siyuan-note/siyuan/issues/4512)
* [支持代码块高亮语言 `bat`, `graphql`；新增 felipec，intellij-light，tokyo-night-dark，tokyo-night-light 主题](https://github.com/siyuan-note/siyuan/issues/4525)
* [播放图片时会闪屏一次](https://github.com/siyuan-note/siyuan/issues/4529)
* [数据库表 `blocks` 中的 `length` 字段按 `content` 长度取值](https://github.com/siyuan-note/siyuan/issues/4530)
* [部分 Windows 端上卡顿的问题](https://github.com/siyuan-note/siyuan/issues/4533)
* [列表样式改进](https://github.com/siyuan-note/siyuan/issues/4535)
* [虚拟引用排除当前文档名](https://github.com/siyuan-note/siyuan/issues/4537)
* [`((` 引用候选中排除当前块的父块](https://github.com/siyuan-note/siyuan/issues/4538)
* [改进集市包预览图加载](https://github.com/siyuan-note/siyuan/issues/4540)
* [桌面端主窗体背景色设置为 `#FFF`](https://github.com/siyuan-note/siyuan/issues/4544)
* [改进搜索排序规则](https://github.com/siyuan-note/siyuan/issues/4546)
* [搜索框的类型开关优化](https://github.com/siyuan-note/siyuan/issues/4548)

### 开发重构

* [降级 Electron](https://github.com/siyuan-note/siyuan/issues/4532)

### 修复缺陷

* [集市包偶尔显示不完全](https://github.com/siyuan-note/siyuan/issues/4521)
* [鼠标右键单击段落中插入的自定义 `emojis` 时控制台输出异常](https://github.com/siyuan-note/siyuan/issues/4528)
* [`((` 引用列表项时使用第一个子块作为动态锚文本](https://github.com/siyuan-note/siyuan/issues/4536)
* [Ctrl+End 最后一个块无法加载](https://github.com/siyuan-note/siyuan/issues/4539)
* [输入内容无法保存](https://github.com/siyuan-note/siyuan/issues/4541)
* [查询嵌入块未禁止划选编辑](https://github.com/siyuan-note/siyuan/issues/4547)

## v1.9.7 / 2022-04-07

### 改进功能

* [统计云端数据同步和备份使用的上传和下载流量](https://github.com/siyuan-note/siyuan/issues/4182)
* [Docker 端支持网络代理选项](https://github.com/siyuan-note/siyuan/issues/4453)
* [改进鼠标悬浮提示文字的位置](https://github.com/siyuan-note/siyuan/issues/4460)
* [Docker 部署时如果没有设置 `--servePath` 参数则终止启动](https://github.com/siyuan-note/siyuan/issues/4463)
* [改进云端同步和备份稳定性](https://github.com/siyuan-note/siyuan/issues/4464)
* [搜索时 Ctrl+Enter 可打开新页签](https://github.com/siyuan-note/siyuan/issues/4492)
* [改进搜索排序](https://github.com/siyuan-note/siyuan/issues/4493)
* [移动端点击嵌入块直接跳转到正文](https://github.com/siyuan-note/siyuan/issues/4495)
* [挂件块支持内置属性 `命名`、`别名` 和 `备注` 搜索](https://github.com/siyuan-note/siyuan/issues/4497)
* [支持 HTML 块中使用 JavaScript](https://github.com/siyuan-note/siyuan/issues/4499)
* [同步统计信息支持多语言](https://github.com/siyuan-note/siyuan/issues/4502)
* [为复制嵌入块添加快捷键 Ctrl+Shift+E](https://github.com/siyuan-note/siyuan/issues/4505)
* [Linux 端支持 URL Scheme `siyuan://`](https://github.com/siyuan-note/siyuan/issues/4513)
* [移动端支持导出完整 data 文件夹 zip 压缩包](https://github.com/siyuan-note/siyuan/issues/4520)
* [支持播放 .webm 视频文件](https://github.com/siyuan-note/siyuan/issues/4522)
* [改进新建文档后的光标位置](https://github.com/siyuan-note/siyuan/issues/4524)

### 开发重构

* [升级 Electron](https://github.com/siyuan-note/siyuan/issues/4504)

### 修复缺陷

* [Alt+7 反链面板切换文档时没有触发刷新](https://github.com/siyuan-note/siyuan/issues/4414)
* [输入 6 个反引号 ` 后解析问题](https://github.com/siyuan-note/siyuan/issues/4426)
* [复制并粘贴 5 个反引号 ` 后点击触发状态异常](https://github.com/siyuan-note/siyuan/issues/4427)
* [生成的用户指南笔记本在文档树中排序异常](https://github.com/siyuan-note/siyuan/issues/4449)
* [带有输入框的 HTML 块每次输入一个字符就失焦](https://github.com/siyuan-note/siyuan/issues/4450)
* [XSS 安全漏洞](https://github.com/siyuan-note/siyuan/issues/4451)
* [非嵌入块的输入框中的 `隐藏标题下方的块` 开关未隐藏](https://github.com/siyuan-note/siyuan/issues/4454)
* [调整表格宽度时鼠标拖拽状态保留异常](https://github.com/siyuan-note/siyuan/issues/4455)
* [iPad 端块滑条无效](https://github.com/siyuan-note/siyuan/issues/4458)
* [空代码块中输入 `[]` 时变为任务列表](https://github.com/siyuan-note/siyuan/issues/4461)
* [划选后输入触发状态异常](https://github.com/siyuan-note/siyuan/issues/4465)
* [视频块点击进度无效](https://github.com/siyuan-note/siyuan/issues/4466)
* [点击动态加载条跳转到最后一个块后无法继续动态加载](https://github.com/siyuan-note/siyuan/issues/4467)
* [列表块删除后再撤销操作出现内容位置异常](https://github.com/siyuan-note/siyuan/issues/4468)
* [符号转义后无法被搜出](https://github.com/siyuan-note/siyuan/issues/4469)
* [划选多块撤销后没有充分还原](https://github.com/siyuan-note/siyuan/issues/4473)
* [点击大纲后再点击动态滚动条后，反链显示错误](https://github.com/siyuan-note/siyuan/issues/4475)
* [集市中同时支持浅色与深色模式的主题无法在过滤结果中同时显示](https://github.com/siyuan-note/siyuan/issues/4476)
* [标题和文档互转后大纲未刷新](https://github.com/siyuan-note/siyuan/issues/4477)
* [点击大纲后双击正文，面包屑高亮错误](https://github.com/siyuan-note/siyuan/issues/4482)
* [设置完属性后引用数会消失](https://github.com/siyuan-note/siyuan/issues/4485)
* [标题转换文档后文档标题状态错误](https://github.com/siyuan-note/siyuan/issues/4487)
* [折叠标题导出为模板后使用会出现内容重复](https://github.com/siyuan-note/siyuan/issues/4488)
* [API `appendBlock` 插入多块时顺序不正确](https://github.com/siyuan-note/siyuan/issues/4498)
* [焦点在表格中未能在文档树自动定位](https://github.com/siyuan-note/siyuan/issues/4500)
* [启动后同步按钮悬浮未显示统计信息](https://github.com/siyuan-note/siyuan/issues/4501)
* [移动无法搜索到新建的空笔记本](https://github.com/siyuan-note/siyuan/issues/4506)
* [iPad 无法设置字号](https://github.com/siyuan-note/siyuan/issues/4507)
* [关闭左侧分屏后重启会重置窗口布局](https://github.com/siyuan-note/siyuan/issues/4510)
* [云端同步服务宕机时不应该导致内核崩溃](https://github.com/siyuan-note/siyuan/issues/4518)
* [缩放后 F5 刷新文档会导致面包屑高亮错误](https://github.com/siyuan-note/siyuan/issues/4523)

## v1.9.6 / 2022-03-31

### 改进功能

* [HTML 块将编辑代码的功能放到菜单中](https://github.com/siyuan-note/siyuan/issues/4276)
* [嵌入块支持隐藏标题下方的块](https://github.com/siyuan-note/siyuan/issues/4404)
* [减小 Android/iOS 端安装包大小](https://github.com/siyuan-note/siyuan/issues/4416)
* [桌面端启用硬件加速](https://github.com/siyuan-note/siyuan/issues/4417)
* [改进标题折叠后的视觉](https://github.com/siyuan-note/siyuan/issues/4418)
* [剪切折叠标题后撤销，加载界面没有消失](https://github.com/siyuan-note/siyuan/issues/4420)
* [点击块标弹出菜单后，无法通过快捷键的方式操作块](https://github.com/siyuan-note/siyuan/issues/4421)
* [Microsoft Store 版支持 `siyuan://` 协议拉起应用](https://github.com/siyuan-note/siyuan/issues/4428)
* [悬浮窗光标在编辑器左侧无法显示图标](https://github.com/siyuan-note/siyuan/issues/4433)
* [改进云端同步和备份稳定性](https://github.com/siyuan-note/siyuan/issues/4436)
* [页签钉住后不显示取消钉住按钮](https://github.com/siyuan-note/siyuan/issues/4437)
* [反链提及转换为引用时使用动态锚文本](https://github.com/siyuan-note/siyuan/issues/4443)
* [反链提及转换为引用后自动刷新反链面板](https://github.com/siyuan-note/siyuan/issues/4444)
* [编辑器分屏视觉区隔](https://github.com/siyuan-note/siyuan/issues/4445)
* [为当前选中的编辑器页签添加高亮显示](https://github.com/siyuan-note/siyuan/issues/4447)

### 修复缺陷

* [PDF 页签 Ctrl+F 和全局搜索冲突](https://github.com/siyuan-note/siyuan/issues/4324)
* [默认折叠的块中代码块展开后不渲染行号](https://github.com/siyuan-note/siyuan/issues/4411)
* [手动安装挂件包后挂件集市无法打开的问题](https://github.com/siyuan-note/siyuan/issues/4415)
* [嵌入超级块时不应该展开其中的标题块](https://github.com/siyuan-note/siyuan/issues/4419)
* [全选删除包含折叠标题，删除后快速输入触发状态异常](https://github.com/siyuan-note/siyuan/issues/4422)
* [折叠标题后打开属性设置不显示](https://github.com/siyuan-note/siyuan/issues/4432)
* [iframe 块的资源不支持 `//` 开头的 URL](https://github.com/siyuan-note/siyuan/issues/4434)
* [部分同步报错未记录到日志文件中](https://github.com/siyuan-note/siyuan/issues/4435)
* [升级 PDF 库后的一些问题](https://github.com/siyuan-note/siyuan/issues/4439)
* [锚文本反链提及搜索不到问题](https://github.com/siyuan-note/siyuan/issues/4442)

## v1.9.5 / 2022-03-28

### 改进功能

* [预览图片时支持缩放和拖动视觉焦点位置](https://github.com/siyuan-note/siyuan/issues/2415)
* [预览图片支持切换上一张和下一张](https://github.com/siyuan-note/siyuan/issues/4223)
* [左右侧栏面板最小宽度限制](https://github.com/siyuan-note/siyuan/issues/4373)
* [订阅到期提醒](https://github.com/siyuan-note/siyuan/issues/4375)
* [减少代码块行号渲染抖动问题](https://github.com/siyuan-note/siyuan/issues/4377)
* [订阅到期后云端数据会被立即删除](https://github.com/siyuan-note/siyuan/issues/4379)
* [改进集市稳定性](https://github.com/siyuan-note/siyuan/issues/4381)
* [改进云端同步性能](https://github.com/siyuan-note/siyuan/issues/4383)
* [不允许在段首的块引用前进行软换行](https://github.com/siyuan-note/siyuan/issues/4386)
* [Android 端通过通知栏返回应用](https://github.com/siyuan-note/siyuan/issues/4392)
* [微信公众号编辑器无法抓取云端图床图片](https://github.com/siyuan-note/siyuan/issues/4396)
* [升级 PDF 库](https://github.com/siyuan-note/siyuan/issues/4398)
* [表格中全选为选中当前单元格](https://github.com/siyuan-note/siyuan/issues/4400)
* [桌面端禁用硬件加速](https://github.com/siyuan-note/siyuan/issues/4405)
* [反链面板图标在拖拽过程中不弹出悬浮层](https://github.com/siyuan-note/siyuan/issues/4407)

### 开发重构

* [更换内核使用的 HTTP 客户端库](https://github.com/siyuan-note/siyuan/issues/4380)
* [更换内核使用的缓存库](https://github.com/siyuan-note/siyuan/issues/4385)

### 修复缺陷

* [网络图片转本地图片失败](https://github.com/siyuan-note/siyuan/issues/4159)
* [行内公式渲染换行问题](https://github.com/siyuan-note/siyuan/issues/4334)
* [大纲面板条目中无法显示多个空格](https://github.com/siyuan-note/siyuan/issues/4370)
* [任务列表粘贴到表格中触发状态异常](https://github.com/siyuan-note/siyuan/issues/4371)
* [重启后通过引用打开的页签不应该进行聚焦](https://github.com/siyuan-note/siyuan/issues/4378)
* [从 VS Code 粘贴 HTML 时解析错误](https://github.com/siyuan-note/siyuan/issues/4382)
* [中西文插入空格导致内核崩溃](https://github.com/siyuan-note/siyuan/issues/4384)
* [Windows 端行级元素通过快捷键排版后输入中文撤销触发状态异常](https://github.com/siyuan-note/siyuan/issues/4388)
* [引用列表块时动态锚文本未跟随定义块内容变动](https://github.com/siyuan-note/siyuan/issues/4393)
* [iPad 端不能新建笔记本](https://github.com/siyuan-note/siyuan/issues/4395)
* [导出 Word .docx 失败](https://github.com/siyuan-note/siyuan/issues/4397)
* [任务列表内的块拖拽到其他笔记后原始位置无法输入](https://github.com/siyuan-note/siyuan/issues/4399)
* [Ant 停靠栏图标在 Windows 端下无法显示](https://github.com/siyuan-note/siyuan/issues/4401)
* [通过命名进行块引用时文本显示不同](https://github.com/siyuan-note/siyuan/issues/4402)
* [API `appendBlock` 插入多块时顺序不正确](https://github.com/siyuan-note/siyuan/issues/4409)

## v1.9.4 / 2022-03-24

### 改进功能

* [提供读写文件 API](https://github.com/siyuan-note/siyuan/issues/4343)
* [代码块中间换行，高亮错误](https://github.com/siyuan-note/siyuan/issues/4356)
* [文档重命名不阻塞](https://github.com/siyuan-note/siyuan/issues/4358)

### 开发重构

* [升级 Go 1.18](https://github.com/siyuan-note/siyuan/issues/4360)

### 修复缺陷

* [动态加载时 data-doc-type 错误](https://github.com/siyuan-note/siyuan/issues/4352)
* [划选引用搜索时触发状态异常](https://github.com/siyuan-note/siyuan/issues/4353)
* [仅包含一个单元格表头剪切后解析报错导致内核崩溃](https://github.com/siyuan-note/siyuan/issues/4354)
* [Adnroid 端无法插入大的资源文件](https://github.com/siyuan-note/siyuan/issues/4357)
* [折叠/展开标题撤销后状态不对](https://github.com/siyuan-note/siyuan/issues/4359)
* [标题更改层级时出现 HTML](https://github.com/siyuan-note/siyuan/issues/4365)

## v1.9.3 / 2022-03-22

### 改进功能

* [移动端复制粘贴问题](https://github.com/siyuan-note/siyuan/issues/3282)
* [划选文字引用搜索支持输入关键字](https://github.com/siyuan-note/siyuan/issues/3596)
* [光标在文档树上时支持 Ctrl+/ 唤起右键菜单，并支持对应的上下左右及回车操作](https://github.com/siyuan-note/siyuan/issues/4304)
* [调整云端获取集市哈希和版本检查接口](https://github.com/siyuan-note/siyuan/issues/4305)
* [续订时间不再限制 180 天后](https://github.com/siyuan-note/siyuan/issues/4307)
* [划选块引用时，禁止弹出浮窗](https://github.com/siyuan-note/siyuan/issues/4314)
* [重建索引时不再清理已过时索引](https://github.com/siyuan-note/siyuan/issues/4326)
* [桌面端点击大纲中的文档名可以定位至文档顶部](https://github.com/siyuan-note/siyuan/issues/4328)
* [使用 Sentry 自动上传报错信息和诊断数据](https://github.com/siyuan-note/siyuan/issues/4338)

### 修复缺陷

* [使用 API  `/api/block/appendBlock` 往超级块中插入内容后渲染错误](https://github.com/siyuan-note/siyuan/issues/4283)
* [使用 API `/api/block/prependBlock` 往任务列表项块中插入内容后解析异常](https://github.com/siyuan-note/siyuan/issues/4302)
* [云端同步空间大小判断问题](https://github.com/siyuan-note/siyuan/issues/4303)
* [选中块引用和文本时，剪切后有残余](https://github.com/siyuan-note/siyuan/issues/4313)
* [段首连续换行时结果不一致](https://github.com/siyuan-note/siyuan/issues/4315)
* [数据库 `spans` 表中上标元素 `type` 字段错误](https://github.com/siyuan-note/siyuan/issues/4316)
* [iPad 端 Shift+Enter 输入无效](https://github.com/siyuan-note/siyuan/issues/4317)
* [光标无法进入剪切之后剩下的空段落](https://github.com/siyuan-note/siyuan/issues/4321)
* [复制 Markdown 任务列表第一项为标题时错位](https://github.com/siyuan-note/siyuan/issues/4325)
* [移动端点击块引跳转后，无法后退到块引原文](https://github.com/siyuan-note/siyuan/issues/4327)
* [修改过标题后再次选中标题中的所有内容进行剪切，无法剪切整个标题](https://github.com/siyuan-note/siyuan/issues/4329)
* [锚文本提及无法转换为引用](https://github.com/siyuan-note/siyuan/issues/4336)
* [文档重命名不生效问题](https://github.com/siyuan-note/siyuan/issues/4339)
* [iPad 端切换页签大纲不会跟随切换](https://github.com/siyuan-note/siyuan/issues/4340)
* [新打开的块中选中内容后使用搜狗输入法输入，再撤销会状态异常](https://github.com/siyuan-note/siyuan/issues/4341)
* [容器块在顶层内容删除后撤销导致状态异常](https://github.com/siyuan-note/siyuan/issues/4342)

## v1.9.2 / 2022-03-18

### 改进功能

* [表格支持最后一个单元格使用 Tab 添加下一行](https://github.com/siyuan-note/siyuan/issues/4235)
* [光标在文档树等面板中，按 Esc 回到编辑器中](https://github.com/siyuan-note/siyuan/issues/4289)
* [支持订阅续订](https://github.com/siyuan-note/siyuan/issues/4290)
* [图片顶部对齐](https://github.com/siyuan-note/siyuan/issues/4292)
* [当块选中且折叠时，使用上下键不应选择其折叠块](https://github.com/siyuan-note/siyuan/issues/4294)

### 文档相关

* [改进导入导出帮助文档](https://github.com/siyuan-note/siyuan/issues/4287)

### 修复缺陷

* [动态渲染的长文档后退问题](https://github.com/siyuan-note/siyuan/issues/3528)
* [标题折叠没有折叠下方最后一个块](https://github.com/siyuan-note/siyuan/issues/4288)
* [导入 Markdown 文件夹时卡住](https://github.com/siyuan-note/siyuan/issues/4295)
* [块引用后软换行异常](https://github.com/siyuan-note/siyuan/issues/4296)

## v1.9.1 / 2022-03-17

### 改进功能

* [改进标题和列表折叠](https://github.com/siyuan-note/siyuan/issues/4213)
* [移动端只读状态下折叠和展开操作提示](https://github.com/siyuan-note/siyuan/issues/4232)
* [标签批量删除](https://github.com/siyuan-note/siyuan/issues/4239)
* [仅含有行级 HTML 标签的 HTML 块导出为模板后再导入会渲染为段落块](https://github.com/siyuan-note/siyuan/issues/4244)
* [书签面板和标签面板上的删除操作增加确认对话框](https://github.com/siyuan-note/siyuan/issues/4257)
* [折叠后光标移到被折叠块上](https://github.com/siyuan-note/siyuan/issues/4265)
* [折叠列表下删除改进](https://github.com/siyuan-note/siyuan/issues/4277)
* [折叠的列表项无法通过鼠标多选](https://github.com/siyuan-note/siyuan/issues/4279)
* [数据库 `spans` 表中超链接元素的 `markdown` 字段未保存为超链接 markdown 文本](https://github.com/siyuan-note/siyuan/issues/4280)
* [表格超长时粘贴会自动调整至最左侧](https://github.com/siyuan-note/siyuan/issues/4281)

### 开发重构

* [CSS 类 `b3-text-filed` 系列重命名为 `b3-text-field`](https://github.com/siyuan-note/siyuan/issues/4247)
* [重构锁机制](https://github.com/siyuan-note/siyuan/issues/4269)

### 移除功能

* [移除自动版本更新检查](https://github.com/siyuan-note/siyuan/issues/4252)

### 修复缺陷

* [代码块里面剪切时触发前文 `#` 号标签搜索以及剪切抖动](https://github.com/siyuan-note/siyuan/issues/4212)
* [导入 Markdown 文件内核连接中断](https://github.com/siyuan-note/siyuan/issues/4241)
* [文档重命名后有时文档树没有刷新](https://github.com/siyuan-note/siyuan/issues/4243)
* [HTML 块复制/剪切后粘贴，块内容转义与解析错误](https://github.com/siyuan-note/siyuan/issues/4245)
* [代码块中回车后滚动位置计算错误](https://github.com/siyuan-note/siyuan/issues/4254)
* [创建文档时标题未转义 `"`](https://github.com/siyuan-note/siyuan/issues/4256)
* [标签转义问题](https://github.com/siyuan-note/siyuan/issues/4258)
* [代码块光标错误](https://github.com/siyuan-note/siyuan/issues/4261)
* [列表项下代码块中按 `↓` 时光标移动问题](https://github.com/siyuan-note/siyuan/issues/4262)
* [数学公式后无法显示光标](https://github.com/siyuan-note/siyuan/issues/4263)
* [块引打开文档动态加载不全](https://github.com/siyuan-note/siyuan/issues/4264)
* [右键弹出菜单错误](https://github.com/siyuan-note/siyuan/issues/4266)
* [新开页签定位错误](https://github.com/siyuan-note/siyuan/issues/4267)
* [嵌入块标题错误显示为 HTML 块](https://github.com/siyuan-note/siyuan/issues/4268)
* [拖拽文档排序后位置不正确](https://github.com/siyuan-note/siyuan/issues/4270)
* [创建列表项触发状态异常](https://github.com/siyuan-note/siyuan/issues/4271)
* [移动端没有渲染 HTML 块](https://github.com/siyuan-note/siyuan/issues/4273)
* [代码块中出现分隔线解析错误](https://github.com/siyuan-note/siyuan/issues/4275)

## v1.9.0 / 2022-03-14

### 引入特性

* [书签重命名](https://github.com/siyuan-note/siyuan/issues/3924)
* [支持 HTML 块](https://github.com/siyuan-note/siyuan/issues/4023)

### 改进功能

* [思源超链接支持浮窗预览](https://github.com/siyuan-note/siyuan/issues/3302)
* [编辑区宽度较小时块标弹出动画多次播放](https://github.com/siyuan-note/siyuan/issues/4166)
* [将挂件的 `src` 与 `data-src` 属性由完整超链接更换为伺服根路径的绝对路径](https://github.com/siyuan-note/siyuan/issues/4206)
* [公式输入框高度随编辑内容自动调整](https://github.com/siyuan-note/siyuan/issues/4215)
* [思源协议块超链接加入 `focus` 参数](https://github.com/siyuan-note/siyuan/issues/4221)
* [表格同时合并第一、二行时，可能会使第二行也成为表头](https://github.com/siyuan-note/siyuan/issues/4224)
* [光标在块左侧时也需显示块标](https://github.com/siyuan-note/siyuan/issues/4225)
* [增加快捷键获得当前文档的人类可读路径](https://github.com/siyuan-note/siyuan/issues/4226)
* [降低文档重命名后文档树改变的延迟](https://github.com/siyuan-note/siyuan/issues/4228)
* [增加根据 ID 获取人类可读路径 API](https://github.com/siyuan-note/siyuan/issues/4229)

### 修复缺陷

* [折叠标题后未触发动态加载](https://github.com/siyuan-note/siyuan/issues/4168)
* [使用 iframe 块嵌入挂件时部分操作会触发选中块并导致运行时异常](https://github.com/siyuan-note/siyuan/issues/4172)
* [代码块粘贴代码时会出现闪烁问题并且光标被移动到最后](https://github.com/siyuan-note/siyuan/issues/4202)
* [如果在一个块的上方嵌入该块，会导致无法正常修改原块的样式](https://github.com/siyuan-note/siyuan/issues/4204)
* [Windows 端下键无法触发滚动](https://github.com/siyuan-note/siyuan/issues/4208)
* [标签面板中的条目内容未转义](https://github.com/siyuan-note/siyuan/issues/4209)
* [粘贴块引时未转义锚文本](https://github.com/siyuan-note/siyuan/issues/4210)
* [文档标题空格粘贴操作出现空格异常](https://github.com/siyuan-note/siyuan/issues/4214)
* [标签比较长时自动补全不应该使用 `...` 省略](https://github.com/siyuan-note/siyuan/issues/4218)
* [重建索引时卡住](https://github.com/siyuan-note/siyuan/issues/4222)
* [折叠列表后回车没有创建新列表项](https://github.com/siyuan-note/siyuan/issues/4227)
* [块聚焦时提及面板点击转换引用块没反应](https://github.com/siyuan-note/siyuan/issues/4230)
* [列表中行级公式后进行退格会增加换行](https://github.com/siyuan-note/siyuan/issues/4233)
* [端到端加密密码设置后提示不对](https://github.com/siyuan-note/siyuan/issues/4236)

## v1.8.9 / 2022-03-09

### 改进功能

* [内容块支持两侧对齐方式](https://github.com/siyuan-note/siyuan/issues/3419)
* [微软商店版任务栏图标问题](https://github.com/siyuan-note/siyuan/issues/4139)
* [编辑器空标题光标无法进入](https://github.com/siyuan-note/siyuan/issues/4167)
* [调整编辑器单个资源文件插入最大限制为 4G](https://github.com/siyuan-note/siyuan/issues/4198)
* [优化数学公式、图表等渲染块编辑窗的弹出方式](https://github.com/siyuan-note/siyuan/issues/4199)

### 修复缺陷

* [切换笔记时如果光标在表格中大纲不会自动刷新](https://github.com/siyuan-note/siyuan/issues/4171)
* [选中图片后输入下一行，图片依然是选中状态](https://github.com/siyuan-note/siyuan/issues/4173)
* [块属性备注栏 Ctrl+Z 撤销不撤销备注栏内容而撤销文档内容](https://github.com/siyuan-note/siyuan/issues/4179)
* [导出 `data-export-md` 时未解析代码块与行内代码内的转义字符](https://github.com/siyuan-note/siyuan/issues/4180)
* [代码块编辑光标乱跳和一些历史遗留问题](https://github.com/siyuan-note/siyuan/issues/4190)
* [引用文档时锚文本没有跟随文档重命名](https://github.com/siyuan-note/siyuan/issues/4193)
* [某些版本的 Windows 无法同步](https://github.com/siyuan-note/siyuan/issues/4197)
* [iPad 端启动偶尔白屏的问题](https://github.com/siyuan-note/siyuan/issues/4200)

## v1.8.8 / 2022-03-08

### 改进功能

* [折叠按钮点击过快优化](https://github.com/siyuan-note/siyuan/issues/4163)
* [改进云端数据同步服务稳定性](https://github.com/siyuan-note/siyuan/issues/4185)

### 文档相关

* [改进云端同步文档](https://github.com/siyuan-note/siyuan/issues/4176)

### 修复缺陷

* [图片居中后光标消失，无法通过 `Ctrl+Shift+↑/↓` 移动块](https://github.com/siyuan-note/siyuan/issues/3091)
* [使用 API 插入空代码块后在其中粘贴时会粘贴至其外部](https://github.com/siyuan-note/siyuan/issues/4143)
* [空的 `<kbd>` 无法删除](https://github.com/siyuan-note/siyuan/issues/4162)
* [代码块编辑出现抖动](https://github.com/siyuan-note/siyuan/issues/4164)
* [使用 API `/api/block/updateBlock` 无法更新文档块](https://github.com/siyuan-note/siyuan/issues/4165)
* [表格中行内代码后换行问题](https://github.com/siyuan-note/siyuan/issues/4169)
* [启动后大纲显示为空](https://github.com/siyuan-note/siyuan/issues/4178)
* [中西文插入空格后代码块出现块 ID](https://github.com/siyuan-note/siyuan/issues/4184)
* [Pagedown 无法加载](https://github.com/siyuan-note/siyuan/issues/4189)

## v1.8.7 / 2022-03-05

### 改进功能

* [列表项和标题折叠小三角](https://github.com/siyuan-note/siyuan/issues/3125)
* [Windows 端 PDF 导出代码块行号对不齐](https://github.com/siyuan-note/siyuan/issues/4148)
* [存储时剔除文档标题首尾空格](https://github.com/siyuan-note/siyuan/issues/4150)
* [代码块代码中划选后隐藏其他块内容划选触发的浮动工具条](https://github.com/siyuan-note/siyuan/issues/4152)
* [拖拽上下分屏会导致滚动条滚动](https://github.com/siyuan-note/siyuan/issues/4155)

### 修复缺陷

* [macOS 端全屏幕后切换主题模式会导致工具栏左侧出现空白](https://github.com/siyuan-note/siyuan/issues/4132)
* [复制块到表格触发状态异常](https://github.com/siyuan-note/siyuan/issues/4141)
* [拖入资源文件到表格里会记录到上一个块里](https://github.com/siyuan-note/siyuan/issues/4146)
* [列表编辑时动态加载触发状态异常](https://github.com/siyuan-note/siyuan/issues/4151)

## v1.8.6 / 2022-03-03

### 改进功能

* [Android 端上架小米应用商店](https://github.com/siyuan-note/siyuan/issues/3946)
* [`Ctrl+End/Home` 调整为在整个文档范围生效](https://github.com/siyuan-note/siyuan/issues/4108)
* [在文档块的 DOM 中添加文档块属性](https://github.com/siyuan-note/siyuan/issues/4117)
* [设置与搜索栏中的类型过滤相互独立](https://github.com/siyuan-note/siyuan/issues/4129)
* [代码块行号和数学公式导出 PDF 改进](https://github.com/siyuan-note/siyuan/issues/4133)
* [`Alt+M` 隐藏窗口时不在任务栏上显示](https://github.com/siyuan-note/siyuan/issues/4138)

### 修复缺陷

* [通过 Markdown 语法插入超级块时属性设置错误问题](https://github.com/siyuan-note/siyuan/issues/4068)
* [粘贴文本到行级元素时插入位置不正确](https://github.com/siyuan-note/siyuan/issues/4118)
* [移动端通过伺服下载某些主题后无法打开](https://github.com/siyuan-note/siyuan/issues/4127)
* [Markdwon 导入时 URL 编码后的图片地址导入失败](https://github.com/siyuan-note/siyuan/issues/4130)
* [macOS 中`Shift+Home/End` 范围选择错误及相关文档修改](https://github.com/siyuan-note/siyuan/issues/4135)

## v1.8.5 / 2022-02-28

### 改进功能

* [Android 端上架华为应用市场](https://github.com/siyuan-note/siyuan/issues/4041)
* [Android 端上架酷安](https://github.com/siyuan-note/siyuan/issues/4092)
* [表格外部左右测禁止输入](https://github.com/siyuan-note/siyuan/issues/4105)
* [禁止在分隔线、嵌入块、数学公式、iframe、音频、视频和图表渲染块内输入中文](https://github.com/siyuan-note/siyuan/issues/4114)
* [改进某些情况下数据下载解密失败问题](https://github.com/siyuan-note/siyuan/issues/4115)
* [浏览器剪藏扩展支持大尺寸数据网页](https://github.com/siyuan-note/siyuan/issues/4116)
* [数学公式块上下对齐问题](https://github.com/siyuan-note/siyuan/issues/4119)
* [导出 HTML/PDF 支持渲染表格合并单元格](https://github.com/siyuan-note/siyuan/issues/4121)
* [浏览器剪藏扩展不申请剪切板读取权限](https://github.com/siyuan-note/siyuan/issues/4125)

### 文档相关

* [上线官网英文版](https://github.com/siyuan-note/siyuan/issues/4103)

### 修复缺陷

* [表格左右滚动时隐藏所选单元格](https://github.com/siyuan-note/siyuan/issues/4099)
* [含标题行的拆分单元格错位](https://github.com/siyuan-note/siyuan/issues/4102)
* [跨表头合并单元格错误](https://github.com/siyuan-note/siyuan/issues/4106)
* [表格居中时选中效果渲染错位](https://github.com/siyuan-note/siyuan/issues/4107)
* [表格居中时无法对单元格宽度进行拖拽](https://github.com/siyuan-note/siyuan/issues/4111)
* [`/` 后输入 `引用块` 和 `引述` 没有候选结果](https://github.com/siyuan-note/siyuan/issues/4112)
* [脑图、图表删除再撤销后无法显示](https://github.com/siyuan-note/siyuan/issues/4113)
* [导出 PDF 数学公式没有居中](https://github.com/siyuan-note/siyuan/issues/4120)

## v1.8.4 / 2022-02-25

### 改进功能

* [ECharts 和 Mindmap 支持高度设定](https://github.com/siyuan-note/siyuan/issues/2896)
* [Windows 端上架 Microsoft Store](https://github.com/siyuan-note/siyuan/issues/3950)
* [iPad 端文档点导出 Markdown 没反应](https://github.com/siyuan-note/siyuan/issues/4013)
* [表格支持合并拆分单元格](https://github.com/siyuan-note/siyuan/issues/4022)
* [取消表格列自定义宽度](https://github.com/siyuan-note/siyuan/issues/4038)
* [Android 端初次安装可选择拒绝隐私政策](https://github.com/siyuan-note/siyuan/issues/4046)
* [设置 - 账号链滴社区服务协议与隐私条款改为勾选同意](https://github.com/siyuan-note/siyuan/issues/4048)
* [支持长表格导出 PDF](https://github.com/siyuan-note/siyuan/issues/4050)
* [导出 PDF 时代码块应保持折行](https://github.com/siyuan-note/siyuan/issues/4051)
* [数学公式渲染改进](https://github.com/siyuan-note/siyuan/issues/4053)
* [多选时禁止按键操作](https://github.com/siyuan-note/siyuan/issues/4061)
* [折叠的块导出 HTML/PDF 时固定展开](https://github.com/siyuan-note/siyuan/issues/4064)
* [关于中提供隐私政策和用户协议查看入口](https://github.com/siyuan-note/siyuan/issues/4066)
* [移动端设置 - 账号中提供账号注销功能](https://github.com/siyuan-note/siyuan/issues/4067)
* [custom.css 编辑或通过外观设置修改后自动刷新](https://github.com/siyuan-note/siyuan/issues/4069)
* [改进特殊情况下大纲需点击两次的问题](https://github.com/siyuan-note/siyuan/issues/4070)
* [折叠列表子内容，按回车不会新建列表项](https://github.com/siyuan-note/siyuan/issues/4074)
* [Excel 粘贴时第一个单元格会出现换行](https://github.com/siyuan-note/siyuan/issues/4083)
* [录音采样率调整为 44100](https://github.com/siyuan-note/siyuan/issues/4085)
* [Android 端编辑状态下键盘上方遮挡](https://github.com/siyuan-note/siyuan/issues/4086)
* [图表块标菜单中不应出现代码块](https://github.com/siyuan-note/siyuan/issues/4093)
* [集市包下载超时调整为两分钟](https://github.com/siyuan-note/siyuan/issues/4096)

### 文档相关

* [API 英文文档](https://github.com/siyuan-note/siyuan/issues/4095)

### 移除功能

* [Android 端移除录音功能](https://github.com/siyuan-note/siyuan/issues/4065)

### 修复缺陷

* [桌面端更新版本时没有结束老内核进程](https://github.com/siyuan-note/siyuan/issues/4039)
* [列表项下标题剪切问题](https://github.com/siyuan-note/siyuan/issues/4040)
* [挂件编辑问题](https://github.com/siyuan-note/siyuan/issues/4072)
* [Android 端长按扩选后复制内容不全](https://github.com/siyuan-note/siyuan/issues/4073)
* [当标题有 `#` 的时候导出 Markdown 失败](https://github.com/siyuan-note/siyuan/issues/4075)
* [不关闭思源几天后可能出现账号鉴权失败](https://github.com/siyuan-note/siyuan/issues/4080)
* [代码块折叠后下方输入文字错误](https://github.com/siyuan-note/siyuan/issues/4087)
* [有序列表项插入行再撤销后序号错误](https://github.com/siyuan-note/siyuan/issues/4088)
* [有序列表项拖拽、撤销再删除后导致的状态异常](https://github.com/siyuan-note/siyuan/issues/4089)

## v1.8.2 / 2022-02-13

### 改进功能

* [Android 端上架 Google Play](https://github.com/siyuan-note/siyuan/issues/4006)
* [开源 iOS 端](https://github.com/siyuan-note/siyuan/issues/4007)
* [移除编辑器光标置于空白行时的提示文案](https://github.com/siyuan-note/siyuan/issues/4015)
* [点击图表交互时不应该触发代码编辑](https://github.com/siyuan-note/siyuan/issues/4016)
* [表格支持调整列宽](https://github.com/siyuan-note/siyuan/issues/4018)
* [`Tab 空格数` 文案修改，提示不会修改复制的内容](https://github.com/siyuan-note/siyuan/issues/4033)
* [Android 端沉浸式状态栏](https://github.com/siyuan-note/siyuan/issues/4034)
* [导出 PDF/Word 时 IFrame 块使用超链接](https://github.com/siyuan-note/siyuan/issues/4035)

### 文档相关

* [更新隐私政策](https://github.com/siyuan-note/siyuan/issues/4017)
* [Android/iOS 开源协议使用 AGPLv3](https://github.com/siyuan-note/siyuan/issues/4036)

### 开发重构

* [重命名内核可执行文件](https://github.com/siyuan-note/siyuan/issues/4026)

### 修复缺陷

* [Android 7 无法打开程序](https://github.com/siyuan-note/siyuan/issues/4010)
* [操作系统休眠重进后卡在加载界面的问题](https://github.com/siyuan-note/siyuan/issues/4024)
* [网络图片转换为本地资源文件文件名不合法问题](https://github.com/siyuan-note/siyuan/issues/4027)
* [/fgx 光标错误](https://github.com/siyuan-note/siyuan/issues/4032)
* [分隔线复制会触发状态异常](https://github.com/siyuan-note/siyuan/issues/4037)

## v1.8.1 / 2022-02-08

### 改进功能

* [加回 Ctrl+P 并对其进行优化](https://github.com/siyuan-note/siyuan/issues/3991)
* [查找替换支持代码、公式和超链接](https://github.com/siyuan-note/siyuan/issues/3992)
* [升级五线谱 abcjs](https://github.com/siyuan-note/siyuan/issues/3993)
* [Ctrl+Shift+F 通过上下键切换选择的搜索内容](https://github.com/siyuan-note/siyuan/issues/3997)
* [Android 端状态栏和全屏状态调整](https://github.com/siyuan-note/siyuan/issues/3998)
* [开源 Android 端](https://github.com/siyuan-note/siyuan/issues/4000)
* [图片之前的空行无法删除](https://github.com/siyuan-note/siyuan/issues/4003)
* [Android 端首次运行弹窗展示 `隐私条款` 和 `使用授权`](https://github.com/siyuan-note/siyuan/issues/4004)

### 文档相关

* [用户指南 - 快捷键文档内容重复](https://github.com/siyuan-note/siyuan/issues/3995)

### 开发重构

* [Android 端升级 SDK 到 12.0](https://github.com/siyuan-note/siyuan/issues/3996)
* [Android 端最低版本要求从 5.1 改为 6.0](https://github.com/siyuan-note/siyuan/issues/3999)

### 修复缺陷

* [三次点击块内部不能选中一句话而是光标跳到了下一行](https://github.com/siyuan-note/siyuan/issues/4005)

## v1.8.0 / 2022-02-05

### 引入特性

* [挂件](https://github.com/siyuan-note/siyuan/issues/1488)
* [挂件集市](https://github.com/siyuan-note/siyuan/issues/1489)
* [支持查找替换](https://github.com/siyuan-note/siyuan/issues/3180)

### 改进功能

* [跨页滚动多选提示](https://github.com/siyuan-note/siyuan/issues/2066)
* [移动功能加入快捷键](https://github.com/siyuan-note/siyuan/issues/3977)
* [设置 - 搜索文案改进](https://github.com/siyuan-note/siyuan/issues/3980)
* [改进一个块中 Shift + 上下光标跨行选中](https://github.com/siyuan-note/siyuan/issues/3981)
* [块引搜索条件为空时去重](https://github.com/siyuan-note/siyuan/issues/3987)
* [提供 32 位的 Android 端安装包](https://github.com/siyuan-note/siyuan/issues/3988)

### 修复缺陷

* [导出 PDF 文件时表格分页表头错位](https://github.com/siyuan-note/siyuan/issues/3374)
* [iOS 中文输入法无法保存内容](https://github.com/siyuan-note/siyuan/issues/3978)
* [合并、取消超级块时，嵌入块会复制多一份结果](https://github.com/siyuan-note/siyuan/issues/3984)
* [列表块撤销状态异常](https://github.com/siyuan-note/siyuan/issues/3985)

## v1.7.11 / 2022-02-02

### 改进功能

* [iOS 主题和安全距离适配](https://github.com/siyuan-note/siyuan/issues/3642)
* [改进同步开关交互](https://github.com/siyuan-note/siyuan/issues/3953)
* [网络图片转换本地资源文件支持 http 协议](https://github.com/siyuan-note/siyuan/issues/3975)

### 修复缺陷

* [查询嵌入块刷新问题](https://github.com/siyuan-note/siyuan/issues/3967)
* [点击集市包 README 中的一些链接导致白屏](https://github.com/siyuan-note/siyuan/issues/3968)
* [Shift+Click 在同一块内无法选中](https://github.com/siyuan-note/siyuan/issues/3970)
* [网络图片转换为本地资源文件丢失后缀问题](https://github.com/siyuan-note/siyuan/issues/3972)
* [移动折叠标题后倒序问题](https://github.com/siyuan-note/siyuan/issues/3973)

## v1.7.10 / 2022-01-31

### 改进功能

* [创建文档副本](https://github.com/siyuan-note/siyuan/issues/2790)
* [挂件块数据导出属性 `data-export-md`](https://github.com/siyuan-note/siyuan/issues/3834)
* [云端同步自动检查间隔改为 5 分钟一次](https://github.com/siyuan-note/siyuan/issues/3948)
* [内核退出时清理临时文件](https://github.com/siyuan-note/siyuan/issues/3955)
* [将文档中的网络图片转换为本地资源文件](https://github.com/siyuan-note/siyuan/issues/3959)
* [切换主题时如果该主题存在 theme.js 则直接刷新界面](https://github.com/siyuan-note/siyuan/issues/3963)
* [集市包 README 渲染不启用软换行转换硬换行](https://github.com/siyuan-note/siyuan/issues/3966)

### 修复缺陷

* [大于 100MB 的文件不应该计入云端空间大小检查](https://github.com/siyuan-note/siyuan/issues/3945)
* [点击集市包 README 中的一些链接导致白屏](https://github.com/siyuan-note/siyuan/issues/3951)
* [部分集市包 README 乱码](https://github.com/siyuan-note/siyuan/issues/3954)
* [键入 SQL 查询后焦点没有自动跳转到 SQL 编辑框内](https://github.com/siyuan-note/siyuan/issues/3956)
* [分割线中也可以输入文字](https://github.com/siyuan-note/siyuan/issues/3958)

## v1.7.9 / 2022-01-28

### 改进功能

* [iOS 端上架 App Store](https://github.com/siyuan-note/siyuan/issues/2800)
* [改进集市](https://github.com/siyuan-note/siyuan/issues/3500)
* [改进端到端加密密码设置后的提示文案](https://github.com/siyuan-note/siyuan/issues/3926)
* [切换主题的时候通过 theme.js 增加的元素不会被清除](https://github.com/siyuan-note/siyuan/issues/3927)
* [选中的文本为链接时 Ctrl+K 不使用剪切板中的链接](https://github.com/siyuan-note/siyuan/issues/3928)
* [使用 API 创建笔记本时返回新建的笔记本的 ID](https://github.com/siyuan-note/siyuan/issues/3934)
* [折叠后展开位置不对](https://github.com/siyuan-note/siyuan/issues/3935)
* [被外部锁文件时提示 `未找到 ID 为 [xxx] 的内容块` 改进](https://github.com/siyuan-note/siyuan/issues/3936)

### 修复缺陷

* [文档树面板和编辑器焦点切换问题](https://github.com/siyuan-note/siyuan/issues/3929)
* [Tooltip 拖拽后显示异常的问题](https://github.com/siyuan-note/siyuan/issues/3930)
* [使用 API 插入空字符串出现错误](https://github.com/siyuan-note/siyuan/issues/3931)
* [文档末尾粘贴时可能触发重复的动态加载](https://github.com/siyuan-note/siyuan/issues/3932)
* [代码块三击复制问题](https://github.com/siyuan-note/siyuan/issues/3940)
* [列表项行级公式结尾回车问题](https://github.com/siyuan-note/siyuan/issues/3942)

## v1.7.8 / 2022-01-25

### 改进功能

* [多个视频相邻时 Shift+Click 多选无效](https://github.com/siyuan-note/siyuan/issues/3026)
* [支持配置 PlantUML 服务器地址](https://github.com/siyuan-note/siyuan/issues/3671)
* [上传资源文件到云端如果失败需要提示](https://github.com/siyuan-note/siyuan/issues/3917)
* [默认限制创建文档层级最大深度为 7 层](https://github.com/siyuan-note/siyuan/issues/3919)

### 修复缺陷

* [表格中难以在行内公式之前插入文字](https://github.com/siyuan-note/siyuan/issues/3908)
* [按住 Shift 试图多选失败](https://github.com/siyuan-note/siyuan/issues/3916)
* [XSS 安全漏洞](https://github.com/siyuan-note/siyuan/issues/3918)
* [云端同步报错 500 问题](https://github.com/siyuan-note/siyuan/issues/3920)

## v1.7.7 / 2022-01-23

### 改进功能

* [iOS 端短时间关闭屏幕会出现内核中断](https://github.com/siyuan-note/siyuan/issues/3775)
* [Windows 端安装程序工作空间确认框弹出一次](https://github.com/siyuan-note/siyuan/issues/3888)
* [iOS 端时区问题](https://github.com/siyuan-note/siyuan/issues/3892)
* [设置搜索不到 `标签` 和 `Pandoc`](https://github.com/siyuan-note/siyuan/issues/3894)
* [Android 端状态栏不隐藏](https://github.com/siyuan-note/siyuan/issues/3900)
* [提升 Android 端启动速度](https://github.com/siyuan-note/siyuan/issues/3902)
* [“在中英文间插入空格”功能对行内公式不生效](https://github.com/siyuan-note/siyuan/issues/3905)

### 开发重构

* [升级 Electron](https://github.com/siyuan-note/siyuan/issues/3886)

### 修复缺陷

* [打开文档并定位文档所在位置后打开日记，文档树会全部折叠](https://github.com/siyuan-note/siyuan/issues/3217)
* [代码块后用中文输入法格式会乱](https://github.com/siyuan-note/siyuan/issues/3885)
* [一些系统上播放多媒体文件崩溃的问题](https://github.com/siyuan-note/siyuan/issues/3887)
* [引用文件夹被误计入未引用资源](https://github.com/siyuan-note/siyuan/issues/3889)
* [三击列表项编辑时出现运行时异常](https://github.com/siyuan-note/siyuan/issues/3891)
* [移动端只读模式光标插入符问题](https://github.com/siyuan-note/siyuan/issues/3893)
* [导入 Markdown 后有时界面会卡死](https://github.com/siyuan-note/siyuan/issues/3895)
* [移动端帮助文档有时无法打开](https://github.com/siyuan-note/siyuan/issues/3901)

## v1.7.6 / 2022-01-21

### 改进功能

* [优化编辑器光标移动](https://github.com/siyuan-note/siyuan/issues/3274)
* [图片支持单击后 Delete/Backspace 删除](https://github.com/siyuan-note/siyuan/issues/3530)
* [文档编辑器 `...` 菜单中新增 `中西文间插入空格` 格式化功能](https://github.com/siyuan-note/siyuan/issues/3873)
* [桌面端支持设置 Pandoc 可执行文件路径](https://github.com/siyuan-note/siyuan/issues/3874)
* [通过 Pandoc 导出 Word .docx 文件](https://github.com/siyuan-note/siyuan/issues/3875)
* [改进安装包下载分发网络](https://github.com/siyuan-note/siyuan/issues/3883)

### 修复缺陷

* [导出 PDF 时行内加粗/行内斜体内的行内公式消失](https://github.com/siyuan-note/siyuan/issues/3866)
* [题头图调整移动以后图片会被计入未引用资源](https://github.com/siyuan-note/siyuan/issues/3880)
* [上下键无法选中数学公式和视频](https://github.com/siyuan-note/siyuan/issues/3881)
* [资源文件上传 API 在未指定 `assetsDirPath` 时存放路径不正确](https://github.com/siyuan-note/siyuan/issues/3882)

## v1.7.5 / 2022-01-20

### 改进功能

* [支持题头图上下拖动调整位置](https://github.com/siyuan-note/siyuan/issues/2805)
* [主题支持加载 theme.js](https://github.com/siyuan-note/siyuan/issues/3856)
* [顶部工具栏标题居中](https://github.com/siyuan-note/siyuan/issues/3868)
* [新增按 Markdown 导出 HTML](https://github.com/siyuan-note/siyuan/issues/3872)
* [大纲面板中的块标视觉调整](https://github.com/siyuan-note/siyuan/issues/3876)

### 文档相关

* [新增微信提醒帮助文档](https://github.com/siyuan-note/siyuan/issues/3877)

### 修复缺陷

* [字体加颜色并添加块引用后无法插入字符](https://github.com/siyuan-note/siyuan/issues/3103)
* [使用 `[]`  输入任务列表时会导致父级列表被清空](https://github.com/siyuan-note/siyuan/issues/3639)
* [在某些版本的 Windows 上无法正常进入应用](https://github.com/siyuan-note/siyuan/issues/3813)
* [导出 Markdown 不应该带超级块语法](https://github.com/siyuan-note/siyuan/issues/3867)

## v1.7.4 / 2022-01-19

### 改进功能

* [全局搜索支持类型过滤](https://github.com/siyuan-note/siyuan/issues/2229)
* [标签面板排序](https://github.com/siyuan-note/siyuan/issues/2877)
* [调整桌面端顶部工具栏](https://github.com/siyuan-note/siyuan/issues/3849)
* [空标签数据订正](https://github.com/siyuan-note/siyuan/issues/3858)
* [标签重命名判空](https://github.com/siyuan-note/siyuan/issues/3859)
* [:emoji 提示面板高度自适应](https://github.com/siyuan-note/siyuan/issues/3860)
* [启动应用时转圈动画改为静态图片](https://github.com/siyuan-note/siyuan/issues/3861)
* [拖拽分屏添加动效](https://github.com/siyuan-note/siyuan/issues/3865)

### 修复缺陷

* [数学公式回车光标错误](https://github.com/siyuan-note/siyuan/issues/3850)
* [快捷键修改后无法保存](https://github.com/siyuan-note/siyuan/issues/3855)

## v1.7.3 / 2022-01-17

### 改进功能

* [标签重命名](https://github.com/siyuan-note/siyuan/issues/844)
* [相同文档分屏后，大纲、引用块点击无法定位到当前激活的文档中](https://github.com/siyuan-note/siyuan/issues/3498)
* [ctrl+shift+f 改为全局快捷键](https://github.com/siyuan-note/siyuan/issues/3833)
* [文档树展开不丝滑](https://github.com/siyuan-note/siyuan/issues/3835)
* [属性过长过多时仅显示一行](https://github.com/siyuan-note/siyuan/issues/3837)
* [以下操作再次按快捷键时界面关闭](https://github.com/siyuan-note/siyuan/issues/3839)
* [ctrl+w, ctrl+f, ctr+shiftl+f 使用时不需点击编辑器](https://github.com/siyuan-note/siyuan/issues/3840)
* [Windows 端安装程序执行前弹出确认框](https://github.com/siyuan-note/siyuan/issues/3842)
* [设置书签属性后编辑器内将书签渲染在命名左侧](https://github.com/siyuan-note/siyuan/issues/3843)
* [emoji 搜索时移除分类](https://github.com/siyuan-note/siyuan/issues/3844)

### 修复缺陷

* [PDF 导出不了图片](https://github.com/siyuan-note/siyuan/issues/3829)
* [加载图标和主题使用文件夹名称而不是 json 配置中的名称](https://github.com/siyuan-note/siyuan/issues/3830)
* [编辑器内属性值未转义](https://github.com/siyuan-note/siyuan/issues/3836)
* [包含子文档时无法转换为标题的判断不正确](https://github.com/siyuan-note/siyuan/issues/3841)
* [数学公式后连续回车，列表不会进行反向缩进](https://github.com/siyuan-note/siyuan/issues/3846)

## v1.7.2 / 2022-01-15

### 改进功能

* [改进页签滚动条](https://github.com/siyuan-note/siyuan/issues/3670)
* [插入链接时的一个小问题](https://github.com/siyuan-note/siyuan/issues/3719)
* [移动文档后不再自动展开目标文档](https://github.com/siyuan-note/siyuan/issues/3764)
* [钉住的页签不显示斜体](https://github.com/siyuan-note/siyuan/issues/3819)
* [Windows 端在缺失 robocopy 命令的情况下使用内置实现](https://github.com/siyuan-note/siyuan/issues/3822)
* [主题和图标加载时带上版本号](https://github.com/siyuan-note/siyuan/issues/3827)
* [HTML/PDF 导出标签样式](https://github.com/siyuan-note/siyuan/issues/3828)

### 文档相关

* [端到端加密具体内容说明](https://github.com/siyuan-note/siyuan/issues/3824)

### 移除功能

* [移除 `![foo](data:image)` 图片解析支持](https://github.com/siyuan-note/siyuan/issues/2750)
* [移除幻灯片演示](https://github.com/siyuan-note/siyuan/issues/3817)
* [移除发光和彩色字体效果](https://github.com/siyuan-note/siyuan/issues/3818)
* [移除中西文间自动插入空格](https://github.com/siyuan-note/siyuan/issues/3826)

### 修复缺陷

* [文档树鼠标悬浮显示的文档备注未转义](https://github.com/siyuan-note/siyuan/issues/3820)
* [使用非默认主题无法导出 HTML](https://github.com/siyuan-note/siyuan/issues/3823)

## v1.7.1 / 2022-01-14

### 改进功能

* [PDF 标注导出锚文本选项](https://github.com/siyuan-note/siyuan/issues/3068)
* [导出 PDF 支持设置一些参数](https://github.com/siyuan-note/siyuan/issues/3337)
* [Linux 上无法导出 PDF](https://github.com/siyuan-note/siyuan/issues/3635)
* [搜索页签添加历史](https://github.com/siyuan-note/siyuan/issues/3794)
* [导出 HTML 时保留块属性](https://github.com/siyuan-note/siyuan/issues/3796)
* [导出 HTML 时自包含 js/css 和 assets](https://github.com/siyuan-note/siyuan/issues/3797)
* [导出 PDF 和 HTML 时支持超级块横排](https://github.com/siyuan-note/siyuan/issues/3798)
* [导出 PDF 支持空格导出](https://github.com/siyuan-note/siyuan/issues/3799)
* [云端备份上传去掉中间的确认框](https://github.com/siyuan-note/siyuan/issues/3802)
* [Alt+5 创建日记后光标应保持在用户可见区域内](https://github.com/siyuan-note/siyuan/issues/3806)
* [拖拽标题后大纲没有更新](https://github.com/siyuan-note/siyuan/issues/3807)
* [切换页签/搜索打开页签后大纲没有高亮](https://github.com/siyuan-note/siyuan/issues/3808)
* [微信提醒设置后进行消息提示](https://github.com/siyuan-note/siyuan/issues/3809)

### 移除功能

* [移除 Word .docx 导出](https://github.com/siyuan-note/siyuan/issues/3811)

### 修复缺陷

* [设置属性命名后复制为引用块不生效](https://github.com/siyuan-note/siyuan/issues/3795)
* [钉住页签在开启 `在当前页签中打开` 功能时失效](https://github.com/siyuan-note/siyuan/issues/3800)
* [菜单点击后不消失](https://github.com/siyuan-note/siyuan/issues/3801)
* [某些版本的 Windows 系统上每次同步时都会上传很多文件](https://github.com/siyuan-note/siyuan/issues/3814)
* [文档树鼠标悬浮文档时不显示命名备注](https://github.com/siyuan-note/siyuan/issues/3815)
* [移动端冒号输入表情错误](https://github.com/siyuan-note/siyuan/issues/3816)

## v1.7.0 / 2022-01-11

### 引入特性

* [切换页签](https://github.com/siyuan-note/siyuan/issues/533)
* [钉住页签](https://github.com/siyuan-note/siyuan/issues/640)
* [支持网络链接题头图](https://github.com/siyuan-note/siyuan/issues/2951)
* [移动端支持切换文档树排序模式](https://github.com/siyuan-note/siyuan/issues/3036)
* [新增 `prependBlock` 和 `appendBlock` API](https://github.com/siyuan-note/siyuan/issues/3751)
* [支持自动生成端到端加密密码](https://github.com/siyuan-note/siyuan/issues/3790)

### 改进功能

* [去除下拉列表中初始自带的书签](https://github.com/siyuan-note/siyuan/issues/3690)
* [iOS 反链、大纲面板无法滚动](https://github.com/siyuan-note/siyuan/issues/3755)
* [同步后进行增量索引](https://github.com/siyuan-note/siyuan/issues/3763)
* [改进移动包含大量子文档层级的文档时的性能](https://github.com/siyuan-note/siyuan/issues/3767)
* [来自 127.0.0.1 的本机资源文件请求不鉴权](https://github.com/siyuan-note/siyuan/issues/3771)
* [移动端大纲点击后不应刷新界面](https://github.com/siyuan-note/siyuan/issues/3774)
* [反链提及过滤中加入文档名](https://github.com/siyuan-note/siyuan/issues/3776)
* [剪藏扩展时间格式改为 `yyyy-MM-dd HH:mm:ss`](https://github.com/siyuan-note/siyuan/issues/3779)
* [延迟显示块标菜单提示](https://github.com/siyuan-note/siyuan/issues/3781)
* [设置 - 账号加入个人主页背景图](https://github.com/siyuan-note/siyuan/issues/3785)
* [`insertBlock` API 支持多块插入](https://github.com/siyuan-note/siyuan/issues/3786)
* [启动应用时的云端同步过程动态显示](https://github.com/siyuan-note/siyuan/issues/3788)
* [云端同步和备份下载数据时先使用索引文件验证解密](https://github.com/siyuan-note/siyuan/issues/3789)

### 开发重构

* [降级 Electron ](https://github.com/siyuan-note/siyuan/issues/3783)

### 移除功能

* [移除同步间隔设置](https://github.com/siyuan-note/siyuan/issues/3793)

### 修复缺陷

* [复制粘贴块后创建时间小于更新时间](https://github.com/siyuan-note/siyuan/issues/3624)
* [开启访问授权以后导出 PDF/Word 时图片丢失](https://github.com/siyuan-note/siyuan/issues/3765)
* [移动带子文档的文档时日志报错](https://github.com/siyuan-note/siyuan/issues/3766)
* [反链面板请求响应顺序问题](https://github.com/siyuan-note/siyuan/issues/3770)
* [一些系统上播放多媒体文件崩溃的问题](https://github.com/siyuan-note/siyuan/issues/3784)

## v1.6.3 / 2022-01-06

### 改进功能

* [面包屑缩略悬浮预览](https://github.com/siyuan-note/siyuan/issues/2858)
* [同步/备份限制单个文件最大为 100MB](https://github.com/siyuan-note/siyuan/issues/3747)
* [移除 Rsync 统一使用 HTTPS 实现同步](https://github.com/siyuan-note/siyuan/issues/3750)
* [改进云端服务网络稳定性](https://github.com/siyuan-note/siyuan/issues/3752)
* [工作空间路径支持中文和空格](https://github.com/siyuan-note/siyuan/issues/3754)
* [云端同步目录最多支持 7 个](https://github.com/siyuan-note/siyuan/issues/3756)

### 修复缺陷

* [移动面板无法使用上下键](https://github.com/siyuan-note/siyuan/issues/3745)
* [文档名的虚拟引用提示不存在符合条件的内容块](https://github.com/siyuan-note/siyuan/issues/3748)
* [Cannot access `showCreateConfDirErrBox` ](https://github.com/siyuan-note/siyuan/issues/3749)
* [macOS 上文档数量较多时索引失败](https://github.com/siyuan-note/siyuan/issues/3761)
* [多设备同步时文件存在冗余的下载请求](https://github.com/siyuan-note/siyuan/issues/3762)

## v1.6.2 / 2022-01-04

### 改进功能

* [移动块时更新修改时间](https://github.com/siyuan-note/siyuan/issues/3567)
* [块标菜单增加 `移动`](https://github.com/siyuan-note/siyuan/issues/3725)
* [~/.config/ 权限不足需弹窗告诉用户](https://github.com/siyuan-note/siyuan/issues/3730)
* [调整云端服务网络架构](https://github.com/siyuan-note/siyuan/issues/3737)
* [大纲项显示对不齐](https://github.com/siyuan-note/siyuan/issues/3739)
* [超链接悬浮显示链接+标题](https://github.com/siyuan-note/siyuan/issues/3740)
* [移动端添加 API token 的显示和复制](https://github.com/siyuan-note/siyuan/issues/3742)

### 修复缺陷

* [笔记本名称为空时无法导出](https://github.com/siyuan-note/siyuan/issues/3729)
* [PDF 搜索无结果时显示错误](https://github.com/siyuan-note/siyuan/issues/3733)
* [同一文档分屏后拖拽问题](https://github.com/siyuan-note/siyuan/issues/3741)
* [大纲未渲染行级元素](https://github.com/siyuan-note/siyuan/issues/3743)
* [PDF 页签切换导致渲染异常](https://github.com/siyuan-note/siyuan/issues/3744)

## v1.6.1 / 2022-01-02

### 改进功能

* [为超链接输入框中加入标题输入框](https://github.com/siyuan-note/siyuan/issues/3586)
* [文档属性的多行备注预览被遮挡](https://github.com/siyuan-note/siyuan/issues/3721)

### 修复缺陷

* [iframe、嵌入块标菜单失效](https://github.com/siyuan-note/siyuan/issues/3722)
* [文档标签重复入库问题](https://github.com/siyuan-note/siyuan/issues/3723)
* [图片和超链接标题 `"` 未转义问题](https://github.com/siyuan-note/siyuan/issues/3724)
* [快速删除文字后再撤销错误](https://github.com/siyuan-note/siyuan/issues/3727)

## v1.6.0 / 2022-01-01

### 引入特性

* [移动端显示大纲](https://github.com/siyuan-note/siyuan/issues/2921)
* [提供插入块、更新块和删除块的 API](https://github.com/siyuan-note/siyuan/issues/3334)
* [微信提醒推送](https://github.com/siyuan-note/siyuan/issues/3457)
* [移动端显示反向链接](https://github.com/siyuan-note/siyuan/issues/3683)

### 改进功能

* [支持设置虚拟引用搜索过滤](https://github.com/siyuan-note/siyuan/issues/3049)
* [标签面板添加引用计数](https://github.com/siyuan-note/siyuan/issues/3330)
* [发起互联网服务请求时进行标准化处理](https://github.com/siyuan-note/siyuan/issues/3685)
* [托盘菜单添加显示主界面](https://github.com/siyuan-note/siyuan/issues/3687)
* [cpp 代码高亮渲染错误](https://github.com/siyuan-note/siyuan/issues/3695)
* [云端备份不再包括历史](https://github.com/siyuan-note/siyuan/issues/3698)
* [Windows 端安装时可选择仅为当前用户安装](https://github.com/siyuan-note/siyuan/issues/3702)
* [提及关键字搜索最大支持 512 个](https://github.com/siyuan-note/siyuan/issues/3715)

### 开发重构

* [升级 Electron](https://github.com/siyuan-note/siyuan/issues/3699)
* [移除 blocks_fts 虚拟表](https://github.com/siyuan-note/siyuan/issues/3708)

### 修复缺陷

* [浮窗中面包屑消失后不会重显](https://github.com/siyuan-note/siyuan/issues/3694)
* [``` 后粘贴回导致状态异常](https://github.com/siyuan-note/siyuan/issues/3701)
* [macOS 端界面图标不显示](https://github.com/siyuan-note/siyuan/issues/3703)
* [`/` 菜单点击插入图片链接无响应](https://github.com/siyuan-note/siyuan/issues/3710)
* [搜索资源文件时显示错位的问题](https://github.com/siyuan-note/siyuan/issues/3711)

## v1.5.6 / 2021-12-29

### 改进功能

* [引用块和嵌入块搜索结果左侧缩略优化](https://github.com/siyuan-note/siyuan/issues/3492)
* [`/` 菜单加入插入图片或文件](https://github.com/siyuan-note/siyuan/issues/3536)
* [`/` 菜单加入创建子文档](https://github.com/siyuan-note/siyuan/issues/3542)
* [编辑时不显示面包屑导航](https://github.com/siyuan-note/siyuan/issues/3622)
* [支持设置反链提及搜索过滤](https://github.com/siyuan-note/siyuan/issues/3652)
* [改进面包屑导航加载性能](https://github.com/siyuan-note/siyuan/issues/3684)
* [Windows 端安装时默认为所有用户安装](https://github.com/siyuan-note/siyuan/issues/3686)
* [自定义表情不随标题大小进行变化](https://github.com/siyuan-note/siyuan/issues/3691)

### 文档相关

* [繁体中文帮助文档](https://github.com/siyuan-note/siyuan/issues/3675)

### 开发重构

* [升级 Electron](https://github.com/siyuan-note/siyuan/issues/3682)

### 修复缺陷

* [复制公式块时的转义问题](https://github.com/siyuan-note/siyuan/issues/3626)
* [导出 Markdown 时缺少带空格文件名的资源文件](https://github.com/siyuan-note/siyuan/issues/3679)
* [预览中公式编号位置错误](https://github.com/siyuan-note/siyuan/issues/3681)
* [云端同步时出现全量传输的问题](https://github.com/siyuan-note/siyuan/issues/3688)
* [导出预览不显示自定义表情](https://github.com/siyuan-note/siyuan/issues/3692)
* [Windows 端同步文件权限问题](https://github.com/siyuan-note/siyuan/issues/3693)

## v1.5.5 / 2021-12-26

### 改进功能

* [多选块外观设置](https://github.com/siyuan-note/siyuan/issues/3037)
* [增加区分默认图标和自定义图标样式类](https://github.com/siyuan-note/siyuan/issues/3270)
* [Ctrl 点击多选块](https://github.com/siyuan-note/siyuan/issues/3300)
* [SQL 不支持字符串拼接操作](https://github.com/siyuan-note/siyuan/issues/3312)
* [iOS 端点击超链接跳转浏览器](https://github.com/siyuan-note/siyuan/issues/3388)
* [优化层级较深的列表下保存数据的性能](https://github.com/siyuan-note/siyuan/issues/3495)
* [自动切换同步方式，提升同步可用性](https://github.com/siyuan-note/siyuan/issues/3503)
* [改进数据一致性](https://github.com/siyuan-note/siyuan/issues/3508)
* [搜索界面反向链接浮窗被遮挡](https://github.com/siyuan-note/siyuan/issues/3515)
* [降低编辑时的 CPU 占用](https://github.com/siyuan-note/siyuan/issues/3521)
* [对自定义 emoji 搜索结果进行匹配优先排序](https://github.com/siyuan-note/siyuan/issues/3525)
* [降低导入 Markdown 文件夹内存占用](https://github.com/siyuan-note/siyuan/issues/3531)
* [插入资源文件时允许下划线](https://github.com/siyuan-note/siyuan/issues/3534)
* [导出 Word 时支持通过属性设置 Pandoc 参数](https://github.com/siyuan-note/siyuan/issues/3535)
* [剪藏扩展自动滚动页面加载图片](https://github.com/siyuan-note/siyuan/issues/3537)
* [搜索页签改为上下布局](https://github.com/siyuan-note/siyuan/issues/3538)
* [数学公式编号遮挡](https://github.com/siyuan-note/siyuan/issues/3541)
* [Windows 上代码签名仅支持 SHA256 算法](https://github.com/siyuan-note/siyuan/issues/3543)
* [iOS 端息屏后内核退出，再次进入时重新拉起内核](https://github.com/siyuan-note/siyuan/issues/3545)
* [Android 端顶部适配打孔屏](https://github.com/siyuan-note/siyuan/issues/3548)
* [工具栏和停靠栏调大](https://github.com/siyuan-note/siyuan/issues/3554)
* [改进块引锚文本实现方式以提升稳定性和性能](https://github.com/siyuan-note/siyuan/issues/3561)
* [固定优先使用数据库](https://github.com/siyuan-note/siyuan/issues/3568)
* [集市中主题安装后不应该再显示下载按钮](https://github.com/siyuan-note/siyuan/issues/3570)
* [为数学公式提供字体变量 `--b3-font-family-math`](https://github.com/siyuan-note/siyuan/issues/3571)
* [反链面板用户调整过布局后将不再自动计算](https://github.com/siyuan-note/siyuan/issues/3584)
* [shift+click 和 alt+click 调整](https://github.com/siyuan-note/siyuan/issues/3585)
* [Rsync 传输设置 30m 超时](https://github.com/siyuan-note/siyuan/issues/3593)
* [移动端提供退出应用按钮](https://github.com/siyuan-note/siyuan/issues/3594)
* [启动时不再根据内置主题自动合并 custom.css ](https://github.com/siyuan-note/siyuan/issues/3597)
* [新增模板函数 `parseTime`](https://github.com/siyuan-note/siyuan/issues/3605)
* [页签样式修改](https://github.com/siyuan-note/siyuan/issues/3606)
* [切换引用后链接光标丢失](https://github.com/siyuan-note/siyuan/issues/3609)
* [启动时不再根据数据内容校验是否直接使用数据库](https://github.com/siyuan-note/siyuan/issues/3615)
* [云端备份下载并恢复由手动重启改为自动重建索引](https://github.com/siyuan-note/siyuan/issues/3616)
* [IPAD思源无法卸载主题，卸载APP后重装仍然有](https://github.com/siyuan-note/siyuan/issues/3619)
* [iOS 支持打开 Excel 和 Word](https://github.com/siyuan-note/siyuan/issues/3625)
* [集市更新包时进行数据覆盖提示](https://github.com/siyuan-note/siyuan/issues/3632)
* [改进集市加载和下载速度](https://github.com/siyuan-note/siyuan/issues/3633)
* [升级 mermaid，支持用户图、git 图、类图、实体关系图](https://github.com/siyuan-note/siyuan/issues/3636)
* [表格出现滚动条时，在末尾输入数字后滚动条会向前移动](https://github.com/siyuan-note/siyuan/issues/3650)
* [支持复制块 ID](https://github.com/siyuan-note/siyuan/issues/3656)
* [反向链接、书签、标签和关系图刷新按钮动效](https://github.com/siyuan-note/siyuan/issues/3672)

### 开发重构

* [新增 blocks_fts 虚拟表用于全文检索](https://github.com/siyuan-note/siyuan/issues/3591)

### 移除功能

* [移除导入时对 `[[Wikilink]]` 和 `#Tag` 的转换处理](https://github.com/siyuan-note/siyuan/issues/3557)
* [移除文档树笔记本级重建索引](https://github.com/siyuan-note/siyuan/issues/3611)

### 修复缺陷

* [Android 开关网络伺服后未自动退出](https://github.com/siyuan-note/siyuan/issues/3509)
* [折叠展开导致的内核崩溃](https://github.com/siyuan-note/siyuan/issues/3510)
* [自定义排序后新建的文档排序不一致](https://github.com/siyuan-note/siyuan/issues/3511)
* [集市包版本更新但不出现更新按钮问题](https://github.com/siyuan-note/siyuan/issues/3513)
* [分屏情况下，全屏后文章显示错误](https://github.com/siyuan-note/siyuan/issues/3514)
* [云端空间大小显示问题](https://github.com/siyuan-note/siyuan/issues/3524)
* [图片光标乱跳问题](https://github.com/siyuan-note/siyuan/issues/3527)
* [引用嵌套导出问题](https://github.com/siyuan-note/siyuan/issues/3540)
* [macOS 端打开时报错](https://github.com/siyuan-note/siyuan/issues/3546)
* [在一些 Windows 系统上 SSH 同步报错](https://github.com/siyuan-note/siyuan/issues/3549)
* [折叠标题后转换为段落丢失原标题下方块](https://github.com/siyuan-note/siyuan/issues/3551)
* [反链面板搜索后 `显示更多` 无效](https://github.com/siyuan-note/siyuan/issues/3552)
* [跨笔记本反向链接不全](https://github.com/siyuan-note/siyuan/issues/3555)
* [导出为模板时空引述问题](https://github.com/siyuan-note/siyuan/issues/3577)
* [iOS 搜索面板无法滚动](https://github.com/siyuan-note/siyuan/issues/3580)
* [存在两处 XSS](https://github.com/siyuan-note/siyuan/issues/3587)
* [图表导出转义问题](https://github.com/siyuan-note/siyuan/issues/3589)
* [【【 输入锚文本后 shift+enter 无效](https://github.com/siyuan-note/siyuan/issues/3590)
* [无法关闭自动更新检查](https://github.com/siyuan-note/siyuan/issues/3599)
* [自动清理历史遗漏了 data/.siyuan/history](https://github.com/siyuan-note/siyuan/issues/3602)
* [无法搜索到 iframe 块、视频块和音频块](https://github.com/siyuan-note/siyuan/issues/3604)
* [iOS 端有时无法滚动进行动态加载](https://github.com/siyuan-note/siyuan/issues/3608)
* [iPhone 上 PDF 无法滚动和退出](https://github.com/siyuan-note/siyuan/issues/3610)
* [嵌入块中脚本换行时导出为模板后不能正确解析](https://github.com/siyuan-note/siyuan/issues/3629)
* [代码块 mermaid 不显示](https://github.com/siyuan-note/siyuan/issues/3641)
* [表格内复制、样式问题](https://github.com/siyuan-note/siyuan/issues/3649)
* [macOS 鼠须管输入法在 `$x+y$` 后面无法输入内容](https://github.com/siyuan-note/siyuan/issues/3651)

## v1.5.4 / 2021-11-28

### 改进功能

* [编辑器全屏后，其余编辑器也需要全屏](https://github.com/siyuan-note/siyuan/issues/2239)
* [优化列表项粘贴到列表中](https://github.com/siyuan-note/siyuan/issues/2591)
* [选中文本按 `Ctrl Alt A` 快速设置命名](https://github.com/siyuan-note/siyuan/issues/2702)
* [增加插入代码块的快捷键](https://github.com/siyuan-note/siyuan/issues/3409)
* [降低数据索引内存占用](https://github.com/siyuan-note/siyuan/issues/3439)
* [窗口最小化时，思源协议无法唤起窗口](https://github.com/siyuan-note/siyuan/issues/3447)
* [编辑器全屏后，为面包屑添加双击和拖拽](https://github.com/siyuan-note/siyuan/issues/3451)
* [Shift+Enter 换行在导出为 Markdown 时使用硬换行](https://github.com/siyuan-note/siyuan/issues/3458)
* [模板和挂件搜索跳过 `.` 开头的文件](https://github.com/siyuan-note/siyuan/issues/3461)
* [PDF 支持 Ctrl + 鼠标滚轮进行缩放](https://github.com/siyuan-note/siyuan/issues/3462)
* [:: 后不进行表情提示](https://github.com/siyuan-note/siyuan/issues/3464)
* [减少表情提示数量，以减少卡顿](https://github.com/siyuan-note/siyuan/issues/3466)
* [统一内核 booting 启动界面](https://github.com/siyuan-note/siyuan/issues/3467)
* [前进后退和文本块引搜索快捷键修改](https://github.com/siyuan-note/siyuan/issues/3468)
* [移动端图片宽度菜单显示不完全](https://github.com/siyuan-note/siyuan/issues/3469)
* [每个 PDF 需单独记住阅读位置](https://github.com/siyuan-note/siyuan/issues/3472)
* [渲染块大小调整，不进行语法错误识别](https://github.com/siyuan-note/siyuan/issues/3475)
* [优化反链面板加载性能](https://github.com/siyuan-note/siyuan/issues/3476)
* [集市下载包问题改进](https://github.com/siyuan-note/siyuan/issues/3479)
* [调整块引搜索列表大小](https://github.com/siyuan-note/siyuan/issues/3483)
* [文档树排序切换后不再展开笔记本](https://github.com/siyuan-note/siyuan/issues/3484)
* [分屏打开改进](https://github.com/siyuan-note/siyuan/issues/3485)
* [反向链接面板计入文档自身引用](https://github.com/siyuan-note/siyuan/issues/3486)
* [插入资源文件时自动将后缀统一为小写](https://github.com/siyuan-note/siyuan/issues/3487)
* [ 反链面板“上下文”文案调整为“显示更多”](https://github.com/siyuan-note/siyuan/issues/3489)
* [嵌入块为长文档时浮窗无法移动位置](https://github.com/siyuan-note/siyuan/issues/3497)

### 修复缺陷

* [iOS 端数据索引阶段崩溃问题](https://github.com/siyuan-note/siyuan/issues/3440)
* [如果多选拖拽的不是第一个块标，拖拽后顺序错误](https://github.com/siyuan-note/siyuan/issues/3441)
* [悬浮窗不应该在属性面板之上](https://github.com/siyuan-note/siyuan/issues/3442)
* [资源文件名中带有 `#` 时打不开](https://github.com/siyuan-note/siyuan/issues/3443)
* [XSS 导致客户端 RCE 2](https://github.com/siyuan-note/siyuan/issues/3444)
* [无法插入包含特殊符号文件名的文件](https://github.com/siyuan-note/siyuan/issues/3445)
* [反链面板中的锚文本显示有误](https://github.com/siyuan-note/siyuan/issues/3446)
* [PDF 中的超链接无法点击跳转](https://github.com/siyuan-note/siyuan/issues/3452)
* [列表和反链块标无法进行拖拽](https://github.com/siyuan-note/siyuan/issues/3453)
* [搜索页签某些情况下无法打开](https://github.com/siyuan-note/siyuan/issues/3455)
* [查询嵌入块脚本为空导致的卡死问题](https://github.com/siyuan-note/siyuan/issues/3456)
* [表格同一行无法输入两个 `$` ](https://github.com/siyuan-note/siyuan/issues/3460)
* [反链面板移动块导致的运行时异常](https://github.com/siyuan-note/siyuan/issues/3463)
* [仅对 PDF 进行标注时无法触发同步](https://github.com/siyuan-note/siyuan/issues/3465)
* [不显示提及](https://github.com/siyuan-note/siyuan/issues/3481)
* [文档树排序对笔记本级别无用](https://github.com/siyuan-note/siyuan/issues/3482)

## v1.5.3 / 2021-11-18

### 改进功能

* [支持多选块拖拽移动](https://github.com/siyuan-note/siyuan/issues/2087)
* [优化列表编辑保存性能](https://github.com/siyuan-note/siyuan/issues/2548)
* [使用同步时两次连续下载后不再退出内核](https://github.com/siyuan-note/siyuan/issues/3406)
* [优化数据索引引用块性能](https://github.com/siyuan-note/siyuan/issues/3408)
* [重命名包含大量子文档的文档时遮罩显示进度](https://github.com/siyuan-note/siyuan/issues/3410)
* [优化数据索引解析 `.sy` 性能](https://github.com/siyuan-note/siyuan/issues/3412)
* [优化属性设置保存性能](https://github.com/siyuan-note/siyuan/issues/3422)
* [启动时优先使用已有数据库](https://github.com/siyuan-note/siyuan/issues/3424)
* [使用 align 时，公式出现滚动条](https://github.com/siyuan-note/siyuan/issues/3426)
* [支持对图片和链接的标题进行搜索](https://github.com/siyuan-note/siyuan/issues/3427)
* [选择行内数学后点击公式按钮应取消公式](https://github.com/siyuan-note/siyuan/issues/3430)
* [Android 长按菜单和双击菜单重叠](https://github.com/siyuan-note/siyuan/issues/3433)

### 开发重构

* [数据库锁模式切换为排它模式](https://github.com/siyuan-note/siyuan/issues/3405)

### 修复缺陷

* [`/code` 插入代码块问题](https://github.com/siyuan-note/siyuan/issues/3411)
* [大量多层级文档时部分文档层级路径为空的问题](https://github.com/siyuan-note/siyuan/issues/3413)
* [移动面板搜索不全问题](https://github.com/siyuan-note/siyuan/issues/3416)
* [数据解析报错导致的启动闪退问题](https://github.com/siyuan-note/siyuan/issues/3418)
* [PDF 标注中包含双引号 `"` 的解析问题](https://github.com/siyuan-note/siyuan/issues/3420)
* [块引用锚文本编辑时光标丢失](https://github.com/siyuan-note/siyuan/issues/3425)
* [粘贴块引用锚文本为空的块](https://github.com/siyuan-note/siyuan/issues/3429)
* [XSS 导致客户端 RCE](https://github.com/siyuan-note/siyuan/issues/3431)

## v1.5.2 / 2021-11-14

### 改进功能

* [录音改进](https://github.com/siyuan-note/siyuan/issues/541)
* [改进列表上下移动逻辑](https://github.com/siyuan-note/siyuan/issues/2466)
* [同文档块引转脚注缩略定义](https://github.com/siyuan-note/siyuan/issues/3299)
* [公式编辑输入框在窗口切换后失焦](https://github.com/siyuan-note/siyuan/issues/3357)
* [修改面包屑部分样式会导致输入时卡死](https://github.com/siyuan-note/siyuan/issues/3384)
* [普通提示和警告提示视觉优化](https://github.com/siyuan-note/siyuan/issues/3386)
* [数据解析报错记录日志](https://github.com/siyuan-note/siyuan/issues/3391)
* [导出时动态渲染锚文本最大长度按照配置处理](https://github.com/siyuan-note/siyuan/issues/3400)
* [文档移动搜索时支持命名、别名和备注](https://github.com/siyuan-note/siyuan/issues/3401)
* [文档移动支持移动到笔记本根路径](https://github.com/siyuan-note/siyuan/issues/3402)

### 开发重构

* [重构数据文件读写包 `filesys`](https://github.com/siyuan-note/siyuan/issues/3398)

### 修复缺陷

* [引用锚文本解析导致的挂起无响应问题](https://github.com/siyuan-note/siyuan/issues/3390)
* [迁移 `~/.siyuan` 到 `~/.config/siyuan` 改进](https://github.com/siyuan-note/siyuan/issues/3393)
* [输入 `//mermaid` 后回车报错](https://github.com/siyuan-note/siyuan/issues/3395)
* [软换行后输入 ``` 报错](https://github.com/siyuan-note/siyuan/issues/3396)
* [代码块不换行输入导致块元数据暴露并出现运行时异常](https://github.com/siyuan-note/siyuan/issues/3399)
* [PDF 多次打开](https://github.com/siyuan-note/siyuan/issues/3403)

## v1.5.1 / 2021-11-11

### 改进功能

* [优化冒号后自动弹出 emoji 选择框的场景](https://github.com/siyuan-note/siyuan/issues/3223)
* [Emoji 加入斜杆菜单](https://github.com/siyuan-note/siyuan/issues/3224)
* [Docker 容器以 1000:1000 用户组执行](https://github.com/siyuan-note/siyuan/issues/3296)
* [块引锚文本修改光标位置不正常](https://github.com/siyuan-note/siyuan/issues/3297)
* [优化数据索引性能](https://github.com/siyuan-note/siyuan/issues/3375)
* [为文档图标的 emoji 选择面板添加上下和回车键](https://github.com/siyuan-note/siyuan/issues/3378)
* [编辑器内的 emoji 选择面板改为文档图标选择面板](https://github.com/siyuan-note/siyuan/issues/3379)
* [端到端密码支持非数字和字母](https://github.com/siyuan-note/siyuan/issues/3383)

### 修复缺陷

* [列表项转换文档触发运行时异常](https://github.com/siyuan-note/siyuan/issues/3371)
* [查询嵌入块和引用嵌套导致的挂起无响应问题](https://github.com/siyuan-note/siyuan/issues/3372)
* [端到端密码无法设置](https://github.com/siyuan-note/siyuan/issues/3377)
* [使用 `~` 输入围栏代码块时运行时异常](https://github.com/siyuan-note/siyuan/issues/3381)

## v1.5.0 / 2021-11-09

### 引入特性

* [列表项块转换为文档块](https://github.com/siyuan-note/siyuan/issues/2610)
* [引述块转换为段落块](https://github.com/siyuan-note/siyuan/issues/2880)

### 改进功能

* [块引浮窗交互改进](https://github.com/siyuan-note/siyuan/issues/3183)
* [开发者工具警告`无法加载来源映射`](https://github.com/siyuan-note/siyuan/issues/3348)
* [`~/.config` 下 Electron 相关文件夹名称改为 `SiYuan-Electron`](https://github.com/siyuan-note/siyuan/issues/3349)
* [HTTPS 同步复用客户端、回收空闲连接](https://github.com/siyuan-note/siyuan/issues/3351)
* [能否加入\ket \bra等更全的 tex 符号支持](https://github.com/siyuan-note/siyuan/issues/3352)
* [重建索引遮罩](https://github.com/siyuan-note/siyuan/issues/3354)
* [浏览器环境下标题没有及时显示](https://github.com/siyuan-note/siyuan/issues/3360)
* [文档标题支持复制引用快捷键](https://github.com/siyuan-note/siyuan/issues/3361)
* [外观支持繁体中文语言](https://github.com/siyuan-note/siyuan/issues/3362)
* [列表项中有多个块就允许折叠](https://github.com/siyuan-note/siyuan/issues/3369)

### 修复缺陷

* [挂起无响应问题](https://github.com/siyuan-note/siyuan/issues/3342)
* [ctrl+k 在空块中无效](https://github.com/siyuan-note/siyuan/issues/3346)
* [引用列表项时，引用块为文档时动态渲染锚文本为空](https://github.com/siyuan-note/siyuan/issues/3350)
* [自定义快捷键bug——表格功能中左右方向键无法识别](https://github.com/siyuan-note/siyuan/issues/3353)
* [空列表项上下无法选中](https://github.com/siyuan-note/siyuan/issues/3356)
* [大纲跳转不正常](https://github.com/siyuan-note/siyuan/issues/3358)
* [代码块输入块元数据后导致运行时异常](https://github.com/siyuan-note/siyuan/issues/3364)
* [标题中如果正在拼写，使用下键会阻断继续的输入](https://github.com/siyuan-note/siyuan/issues/3366)

## v1.4.8 / 2021-11-06

### 改进功能

* [日志大于 2M 后清空重置](https://github.com/siyuan-note/siyuan/issues/3339)
* [列表项大于一个时 【】不再将其转换为任务列表](https://github.com/siyuan-note/siyuan/issues/3343)
* [链接聚焦优化](https://github.com/siyuan-note/siyuan/issues/3344)

### 修复缺陷

* [App does not boot](https://github.com/siyuan-note/siyuan/issues/3341)

## v1.4.7 / 2021-11-05

### 改进功能

* [移动面板支持跨笔记本](https://github.com/siyuan-note/siyuan/issues/2850)
* [输入 `[]`，`【】` 时，转换为任务列表](https://github.com/siyuan-note/siyuan/issues/2936)
* [优先使用系统 $PATH 下的 pandoc](https://github.com/siyuan-note/siyuan/issues/3124)
* [同步配置向导](https://github.com/siyuan-note/siyuan/issues/3243)
* [清理未引用资源时忽略挂件引用的数据文件](https://github.com/siyuan-note/siyuan/issues/3249)
* [块引动态渲染的锚文本长度支持配置](https://github.com/siyuan-note/siyuan/issues/3251)
* [移动端扩展可点击的空白区域](https://github.com/siyuan-note/siyuan/issues/3252)
* [优化关系图渲染效果](https://github.com/siyuan-note/siyuan/issues/3255)
* [优化块引搜索性能](https://github.com/siyuan-note/siyuan/issues/3263)
* [iOS 端同步完整性改进](https://github.com/siyuan-note/siyuan/issues/3267)
* [HTTPS 同步大文件性能改进](https://github.com/siyuan-note/siyuan/issues/3269)
* [简化云端备份功能](https://github.com/siyuan-note/siyuan/issues/3275)
* [超链接/块引设置对话框改进](https://github.com/siyuan-note/siyuan/issues/3276)
* [推荐订阅送终身会员，512 个名额送完即止](https://github.com/siyuan-note/siyuan/issues/3278)
* [双击悬浮层顶部栏进行 pin/unpin 操作](https://github.com/siyuan-note/siyuan/issues/3281)
* [上传资源文件 API 支持覆盖已有资源文件](https://github.com/siyuan-note/siyuan/issues/3286)
* [缩放聚焦容器块时计入反链](https://github.com/siyuan-note/siyuan/issues/3303)
* [各面板中的树的箭头保持显示](https://github.com/siyuan-note/siyuan/issues/3307)
* [日志文件存放到 temp 下](https://github.com/siyuan-note/siyuan/issues/3311)
* [块引动态渲染的锚文本优先使用命名](https://github.com/siyuan-note/siyuan/issues/3315)
* [没有块的时候对嵌入和引用进行搜索时应进行提示](https://github.com/siyuan-note/siyuan/issues/3316)
* [在页签右/下侧打开文档，应保持在该页签紧邻的右/下侧](https://github.com/siyuan-note/siyuan/issues/3321)
* [文件树上 alt/shift/ctrl 点击后不松开，依旧保持原有的打开方式](https://github.com/siyuan-note/siyuan/issues/3323)
* [为引用打开悬浮窗/页签添加快捷键](https://github.com/siyuan-note/siyuan/issues/3325)
* [SQL 不支持公共表表达式](https://github.com/siyuan-note/siyuan/issues/3328)
* [搜索/搜索页签/引用块打开文档，没有光标](https://github.com/siyuan-note/siyuan/issues/3331)
* [全局配置目录放置到 ~/.config/siyuan](https://github.com/siyuan-note/siyuan/issues/3332)
* [桌面端 app.log 放置到 ~/.config/siyuan](https://github.com/siyuan-note/siyuan/issues/3333)
* [属性面板中的备注输入框增加高度](https://github.com/siyuan-note/siyuan/issues/3336)

### 修复缺陷

* [修改密码后已登录账号的设备账号没有过期](https://github.com/siyuan-note/siyuan/issues/3247)
* [工作空间路切换时的报错文案误导问题](https://github.com/siyuan-note/siyuan/issues/3248)
* [数据库表 spans 未写入行级高亮元素](https://github.com/siyuan-note/siyuan/issues/3250)
* [脑图不显示](https://github.com/siyuan-note/siyuan/issues/3253)
* [引用提示请求覆盖](https://github.com/siyuan-note/siyuan/issues/3256)
* [闭合行级代码后粘贴内容仍然在行级代码内](https://github.com/siyuan-note/siyuan/issues/3257)
* [新建文档后位置错位及文档树定位错误](https://github.com/siyuan-note/siyuan/issues/3258)
* [某些输入法下分隔线语法解析问题](https://github.com/siyuan-note/siyuan/issues/3259)
* [列表项下挂代码块时竖线显示问题](https://github.com/siyuan-note/siyuan/issues/3260)
* [大纲出现 `...` 问题](https://github.com/siyuan-note/siyuan/issues/3261)
* [开启在当前页签中选项，关闭右侧页签错误](https://github.com/siyuan-note/siyuan/issues/3271)
* [右键删除有序列表项后，序号不会改变](https://github.com/siyuan-note/siyuan/issues/3272)
* [剪切板中为链接且无选中内容，ctrl+k 无效](https://github.com/siyuan-note/siyuan/issues/3288)
* [转义符暴露搜索高亮代码问题](https://github.com/siyuan-note/siyuan/issues/3289)
* [超链接、块引用、PDF 标注锚文本转义问题](https://github.com/siyuan-note/siyuan/issues/3320)
* [任务列表完成状态改变时 updated 字段设值错误](https://github.com/siyuan-note/siyuan/issues/3327)
* [Linux dolpin 文件管理器复制粘贴图片无效](https://github.com/siyuan-note/siyuan/issues/3329)

## v1.4.6 / 2021-10-24

### 改进功能

* [Android 端支持上传文件](https://github.com/siyuan-note/siyuan/issues/1957)
* [移动端点击空白处无法编辑](https://github.com/siyuan-note/siyuan/issues/2932)
* [剪藏扩展插入原文链接、摘要和剪藏时间](https://github.com/siyuan-note/siyuan/issues/3146)
* [移动端左右滑动改为前进后退](https://github.com/siyuan-note/siyuan/issues/3177)
* [全局搜索路径缓存处理改进](https://github.com/siyuan-note/siyuan/issues/3193)
* [粘贴文本中包含 `((` 时不应该出现块引提示](https://github.com/siyuan-note/siyuan/issues/3227)
* [设置页面按钮宽度自适应](https://github.com/siyuan-note/siyuan/issues/3230)
* [iOS 端公测同步](https://github.com/siyuan-note/siyuan/issues/3236)
* [优化 HTTPS 同步性能](https://github.com/siyuan-note/siyuan/issues/3237)
* [移动端取消滑动拉出侧栏和搜索](https://github.com/siyuan-note/siyuan/issues/3240)
* [支持嵌入 B 站视频时去弹幕](https://github.com/siyuan-note/siyuan/issues/3242)

### 修复缺陷

* [数学公式导出 `&` 转义问题](https://github.com/siyuan-note/siyuan/issues/3234)
* [反链面板容器块自动渲染锚文本问题](https://github.com/siyuan-note/siyuan/issues/3235)
* [块引搜索转圈不停](https://github.com/siyuan-note/siyuan/issues/3238)
* [移动端编辑器 `...` 菜单问题](https://github.com/siyuan-note/siyuan/issues/3241)
* [剪藏时图片后标题解析问题](https://github.com/siyuan-note/siyuan/issues/3244)
* [反链面板搜索关键字失效问题](https://github.com/siyuan-note/siyuan/issues/3246)

## v1.4.5 / 2021-10-22

### 改进功能

* [引用超大的单个块会导致无响应](https://github.com/siyuan-note/siyuan/issues/3140)
* [改进反链面板列表项子级展现判断](https://github.com/siyuan-note/siyuan/issues/3151)
* [移动端返回桌面时进行一次同步](https://github.com/siyuan-note/siyuan/issues/3187)
* [选择文本插入超链接改进](https://github.com/siyuan-note/siyuan/issues/3192)
* [工作空间中文路径校验](https://github.com/siyuan-note/siyuan/issues/3205)
* [图片菜单样式改进](https://github.com/siyuan-note/siyuan/issues/3206)
* [列表中连续代码块之间没有空隙](https://github.com/siyuan-note/siyuan/issues/3208)
* [打包所有 highlight.js 支持的高亮](https://github.com/siyuan-note/siyuan/issues/3210)
* [改进引述容器为空的处理](https://github.com/siyuan-note/siyuan/issues/3211)
* [大纲和嵌入块慢半拍改进](https://github.com/siyuan-note/siyuan/issues/3212)
* [块引自动渲染锚文本最大长度设置为 64](https://github.com/siyuan-note/siyuan/issues/3213)
* [查询为空时默认的块引排序规则按最近使用优先](https://github.com/siyuan-note/siyuan/issues/3218)
* [优化文档树展开性能](https://github.com/siyuan-note/siyuan/issues/3225)

### 修复缺陷

* [加粗和斜体等空格情况标记符暴露](https://github.com/siyuan-note/siyuan/issues/3134)
* [设置账号无法登出](https://github.com/siyuan-note/siyuan/issues/3202)
* [复制为嵌入块时重复](https://github.com/siyuan-note/siyuan/issues/3203)
* [列表标记符暴露问题](https://github.com/siyuan-note/siyuan/issues/3204)
* [导出软换行和有序列表序号问题](https://github.com/siyuan-note/siyuan/issues/3207)
* [没有标签时输入 `#` 后转圈不停止](https://github.com/siyuan-note/siyuan/issues/3209)
* [列表撤销导致状态异常](https://github.com/siyuan-note/siyuan/issues/3216)
* [容器块自动渲染锚文本问题](https://github.com/siyuan-note/siyuan/issues/3220)
* [最后一个代码块右键失效](https://github.com/siyuan-note/siyuan/issues/3221)
* [自动空格导致输入法吞字](https://github.com/siyuan-note/siyuan/issues/3222)

## v1.4.4 / 2021-10-20

### 改进功能

* [Docker 镜像版本化](https://github.com/siyuan-note/siyuan/issues/3199)

### 修复缺陷

* [嵌入块查询异常导致重新索引](https://github.com/siyuan-note/siyuan/issues/3197)
* [频繁报错状态异常](https://github.com/siyuan-note/siyuan/issues/3198)

## v1.4.3 / 2021-10-20

### 改进功能

* [优化暗黑模式下选择代码后的显式效果](https://github.com/siyuan-note/siyuan/issues/3070)
* [行内公式与文字垂直居中排版](https://github.com/siyuan-note/siyuan/issues/3081)
* [引用容器块时自动渲染锚文本改进](https://github.com/siyuan-note/siyuan/issues/3126)
* [通过异步写入优化内核保存数据性能](https://github.com/siyuan-note/siyuan/issues/3128)
* [改进输入实现](https://github.com/siyuan-note/siyuan/issues/3129)
* [主题文件夹没有 theme.json 时不应该影响内核启动](https://github.com/siyuan-note/siyuan/issues/3130)
* [剪藏某些网站代码块换行丢失](https://github.com/siyuan-note/siyuan/issues/3135)
* [减少列表竖线间距](https://github.com/siyuan-note/siyuan/issues/3137)
* [设置工作空间路径时校验不能放置在程序安装路径下](https://github.com/siyuan-note/siyuan/issues/3139)
* [列表项折叠，除第一个子块外其余子块都隐藏](https://github.com/siyuan-note/siyuan/issues/3142)
* [云端空间总大小在 .5G 时不显示](https://github.com/siyuan-note/siyuan/issues/3149)
* [改进导出时嵌入和引用嵌套的处理](https://github.com/siyuan-note/siyuan/issues/3152)
* [为搜索、块嵌入、块引用添加 loading](https://github.com/siyuan-note/siyuan/issues/3159)
* [订阅推荐码改为付款后输入](https://github.com/siyuan-note/siyuan/issues/3161)
* [嵌入块过长时，单击弹出的悬浮窗位置居下](https://github.com/siyuan-note/siyuan/issues/3165)
* [删除笔记本时复制 assets 到全局 assets 下](https://github.com/siyuan-note/siyuan/issues/3166)
* [表格内公式含有 `|` 符号导致表格异常分割](https://github.com/siyuan-note/siyuan/issues/3168)
* [同步改进 - 引入基于 HTTPS 的同步方式](https://github.com/siyuan-note/siyuan/issues/3169)
* [iOS 初版公测](https://github.com/siyuan-note/siyuan/issues/3172)
* [移动端自定义图标对不齐](https://github.com/siyuan-note/siyuan/issues/3174)
* [内核连接中断退出调整为重建索引](https://github.com/siyuan-note/siyuan/issues/3176)
* [移动端文档树禁用修改图标](https://github.com/siyuan-note/siyuan/issues/3178)
* [为每个面板添加属性，增加自定义样式的灵活性](https://github.com/siyuan-note/siyuan/issues/3179)
* [文档树动画效果](https://github.com/siyuan-note/siyuan/issues/3182)
* [虚拟引用排除命中自身块命名和别名的情况](https://github.com/siyuan-note/siyuan/issues/3185)
* [改进嵌入块查询性能](https://github.com/siyuan-note/siyuan/issues/3195)
* [改进导入 Markdown 相对路径资源文件处理](https://github.com/siyuan-note/siyuan/issues/3196)

### 移除功能

* [废弃导出选项引用块转换为原始块和引述块](https://github.com/siyuan-note/siyuan/issues/3155)
* [去掉移动端设置按钮](https://github.com/siyuan-note/siyuan/issues/3184)

### 修复缺陷

* [列表中引述侧边线对不齐](https://github.com/siyuan-note/siyuan/issues/3131)
* [新建日记存放路径仅填 `/` 时文档打不开](https://github.com/siyuan-note/siyuan/issues/3143)
* [列表项引用块下有任务列表时反链面板无法显示任何反链](https://github.com/siyuan-note/siyuan/issues/3147)
* [系统休眠唤醒后同步报错 Failed to exec bin/ssh.exe](https://github.com/siyuan-note/siyuan/issues/3148)
* [快捷键创建日志后文档树没有被选中](https://github.com/siyuan-note/siyuan/issues/3153)
* [引用后的文本删除，锚文本会被填充内容](https://github.com/siyuan-note/siyuan/issues/3154)
* [代码块里无法复制空格](https://github.com/siyuan-note/siyuan/issues/3158)
* [视频居左拖拽大小异常](https://github.com/siyuan-note/siyuan/issues/3162)
* [右键视频、音频、IFrame 禁止弹出复制粘贴菜单](https://github.com/siyuan-note/siyuan/issues/3163)
* [列表折叠后的第一个子块竖线过长](https://github.com/siyuan-note/siyuan/issues/3164)
* [导出为 Markdown 时段落开头空两格不生效](https://github.com/siyuan-note/siyuan/issues/3167)
* [幻灯片播放后无法退出](https://github.com/siyuan-note/siyuan/issues/3170)
* [表格中的换行复制粘贴后会变为 `<br>`](https://github.com/siyuan-note/siyuan/issues/3173)
* [预览/导出使用块引转脚注时报错](https://github.com/siyuan-note/siyuan/issues/3186)
* [macOS 版全屏后无法关闭](https://github.com/siyuan-note/siyuan/issues/3188)
* [同步排除的笔记本文档丢失](https://github.com/siyuan-note/siyuan/issues/3191)

## v1.4.2 / 2021-10-11

### 改进功能

* [文档树拖拽文档层级时细化视觉](https://github.com/siyuan-note/siyuan/issues/3106)
* [云端同步默认忽略帮助文档](https://github.com/siyuan-note/siyuan/issues/3107)
* [跨笔记本移动时保持自定义排序](https://github.com/siyuan-note/siyuan/issues/3109)
* [打包 Apple 芯片 arm64 版本](https://github.com/siyuan-note/siyuan/issues/3110)
* [列表侧边竖线改进](https://github.com/siyuan-note/siyuan/issues/3111)
* [改进 PDF 注解语法解析](https://github.com/siyuan-note/siyuan/issues/3112)
* [13 后回车改进：由生成 1 同级列表修改为生成13下方的空块](https://github.com/siyuan-note/siyuan/issues/3118)
* [开启同步时校验是否端到端密码为空](https://github.com/siyuan-note/siyuan/issues/3122)

### 修复缺陷

* [软换行后移动数学公式导致内核中断](https://github.com/siyuan-note/siyuan/issues/3113)
* [连续空列表项无法 shift + click 选中](https://github.com/siyuan-note/siyuan/issues/3116)
* [网络角标显示问题](https://github.com/siyuan-note/siyuan/issues/3119)
* [超级块下的列表项中再包含超级块时，样式错位](https://github.com/siyuan-note/siyuan/issues/3120)
* [`/无序` 唤出问题](https://github.com/siyuan-note/siyuan/issues/3121)
* [Android 端无法通过其他应用打开资源文件](https://github.com/siyuan-note/siyuan/issues/3123)
* [主题配置文件损坏时内核启动崩溃](https://github.com/siyuan-note/siyuan/issues/3127)

## v1.4.1 / 2021-10-09

### 改进功能

* [文档树双击为子文档的折叠或展开](https://github.com/siyuan-note/siyuan/issues/2888)
* [PDF 打开位置为包含 PDF 的页签组中](https://github.com/siyuan-note/siyuan/issues/3072)
* [列表侧边竖线改进](https://github.com/siyuan-note/siyuan/issues/3093)
* [全局搜索加入选项 - 是否排除容器块](https://github.com/siyuan-note/siyuan/issues/3094)

### 开发重构

* [变更发版机制](https://github.com/siyuan-note/siyuan/issues/3087)

### 修复缺陷

* [块引新建时选择到的行级代码重复](https://github.com/siyuan-note/siyuan/issues/3075)
* [不能修改文档图标](https://github.com/siyuan-note/siyuan/issues/3076)
* [设置文档图标导致自动创建空的笔记本](https://github.com/siyuan-note/siyuan/issues/3078)
* [子文档不能拖到笔记本下](https://github.com/siyuan-note/siyuan/issues/3080)
* [PDF 标注复制引用后有时查询不到块](https://github.com/siyuan-note/siyuan/issues/3084)
* [部分站点的 iframe 加载问题](https://github.com/siyuan-note/siyuan/issues/3085)
* [macOS 中 Dock 右键退出无法退出](https://github.com/siyuan-note/siyuan/issues/3086)
* [大纲中显示次级标题的数量不全](https://github.com/siyuan-note/siyuan/issues/3088)
* [网络代理设置文案错误](https://github.com/siyuan-note/siyuan/issues/3092)
* [解析文本 `<<` 时错误识别为文件标注语法](https://github.com/siyuan-note/siyuan/issues/3095)
* [设置搜索失效](https://github.com/siyuan-note/siyuan/issues/3102)
* [导出模板时任务列表问题](https://github.com/siyuan-note/siyuan/issues/3108)

## v1.4.0 / 2021-10-07

### 引入特性

* [工作空间列表切换](https://github.com/siyuan-note/siyuan/issues/2535)
* [笔记本排序](https://github.com/siyuan-note/siyuan/issues/2786)
* [笔记本图标](https://github.com/siyuan-note/siyuan/issues/3056)

### 改进功能

* [当光标没有定位到块时，文件无法拖到笔记中](https://github.com/siyuan-note/siyuan/issues/2665)
* [改进输入法兼容性](https://github.com/siyuan-note/siyuan/issues/3027)
* [资源文件搜索结果显示不完整](https://github.com/siyuan-note/siyuan/issues/3040)
* [点击文档后，大纲同步滚动](https://github.com/siyuan-note/siyuan/issues/3043)
* [虚拟引用不再排除自身定义块](https://github.com/siyuan-note/siyuan/issues/3046)
* [资源文件搜索去重](https://github.com/siyuan-note/siyuan/issues/3047)
* [标签筛选组合需按住 Ctrl](https://github.com/siyuan-note/siyuan/issues/3055)
* [文档中的 PDF 标注无法通过 Backspace 删除](https://github.com/siyuan-note/siyuan/issues/3057)
* [多个软换行后应形成新的块](https://github.com/siyuan-note/siyuan/issues/3058)
* [剪藏扩展支持笔记本 assets](https://github.com/siyuan-note/siyuan/issues/3061)
* [嵌入块面包屑滑动会弹出左右菜单](https://github.com/siyuan-note/siyuan/issues/3065)
* [开启同步以后，如果同步失败可选择强制退出](https://github.com/siyuan-note/siyuan/issues/3071)

### 修复缺陷

* [在代码块输入 &copy; 自动转变字符](https://github.com/siyuan-note/siyuan/issues/3041)
* [调整块宽度影响图片大小](https://github.com/siyuan-note/siyuan/issues/3044)
* [开启最小化到托盘后 Quit 无效](https://github.com/siyuan-note/siyuan/issues/3045)
* [部分站点的 iframe 加载问题](https://github.com/siyuan-note/siyuan/issues/3051)
* [文档名包含 `"` 和 `>` 等符号的转义问题](https://github.com/siyuan-note/siyuan/issues/3052)
* [网络角标显示问题](https://github.com/siyuan-note/siyuan/issues/3053)
* [任务列表下的引用导致反链显示问题](https://github.com/siyuan-note/siyuan/issues/3054)
* [某些移动端 Pad 设备上无法进入](https://github.com/siyuan-note/siyuan/issues/3060)
* [查询嵌入块导出问题](https://github.com/siyuan-note/siyuan/issues/3069)

## v1.3.9 / 2021-10-03

### 引入特性

* [插入已有资源文件](https://github.com/siyuan-note/siyuan/issues/1378)

### 改进功能

* [文档标题互转后，编辑区会跳转到开头](https://github.com/siyuan-note/siyuan/issues/2939)
* [Windows 下图表弹框拖拽卡顿](https://github.com/siyuan-note/siyuan/issues/2950)
* [PDF 搜索或更多，点击空白地方不会消失](https://github.com/siyuan-note/siyuan/issues/3006)
* [不同步符号链接](https://github.com/siyuan-note/siyuan/issues/3020)
* [大纲点击后文档标题定位到顶部](https://github.com/siyuan-note/siyuan/issues/3028)
* [改进 PDF 标注渲染效果](https://github.com/siyuan-note/siyuan/issues/3033)
* [英文句尾换行问题](https://github.com/siyuan-note/siyuan/issues/3035)
* [列表项不应该允许合并超级块](https://github.com/siyuan-note/siyuan/issues/3039)

### 修复缺陷

* [在 data 下的子文件同步时没有删除](https://github.com/siyuan-note/siyuan/issues/3022)
* [代码块换行，复制按钮消失](https://github.com/siyuan-note/siyuan/issues/3024)
* [反链面板中，某一项突然颜色变淡](https://github.com/siyuan-note/siyuan/issues/3025)
* [退出应用问题](https://github.com/siyuan-note/siyuan/issues/3029)
* [大纲不显示转义内容](https://github.com/siyuan-note/siyuan/issues/3030)
* [列表项横排后撤销内核中断](https://github.com/siyuan-note/siyuan/issues/3031)
* [有的 PDF 无法划选](https://github.com/siyuan-note/siyuan/issues/3032)
* [端到端密码报错](https://github.com/siyuan-note/siyuan/issues/3034)
* [虚拟引用通过命名搜索遗漏问题](https://github.com/siyuan-note/siyuan/issues/3038)

## v1.3.8 / 2021-09-30

### 引入特性

* [支持 SOCKS5 网络代理](https://github.com/siyuan-note/siyuan/issues/2928)
* [PDF 标注支持背景和边框切换](https://github.com/siyuan-note/siyuan/issues/2961)

### 改进功能

* [嵌入块未保留折叠显示](https://github.com/siyuan-note/siyuan/issues/2889)
* [PDF 需精准定位到注解](https://github.com/siyuan-note/siyuan/issues/2980)
* [剪藏扩展点击发送到思源后关闭面板](https://github.com/siyuan-note/siyuan/issues/2993)
* [插入资源文件时不替换标点符号和空格](https://github.com/siyuan-note/siyuan/issues/2999)
* [云端同步的 4.1kB 应该显示为 0](https://github.com/siyuan-note/siyuan/issues/3001)
* [变更同步忽略文件夹语法](https://github.com/siyuan-note/siyuan/issues/3002)
* [剪藏扩展保留代码高亮语言](https://github.com/siyuan-note/siyuan/issues/3012)
* [为待办列表添加 ctrl/shift/alt +click 事件](https://github.com/siyuan-note/siyuan/issues/3013)

### 修复缺陷

* [同步忽略列表删除源文件问题](https://github.com/siyuan-note/siyuan/issues/2998)
* [查询嵌入块渲染导致的内核崩溃](https://github.com/siyuan-note/siyuan/issues/3000)
* [列表下标题过长导致样式错位](https://github.com/siyuan-note/siyuan/issues/3003)
* [Code is inline by mistake when copy-paste](https://github.com/siyuan-note/siyuan/issues/3008)
* [需要登录的 iframe 无法登录](https://github.com/siyuan-note/siyuan/issues/3014)
* [软换行后，数据没有保存](https://github.com/siyuan-note/siyuan/issues/3017)
* [连续粘贴 PDF 标注不生效](https://github.com/siyuan-note/siyuan/issues/3018)

## v1.3.7 / 2021-09-28

### 引入特性

* [同步排除文件列表](https://github.com/siyuan-note/siyuan/issues/2842)

### 改进功能

* [Alt+F4/Command+Q 和关闭按钮保持逻辑一致](https://github.com/siyuan-note/siyuan/issues/2575)
* [编辑时 ESC 取消光标并选中当前块](https://github.com/siyuan-note/siyuan/issues/2875)
* [锁屏界面多语言支持](https://github.com/siyuan-note/siyuan/issues/2899)
* [浏览器剪藏扩展剪藏同名网页改进](https://github.com/siyuan-note/siyuan/issues/2991)

### 开发重构

* [升级 Electron](https://github.com/siyuan-note/siyuan/issues/2814)
* [重构系统剪切板读取文件路径](https://github.com/siyuan-note/siyuan/issues/2984)

### 修复缺陷

* [macOS 关闭后无法保存布局状态](https://github.com/siyuan-note/siyuan/issues/2813)
* [代码块无法对齐](https://github.com/siyuan-note/siyuan/issues/2971)
* [悬浮窗点击更多，鼠标移动到菜单上时，悬浮窗消失](https://github.com/siyuan-note/siyuan/issues/2981)
* [打不开使用 `file://` 链接的 PDF](https://github.com/siyuan-note/siyuan/issues/2983)
* [列表项拖动内核中断](https://github.com/siyuan-note/siyuan/issues/2994)
* [历史无法滚动](https://github.com/siyuan-note/siyuan/issues/2995)

## v1.3.6 / 2021-09-27

### 引入特性

* [一键清空所有历史](https://github.com/siyuan-note/siyuan/issues/2840)

### 改进功能

* [直接粘贴公式后无法撤销](https://github.com/siyuan-note/siyuan/issues/2198)
* [反链面板层级、上下文和移动改进](https://github.com/siyuan-note/siyuan/issues/2762)
* [嵌入块右键显示菜单](https://github.com/siyuan-note/siyuan/issues/2866)
* [文档导出模板保留空行和任务列表](https://github.com/siyuan-note/siyuan/issues/2882)
* [编辑器字体选择支持 TTC 和 OTF](https://github.com/siyuan-note/siyuan/issues/2956)
* [嵌入块交互改进](https://github.com/siyuan-note/siyuan/issues/2957)
* [PDF 划选背景改为边框](https://github.com/siyuan-note/siyuan/issues/2958)
* [折叠标题改动层级时需要先展开](https://github.com/siyuan-note/siyuan/issues/2959)
* [PDF 画框复制注解锚文本改进](https://github.com/siyuan-note/siyuan/issues/2962)
* [被其他程序锁定的文件加入关闭按钮](https://github.com/siyuan-note/siyuan/issues/2963)
* [汇编语法高亮](https://github.com/siyuan-note/siyuan/issues/2964)
* [代码签名 rsync 相关 exe](https://github.com/siyuan-note/siyuan/issues/2965)
* [数据库表 spans 不再存储纯文本元素](https://github.com/siyuan-note/siyuan/issues/2967)
* [整理表格、标题、代码块、引述第一个字符前，前向删除逻辑](https://github.com/siyuan-note/siyuan/issues/2970)
* [PDF 标注文本需要在大纲显示](https://github.com/siyuan-note/siyuan/issues/2974)
* [隐藏 PDF 文件上使用其他编辑器做的标注](https://github.com/siyuan-note/siyuan/issues/2975)

### 开发重构

* [重构历史恢复机制](https://github.com/siyuan-note/siyuan/issues/2855)

### 修复缺陷

* [加粗邻接时标记符和属性暴露](https://github.com/siyuan-note/siyuan/issues/2160)
* [文档导出模板包含自定义 emoji 问题](https://github.com/siyuan-note/siyuan/issues/2851)
* [应用主题以后模式选择保留](https://github.com/siyuan-note/siyuan/issues/2862)
* [软换行后输入 >> 内核中断](https://github.com/siyuan-note/siyuan/issues/2960)
* [转义符导致的行级元素样式属性暴露](https://github.com/siyuan-note/siyuan/issues/2969)
* [跨文档移动列表项时父 ID 指向不对](https://github.com/siyuan-note/siyuan/issues/2972)
* [动态加载最后一个块可能出现的边界计算问题](https://github.com/siyuan-note/siyuan/issues/2976)

## v1.3.5 / 2021-09-23

### 引入特性

* [HTTP API](https://github.com/siyuan-note/siyuan/issues/213)
* [导出 PDF 书签大纲](https://github.com/siyuan-note/siyuan/issues/779)
* [PDF 标注双链](https://github.com/siyuan-note/siyuan/issues/2828)
* [预览 PDF 支持书签大纲跳转、搜索、缩放等常用功能](https://github.com/siyuan-note/siyuan/issues/2857)
* [Linux 和 macOS 上支持选择字体](https://github.com/siyuan-note/siyuan/issues/2914)
* [集市显示仓库星标数](https://github.com/siyuan-note/siyuan/issues/2935)
* [浏览器剪藏扩展支持一键发送](https://github.com/siyuan-note/siyuan/issues/2944)

### 改进功能

* [导出增加文档标题选项](https://github.com/siyuan-note/siyuan/issues/2863)
* [支持 VHDL、Scala 语法高亮](https://github.com/siyuan-note/siyuan/issues/2864)
* [列表中的标题没有对齐](https://github.com/siyuan-note/siyuan/issues/2867)
* [移除超级块内部边距](https://github.com/siyuan-note/siyuan/issues/2873)
* [支持标签层级范围搜索](https://github.com/siyuan-note/siyuan/issues/2878)
* [字体列表中仅支持常规字形的字体](https://github.com/siyuan-note/siyuan/issues/2879)
* [自动同步支持设置时间间隔](https://github.com/siyuan-note/siyuan/issues/2885)
* [超链接提示干扰](https://github.com/siyuan-note/siyuan/issues/2887)
* [优化同步获取云端信息](https://github.com/siyuan-note/siyuan/issues/2893)
* [get upload token failed: 401](https://github.com/siyuan-note/siyuan/issues/2897)
* [上下移动导致大纲面板闪烁](https://github.com/siyuan-note/siyuan/issues/2898)
* [点击停靠栏两次后面板才会收起](https://github.com/siyuan-note/siyuan/issues/2905)
* [行内数学公式被遮挡](https://github.com/siyuan-note/siyuan/issues/2917)
* [属性面板、代码编辑框等使用 Ctrl Enter 确认并关闭](https://github.com/siyuan-note/siyuan/issues/2933)
* [引用过多时悬浮窗很难 resize](https://github.com/siyuan-note/siyuan/issues/2937)
* [嵌入块中的超链接支持点击打开](https://github.com/siyuan-note/siyuan/issues/2940)
* [嵌入块折叠后选项按钮消失](https://github.com/siyuan-note/siyuan/issues/2941)
* [为二级菜单添加阴影效果](https://github.com/siyuan-note/siyuan/issues/2943)
* [修改暗黑主题下错误、警告、信息、成功的背景色](https://github.com/siyuan-note/siyuan/issues/2945)
* [打开用户指南时提示请勿写入重要数据](https://github.com/siyuan-note/siyuan/issues/2949)

### 开发重构

* [重新打包 Windows 版 Rsync](https://github.com/siyuan-note/siyuan/issues/2934)

### 修复缺陷

* [Android 11 以下无法正常进入](https://github.com/siyuan-note/siyuan/issues/2868)
* [列表下嵌入块图标位置显示错误](https://github.com/siyuan-note/siyuan/issues/2870)
* [搜索结果上下键切换问题](https://github.com/siyuan-note/siyuan/issues/2872)
* [某些字体设置失效](https://github.com/siyuan-note/siyuan/issues/2876)
* [标签带空格时搜索失效问题](https://github.com/siyuan-note/siyuan/issues/2881)
* [引用跳转高亮消失](https://github.com/siyuan-note/siyuan/issues/2890)
* [下划线合并问题](https://github.com/siyuan-note/siyuan/issues/2900)
* [窗口位置超出屏幕之外](https://github.com/siyuan-note/siyuan/issues/2902)
* [空白处粘贴超级块显示不出来](https://github.com/siyuan-note/siyuan/issues/2903)
* [Markdown link parse failed](https://github.com/siyuan-note/siyuan/issues/2906)
* [未鉴权的情况下可以访问 assets 下的图片](https://github.com/siyuan-note/siyuan/issues/2908)
* [文档末尾表格内右键无效](https://github.com/siyuan-note/siyuan/issues/2910)
* [打开刚关闭的文档不显示大纲](https://github.com/siyuan-note/siyuan/issues/2912)
* [虚拟引用别名判断重复包含问题](https://github.com/siyuan-note/siyuan/issues/2915)
* [剪藏扩展处理 SVG 公式时路径不正确](https://github.com/siyuan-note/siyuan/issues/2916)
* [数学公式内容中包含 `\$` 时解析报错](https://github.com/siyuan-note/siyuan/issues/2918)
* [选中整个块粘贴再撤销会导致选中的内容丢失](https://github.com/siyuan-note/siyuan/issues/2920)
* [快捷键无法设置为 alt + 左右](https://github.com/siyuan-note/siyuan/issues/2922)
* [无网络情况无法通过设置 - 云端关闭同步](https://github.com/siyuan-note/siyuan/issues/2925)
* [文档块属性换行符转义](https://github.com/siyuan-note/siyuan/issues/2927)
* [表格内的数学公式复制粘贴无效](https://github.com/siyuan-note/siyuan/issues/2929)
* [五线谱导出 PDF 不全](https://github.com/siyuan-note/siyuan/issues/2930)
* [内核只读模式下仍然可以移动块](https://github.com/siyuan-note/siyuan/issues/2931)
* [视频框拖拽粘滞](https://github.com/siyuan-note/siyuan/issues/2942)
* [XSS 漏洞修复](https://github.com/siyuan-note/siyuan/issues/2946)
* [折叠标题转换为文档时需要自动展开下方块](https://github.com/siyuan-note/siyuan/issues/2947)
* [列表中代码块回车后会回到顶部](https://github.com/siyuan-note/siyuan/issues/2948)

## v1.3.4 / 2021-09-06

### 引入特性

* [导出时将块引用转换为脚注](https://github.com/siyuan-note/siyuan/issues/2833)

### 改进功能

* [同步鉴权失败后自动重试](https://github.com/siyuan-note/siyuan/issues/2831)
* [文档导出为模板支持属性](https://github.com/siyuan-note/siyuan/issues/2841)
* [编辑器文档块标菜单添加删除文档](https://github.com/siyuan-note/siyuan/issues/2844)
* [添加超链接时如果不填链接地址则取消超链接](https://github.com/siyuan-note/siyuan/issues/2845)
* [标签面板不再显示块，点击标签以后通过搜索页签展现](https://github.com/siyuan-note/siyuan/issues/2846)
* [编辑标题时大纲闪烁](https://github.com/siyuan-note/siyuan/issues/2848)
* [(( 新建文档 32 个字符限制改为 512个](https://github.com/siyuan-note/siyuan/issues/2853)
* [使用非中文和英文外观时统一使用英文帮助文档](https://github.com/siyuan-note/siyuan/issues/2859)

### 修复缺陷

* [列表项内用ctrl+↑折叠，块标变成段落块](https://github.com/siyuan-note/siyuan/issues/2809)
* [移动端右侧滑动卡](https://github.com/siyuan-note/siyuan/issues/2839)
* [搜索预览区动态加载时丢失关键字高亮](https://github.com/siyuan-note/siyuan/issues/2843)
* [移动端搜索跳转定位不对](https://github.com/siyuan-note/siyuan/issues/2852)
* [移动端粘贴菜单无效](https://github.com/siyuan-note/siyuan/issues/2854)
* [导出嵌入超级块重复](https://github.com/siyuan-note/siyuan/issues/2861)

## v1.3.3 / 2021-09-04

### 引入特性

* [文档另存为模板](https://github.com/siyuan-note/siyuan/issues/2517)
* [嵌入块导出选项](https://github.com/siyuan-note/siyuan/issues/2810)
* [为各面板添加全部折叠/展开的快捷键](https://github.com/siyuan-note/siyuan/issues/2823)

### 改进功能

* [文档动态加载优化](https://github.com/siyuan-note/siyuan/issues/2815)
* [切换外观模式时卡顿](https://github.com/siyuan-note/siyuan/issues/2818)
* [鼠标移动到命名，别名，备注上，对应的块需进行高亮](https://github.com/siyuan-note/siyuan/issues/2827)
* [代码块编辑改进](https://github.com/siyuan-note/siyuan/issues/2834)

### 开发重构

* [重构运行环境容器判断](https://github.com/siyuan-note/siyuan/issues/2820)

### 修复缺陷

* [代码块 // 注释后粘贴, 光标错误](https://github.com/siyuan-note/siyuan/issues/2817)
* [新建的笔记本查看历史报错](https://github.com/siyuan-note/siyuan/issues/2819)
* [无法复制自定义 emoji](https://github.com/siyuan-note/siyuan/issues/2824)
* [同一个块内有2个引用时产生的问题](https://github.com/siyuan-note/siyuan/issues/2825)
* [导出嵌入块时未处理嵌套情况](https://github.com/siyuan-note/siyuan/issues/2826)
* [锚文本不支持单个字符的问题](https://github.com/siyuan-note/siyuan/issues/2830)
* [移动端浏览器使用时链接不能跳转的问题](https://github.com/siyuan-note/siyuan/issues/2832)
* [反链提及排序不稳定](https://github.com/siyuan-note/siyuan/issues/2836)
* [反链面板上下文按钮状态问题](https://github.com/siyuan-note/siyuan/issues/2837)
* [悬浮窗改变宽度后滚动条消失](https://github.com/siyuan-note/siyuan/issues/2838)

## v1.3.2 / 2021-09-01

### 引入特性

* [支持跨笔记本移动块](https://github.com/siyuan-note/siyuan/issues/2488)

### 改进功能

* [列表项多选禁止转换](https://github.com/siyuan-note/siyuan/issues/2708)
* [支持关闭网络图片角标](https://github.com/siyuan-note/siyuan/issues/2771)
* [导出时嵌入块使用原始文本](https://github.com/siyuan-note/siyuan/issues/2772)
* [点击左边空白，光标置于段首](https://github.com/siyuan-note/siyuan/issues/2779)
* [同步/备份限制单个文件最大为 1G](https://github.com/siyuan-note/siyuan/issues/2785)
* [嵌入多行块，第二行会显示一半](https://github.com/siyuan-note/siyuan/issues/2792)
* [改进复制网页内容时的换行处理](https://github.com/siyuan-note/siyuan/issues/2793)
* [文档的标签不能用顶级标签](https://github.com/siyuan-note/siyuan/issues/2801)
* [改进锚文本修改后光标的位置](https://github.com/siyuan-note/siyuan/issues/2802)
* [列表项下的标题和圆点对不齐](https://github.com/siyuan-note/siyuan/issues/2803)
* [移除空链接](https://github.com/siyuan-note/siyuan/issues/2808)
* [嵌入块内的引用无法点击打开](https://github.com/siyuan-note/siyuan/issues/2816)

### 修复缺陷

* [某些空行删除不了](https://github.com/siyuan-note/siyuan/issues/2787)
* [Android 端无法打开 PDF 资源文件](https://github.com/siyuan-note/siyuan/issues/2788)
* [云端报错 failed to connect cloud server](https://github.com/siyuan-note/siyuan/issues/2794)
* [`\` 撤销问题](https://github.com/siyuan-note/siyuan/issues/2795)
* [添加颜色后英文单词之间无法添加空格](https://github.com/siyuan-note/siyuan/issues/2797)
* [浮窗中的列表项无法拖拽到文档中](https://github.com/siyuan-note/siyuan/issues/2798)
* [移动带子文档的文档后子文档打不开](https://github.com/siyuan-note/siyuan/issues/2804)
* [休眠后内核连接中断](https://github.com/siyuan-note/siyuan/issues/2806)
* [悬浮窗内容显示不全](https://github.com/siyuan-note/siyuan/issues/2807)
* [未使用过字体染色后，alt+x 报错](https://github.com/siyuan-note/siyuan/issues/2811)
* [从 Word 粘贴时空列表项处理](https://github.com/siyuan-note/siyuan/issues/2812)

## v1.3.1 / 2021-08-29

### 引入特性

* [支持浮窗移动块](https://github.com/siyuan-note/siyuan/issues/2766)

### 改进功能

* [添加  Vim Script 语言代码高亮，扩展 TOML、C#](https://github.com/siyuan-note/siyuan/issues/2753)
* [标签跳转折叠块](https://github.com/siyuan-note/siyuan/issues/2764)
* [自定义 emoji 支持子文件夹](https://github.com/siyuan-note/siyuan/issues/2769)
* [改进主界面加载性能](https://github.com/siyuan-note/siyuan/issues/2770)
* [折叠嵌入块 UI 改进](https://github.com/siyuan-note/siyuan/issues/2780)
* [出现内核中断问题以后下次启动重建索引](https://github.com/siyuan-note/siyuan/issues/2782)
* [文档树 icon 大小不一致](https://github.com/siyuan-note/siyuan/issues/2784)

### 开发重构

* [块 hash 字段减少长度](https://github.com/siyuan-note/siyuan/issues/2781)

### 修复缺陷

* [弹框编辑删除内核中断](https://github.com/siyuan-note/siyuan/issues/2748)
* [全局搜索鼠标单击跳转问题](https://github.com/siyuan-note/siyuan/issues/2757)
* [移动端登录账号问题](https://github.com/siyuan-note/siyuan/issues/2758)
* [容器块 updated 字段未更新](https://github.com/siyuan-note/siyuan/issues/2765)
* [段首不能软换行](https://github.com/siyuan-note/siyuan/issues/2767)
* [第一个块的块首按左键或最后一个块块末按右键，光标丢失](https://github.com/siyuan-note/siyuan/issues/2768)
* [有序列表下方多选块删除内核中断](https://github.com/siyuan-note/siyuan/issues/2773)
* [从历史恢复时报错，查看历史入口统一到笔记本右键菜单](https://github.com/siyuan-note/siyuan/issues/2774)
* [搜索类型过滤失效](https://github.com/siyuan-note/siyuan/issues/2775)
* [账号鉴权自动续期问题](https://github.com/siyuan-note/siyuan/issues/2777)
* [撤销导致的内核中断](https://github.com/siyuan-note/siyuan/issues/2778)
* [反链面板中点击悬浮窗中的面包屑，反链面板不应更新](https://github.com/siyuan-note/siyuan/issues/2783)

## v1.3.0 / 2021-08-28

### 引入特性

* [工作空间端到端加密数据同步](https://github.com/siyuan-note/siyuan/issues/2165)

### 改进功能

* [Code signing on macOS](https://github.com/siyuan-note/siyuan/issues/1768)
* [Zoom-in while searching folded blocks](https://github.com/siyuan-note/siyuan/issues/2230)
* [全局搜索排除容器块](https://github.com/siyuan-note/siyuan/issues/2612)
* [自定义前进/后退/聚焦进入/聚焦返回快捷键](https://github.com/siyuan-note/siyuan/issues/2689)
* [各功能面板在选中时需显示展开的箭头](https://github.com/siyuan-note/siyuan/issues/2712)
* [``` 代码块输入改进](https://github.com/siyuan-note/siyuan/issues/2731)
* [桌面端启动检查端口改进](https://github.com/siyuan-note/siyuan/issues/2734)
* [调整链接打开规则](https://github.com/siyuan-note/siyuan/issues/2736)
* [为“移动”功能添加可配置的快捷键](https://github.com/siyuan-note/siyuan/issues/2737)
* [内核启动时自动优化数据库文件](https://github.com/siyuan-note/siyuan/issues/2743)
* [优化集市加载速度](https://github.com/siyuan-note/siyuan/issues/2744)
* [有序列表批量删除需更新序号](https://github.com/siyuan-note/siyuan/issues/2746)
* [自动检查版本更新](https://github.com/siyuan-note/siyuan/issues/2749)
* [文档树展开箭头和文档图标视觉优化](https://github.com/siyuan-note/siyuan/issues/2756)

### 移除功能

* [移除自动更新相关遗留代码](https://github.com/siyuan-note/siyuan/issues/2754)

### 修复缺陷

* [空表格里不能 Backspace 空行](https://github.com/siyuan-note/siyuan/issues/2732)
* [文档树添加 Ctrl F 快捷键](https://github.com/siyuan-note/siyuan/issues/2733)
* [页面按向下箭头丢失焦点](https://github.com/siyuan-note/siyuan/issues/2735)
* [句首和句尾的英文不显示虚拟引用](https://github.com/siyuan-note/siyuan/issues/2741)
* [反链面板布局状态保留问题](https://github.com/siyuan-note/siyuan/issues/2742)
* [代码块光标乱跳](https://github.com/siyuan-note/siyuan/issues/2745)
* [macOS 上删除所有 emoji 文件之后仍存在一个破损文件](https://github.com/siyuan-note/siyuan/issues/2751)
* [Docker 部署帮助文档自动打开问题](https://github.com/siyuan-note/siyuan/issues/2755)

## v1.2.9 / 2021-08-26

### 引入特性

* [支持扩展 Emoji](https://github.com/siyuan-note/siyuan/issues/2654)

### 改进功能

* [调整图片外链标识位置](https://github.com/siyuan-note/siyuan/issues/2714)
* [块引搜索候选列表排序优化](https://github.com/siyuan-note/siyuan/issues/2715)
* [代码高亮渲染改进](https://github.com/siyuan-note/siyuan/issues/2726)

### 移除功能

* [移除涉及侵权的 Emoji](https://github.com/siyuan-note/siyuan/issues/2725)

### 修复缺陷

* [【【块引呼出问题](https://github.com/siyuan-note/siyuan/issues/2713)
* [句末不能使用软换行](https://github.com/siyuan-note/siyuan/issues/2716)
* [代码块回车抖动](https://github.com/siyuan-note/siyuan/issues/2717)
* [文档图标搜索删除和文档标题重命名删除会触发删除文档](https://github.com/siyuan-note/siyuan/issues/2719)
* [点击块引进去的文档不显示反链信息](https://github.com/siyuan-note/siyuan/issues/2720)
* [悬浮窗列表项无法展开](https://github.com/siyuan-note/siyuan/issues/2721)
* [列表内斜体后的最后一个字符无法选中](https://github.com/siyuan-note/siyuan/issues/2722)

## v1.2.8 / 2021-08-24

### 引入特性

* [网络图片提示角标](https://github.com/siyuan-note/siyuan/issues/2276)

### 改进功能

* [文档树 Alt 1 展开后获得焦点、上下键选择以及 Enter 打开](https://github.com/siyuan-note/siyuan/issues/2463)
* [启动进入主界面加载优化](https://github.com/siyuan-note/siyuan/issues/2660)
* [引用块时粘贴的文本无法显示新建](https://github.com/siyuan-note/siyuan/issues/2664)
* [PDF 链接 ctrl+click 使用本地默认工具打开](https://github.com/siyuan-note/siyuan/issues/2685)
* [文档树支持 Del 键删除笔记](https://github.com/siyuan-note/siyuan/issues/2698)
* [虚拟引用对英语使用空格分词](https://github.com/siyuan-note/siyuan/issues/2703)
* [视频音频等文件插入去重](https://github.com/siyuan-note/siyuan/issues/2704)
* [嵌入块为代码块的时候，右上角的功能会被覆盖](https://github.com/siyuan-note/siyuan/issues/2709)

### 移除功能

* [移除 v1.2.5 数据迁移支持](https://github.com/siyuan-note/siyuan/issues/2697)

### 修复缺陷

* [开启虚拟引用导致的内容乱码问题](https://github.com/siyuan-note/siyuan/issues/2699)
* [文档标签搜索不出](https://github.com/siyuan-note/siyuan/issues/2700)
* [文档标签区分大小写](https://github.com/siyuan-note/siyuan/issues/2701)
* [虚拟引用搜索多个别名时的问题](https://github.com/siyuan-note/siyuan/issues/2705)
* [文档题头工具栏遮挡问题](https://github.com/siyuan-note/siyuan/issues/2706)
* [文档标签下拉菜单没有文档级标签](https://github.com/siyuan-note/siyuan/issues/2707)

## v1.2.7 / 2021-08-23

### 引入特性

* [文档块支持标签](https://github.com/siyuan-note/siyuan/issues/2431)

### 改进功能

* [拖拽文件夹到编辑器内，错误信息为空](https://github.com/siyuan-note/siyuan/issues/2586)
* [虚拟引用涵盖命名、别名、定义块文本](https://github.com/siyuan-note/siyuan/issues/2677)
* [启动思源后，点击页签，光标不会聚焦到编辑器上](https://github.com/siyuan-note/siyuan/issues/2678)
* [头图上传插入去重](https://github.com/siyuan-note/siyuan/issues/2681)
* [虚拟引用支持关键字排除列表](https://github.com/siyuan-note/siyuan/issues/2686)
* [笔记本名称、文档标题允许使用特殊符号](https://github.com/siyuan-note/siyuan/issues/2690)
* [移动端使用系统自带 emoji](https://github.com/siyuan-note/siyuan/issues/2694)
* [支持直接使用 ID 搜索块](https://github.com/siyuan-note/siyuan/issues/2696)

### 修复缺陷

* [后退后再操作，后退缺少一步](https://github.com/siyuan-note/siyuan/issues/2676)
* [文档树点击已打开的文档、切换页签没有记录到后退中](https://github.com/siyuan-note/siyuan/issues/2679)
* [设置属性以后没有同步到数据库](https://github.com/siyuan-note/siyuan/issues/2680)
* [重名文档导出只导出一个文档问题](https://github.com/siyuan-note/siyuan/issues/2683)
* [表格单元格内颜色文字后无法继续输入](https://github.com/siyuan-note/siyuan/issues/2687)
* [打开文档不会更新大纲](https://github.com/siyuan-note/siyuan/issues/2691)
* [无法消除的高亮](https://github.com/siyuan-note/siyuan/issues/2692)
* [标题转换为段落时，大纲没有更新](https://github.com/siyuan-note/siyuan/issues/2693)
* [列表大纲定位错误](https://github.com/siyuan-note/siyuan/issues/2695)

## v1.2.6 / 2021-08-21

### 引入特性

* [虚拟引用 Virtual ref](https://github.com/siyuan-note/siyuan/issues/2249)

### 改进功能

* [导入时 assets 的放置改进](https://github.com/siyuan-note/siyuan/issues/2627)
* [F5 刷新增加标题后的引用数更新](https://github.com/siyuan-note/siyuan/issues/2658)
* [移动端支持切换主题](https://github.com/siyuan-note/siyuan/issues/2659)
* [改进已关闭笔记本列表](https://github.com/siyuan-note/siyuan/issues/2662)

### 修复缺陷

* [有关闭的笔记本时文档树排序报查询笔记本失败](https://github.com/siyuan-note/siyuan/issues/2656)
* [自定义排序失效问题](https://github.com/siyuan-note/siyuan/issues/2657)
* [剪切单个块粘贴后id会变，且再次粘贴错误](https://github.com/siyuan-note/siyuan/issues/2661)
* [文档表情标签残留](https://github.com/siyuan-note/siyuan/issues/2663)
* [重命名具有共同前缀的文档标题时的问题](https://github.com/siyuan-note/siyuan/issues/2666)
* [查询嵌入块的递归问题](https://github.com/siyuan-note/siyuan/issues/2668)
* [调整设置后不能使用 emoji](https://github.com/siyuan-note/siyuan/issues/2671)
* [导入以后删除文档报错](https://github.com/siyuan-note/siyuan/issues/2672)
* [大纲点击跳转不稳定](https://github.com/siyuan-note/siyuan/issues/2673)
* [块引浮窗面包屑根路径缺失父路径](https://github.com/siyuan-note/siyuan/issues/2674)
* [折叠下方为空的标题时内核中断](https://github.com/siyuan-note/siyuan/issues/2675)

## v1.2.5 / 2021-08-20

### 引入特性

* [Back and forward for editor](https://github.com/siyuan-note/siyuan/issues/239)
* [从文件夹结构迁移到子文档结构](https://github.com/siyuan-note/siyuan/issues/2304)
* [支持鼠标中键关闭页签，侧键前进后退](https://github.com/siyuan-note/siyuan/issues/2598)
* [文档图标](https://github.com/siyuan-note/siyuan/issues/2617)
* [自动保存常用 Emoji](https://github.com/siyuan-note/siyuan/issues/2628)

### 改进功能

* [Add SiYuan emoji](https://github.com/siyuan-note/siyuan/issues/1496)
* [文档数据文件名使用 ID](https://github.com/siyuan-note/siyuan/issues/2131)
* [全局搜索预览编辑区支持行级文本内容高亮](https://github.com/siyuan-note/siyuan/issues/2551)
* [End-to-End testing via Cypress](https://github.com/siyuan-note/siyuan/issues/2566)
* [同步报错文案优化](https://github.com/siyuan-note/siyuan/issues/2569)
* [从临时文件恢复](https://github.com/siyuan-note/siyuan/issues/2571)
* [延长文档锁定时间为 5 分钟](https://github.com/siyuan-note/siyuan/issues/2572)
* [不允许同时选中文本和块](https://github.com/siyuan-note/siyuan/issues/2588)
* [稳定 shift+click 算法，选中后定位光标](https://github.com/siyuan-note/siyuan/issues/2590)
* [剪藏扩展发布到 Edge 浏览器商店](https://github.com/siyuan-note/siyuan/issues/2592)
* [macOS 和 Linux 上使用系统自带的 rsync 兜底](https://github.com/siyuan-note/siyuan/issues/2596)
* [通过模版创建日记时支持 id 和 title 变量](https://github.com/siyuan-note/siyuan/issues/2599)
* [没有配置授权码时锁屏需要提示](https://github.com/siyuan-note/siyuan/issues/2600)
* [设置 - 云端相关加载改进](https://github.com/siyuan-note/siyuan/issues/2604)
* [修改默认快捷不再需要进行重置](https://github.com/siyuan-note/siyuan/issues/2605)
* [重写移动端文档树](https://github.com/siyuan-note/siyuan/issues/2607)
* [同步时连续两次从云端下载则退出应用](https://github.com/siyuan-note/siyuan/issues/2609)
* [代码块下的空段落块无法删除](https://github.com/siyuan-note/siyuan/issues/2618)
* [创建文档流程改进](https://github.com/siyuan-note/siyuan/issues/2619)
* [多选块以后右键需打开多选块菜单](https://github.com/siyuan-note/siyuan/issues/2624)
* [全局搜索快捷调整大小写敏感](https://github.com/siyuan-note/siyuan/issues/2625)
* [笔记本关闭后依旧保留在文档树上](https://github.com/siyuan-note/siyuan/issues/2636)
* [文档树上的引用计数和文档引用计数区分](https://github.com/siyuan-note/siyuan/issues/2640)
* [引述块折叠会显示一行半的文字](https://github.com/siyuan-note/siyuan/issues/2645)
* [改进剪藏扩展拉取图片稳定性](https://github.com/siyuan-note/siyuan/issues/2651)

### 开发重构

* [WebSocket 重构为 HTTP API](https://github.com/siyuan-note/siyuan/issues/2603)
* [重新实现文档树自定义排序](https://github.com/siyuan-note/siyuan/issues/2623)

### 移除功能

* [移除老版本到 v1.2.0 的迁移支持](https://github.com/siyuan-note/siyuan/issues/2578)

### 修复缺陷

* [重命名和使用别名后反向链接显示错误](https://github.com/siyuan-note/siyuan/issues/2567)
* [引用超级块时没有渲染文本](https://github.com/siyuan-note/siyuan/issues/2568)
* [重命名笔记本和笔记的问题](https://github.com/siyuan-note/siyuan/issues/2570)
* [点击行内元素光标乱跳](https://github.com/siyuan-note/siyuan/issues/2573)
* [mac 拼音输入法在大纲中的 bug](https://github.com/siyuan-note/siyuan/issues/2574)
* [创建标题后对应子内容父亲字段未更新](https://github.com/siyuan-note/siyuan/issues/2581)
* [嵌入超级块，图片拖拽导致界面异常](https://github.com/siyuan-note/siyuan/issues/2584)
* [事务失败导致的内核连接中断](https://github.com/siyuan-note/siyuan/issues/2585)
* [移动端滑动表格会出现菜单](https://github.com/siyuan-note/siyuan/issues/2593)
* [表格选择需移除空元素](https://github.com/siyuan-note/siyuan/issues/2594)
* [修改链接光标和标题转义问题](https://github.com/siyuan-note/siyuan/issues/2595)
* [任务列表空项引起的解析报错](https://github.com/siyuan-note/siyuan/issues/2602)
* [SQL `"` 转义处理问题](https://github.com/siyuan-note/siyuan/issues/2611)
* [链接提示不会消失改进](https://github.com/siyuan-note/siyuan/issues/2614)
* [改进搜索历史](https://github.com/siyuan-note/siyuan/issues/2615)
* [重启思源导致列表背景色丢失](https://github.com/siyuan-note/siyuan/issues/2629)
* [面包屑自动订正数据引起的内核中断问题](https://github.com/siyuan-note/siyuan/issues/2630)
* [反向缩进内容丢失](https://github.com/siyuan-note/siyuan/issues/2631)
* [代码块中的 kramdown 代码会被解析渲染](https://github.com/siyuan-note/siyuan/issues/2634)
* [引用前后加 `**` 重启后引用消失](https://github.com/siyuan-note/siyuan/issues/2639)
* [折叠标题更新和移动导致内容错乱的问题](https://github.com/siyuan-note/siyuan/issues/2641)
* [表格内使用微软拼音的问题](https://github.com/siyuan-note/siyuan/issues/2644)
* [从 Word 中复制多段落时自动添加空格问题](https://github.com/siyuan-note/siyuan/issues/2646)
* [数学公式染色 bug](https://github.com/siyuan-note/siyuan/issues/2649)

## v1.2.31 / 2021-08-01

### 引入特性

* [笔记本重命名](https://github.com/siyuan-note/siyuan/issues/2484)
* [API token](https://github.com/siyuan-note/siyuan/issues/2537)
* [笔记本删除](https://github.com/siyuan-note/siyuan/issues/2563)

### 改进功能

* [剪藏扩展加入 API token 配置](https://github.com/siyuan-note/siyuan/issues/2538)
* [优化数据保存性能](https://github.com/siyuan-note/siyuan/issues/2539)
* [鼠标单击行尾空白处时，光标有时会定位在行首而非行末](https://github.com/siyuan-note/siyuan/issues/2547)
* [Docker 容器监听 `0.0.0.0`](https://github.com/siyuan-note/siyuan/issues/2549)
* [面包屑导航列表使用第一个子块文本](https://github.com/siyuan-note/siyuan/issues/2553)
* [不允许创建以 `.` 开头的文档](https://github.com/siyuan-note/siyuan/issues/2556)
* [编辑时自动移除空标签](https://github.com/siyuan-note/siyuan/issues/2560)
* [改进折叠块的块标显示](https://github.com/siyuan-note/siyuan/issues/2562)

### 开发重构

* [SQL 表 blocks 移除两列 `previous_id` 和 `next_id`](https://github.com/siyuan-note/siyuan/issues/2546)
* [笔记本路径迁移](https://github.com/siyuan-note/siyuan/issues/2559)

### 修复缺陷

* [有序列表块选择移动问题](https://github.com/siyuan-note/siyuan/issues/2541)
* [多行块属性导致内核崩溃](https://github.com/siyuan-note/siyuan/issues/2543)
* [未引用资源在自建子文件夹的情况下计算错误](https://github.com/siyuan-note/siyuan/issues/2544)
* [着色后，不在同一个块中继续输入，光标会乱跳](https://github.com/siyuan-note/siyuan/issues/2545)
* [导出 Word 时中文段首缩进失效](https://github.com/siyuan-note/siyuan/issues/2550)
* [链接无法保存](https://github.com/siyuan-note/siyuan/issues/2554)
* [折叠标题修改数据丢失](https://github.com/siyuan-note/siyuan/issues/2555)
* [数学公式前输入公式排版格式消失](https://github.com/siyuan-note/siyuan/issues/2561)

## v1.2.3 / 2021-07-28

### 引入特性

* [文件排序加入“按创建时间排序”](https://github.com/siyuan-note/siyuan/issues/2519)

### 改进功能

* [更新文档名后，引用不会实时更新](https://github.com/siyuan-note/siyuan/issues/2512)
* [数据写入遇到“关键错误”时强制退出内核进程](https://github.com/siyuan-note/siyuan/issues/2516)
* [移除本地同步目录、本地备份目录设置](https://github.com/siyuan-note/siyuan/issues/2518)
* [删除大纲标题后面包屑不会立即刷新](https://github.com/siyuan-note/siyuan/issues/2521)
* [版本升级时强制结束老内核进程](https://github.com/siyuan-note/siyuan/issues/2525)
* [更换授权码字段为 `accessAuthCode`](https://github.com/siyuan-note/siyuan/issues/2526)
* [浏览器中点击附件改进](https://github.com/siyuan-note/siyuan/issues/2527)
* [安卓端长公式的手势改进](https://github.com/siyuan-note/siyuan/issues/2530)
* [支持鉴权页面拖拽](https://github.com/siyuan-note/siyuan/issues/2533)

### 修复缺陷

* [标签异常高亮](https://github.com/siyuan-note/siyuan/issues/2513)
* [工作空间所在磁盘分区不存在时内核启动失败](https://github.com/siyuan-note/siyuan/issues/2514)
* [表格 ctrl+z 撤销的问题](https://github.com/siyuan-note/siyuan/issues/2520)
* [修改文件树或编辑器内的文件名，大纲顶部的文件名不会刷新](https://github.com/siyuan-note/siyuan/issues/2522)
* [Markdown 语法 `<url>` 问题](https://github.com/siyuan-note/siyuan/issues/2523)
* [手机端面包屑过长时的问题](https://github.com/siyuan-note/siyuan/issues/2529)
* [更改鉴权密码后不能关闭软件](https://github.com/siyuan-note/siyuan/issues/2531)
* [吞超链接](https://github.com/siyuan-note/siyuan/issues/2532)
* [移动端选择后没有复制选项](https://github.com/siyuan-note/siyuan/issues/2534)
* [转义符 `\[` 引起的关键错误](https://github.com/siyuan-note/siyuan/issues/2536)

## v1.2.2 / 2021-07-27

### 升级须知

* 升级前请在老版本上将 <kbd>设置 - 关于 - 访问授权码</kbd> 设置为空或者设置为一个自己常用的授权码（设置为空时新版打开不需要鉴权，不为空时需要输入授权码解锁）
* 数据同步功能已经开始公测，使用前请查看帮助文档，备份数据后再开启同步

### 引入特性

* [重制鉴权](https://github.com/siyuan-note/siyuan/issues/1139)
* [文档树新增按文档被引用数排序](https://github.com/siyuan-note/siyuan/issues/1215)
* [对接 Web Clipper](https://github.com/siyuan-note/siyuan/issues/1266)
* [设置 - 搜索支持大小写敏感选项](https://github.com/siyuan-note/siyuan/issues/2461)
* [光标所在块右键不弹块菜单，弹出复制/全选等菜单](https://github.com/siyuan-note/siyuan/issues/2469)
* [选中块元素后， 可使用上下键选择附近的块](https://github.com/siyuan-note/siyuan/issues/2470)
* [面包屑缩放中高亮当前块](https://github.com/siyuan-note/siyuan/issues/2474)
* [Android 端支持后退](https://github.com/siyuan-note/siyuan/issues/2502)
* [自动清理历史](https://github.com/siyuan-note/siyuan/issues/2507)

### 改进功能

* [反链提及搜索排除链接文本](https://github.com/siyuan-note/siyuan/issues/1542)
* [优化备份/恢复性能](https://github.com/siyuan-note/siyuan/issues/2406)
* [shift + 方向键和全选快捷键的操作建议](https://github.com/siyuan-note/siyuan/issues/2442)
* [优化未引用资源文件加载性能](https://github.com/siyuan-note/siyuan/issues/2449)
* [导出块引时支持仅锚文本模式](https://github.com/siyuan-note/siyuan/issues/2457)
* [帮助文档仅在初次安装时打开](https://github.com/siyuan-note/siyuan/issues/2458)
* [正常退出内核时等待数据全部写入后再退出](https://github.com/siyuan-note/siyuan/issues/2459)
* [使用设置 - 搜索 - 搜索结果显示数来限制反链提及搜索结果条目](https://github.com/siyuan-note/siyuan/issues/2460)
* [导入 Markdown 文档前进行重名检查](https://github.com/siyuan-note/siyuan/issues/2464)
* [alt+x 需全局缓存记忆](https://github.com/siyuan-note/siyuan/issues/2465)
* [所有本地功能完全免费](https://github.com/siyuan-note/siyuan/issues/2471)
* [大纲中的全部展开改为保持全部展开](https://github.com/siyuan-note/siyuan/issues/2476)
* [面包屑导航文本优先使用命名](https://github.com/siyuan-note/siyuan/issues/2479)
* [ `shift+左/右` 选中行内公式后 `ctr+m` 可进行编辑](https://github.com/siyuan-note/siyuan/issues/2483)
* [删除笔记本配置 .siyuan/conf.json 中的更新时间字段](https://github.com/siyuan-note/siyuan/issues/2490)
* [复制/剪切空格时会应用到块上](https://github.com/siyuan-note/siyuan/issues/2491)
* [不使用系统临时目录](https://github.com/siyuan-note/siyuan/issues/2493)
* [/ 菜单交互改进](https://github.com/siyuan-note/siyuan/issues/2506)
* [列表前的原点操作和块图标保持一致](https://github.com/siyuan-note/siyuan/issues/2509)

### 开发重构

* [重构块移动和删除](https://github.com/siyuan-note/siyuan/issues/2456)
* [重构数据提交事务实现](https://github.com/siyuan-note/siyuan/issues/2462)
* [重构容器块类型转换实现](https://github.com/siyuan-note/siyuan/issues/2467)

### 修复缺陷

* [别名、命名等属性未转义](https://github.com/siyuan-note/siyuan/issues/2447)
* [文档内粘贴并换行后文档自动关闭](https://github.com/siyuan-note/siyuan/issues/2448)
* [移动超级块内的折叠标题会丢失数据](https://github.com/siyuan-note/siyuan/issues/2450)
* [删除空行导致文本块和代码块合并](https://github.com/siyuan-note/siyuan/issues/2452)
* [导入 Markdown 时存在行级 HTML 解析报错](https://github.com/siyuan-note/siyuan/issues/2468)
* [将软换行段落使用标题打断为多个块后乱序的问题](https://github.com/siyuan-note/siyuan/issues/2472)
* [标签自动完成候选列表不全](https://github.com/siyuan-note/siyuan/issues/2473)
* [推荐码使用过多，无法看到剩余天数](https://github.com/siyuan-note/siyuan/issues/2475)
* [不期待的任务列表输入方式](https://github.com/siyuan-note/siyuan/issues/2477)
* [块中有行内公式，输入 Emoji 会消失](https://github.com/siyuan-note/siyuan/issues/2478)
* [粗体、颜色选中后再输入 bug](https://github.com/siyuan-note/siyuan/issues/2480)
* [内容块弹窗无法折叠和展开](https://github.com/siyuan-note/siyuan/issues/2481)
* [相对路径 assets 上传不了云端图床](https://github.com/siyuan-note/siyuan/issues/2482)
* [代码块换行没有进行保存](https://github.com/siyuan-note/siyuan/issues/2486)
* [日文片假名长音 `ー` 等 Unicode 字母修饰符自动空格问题](https://github.com/siyuan-note/siyuan/issues/2487)
* [任务列表前有的有 id，有的没有](https://github.com/siyuan-note/siyuan/issues/2489)
* [给行内公式加下划线样式错误](https://github.com/siyuan-note/siyuan/issues/2492)
* [/api/lute/html2BlockDOM 接口转换错误](https://github.com/siyuan-note/siyuan/issues/2498)
* [模板自定义属性问题](https://github.com/siyuan-note/siyuan/issues/2510)
* [完善引用提示补全](https://github.com/siyuan-note/siyuan/issues/2511)

## v1.2.1 / 2021-07-16

### Features

* [内容块聚焦关系图](https://github.com/siyuan-note/siyuan/issues/1388)
* [关系图全屏](https://github.com/siyuan-note/siyuan/issues/2223)
* [为图片提供更多设置](https://github.com/siyuan-note/siyuan/issues/2439)

### Enhancements

* [优化未引用资源文件加载性能](https://github.com/siyuan-note/siyuan/issues/2414)
* [复制块级元素到表格中时转换为行级元素](https://github.com/siyuan-note/siyuan/issues/2436)
* [设置备份目录路径改进](https://github.com/siyuan-note/siyuan/issues/2437)
* [文档标题保存在属性中](https://github.com/siyuan-note/siyuan/issues/2438)
* [导入 Markdown 文档时同时导入引用的资源文件](https://github.com/siyuan-note/siyuan/issues/2441)

### Bug fixes

* [打开帮助文档后引起的未找到内容块](https://github.com/siyuan-note/siyuan/issues/2432)
* [资源文件打开报错](https://github.com/siyuan-note/siyuan/issues/2434)
* [未引用资源文件统计错误](https://github.com/siyuan-note/siyuan/issues/2435)
* [导入 Markdown 文件夹时 `\` 路径未处理](https://github.com/siyuan-note/siyuan/issues/2440)
* [文档标题选中后粘贴应删除选中的内容](https://github.com/siyuan-note/siyuan/issues/2445)

## v1.2.0 / 2021-07-15

### Bug fixes

* [`#标签` 自动完成性能不好](https://github.com/siyuan-note/siyuan/issues/2424)
* [行级公式内容为空时应该自动移除标记符](https://github.com/siyuan-note/siyuan/issues/2425)
* [当前光标所在位置块字数统计错误](https://github.com/siyuan-note/siyuan/issues/2426)

## v1.2.0-rc3 / 2021-07-14

### Bug fixes

* [横排标题折叠后使用 Ctrl ↓ 展开失效](https://github.com/siyuan-note/siyuan/issues/2416)
* [打开/关闭笔记本和刷新文档树并发问题](https://github.com/siyuan-note/siyuan/issues/2417)
* [云端备份 rsync 路径错误](https://github.com/siyuan-note/siyuan/issues/2418)
* [Android 端文档树返回上一层失效](https://github.com/siyuan-note/siyuan/issues/2419)
* [Windows 安装程序问题](https://github.com/siyuan-note/siyuan/issues/2420)
* [复制图片后不应该转换 PNG 格式](https://github.com/siyuan-note/siyuan/issues/2421)
* [插入资源文件时避免重复](https://github.com/siyuan-note/siyuan/issues/2422)

## v1.2.0-rc2 / 2021-07-13

### Documentation

* [安装/升级后自动打开帮助文档](https://github.com/siyuan-note/siyuan/issues/2411)

### Bug fixes

* [代码高亮渲染不完整](https://github.com/siyuan-note/siyuan/issues/2399)
* [横排标题折叠后使用 Ctrl ↓ 展开失效](https://github.com/siyuan-note/siyuan/issues/2400)
* [Alt M 未恢复窗体状态](https://github.com/siyuan-note/siyuan/issues/2401)
* [去掉 Ctrl Click 聚焦](https://github.com/siyuan-note/siyuan/issues/2403)
* [重命名文档时 `\n`、`\t` 等没有处理](https://github.com/siyuan-note/siyuan/issues/2404)
* [Windows 上 rsync 存在性修复](https://github.com/siyuan-note/siyuan/issues/2405)
* [不允许将工作空间、备份目录设置到带空格的路径下](https://github.com/siyuan-note/siyuan/issues/2407)
* [Android 端左滑、右滑、下滑触发失效问题](https://github.com/siyuan-note/siyuan/issues/2408)
* [浏览器剪藏时没有将资源文件保存在手动建立的 assets 中](https://github.com/siyuan-note/siyuan/issues/2410)
* [PDF 页签图标错误](https://github.com/siyuan-note/siyuan/issues/2412)
* [行级公式 `&amp;` 数据订正](https://github.com/siyuan-note/siyuan/issues/2413)

## v1.2.0-rc1 / 2021-07-11

### Bug fixes

* [显示/隐藏窗口快捷键唤出时窗口不在最前](https://github.com/siyuan-note/siyuan/issues/2354)
* [导出设置块引为锚文本模式时报错](https://github.com/siyuan-note/siyuan/issues/2376)
* [托盘退出时关闭内核](https://github.com/siyuan-note/siyuan/issues/2377)
* [重命名工作空间文件夹后重启会新建一个原有的工作空间文件夹](https://github.com/siyuan-note/siyuan/issues/2379)
* [Docker 导出 Markdown 时下载地址不对](https://github.com/siyuan-note/siyuan/issues/2380)
* [行级元素 Shift 跳出不连续问题](https://github.com/siyuan-note/siyuan/issues/2381)
* [行级元素软换行后删除不了](https://github.com/siyuan-note/siyuan/issues/2382)
* [页签/文档树等 UI 元素过窄时界面会失去焦点，交互操作无响应](https://github.com/siyuan-note/siyuan/issues/2383)
* [空列表项粘贴嵌入块再撤销，就没法回车继续回车了](https://github.com/siyuan-note/siyuan/issues/2386)
* [列表内有嵌入块，列表下方按删除键无反应](https://github.com/siyuan-note/siyuan/issues/2388)
* [折叠组合移动 bug](https://github.com/siyuan-note/siyuan/issues/2389)
* [导出时子列表内标记符重复](https://github.com/siyuan-note/siyuan/issues/2390)
* [新建文档名对话框输入自适应宽度](https://github.com/siyuan-note/siyuan/issues/2391)
* [空公式解析问题](https://github.com/siyuan-note/siyuan/issues/2392)
* [中西文自动空格对上下标排版后失效](https://github.com/siyuan-note/siyuan/issues/2393)
* [foo /math 后重新打开还存在](https://github.com/siyuan-note/siyuan/issues/2394)
* [禁止行级公式派生块级公式](https://github.com/siyuan-note/siyuan/issues/2395)
* [图片下间距太长，不美观](https://github.com/siyuan-note/siyuan/issues/2396)
* [大纲、面包屑内容转义问题](https://github.com/siyuan-note/siyuan/issues/2397)
* [软换行后数学公式不会弹出公式输入框](https://github.com/siyuan-note/siyuan/issues/2398)

## v1.2.0-beta16 / 2021-07-09

### Enhancements

* [列表项带子块聚焦](https://github.com/siyuan-note/siyuan/issues/2362)
* [Windows 版允许设置安装位置](https://github.com/siyuan-note/siyuan/issues/2366)
* [阻止长按 enter 回车](https://github.com/siyuan-note/siyuan/issues/2367)
* [设置备份目录路径检查](https://github.com/siyuan-note/siyuan/issues/2368)
* [图片预览由单击改为双击](https://github.com/siyuan-note/siyuan/issues/2373)
* [大纲默认全部展开](https://github.com/siyuan-note/siyuan/issues/2374)
* [优化属性设置的性能](https://github.com/siyuan-note/siyuan/issues/2375)

### Bug fixes

* [冷启动过慢的问题](https://github.com/siyuan-note/siyuan/issues/2363)
* [回滚文档大小为 0K 的问题](https://github.com/siyuan-note/siyuan/issues/2364)
* [图片上下空行问题](https://github.com/siyuan-note/siyuan/issues/2365)
* [`<iframe ` 解析问题](https://github.com/siyuan-note/siyuan/issues/2369)

## v1.2.0-beta15 / 2021-07-08

### Features

* [双击未修改过的页签后不再进行替换](https://github.com/siyuan-note/siyuan/issues/2344)
* [Shift+↑/↓ 延续选中上/下兄弟块](https://github.com/siyuan-note/siyuan/issues/2349)
* [支持段落块段首空格或 Tab 缩进](https://github.com/siyuan-note/siyuan/issues/2356)

### Enhancements

* [有序列表拖拽第一项后应保持顺序不变](https://github.com/siyuan-note/siyuan/issues/2337)
* [面包屑文档根节点导航点击改进](https://github.com/siyuan-note/siyuan/issues/2343)
* [文字选中优化](https://github.com/siyuan-note/siyuan/issues/2345)
* [空列表数据订正](https://github.com/siyuan-note/siyuan/issues/2350)
* [缩放快捷键 `Alt+→/←`](https://github.com/siyuan-note/siyuan/issues/2351)
* [缩放 `Ctrl+Click`/`Ctrl+RightClick` 支持在非块标上操作](https://github.com/siyuan-note/siyuan/issues/2352)
* [图片右键应弹出图片菜单而非段落块菜单](https://github.com/siyuan-note/siyuan/issues/2355)
* [块引用时排除当前块](https://github.com/siyuan-note/siyuan/issues/2358)

### Bug fixes

* [浏览历史为空的问题](https://github.com/siyuan-note/siyuan/issues/2338)
* [帮助文档重复挂载问题](https://github.com/siyuan-note/siyuan/issues/2339)
* [删除标题块以后编辑报错查询内容块失败](https://github.com/siyuan-note/siyuan/issues/2340)
* [列表项拖拽合并到另一个列表第一项时的问题](https://github.com/siyuan-note/siyuan/issues/2341)
* [Docker 镜像缺失 Pandoc ](https://github.com/siyuan-note/siyuan/issues/2346)
* [粘贴行级代码时 HTML 转义问题](https://github.com/siyuan-note/siyuan/issues/2347)
* [有序列表缩进到无序列表中的 bug](https://github.com/siyuan-note/siyuan/issues/2348)

## v1.2.0-beta14 / 2021-07-06

### Enhancements

* [从右往左选中优化](https://github.com/siyuan-note/siyuan/issues/2328)
* [新版启动时自动结束老版内核](https://github.com/siyuan-note/siyuan/issues/2330)
* [全局缓存代码语言](https://github.com/siyuan-note/siyuan/issues/2331)
* [代码块自定义默认配置需和全局保持一致](https://github.com/siyuan-note/siyuan/issues/2334)

### Bug fixes

* [List block data loss](https://github.com/siyuan-note/siyuan/issues/2329)
* [图片末尾回车 bug](https://github.com/siyuan-note/siyuan/issues/2332)
* [删除文件夹时报文件被占用锁定问题](https://github.com/siyuan-note/siyuan/issues/2333)

## v1.2.0-beta13 / 2021-07-05

### Enhancements

* [增加行宽度75](https://github.com/siyuan-note/siyuan/issues/2294)
* [被其他软件占用文件时需要弹框锁定](https://github.com/siyuan-note/siyuan/issues/2309)
* [块引浮窗取消动态加载，除非点击过上下文加载按钮才启用动态加载](https://github.com/siyuan-note/siyuan/issues/2311)
* [改进重命名机制，避免使用同步盘时潜在的数据不一致](https://github.com/siyuan-note/siyuan/issues/2319)
* [体验改进](https://github.com/siyuan-note/siyuan/issues/2322)
* [浏览器中支持 Ctrl+K](https://github.com/siyuan-note/siyuan/issues/2324)
* [文档树上文件夹和文档的视觉区分](https://github.com/siyuan-note/siyuan/issues/2327)

### Bug fixes

* [导出 Markdown 时没有导出笔记本级 assets](https://github.com/siyuan-note/siyuan/issues/2312)
* [历史记录写入报错](https://github.com/siyuan-note/siyuan/issues/2313)
* [移动端切换文档时面包屑不会刷新](https://github.com/siyuan-note/siyuan/issues/2316)
* [引术块属性 bug](https://github.com/siyuan-note/siyuan/issues/2317)
* [点击两行文字的中间光标消失](https://github.com/siyuan-note/siyuan/issues/2318)
* [微软输入法中文状态下输入数字的问题](https://github.com/siyuan-note/siyuan/issues/2321)
* [编辑标题块以后内容块查询失败的问题](https://github.com/siyuan-note/siyuan/issues/2326)

## v1.2.0-beta12 / 2021-07-03

### Features

* [支持插入音频、视频和图片后设置链接](https://github.com/siyuan-note/siyuan/issues/2302)
* [为块元素添加字体、背景、镂空、阴影、发光效果](https://github.com/siyuan-note/siyuan/issues/2306)

### Enhancements

* [块引浮窗上下文加载按钮](https://github.com/siyuan-note/siyuan/issues/2262)
* [折叠标题性能优化](https://github.com/siyuan-note/siyuan/issues/2281)
* [导出时块引锚文本加上 siyuan:// 块链](https://github.com/siyuan-note/siyuan/issues/2282)
* [拖拽时隐藏块前图标提示](https://github.com/siyuan-note/siyuan/issues/2283)
* [固定面包屑导航](https://github.com/siyuan-note/siyuan/issues/2285)
* [拖拽块前图标无法向上滚动](https://github.com/siyuan-note/siyuan/issues/2287)
* [导出的多级列表样式和编辑器中不一致](https://github.com/siyuan-note/siyuan/issues/2288)
* [优化全局搜索结果排序](https://github.com/siyuan-note/siyuan/issues/2289)
* [支持行内代码连字](https://github.com/siyuan-note/siyuan/issues/2295)
* [列表样式不随着字体大小改变而变化](https://github.com/siyuan-note/siyuan/issues/2296)
* [兼容主题菜单样式错误](https://github.com/siyuan-note/siyuan/issues/2300)
* [支持视频、音频、iframe 的居中、居左、居右配置](https://github.com/siyuan-note/siyuan/issues/2301)
* [嵌入块 `{{` 后不弹出 SQL 代码框，而是类似 `((` 后自动搜索关键字](https://github.com/siyuan-note/siyuan/issues/2305)

### Bug fixes

* [子块折叠后位置错位](https://github.com/siyuan-note/siyuan/issues/2284)
* [列表删除后仍然可被引用](https://github.com/siyuan-note/siyuan/issues/2293)
* [输入中文双引号时，会出现文本显示错位，之后输入文本，光标会丢失](https://github.com/siyuan-note/siyuan/issues/2297)
* [公式导出时大于号、小于号等错误地转换为了 HTML 实体](https://github.com/siyuan-note/siyuan/issues/2298)
* [文件树拖拽间隔过短会失败](https://github.com/siyuan-note/siyuan/issues/2299)
* [段落块意外的块属性修正](https://github.com/siyuan-note/siyuan/issues/2307)
* [文档转换标题时层级计算溢出](https://github.com/siyuan-note/siyuan/issues/2308)

## v1.2.0-beta11 / 2021-07-01

### Features

* [列表项多选缩进及反向缩进](https://github.com/siyuan-note/siyuan/issues/1392)
* [重写文档数据写入机制，锁定文件提升稳定性](https://github.com/siyuan-note/siyuan/issues/2257)

### Enhancements

* [用 `Ctrl+/` 调出块标菜单后可支持方向键和回车键进行操作](https://github.com/siyuan-note/siyuan/issues/2078)
* [点击文档，高亮大纲中对应的标题](https://github.com/siyuan-note/siyuan/issues/2195)
* [表格细节改进](https://github.com/siyuan-note/siyuan/issues/2210)
* [点击块右上角的属性后将光标定位到该属性的输入框中](https://github.com/siyuan-note/siyuan/issues/2224)
* [剪切链接后粘贴问题](https://github.com/siyuan-note/siyuan/issues/2231)
* [输入法中数字的句号无法转换为点](https://github.com/siyuan-note/siyuan/issues/2237)
* [增加段落块转换类型支持](https://github.com/siyuan-note/siyuan/issues/2238)
* [引用过多时，优化悬浮窗性能](https://github.com/siyuan-note/siyuan/issues/2246)
* [搜索结果中存在命名别名的块排序优先](https://github.com/siyuan-note/siyuan/issues/2251)
* [嵌入块搜索忽略类型过滤](https://github.com/siyuan-note/siyuan/issues/2252)
* [搜索结果高亮](https://github.com/siyuan-note/siyuan/issues/2254)
* [文档手动刷新按钮](https://github.com/siyuan-note/siyuan/issues/2256)
* [优化移动端横向排版效果](https://github.com/siyuan-note/siyuan/issues/2259)
* [顿号唤出菜单仅限于斜杆，反斜杠按钮打出的顿号不再唤出菜单](https://github.com/siyuan-note/siyuan/issues/2261)
* [改进空块提示](https://github.com/siyuan-note/siyuan/issues/2263)
* [调整编辑器大小时，块符号不跟随](https://github.com/siyuan-note/siyuan/issues/2266)
* [切换/编辑文档时保持大纲折叠状态](https://github.com/siyuan-note/siyuan/issues/2268)
* [从备份恢复后需要重新启动](https://github.com/siyuan-note/siyuan/issues/2273)
* [Android 通过通知栏保活](https://github.com/siyuan-note/siyuan/issues/2274)
* [简化块标、聚焦面包屑导航](https://github.com/siyuan-note/siyuan/issues/2278)

### Bug fixes

* [`<kbd>` 中反斜杠转义问题](https://github.com/siyuan-note/siyuan/issues/2242)
* [首行是列表块时光标上移 bug](https://github.com/siyuan-note/siyuan/issues/2245)
* [标题折叠展开相关问题](https://github.com/siyuan-note/siyuan/issues/2248)
* [Do not allow to write data during boot](https://github.com/siyuan-note/siyuan/issues/2253)
* [Docker 部署时下载云端数据备份异常](https://github.com/siyuan-note/siyuan/issues/2255)
* [代码块粘贴文本以换行符结尾时, 最后一行无法删除](https://github.com/siyuan-note/siyuan/issues/2258)
* [wrap code bug](https://github.com/siyuan-note/siyuan/issues/2264)
* [登录账号需要输入验证码时没有显示验证码的问题](https://github.com/siyuan-note/siyuan/issues/2271)
* [剪藏微信公众号全选报错问题](https://github.com/siyuan-note/siyuan/issues/2275)
* [列表中嵌套超级块后无法点击左侧图标](https://github.com/siyuan-note/siyuan/issues/2277)
* [表格内存在行级公式时编辑会产生换行](https://github.com/siyuan-note/siyuan/issues/2279)

## v1.2.0-beta10 / 2021-06-26

### Features

* [浏览器剪藏扩展支持设置内核接口地址](https://github.com/siyuan-note/siyuan/issues/2203)
* [资源文件相对路径伺服](https://github.com/siyuan-note/siyuan/issues/2236)

### Enhancements

* [高亮排版时删除内部多余的空格](https://github.com/siyuan-note/siyuan/issues/2169)
* [大纲折叠优化](https://github.com/siyuan-note/siyuan/issues/2199)
* [菜单项过多时需进行滚动](https://github.com/siyuan-note/siyuan/issues/2201)
* [行首为公式时无法使用 `Home` 键定位到行首](https://github.com/siyuan-note/siyuan/issues/2204)
* [文档大纲缩进优化](https://github.com/siyuan-note/siyuan/issues/2205)
* [PDF、HTML 导出需要付费订阅](https://github.com/siyuan-note/siyuan/issues/2206)
* [任务列表块内容和方块标记不对齐](https://github.com/siyuan-note/siyuan/issues/2207)
* [文章标题能够自动换行](https://github.com/siyuan-note/siyuan/issues/2213)
* [汉字与假名的自动空格问题](https://github.com/siyuan-note/siyuan/issues/2214)
* [文档编辑时如果没有权限写入数据需要及时在界面上提醒](https://github.com/siyuan-note/siyuan/issues/2220)
* [斜杆菜单位置和大小优化](https://github.com/siyuan-note/siyuan/issues/2221)
* [重命名后光标应再回到编辑器中](https://github.com/siyuan-note/siyuan/issues/2227)
* [增加图片拖拽区域范围](https://github.com/siyuan-note/siyuan/issues/2228)

### Bug fixes

* [代码块在缩小字体字号时，左边有部分内容被隐藏，整体往左偏移了一些像素。](https://github.com/siyuan-note/siyuan/issues/2178)
* [搜索面板搜索为空且关闭报错](https://github.com/siyuan-note/siyuan/issues/2202)
* [后缀名为空的文件拖动到笔记时无法自动复制](https://github.com/siyuan-note/siyuan/issues/2208)
* [含有视频网站链接的文章无法导出 pdf](https://github.com/siyuan-note/siyuan/issues/2209)
* [SQL 全局搜索不应该转换小写](https://github.com/siyuan-note/siyuan/issues/2211)
* [查看云端空间占用为零的问题](https://github.com/siyuan-note/siyuan/issues/2212)
* [列表前一个块结尾 Delete 后删除逻辑问题](https://github.com/siyuan-note/siyuan/issues/2218)
* [嵌入块中的图片图标遮挡住了嵌入块的操作按钮](https://github.com/siyuan-note/siyuan/issues/2225)
* [调整历史生成间隔以后没有即时生效](https://github.com/siyuan-note/siyuan/issues/2226)
* [链接后粘贴链接问题](https://github.com/siyuan-note/siyuan/issues/2232)
* [粘贴 Excel 变成图片的问题](https://github.com/siyuan-note/siyuan/issues/2235)

## v1.2.0-beta9 / 2021-06-23

### 引入特性

* [Global search with path filter](https://github.com/siyuan-note/siyuan/issues/1995)

### 改进功能

* [中西文自动空格计入 `@` 符号](https://github.com/siyuan-note/siyuan/issues/2164)
* [表格内容三击操作有问题](https://github.com/siyuan-note/siyuan/issues/2168)
* [copy individual image locally](https://github.com/siyuan-note/siyuan/issues/2171)
* [持久化保存备份密码，避免每次都需要输入](https://github.com/siyuan-note/siyuan/issues/2173)
* [笔记本 backup 目录重命名为 history](https://github.com/siyuan-note/siyuan/issues/2175)
* [数学公式改进](https://github.com/siyuan-note/siyuan/issues/2181)
* [嵌入块手动刷新](https://github.com/siyuan-note/siyuan/issues/2184)
* [行级公式编辑框不允许换行](https://github.com/siyuan-note/siyuan/issues/2187)
* [脑图编辑支持 tab](https://github.com/siyuan-note/siyuan/issues/2192)
* [表格内粘贴优化](https://github.com/siyuan-note/siyuan/issues/2193)

### 修复缺陷

* [整段文字加颜色着重,行内公式上移](https://github.com/siyuan-note/siyuan/issues/2170)
* [大小写影响提及转换链接](https://github.com/siyuan-note/siyuan/issues/2172)
* [标题折叠取消超级块时内容丢失](https://github.com/siyuan-note/siyuan/issues/2174)
* [文档标题栏不应该显示其子块引用计数](https://github.com/siyuan-note/siyuan/issues/2183)
* [任务列表转换有序列表序号不正确](https://github.com/siyuan-note/siyuan/issues/2185)
* [导出 Markdown 时包含中文名的资源文件没有导出](https://github.com/siyuan-note/siyuan/issues/2186)
* [删除折叠标题时恢复下方块为展开状态](https://github.com/siyuan-note/siyuan/issues/2188)
* [同一个文档中移动折叠标题导致内容重复](https://github.com/siyuan-note/siyuan/issues/2189)
* [块引时候选列表中点击块标插入位置问题](https://github.com/siyuan-note/siyuan/issues/2191)
* [双栏操作下光标会出现跳回上次操作的位置](https://github.com/siyuan-note/siyuan/issues/2196)
* [多选先“转换为引述”，再“转换为无序列表”内容丢失](https://github.com/siyuan-note/siyuan/issues/2197)

## v1.2.0-beta8 / 2021-06-18

### Features

* [标题块带下方块折叠和移动](https://github.com/siyuan-note/siyuan/issues/2097)
* [为代码块单独提供换行、连字符和行号配置](https://github.com/siyuan-note/siyuan/issues/2144)

### Enhancements

* [切换 tab 不应该失去光标焦点](https://github.com/siyuan-note/siyuan/issues/2156)
* [禁止在表格中多选单元格进行格式化排版](https://github.com/siyuan-note/siyuan/issues/2157)
* [引用块面板全局滚动条无法使用鼠标进行拖动](https://github.com/siyuan-note/siyuan/issues/2158)
* [Improve undo](https://github.com/siyuan-note/siyuan/issues/2159)
* [属性面板支持回车确定](https://github.com/siyuan-note/siyuan/issues/2163)

### Bug fixes

* [命名及备注标识被遮挡](https://github.com/siyuan-note/siyuan/issues/2153)
* [Cannot remove bookmark for doc](https://github.com/siyuan-note/siyuan/issues/2154)
* [正文中出现滑块](https://github.com/siyuan-note/siyuan/issues/2155)
* [列表项中包含子列表和段落，回车错误](https://github.com/siyuan-note/siyuan/issues/2161)
* [脑图和图表上下动态加载后会消失](https://github.com/siyuan-note/siyuan/issues/2162)

## v1.2.0-beta7 / 2021-06-16

### Features

* [Docker rsync](https://github.com/siyuan-note/siyuan/issues/2040)
* [笔记本 assets 资源文件伺服](https://github.com/siyuan-note/siyuan/issues/2113)
* [支持剪藏 SVG](https://github.com/siyuan-note/siyuan/issues/2151)

### Enhancements

* [属性设置交互优化](https://github.com/siyuan-note/siyuan/issues/2129)
* [resize heading with folding quoteblock](https://github.com/siyuan-note/siyuan/issues/2134)
* [Cursor Position Wrong When Typing Math Formula](https://github.com/siyuan-note/siyuan/issues/2135)
* [Enhancement of naming and memo functions](https://github.com/siyuan-note/siyuan/issues/2136)
* [块引悬浮层加载上下文](https://github.com/siyuan-note/siyuan/issues/2139)
* [折叠逻辑修改](https://github.com/siyuan-note/siyuan/issues/2142)
* [改进导出 pdf 中的数学公式渲染](https://github.com/siyuan-note/siyuan/issues/2147)
* [Add refresh button on the bookmark toolbar](https://github.com/siyuan-note/siyuan/issues/2149)
* [优化粘贴大量数据时的性能](https://github.com/siyuan-note/siyuan/issues/2150)

### Bug fixes

* [设置 - 资源界面卡住问题](https://github.com/siyuan-note/siyuan/issues/2126)
* [剪藏某些网页图片路径重复问题](https://github.com/siyuan-note/siyuan/issues/2130)
* [PPT 渲染无法解析数学公式、代码块等](https://github.com/siyuan-note/siyuan/issues/2132)
* [Resize image not work](https://github.com/siyuan-note/siyuan/issues/2133)
* [带编号的公式显示不正常](https://github.com/siyuan-note/siyuan/issues/2140)
* [反斜杠 `\` 转义后再打开文档会重复显示](https://github.com/siyuan-note/siyuan/issues/2141)
* [模板空列表项解析问题](https://github.com/siyuan-note/siyuan/issues/2143)
* [自定义排序移动文件夹后失效的问题](https://github.com/siyuan-note/siyuan/issues/2145)
* [无法撤销第一个操作](https://github.com/siyuan-note/siyuan/issues/2148)

## v1.2.0-beta6 / 2021-06-13

### Features

* [Support custom block attributes](https://github.com/siyuan-note/siyuan/issues/1719)
* [添加居中/左/右快捷键](https://github.com/siyuan-note/siyuan/issues/2091)
* [横排分栏宽度调整](https://github.com/siyuan-note/siyuan/issues/2125)

### Enhancements

* [命名、别名、备注和书签合并到属性设置中](https://github.com/siyuan-note/siyuan/issues/1275)
* [图片标题入库](https://github.com/siyuan-note/siyuan/issues/2100)
* [Want to unify the folding style for list and list item](https://github.com/siyuan-note/siyuan/issues/2104)
* [移动端代码块折行问题](https://github.com/siyuan-note/siyuan/issues/2106)
* [从其他软件复制带图内容改进](https://github.com/siyuan-note/siyuan/issues/2110)
* [行内公式的新问题](https://github.com/siyuan-note/siyuan/issues/2112)
* [结合 shift↑ 为块添加展开/折叠快捷键 ⌘↑](https://github.com/siyuan-note/siyuan/issues/2114)
* [图片居中以后，同一段落输入文本，图片的居中会被取消](https://github.com/siyuan-note/siyuan/issues/2117)
* [不锁定日志文件](https://github.com/siyuan-note/siyuan/issues/2122)
* [缩短备份文件名，避免一些系统上路径过长报错](https://github.com/siyuan-note/siyuan/issues/2124)

### Bug fixes

* [任务列表转换段落问题](https://github.com/siyuan-note/siyuan/issues/2102)
* [Android 端横屏重启问题](https://github.com/siyuan-note/siyuan/issues/2107)
* [行级元素拖拽移动问题](https://github.com/siyuan-note/siyuan/issues/2108)
* [备注预览显示默认 `memo` 文案问题](https://github.com/siyuan-note/siyuan/issues/2109)
* [重启后访问授权码被随机重置问题](https://github.com/siyuan-note/siyuan/issues/2115)
* [未引用资源预览样式不正确、最后一个资源无法删除](https://github.com/siyuan-note/siyuan/issues/2116)
* [剪藏时如果包含长图片名路径时会报错](https://github.com/siyuan-note/siyuan/issues/2119)
* [备份恢复报错 `open xxx/decrypt: is a directory`](https://github.com/siyuan-note/siyuan/issues/2120)
* [剪切、粘贴引用块后，被剪切的块会留在原地](https://github.com/siyuan-note/siyuan/issues/2123)

## v1.2.0-beta5 / 2021-06-10

### Features

* [引入挂件块伺服](https://github.com/siyuan-note/siyuan/issues/2093)

### Enhancements

* [Support select, copy, cut and enter to edit ](https://github.com/siyuan-note/siyuan/issues/2069)
* [文字选中进行操作处理时,能否自动跳过公式?](https://github.com/siyuan-note/siyuan/issues/2076)
* [自定义加密备份存放路径](https://github.com/siyuan-note/siyuan/issues/2077)
* [备注悬浮预览](https://github.com/siyuan-note/siyuan/issues/2080)
* [上下键会跳过空段落](https://github.com/siyuan-note/siyuan/issues/2082)
* [字体加粗后删除依旧为粗体](https://github.com/siyuan-note/siyuan/issues/2086)
* [数据库结构变更后强制重建库](https://github.com/siyuan-note/siyuan/issues/2088)
* [开源端到端加密代码](https://github.com/siyuan-note/siyuan/issues/2095)
* [为代码块添加 144 种主题及对 verilog 的支持](https://github.com/siyuan-note/siyuan/issues/2103)

### Bug fixes

* [Blockquote data loss](https://github.com/siyuan-note/siyuan/issues/2075)
* [不同笔记本下创建了同名笔记的问题](https://github.com/siyuan-note/siyuan/issues/2081)
* [行内公式在一行之首时无法缩到上一行](https://github.com/siyuan-note/siyuan/issues/2083)
* [块引单引号影响搜索](https://github.com/siyuan-note/siyuan/issues/2089)
* [标题转换文档数据丢失](https://github.com/siyuan-note/siyuan/issues/2094)
* [一些网站无法使用 IFrame 嵌入的问题](https://github.com/siyuan-note/siyuan/issues/2096)

## v1.2.0-beta4 / 2021-06-07

### Features

* [Mermaid click callback ](https://github.com/siyuan-note/siyuan/issues/2042)

### Enhancements

* [发布新的 Docker 镜像，请注意备份数据和修改启动参数](https://github.com/siyuan-note/siyuan/issues/2070)

### Bug fixes

* [`kbd` 和下划线的解析问题 ](https://github.com/siyuan-note/siyuan/issues/2068)
* [资源文件 Assets 相关的一些列问题](https://github.com/siyuan-note/siyuan/issues/2072)
* [添加的标签没有显示在标签栏](https://github.com/siyuan-note/siyuan/issues/2073)
* [插入模板后会出现在页面的上方](https://github.com/siyuan-note/siyuan/issues/2074)

## v1.2.0-beta3 / 2021-06-07

Bug fixes and improves details.

## v1.2.0-beta2 / 2021-06-05

Bug fixes and improves details.

## v1.2.0-beta1 / 2021-06-03

### Features

* [Outline expand collapse all](https://github.com/siyuan-note/siyuan/issues/564)
* [Horizontal layout of content blocks](https://github.com/siyuan-note/siyuan/issues/790)
* [Block zoom-in](https://github.com/siyuan-note/siyuan/issues/1231)
* [Support underline](https://github.com/siyuan-note/siyuan/issues/1773)
* [Support cross notebook block ref](https://github.com/siyuan-note/siyuan/issues/1853)
* [Document dynamic loading](https://github.com/siyuan-note/siyuan/issues/1977)
* [Block drag](https://github.com/siyuan-note/siyuan/issues/1980)
* [Use Protyle instead of Vditor for the editor](https://github.com/siyuan-note/siyuan/issues/1981)
* [List outline](https://github.com/siyuan-note/siyuan/issues/1983)
* [WYSIWYG instead of IR](https://github.com/siyuan-note/siyuan/issues/1985)
* [Local workspace dir](https://github.com/siyuan-note/siyuan/issues/2016)
* [New assets serve](https://github.com/siyuan-note/siyuan/issues/2019)
* [Chrome extension for content copy](https://github.com/siyuan-note/siyuan/issues/2035)
* [Support upload assets of a single doc to cloud](https://github.com/siyuan-note/siyuan/issues/2041)
* [Auto copy local attachments to assets when pasting from Word](https://github.com/siyuan-note/siyuan/issues/2043)
* [Batch export standard Markdown with assets](https://github.com/siyuan-note/siyuan/issues/2047)
* [Support export to `.docx`](https://github.com/siyuan-note/siyuan/issues/2054)
* [End-to-end encryption backup](https://github.com/siyuan-note/siyuan/issues/2056)

### Enhancements

* [Editing freezes when rendering a large number of mathematical formulas](https://github.com/siyuan-note/siyuan/issues/845)
* [Support the preview and export for query embed block](https://github.com/siyuan-note/siyuan/issues/1362)
* [Improve function in image scale mode](https://github.com/siyuan-note/siyuan/issues/1739)
* [Editor redo/undo](https://github.com/siyuan-note/siyuan/issues/1988)
* [Rename editor options](https://github.com/siyuan-note/siyuan/issues/2000)
* [Change the doc data file format to `.sy`](https://github.com/siyuan-note/siyuan/issues/2002)
* [Optimize the writing performance of large document data](https://github.com/siyuan-note/siyuan/issues/2005)
* [Change embed query block syntax from `!{{script}}` to `{{script}}`](https://github.com/siyuan-note/siyuan/issues/2020)
* [Template use `.md`, save under workspace data dir `templates`](https://github.com/siyuan-note/siyuan/issues/2023)
* [Conf dir move to $workspace/conf/](https://github.com/siyuan-note/siyuan/issues/2029)
* [Boot parameter `--workspace` instead of `--conf` and `--data`](https://github.com/siyuan-note/siyuan/issues/2030)
* [Table `blocks` add columns](https://github.com/siyuan-note/siyuan/issues/2044)
* [Improve performance of boot indexing](https://github.com/siyuan-note/siyuan/issues/2046)

### Docs

* [Weaken Markdown related content in the user guide](https://github.com/siyuan-note/siyuan/issues/2001)

### Abolishments

* [Remove editor options](https://github.com/siyuan-note/siyuan/issues/1997)
* [Remove export option `fixTermTypo`](https://github.com/siyuan-note/siyuan/issues/1998)
* [Remove YAML Front Matter support](https://github.com/siyuan-note/siyuan/issues/2006)
* [Remove HTML Block and Inline HTML rendering](https://github.com/siyuan-note/siyuan/issues/2007)
* [Remove block ref anchor text template `{{.text}}`](https://github.com/siyuan-note/siyuan/issues/2008)
* [Remove block ref anchor text inline parsing](https://github.com/siyuan-note/siyuan/issues/2009)
* [Remove block embed `!((id))`](https://github.com/siyuan-note/siyuan/issues/2011)
* [Remove Markdown footnotes support](https://github.com/siyuan-note/siyuan/issues/2012)
* [Remove Markdown link ref support](https://github.com/siyuan-note/siyuan/issues/2013)
* [Remove find in page and find replace](https://github.com/siyuan-note/siyuan/issues/2014)
* [Remove filetree options](https://github.com/siyuan-note/siyuan/issues/2017)
* [Remove WebDAV support](https://github.com/siyuan-note/siyuan/issues/2018)
* [Remove template call syntax `{{`, use `/` as the entry](https://github.com/siyuan-note/siyuan/issues/2021)
* [Remove expert mode](https://github.com/siyuan-note/siyuan/issues/2022)
* [Remove sync option in notebook conf and global conf](https://github.com/siyuan-note/siyuan/issues/2025)
* [Remove `[toc]`](https://github.com/siyuan-note/siyuan/issues/2026)
* [Remove `siyuan://notebooks/{notebook_name}/blocks/{id}`](https://github.com/siyuan-note/siyuan/issues/2031)
* [Remove Mindmap](https://github.com/siyuan-note/siyuan/issues/2032)
* [Remove auto fetch remote image to local](https://github.com/siyuan-note/siyuan/issues/2033)
* [Remove search text mode](https://github.com/siyuan-note/siyuan/issues/2034)
* [Remove indent code block](https://github.com/siyuan-note/siyuan/issues/2037)
* [Remove TextBundle export](https://github.com/siyuan-note/siyuan/issues/2048)
* [Remove MathJax engine](https://github.com/siyuan-note/siyuan/issues/2051)
* [Remove cloud online workspace and publishing](https://github.com/siyuan-note/siyuan/issues/2055)

### Bug fixes

* [Change account then sync: auth failed](https://github.com/siyuan-note/siyuan/issues/581)
* [Edit heading after code block issue](https://github.com/siyuan-note/siyuan/issues/727)
* [Emoji issue when using Microsoft PinYin](https://github.com/siyuan-note/siyuan/issues/1555)
* [Doc tree custom sorting bug](https://github.com/siyuan-note/siyuan/issues/2049)

## v1.1.83 / 2021-04-09

### Enhancements

* [Improve export block ref mode option](https://github.com/siyuan-note/siyuan/issues/1976)
* [Template folder should NOT be included while rendering global graph](https://github.com/siyuan-note/siyuan/issues/1978)

### Bug fixes

* [The image is not displayed when other machines in the local area network access](https://github.com/siyuan-note/siyuan/issues/1975)
* [Boot failed on macOS M1](https://github.com/siyuan-note/siyuan/issues/1982)

## v1.1.82 / 2021-04-06

### Enhancements

* [Android edit even when there is no internet](https://github.com/siyuan-note/siyuan/issues/1615)
* [Persist auth code on Android](https://github.com/siyuan-note/siyuan/issues/1831)
* [Built-in rsync for macOS Apple Silicon](https://github.com/siyuan-note/siyuan/issues/1964)
* [Optimize the network, reduce the delay of login and synchronization](https://github.com/siyuan-note/siyuan/issues/1965)
* [Copy content should remove heading marker](https://github.com/siyuan-note/siyuan/issues/1966)
* [Do not check requests from `127.0.0.1`](https://github.com/siyuan-note/siyuan/issues/1967)
* [Export PDF remove iframe](https://github.com/siyuan-note/siyuan/issues/1969)
* [Update the right-click menu of the file tree and tabs](https://github.com/siyuan-note/siyuan/issues/1971)

### Bug fixes

* [Can't show the image when export PDF with network images](https://github.com/siyuan-note/siyuan/issues/1968)
* [Content loss caused by iframe not closing](https://github.com/siyuan-note/siyuan/issues/1970)
* [`# 1. foo` ref as anchor text template will be rendered to `foo`](https://github.com/siyuan-note/siyuan/issues/1972)
* [Enter the sublist under the task list](https://github.com/siyuan-note/siyuan/issues/1973)
* [List in the blockquote can not move to up](https://github.com/siyuan-note/siyuan/issues/1974)

## v1.1.81 / 2021-04-04

### Enhancements

* [Add copy button for block code](https://github.com/siyuan-note/siyuan/issues/1959)
* [Improve sync stability](https://github.com/siyuan-note/siyuan/issues/1960)
* [When there is only one block in the list item, insert an empty block to become a list item](https://github.com/siyuan-note/siyuan/issues/1961)
* [Add remove block for gutter icon](https://github.com/siyuan-note/siyuan/issues/1962)

### Bug fixes

* [When pasting code in code block it creates new lines](https://github.com/siyuan-note/siyuan/issues/1938)

## v1.1.8 / 2021-04-03

### Features

* [Use file copy instead of Git for versioning](https://github.com/siyuan-note/siyuan/issues/1940)

### Enhancements

* [Gutter icon add cut function](https://github.com/siyuan-note/siyuan/issues/1946)
* [Add some shortcut keys](https://github.com/siyuan-note/siyuan/issues/1947)
* [Improve conf file read/write](https://github.com/siyuan-note/siyuan/issues/1948)
* [The spacing between pictures with description and pictures without description should be the same](https://github.com/siyuan-note/siyuan/issues/1951)
* [Built-int rsync on macOS 10](https://github.com/siyuan-note/siyuan/issues/1955)
* [Add local protocol recognition](https://github.com/siyuan-note/siyuan/issues/1956)

### Bug fixes

* [Uploading assets takes a lot of time](https://github.com/siyuan-note/siyuan/issues/1945)
* [Boot param `--authCode` not work](https://github.com/siyuan-note/siyuan/issues/1949)
* [Delete at the beginning of the block below will delete the end of the block above](https://github.com/siyuan-note/siyuan/issues/1950)
* [Sometimes failed to parse standard Markdown when importing](https://github.com/siyuan-note/siyuan/issues/1954)
* [Fix the display of markers in popover and embed blocks](https://github.com/siyuan-note/siyuan/issues/1958)

## v1.1.7 / 2021-04-02

### Features

* [Open SiYuan via protocol `siyuan://`](https://github.com/siyuan-note/siyuan/issues/1896)
* [Insert mp4/mov/webm convert to `<video>`](https://github.com/siyuan-note/siyuan/issues/1909)
* [Support fold/unfold block on Android](https://github.com/siyuan-note/siyuan/issues/1919)
* [When exporting html, the image can use the CDN address](https://github.com/siyuan-note/siyuan/issues/1930)

### Enhancements

* [Sometimes the arrow keys cannot control the cursor](https://github.com/siyuan-note/siyuan/issues/1108)
* [Add a switch option for cloud assets storage](https://github.com/siyuan-note/siyuan/issues/1808)
* [There is an empty paragraph before the heading, delete before the heading should keep the title and its id](https://github.com/siyuan-note/siyuan/issues/1890)
* [Convert `<br>` to `\n` when copy as standard Markdown](https://github.com/siyuan-note/siyuan/issues/1920)
* [Pasting two paragraphs into the table should not be merged](https://github.com/siyuan-note/siyuan/issues/1921)
* [Built-in rsync on macOS](https://github.com/siyuan-note/siyuan/issues/1925)
* [Display boot progress on Android](https://github.com/siyuan-note/siyuan/issues/1927)
* [No longer provide Windows zip decompression version](https://github.com/siyuan-note/siyuan/issues/1933)
* [No longer support open multiple instances](https://github.com/siyuan-note/siyuan/issues/1935)
* [After clicking, hide the prompt panel](https://github.com/siyuan-note/siyuan/issues/1942)
* [It is not allowed to close the tab during upload](https://github.com/siyuan-note/siyuan/issues/1943)

### Bug fixes

* [Copy the order list and paste it will become a list](https://github.com/siyuan-note/siyuan/issues/1789)
* [The result of the query with level-3 tags is empty](https://github.com/siyuan-note/siyuan/issues/1911)
* [Failed to parse when copy code block](https://github.com/siyuan-note/siyuan/issues/1922)
* [Data is not overwritten according to the update time when multiple devices are synchronized](https://github.com/siyuan-note/siyuan/issues/1926)
* [Block ref inline code issue](https://github.com/siyuan-note/siyuan/issues/1928)
* [WebSocket connection auth](https://github.com/siyuan-note/siyuan/issues/1937)
* [Changing the task to the list should remove the class vditor-task-complete](https://github.com/siyuan-note/siyuan/issues/1941)

## v1.1.6 / 2021-03-29

### Features

* [Support config Tab width in the code block](https://github.com/siyuan-note/siyuan/issues/705)
* [Edit code block in place](https://github.com/siyuan-note/siyuan/issues/1374)
* [Support backup for deleting files](https://github.com/siyuan-note/siyuan/issues/1893)
* [Support auto sync mode](https://github.com/siyuan-note/siyuan/issues/1910)

### Enhancements

* [Code block line wrap configuration](https://github.com/siyuan-note/siyuan/issues/708)
* [Improve Ctrl+Shift+B in the list item](https://github.com/siyuan-note/siyuan/issues/1790)
* [Improve code block search](https://github.com/siyuan-note/siyuan/issues/1826)
* [Optimize the drag and drop performance of block elements in the editor](https://github.com/siyuan-note/siyuan/issues/1894)
* [Code block or math block ref anchor text template display all content](https://github.com/siyuan-note/siyuan/issues/1895)
* [Add copy code function for Export HTML](https://github.com/siyuan-note/siyuan/issues/1899)
* [Count the contents of code blocks and formula blocks into the character count](https://github.com/siyuan-note/siyuan/issues/1901)
* [When copying a block reference, the anchor text is the name](https://github.com/siyuan-note/siyuan/issues/1903)
* [Supports sync of notebooks that contain spaces in the path](https://github.com/siyuan-note/siyuan/issues/1904)
* [In the editor, you can set whether to render mathematical formulas](https://github.com/siyuan-note/siyuan/issues/1905)
* [Support mathematica, lisp, clojure, Fortran language in code block](https://github.com/siyuan-note/siyuan/issues/1906)
* [Add copy block id](https://github.com/siyuan-note/siyuan/issues/1913)
* [Outline search ignores case](https://github.com/siyuan-note/siyuan/issues/1914)
* [Add a link to automatically recognize the file protocol](https://github.com/siyuan-note/siyuan/issues/1915)
* [The attachment in the embed block cannot be opened by clicking](https://github.com/siyuan-note/siyuan/issues/1916)
* [Improve init language detect on Android](https://github.com/siyuan-note/siyuan/issues/1917)

### Bug fixes

* [Do not change `[[wikilink]]` text if not found ref](https://github.com/siyuan-note/siyuan/issues/1843)
* [Blockquote in the list, enter will change to list item](https://github.com/siyuan-note/siyuan/issues/1897)
* [The database will be cleared when the UI is launched for the second time while the kernel is resident](https://github.com/siyuan-note/siyuan/issues/1898)
* [Import templates should not be wrapped in paragraphs](https://github.com/siyuan-note/siyuan/issues/1900)
* [Failed to parse name, alias or memo (IAL properties) including `}`](https://github.com/siyuan-note/siyuan/issues/1902)
* [Invalid permission when sync download](https://github.com/siyuan-note/siyuan/issues/1908)
* [Can't convert backmention to backlink for doc name ref](https://github.com/siyuan-note/siyuan/issues/1918)

## v1.1.5 / 2021-03-23

### Features

* [Delete bookmarks directly in the bookmarks panel](https://github.com/siyuan-note/siyuan/issues/1619)
* [Add copy function to assets files](https://github.com/siyuan-note/siyuan/issues/1889)

### Enhancements

* [Failed to fetch image when copy-pasting HTML](https://github.com/siyuan-note/siyuan/issues/1792)
* [Support sync path containing non-ASCII characters on Windows](https://github.com/siyuan-note/siyuan/issues/1865)
* [Graph's title and label display HTML entity](https://github.com/siyuan-note/siyuan/issues/1866)
* [Support using CSS to set Graph font family](https://github.com/siyuan-note/siyuan/issues/1867)
* [Variables missing in the theme are replaced by official theme variables](https://github.com/siyuan-note/siyuan/issues/1871)
* [Support for querying the set fonts](https://github.com/siyuan-note/siyuan/issues/1874)
* [Local graph show related tag only](https://github.com/siyuan-note/siyuan/issues/1878)
* [Table `blocks` add field `length`](https://github.com/siyuan-note/siyuan/issues/1879)
* [Improve HTML code block parse](https://github.com/siyuan-note/siyuan/issues/1880)
* [Pin pdf toolbar](https://github.com/siyuan-note/siyuan/issues/1881)
* [Keep the editable state of the embed block consistent with the editor](https://github.com/siyuan-note/siyuan/issues/1883)
* [Add hotkey to open new tab for ref and embed block](https://github.com/siyuan-note/siyuan/issues/1884)
* [`Ctrl+Shift+X` in the block ref, only remove ref](https://github.com/siyuan-note/siyuan/issues/1886)
* [Improve file tree listing performance](https://github.com/siyuan-note/siyuan/issues/1887)
* [After pressing enter before the heading, the previous element needs to become a paragraph](https://github.com/siyuan-note/siyuan/issues/1892)

### Bug fixes

* [A newline will be added after the heading of the super block](https://github.com/siyuan-note/siyuan/issues/1841)
* [Gutter icon can not show updated time](https://github.com/siyuan-note/siyuan/issues/1868)
* [Lost content when indenting list items with Tab](https://github.com/siyuan-note/siyuan/issues/1869)
* [Custom theme styles are corrupted after the restart ](https://github.com/siyuan-note/siyuan/issues/1872)
* [Lost properties after converting Doc-Heading](https://github.com/siyuan-note/siyuan/issues/1873)
* [Invalid Git commit time on macOS](https://github.com/siyuan-note/siyuan/issues/1876)
* [Improve list outdent](https://github.com/siyuan-note/siyuan/issues/1877)
* [Cannot open embed block in Android](https://github.com/siyuan-note/siyuan/issues/1882)

## v1.1.4 / 2021-03-19

### Features

* [Use vis.js instead of D3.js for graph](https://github.com/siyuan-note/siyuan/issues/1854)
* [Support custom font color and background color](https://github.com/siyuan-note/siyuan/issues/1863)

### Enhancements

* [Improve thematic break editing](https://github.com/siyuan-note/siyuan/issues/1636)
* [Update font and background color](https://github.com/siyuan-note/siyuan/issues/1855)
* [Tab indent without children, ctrl+shift+i indent with children](https://github.com/siyuan-note/siyuan/issues/1856)

### Bug fixes

* [Can not open graph if exists duplicated nodes](https://github.com/siyuan-note/siyuan/issues/1857)
* [Can't not sync on macOS](https://github.com/siyuan-note/siyuan/issues/1858)
* [Unrecognized local theme and reset css](https://github.com/siyuan-note/siyuan/issues/1859)
* [After the heading is cut and then pasted, it becomes text](https://github.com/siyuan-note/siyuan/issues/1860)
* [Local and cloud space display is inconsistent](https://github.com/siyuan-note/siyuan/issues/1861)
* [After the table enter, the next block ID will change](https://github.com/siyuan-note/siyuan/issues/1862)

## v1.1.3 / 2021-03-18

### Features

* [Use Rsync instead of Git for sync](https://github.com/siyuan-note/siyuan/issues/1807)
  * Since the cloud data has been emptied, it is necessary to upload the local data to the cloud through synchronization-upload first
  * Removed the automatic synchronization function, if you need to synchronize, please operate manually
  * The Git automatic commit interval will be reset to 0, that is, the Git version management function is disabled. If you need to open the version management function, please set the interval value to a value greater than 0. It is recommended to set it to 10, which means that the version will be submitted automatically every 10 minutes
* The initial size of cloud space has been expanded from 4G to 8G
* The graph has undergone a preliminary remake, please manually reset the graph parameters once

### Enhancements

* [File tree and recent document exchange location on Android](https://github.com/siyuan-note/siyuan/issues/1798)
* [Double click gutter icon to update memo](https://github.com/siyuan-note/siyuan/issues/1809)
* [Improve reload after sync error](https://github.com/siyuan-note/siyuan/issues/1821)
* [`、` is only useful at the beginning](https://github.com/siyuan-note/siyuan/issues/1824)
* [Input `》` can also be converted to blockquote](https://github.com/siyuan-note/siyuan/issues/1825)
* [Improve name style in the table, code block and math block](https://github.com/siyuan-note/siyuan/issues/1827)
* [Support ⌘ARROWDOWN/⌘ARROWUP for config hotkey](https://github.com/siyuan-note/siyuan/issues/1828)
* [Backmention doc name is so short](https://github.com/siyuan-note/siyuan/issues/1830)
* [Expand the default cloud storage space to 8G](https://github.com/siyuan-note/siyuan/issues/1832)
* [Improve boot speed on Android](https://github.com/siyuan-note/siyuan/issues/1833)
* [Improve search sort](https://github.com/siyuan-note/siyuan/issues/1836)
* [Click the daily notes button to select notebook](https://github.com/siyuan-note/siyuan/issues/1844)
* [When dragging a image to Siyuan, disable its cursor selection](https://github.com/siyuan-note/siyuan/issues/1846)
* [Improve click and dblclick at the end of the block](https://github.com/siyuan-note/siyuan/issues/1848)
* [You can use tabs for indentation anywhere in the list](https://github.com/siyuan-note/siyuan/issues/1850)
* [Clicking on the outline cannot locate the collapsed heading](https://github.com/siyuan-note/siyuan/issues/1852)

### Bug fixes

* [After Ctrl+A can not remove embed ref](https://github.com/siyuan-note/siyuan/issues/1799)
* [Only show one backlink](https://github.com/siyuan-note/siyuan/issues/1817)
* [Copy document ref, paste as embed ref is error](https://github.com/siyuan-note/siyuan/issues/1819)
* [No authentication is required when URL include /stage/](https://github.com/siyuan-note/siyuan/issues/1820)
* [The same block ref show twice sometimes](https://github.com/siyuan-note/siyuan/issues/1822)
* [Failed to parse `<table>` tag](https://github.com/siyuan-note/siyuan/issues/1823)
* [The graph can not show if customized graph style](https://github.com/siyuan-note/siyuan/issues/1834)
* [Cut and paste will cause duplicate id](https://github.com/siyuan-note/siyuan/issues/1838)
* [The text before the ref cannot use alt+z](https://github.com/siyuan-note/siyuan/issues/1839)
* [Export PDF can not load static resource](https://github.com/siyuan-note/siyuan/issues/1842)
* [DeleteContentForward at the end of the paragraph, when there is a ref in the next paragraph, the ref is wrong](https://github.com/siyuan-note/siyuan/issues/1845)
* [`*` after entering a space, the list disappears](https://github.com/siyuan-note/siyuan/issues/1849)
* [Folders cannot be sorted before and after the document by dragging and dropping](https://github.com/siyuan-note/siyuan/issues/1851)

## v1.1.2 / 2021-03-10

### Enhancements

* [Improve graph performance](https://github.com/siyuan-note/siyuan/issues/1783)
* [Preview and export has no class `vditor-task--done`](https://github.com/siyuan-note/siyuan/issues/1791)
* [Set sync flag to true after clone](https://github.com/siyuan-note/siyuan/issues/1805)

### Bug fixes

* [Complex sql parsing problems](https://github.com/siyuan-note/siyuan/issues/1727)
* [Failed to custom appearance on Android](https://github.com/siyuan-note/siyuan/issues/1796)
* [Boot hangs sometimes](https://github.com/siyuan-note/siyuan/issues/1803)
* [Cloud assets path issue](https://github.com/siyuan-note/siyuan/issues/1804)
* [Not download assets after clone](https://github.com/siyuan-note/siyuan/issues/1806)

## v1.1.1 / 2021-03-09

### Features

* [Filter daily note in the graph](https://github.com/siyuan-note/siyuan/issues/1652)
* [Drag asset from the file tree to the doc](https://github.com/siyuan-note/siyuan/issues/1756)
* [Block ref '((' support name, alias and memo](https://github.com/siyuan-note/siyuan/issues/1761)
* [Global graph support type filtering](https://github.com/siyuan-note/siyuan/issues/1775)
* [SQL query API](https://github.com/siyuan-note/siyuan/issues/1777)

### Enhancements

* [Copy or drag content with pictures to a different folder](https://github.com/siyuan-note/siyuan/issues/480)
* [Divide assets icons into video, audio, image, pdf](https://github.com/siyuan-note/siyuan/issues/1757)
* [Open or new file in the focus panel](https://github.com/siyuan-note/siyuan/issues/1758)
* [Ctrl+F  code block](https://github.com/siyuan-note/siyuan/issues/1765)
* [Anchor text is incomplete when pasting block ref](https://github.com/siyuan-note/siyuan/issues/1766)
* [Add search settings name, alias and memo](https://github.com/siyuan-note/siyuan/issues/1769)
* [Improve Ctrl+F/R performance](https://github.com/siyuan-note/siyuan/issues/1772)
* [Display boot progress](https://github.com/siyuan-note/siyuan/issues/1774)
* [Separate the settings of the global graph and the local graph](https://github.com/siyuan-note/siyuan/issues/1776)
* [Improve focus in the file tree](https://github.com/siyuan-note/siyuan/issues/1778)
* [Improve export for block ref](https://github.com/siyuan-note/siyuan/issues/1779)
* [Real-time display of memo on gutter icon](https://github.com/siyuan-note/siyuan/issues/1780)
* [After `shift + tab`, the first list item cannot be changed into paragraphs](https://github.com/siyuan-note/siyuan/issues/1782)
* [Save the layout of the PC browser](https://github.com/siyuan-note/siyuan/issues/1786)
* [Improve import performance](https://github.com/siyuan-note/siyuan/issues/1788)
* [Improve graphviz style](https://github.com/siyuan-note/siyuan/issues/1793)
* [Improve backmention to backlink](https://github.com/siyuan-note/siyuan/issues/1801)

### Bug fixes

* [Switch theme mode, the code theme is incorrect](https://github.com/siyuan-note/siyuan/issues/1770)
* [Ctrl+F continuous search bug](https://github.com/siyuan-note/siyuan/issues/1771)
* [Improve enter at the heading with fold](https://github.com/siyuan-note/siyuan/issues/1784)
* [Failed to create a doc on WebDAV](https://github.com/siyuan-note/siyuan/issues/1785)
* [Mind map will be lost data](https://github.com/siyuan-note/siyuan/issues/1794)

## v1.1.0 / 2021-03-04

### Features

* [Add "Move to" in the file tree and editor tabs](https://github.com/siyuan-note/siyuan/issues/449)

### Enhancements

* [Improve rename case sensitive](https://github.com/siyuan-note/siyuan/issues/1722)
* [Android cannot keep the last opened document](https://github.com/siyuan-note/siyuan/issues/1737)
* [Flatten backlinks](https://github.com/siyuan-note/siyuan/issues/1738)
* [Heading in the list item, the gutter icon can not align](https://github.com/siyuan-note/siyuan/issues/1740)
* [Remove .git in sub folders when syncing](https://github.com/siyuan-note/siyuan/issues/1742)
* [Improve wiki link convert when importing](https://github.com/siyuan-note/siyuan/issues/1745)
* [Reduce Android size](https://github.com/siyuan-note/siyuan/issues/1746)
* [Improve fold list style](https://github.com/siyuan-note/siyuan/issues/1749)
* [Ctrl+F performance optimization](https://github.com/siyuan-note/siyuan/issues/1750)
* [Improve link text parse](https://github.com/siyuan-note/siyuan/issues/1751)
* [Slash menu remove `、` hint](https://github.com/siyuan-note/siyuan/issues/1753)
* [Improve performance for indexing](https://github.com/siyuan-note/siyuan/issues/1754)
* [Change asset ID from prefix to suffix](https://github.com/siyuan-note/siyuan/issues/1759)
* [Trim starting empty blocks when rendering templates](https://github.com/siyuan-note/siyuan/issues/1762)

### Refactor

* [Upgrade Electron](https://github.com/siyuan-note/siyuan/issues/1748)

### Bug fixes

* [Cannot synchronize using the sync button in the browser through android APP](https://github.com/siyuan-note/siyuan/issues/1644)
* [The problem when creating daily note using template](https://github.com/siyuan-note/siyuan/issues/1744)
* [After resizing in the dock panel, closing one will leave blank](https://github.com/siyuan-note/siyuan/issues/1764)

## v1.0.9 / 2021-03-02

### Features

* [Support open/close/new/recent notebook for the online workspace and Docker](https://github.com/siyuan-note/siyuan/issues/1710)

### Enhancements

* [Code signing on Windows](https://github.com/siyuan-note/siyuan/issues/1485)
* [Import template can not keep the empty block](https://github.com/siyuan-note/siyuan/issues/1715)
* [Use built-in Git on Windows](https://github.com/siyuan-note/siyuan/issues/1718)
* [Add copy block id to file tree](https://github.com/siyuan-note/siyuan/issues/1720)
* [Android server supports copying to yuque](https://github.com/siyuan-note/siyuan/issues/1728)
* [Only sync .md for Git](https://github.com/siyuan-note/siyuan/issues/1731)
* [Improve order list outdent](https://github.com/siyuan-note/siyuan/issues/1736)

### Bug fixes

* [Ref in heading is error](https://github.com/siyuan-note/siyuan/issues/1712)
* [Use the template, the anchor text is error](https://github.com/siyuan-note/siyuan/issues/1713)
* [Empty task item render error when open again](https://github.com/siyuan-note/siyuan/issues/1717)
* [Before saving the file on Android, go to other files will be overwritten](https://github.com/siyuan-note/siyuan/issues/1723)
* [Ref create doc save location and Template path can not save `"`](https://github.com/siyuan-note/siyuan/issues/1725)
* [Undo will overwrite the content of the current document with the content of the last opened document](https://github.com/siyuan-note/siyuan/issues/1726)
* [`Alt+Ctrl+A` The handle is invalid](https://github.com/siyuan-note/siyuan/issues/1730)

## v1.0.8 / 2021-02-28

### Features

* [Historical search conditions](https://github.com/siyuan-note/siyuan/issues/1255)

### Enhancements

* [Improve ref code block anchor text template](https://github.com/siyuan-note/siyuan/issues/1260)
* [Improve asset file name link text](https://github.com/siyuan-note/siyuan/issues/1692)
* [Improve daily note selection](https://github.com/siyuan-note/siyuan/issues/1696)
* [Prevent repeated clicks when refreshing the file tree and sync](https://github.com/siyuan-note/siyuan/issues/1698)
* [Improve online workspace/publishing loading](https://github.com/siyuan-note/siyuan/issues/1699)
* [Global graph show unrelated nodes](https://github.com/siyuan-note/siyuan/issues/1700)
* [WebDAV connect URL must specify to folder](https://github.com/siyuan-note/siyuan/issues/1703)
* [Improve list enter](https://github.com/siyuan-note/siyuan/issues/1705)
* [Improve sync message notify](https://github.com/siyuan-note/siyuan/issues/1709)
* [Improve memo on icon for fold](https://github.com/siyuan-note/siyuan/issues/1711)
* [Add notebook settings for Android](https://github.com/siyuan-note/siyuan/issues/1714)

### Bug fixes

* [The tag in the doc have no lines in the graph](https://github.com/siyuan-note/siyuan/issues/1688)
* [Apple Silicon version fails to open](https://github.com/siyuan-note/siyuan/issues/1691)
* [Text mode `created between` syntax does not work](https://github.com/siyuan-note/siyuan/issues/1697)
* [Kernel crash on saving doc sometimes if using WebDAV notebook](https://github.com/siyuan-note/siyuan/issues/1702)
* [Can not sync after open User Guide](https://github.com/siyuan-note/siyuan/issues/1707)

## v1.0.7 / 2021-02-26

### Features

* [Search settings](https://github.com/siyuan-note/siyuan/issues/1676)

### Enhancements

* [Support ARM architecture on macOS (Apple Silicon)](https://github.com/siyuan-note/siyuan/issues/713)
* [Deleting a checkbox block will add several newlines below](https://github.com/siyuan-note/siyuan/issues/1601)
* [Improve update](https://github.com/siyuan-note/siyuan/issues/1677)
* [Support Windows 32-bit](https://github.com/siyuan-note/siyuan/issues/1687)
* [Improve drag icon to the checkbox](https://github.com/siyuan-note/siyuan/issues/1689)

### Bug fixes

* [Failed to create daily note](https://github.com/siyuan-note/siyuan/issues/1685)
* [WebDAV can not save the box config](https://github.com/siyuan-note/siyuan/issues/1686)

## v1.0.6 / 2021-02-26

### Features

* [Notebook settings](https://github.com/siyuan-note/siyuan/issues/1616)
* [Copy standard Markdown, Zhihu, Yuque and WeChat MP using cloud asset path](https://github.com/siyuan-note/siyuan/issues/1658)
* [Auto-sync at interval](https://github.com/siyuan-note/siyuan/issues/1673)

### Enhancements

* [Improve sync](https://github.com/siyuan-note/siyuan/issues/1663)
* [Display the latest sync time](https://github.com/siyuan-note/siyuan/issues/1668)
* [Improve assets download performance](https://github.com/siyuan-note/siyuan/issues/1669)
* [Do not reload UI if there are no changes when syncing](https://github.com/siyuan-note/siyuan/issues/1671)
* [Add template var `{{.alias}}` for doc](https://github.com/siyuan-note/siyuan/issues/1675)
* [AppImage for Linux](https://github.com/siyuan-note/siyuan/issues/1678)
* [Improve `Ctrl+Shift+A`](https://github.com/siyuan-note/siyuan/issues/1679)
* [Improve drag list item to another list item](https://github.com/siyuan-note/siyuan/issues/1681)

### Bug fixes

* [Import folder, custom sort can not work](https://github.com/siyuan-note/siyuan/issues/1605)
* [Create doc failed sometimes](https://github.com/siyuan-note/siyuan/issues/1654)
* [Some formats of assets upload failed](https://github.com/siyuan-note/siyuan/issues/1670)
* [The first child of the list item is the code block, and the collapsed list item shows an error](https://github.com/siyuan-note/siyuan/issues/1680)
* [Parse error when `+`  in the middle of ref](https://github.com/siyuan-note/siyuan/issues/1682)

## v1.0.5 / 2021-02-24

### Features

* [Assets storage in the cloud](https://github.com/siyuan-note/siyuan/issues/1614)
  
  Starting from this version, cloud synchronization will be divided into Git synchronization and asset file synchronization, which can significantly improve performance and reduce space usage by about half.

  * Git synchronization is only used to synchronize .md files, automatically ignore the assets folder synchronization through .gitignore
  * The asset files referenced in the document under the assets folder will be synchronized through upload and download, and the asset files that are not referenced will not be synchronized

  Note:

  * Every time Siyuan synchronizes, it will automatically add the `assets` line in .gitignore, that is, ignore the assets folder submission
  * Because assets are not included in Git management, there will be no version history support, please confirm clearly when deleting asset files
  * If you use other Git warehouse services, please manually modify .gitignore and then use `git`

  Upgrade suggestions:

  * Please follow `Help Document - Versioning and Synchronization - FAQ - How to delete unnecessary history records to reduce space usage and improve performance`

  In the future, we will continue to improve cloud asset file storage services, adding management functions such as uploading, viewing, and deleting to facilitate users to share documents across platforms and applications. In addition, we plan to complete the free expansion of cloud space for all paying users before the end of March. The basic space will be expanded from 4G to 8G. Thank you for your company and encouragement. We will continue to work hard.
* [Add database table assets](https://github.com/siyuan-note/siyuan/issues/1651)

### Enhancements

* [Git sync ignore assets by default](https://github.com/siyuan-note/siyuan/issues/1625)
* [Inline math and math block are not the same size](https://github.com/siyuan-note/siyuan/issues/1645)
* [When link contains a image, can not jump to the corresponding link after clicking](https://github.com/siyuan-note/siyuan/issues/1646)
* [In mind map, press space can edit it](https://github.com/siyuan-note/siyuan/issues/1649)
* [No prompt after `#xxx` input `#`](https://github.com/siyuan-note/siyuan/issues/1655)
* [Support MIUI 12.5](https://github.com/siyuan-note/siyuan/issues/1656)
* [Assets name retain scores and underscores](https://github.com/siyuan-note/siyuan/issues/1661)

### Bug fixes

* [The Dynamic query does not work in template](https://github.com/siyuan-note/siyuan/issues/1648)
* [Fold heading show `Failed to query content block`](https://github.com/siyuan-note/siyuan/issues/1653)
* [Import list problem](https://github.com/siyuan-note/siyuan/issues/1657)
* [Delete under the collapsed list item will delete its subitems](https://github.com/siyuan-note/siyuan/issues/1660)

## v1.0.4 / 2021-02-23

### Features

* [Open new tab by ctrl+click  when set `Open in the current tab`](https://github.com/siyuan-note/siyuan/issues/1624)

### Enhancements

* [Render result after the cursor leaves dynamic query](https://github.com/siyuan-note/siyuan/issues/1592)
* [Add alt+click for `Open Below the Tab`](https://github.com/siyuan-note/siyuan/issues/1626)
* [Add option `Close the kernel when exiting the interface`](https://github.com/siyuan-note/siyuan/issues/1628)
* [Rendering error when the app opened for the first time contains math](https://github.com/siyuan-note/siyuan/issues/1641)
* [Ignore .siyuan sync](https://github.com/siyuan-note/siyuan/issues/1642)
* [Bazaar templates/themes sort by update time desc](https://github.com/siyuan-note/siyuan/issues/1643)

### Bug fixes

* [Folding of the embed block will cause the outer layer to be folded](https://github.com/siyuan-note/siyuan/issues/1593)
* [UI process does not exit sometime](https://github.com/siyuan-note/siyuan/issues/1629)
* [Can't use super block in templates](https://github.com/siyuan-note/siyuan/issues/1633)
* [Cannot create diary after setting template](https://github.com/siyuan-note/siyuan/issues/1638)
* [File Tree cannot be refreshed automatically](https://github.com/siyuan-note/siyuan/issues/1640)

## v1.0.3 / 2021-02-21

### Features

* [Save update time of blocks](https://github.com/siyuan-note/siyuan/issues/1561)

### Enhancements

* [Showing tags on the graph](https://github.com/siyuan-note/siyuan/issues/1597)
* [Add template var `{{.id}}` for doc](https://github.com/siyuan-note/siyuan/issues/1608)
* [Improve def block render performance](https://github.com/siyuan-note/siyuan/issues/1611)
* [(( After allowing input of `!`, `/` and `、` to filter](https://github.com/siyuan-note/siyuan/issues/1613)
* [Database table blocks `time` field rename to `created`](https://github.com/siyuan-note/siyuan/issues/1622)

### Bug Fixes

* [Export pdf can not use custom.css](https://github.com/siyuan-note/siyuan/issues/1607)
* [Copy the ref and then paste it incorrectly](https://github.com/siyuan-note/siyuan/issues/1609)
* [The heading bar is dragged incorrectly from top to bottom](https://github.com/siyuan-note/siyuan/issues/1610)
* [Order list Shift + Tab is incorrect](https://github.com/siyuan-note/siyuan/issues/1612)
* [Some files in the file tree cannot be displayed](https://github.com/siyuan-note/siyuan/issues/1617)
* [List item ID changed if set background color](https://github.com/siyuan-note/siyuan/issues/1623)

## v1.0.2 / 2021-02-20

### Features

* [Copy image into clipboard](https://github.com/siyuan-note/siyuan/issues/448)

### Enhancements

* [Support Android 11](https://github.com/siyuan-note/siyuan/issues/1576)
* [In browser, can remove webdav](https://github.com/siyuan-note/siyuan/issues/1581)
* [Use bellow method, can not save layout](https://github.com/siyuan-note/siyuan/issues/1583)
* [Change installation method on Windows](https://github.com/siyuan-note/siyuan/issues/1584)
* [End of support for auto-update on macOS and Linux](https://github.com/siyuan-note/siyuan/issues/1585)
* [End of support for auto-update if using zip package on Windows](https://github.com/siyuan-note/siyuan/issues/1587)
* [Support search/replace for inline math](https://github.com/siyuan-note/siyuan/issues/1590)
* [Let the prompt box display completely](https://github.com/siyuan-note/siyuan/issues/1591)

### Fix bugs

* [Select marker * cannot set the font color](https://github.com/siyuan-note/siyuan/issues/1582)
* [Task list can not input ref](https://github.com/siyuan-note/siyuan/issues/1588)
* [The name of the list item will be transmitted to the next list item after the line break](https://github.com/siyuan-note/siyuan/issues/1589)
* [Report an error after remove `alt+M` in setting -> hotkey](https://github.com/siyuan-note/siyuan/issues/1594)

## v1.0.1 / 2021-02-19

### Enhancements

* [If task list item checked, add class `vditor-task--done`](https://github.com/siyuan-note/siyuan/issues/1556)
* [Add default value for the diary storage path](https://github.com/siyuan-note/siyuan/issues/1564)
* [Improve update](https://github.com/siyuan-note/siyuan/issues/1569)
* [Before clicking ref to open the document, close the pop-up window](https://github.com/siyuan-note/siyuan/issues/1572)
* [Improve clone performance](https://github.com/siyuan-note/siyuan/issues/1577)
* [Improve sync performance](https://github.com/siyuan-note/siyuan/issues/1578)

### Development refactoring

* [Kernel upgrade to Go 1.16](https://github.com/siyuan-note/siyuan/issues/1573)

### Fix bugs

* [Bookmark invalid](https://github.com/siyuan-note/siyuan/issues/1565)
* [Heading cannot be converted into a doc](https://github.com/siyuan-note/siyuan/issues/1570)
* [Gutter icon are not aligned](https://github.com/siyuan-note/siyuan/issues/1571)
* [`((` type filter problem](https://github.com/siyuan-note/siyuan/issues/1574)

## v1.0.0 / 2021-02-18

### Features

* [Support copy to yuque.com](https://github.com/siyuan-note/siyuan/issues/1546)

### Enhancements

* [Support custom keymap for Alt+M](https://github.com/siyuan-note/siyuan/issues/899)
* [End early bird discount subscription](https://github.com/siyuan-note/siyuan/issues/1536)
* [Improve sync process on Android](https://github.com/siyuan-note/siyuan/issues/1538)
* [Optimize the editing performance on the large document](https://github.com/siyuan-note/siyuan/issues/1547)
* [Improve boot process](https://github.com/siyuan-note/siyuan/issues/1549)

### Fix bugs

* [Heading as list item problem](https://github.com/siyuan-note/siyuan/issues/733)
* [Crash on Android 8.1](https://github.com/siyuan-note/siyuan/issues/1537)
* [Show/hide super block mark, wrong position of gutter icon](https://github.com/siyuan-note/siyuan/issues/1540)
* [Kernel interrupt](https://github.com/siyuan-note/siyuan/issues/1543)
* [UI error when editor is fullscreen](https://github.com/siyuan-note/siyuan/issues/1544)
* [Exception after renaming the same file twice](https://github.com/siyuan-note/siyuan/issues/1545)
* [Sync issue on Android 8.1](https://github.com/siyuan-note/siyuan/issues/1548)
* [After `:`, press `alt+z` error](https://github.com/siyuan-note/siyuan/issues/1550)
* [Outline display error](https://github.com/siyuan-note/siyuan/issues/1551)

## v0.9.9 / 2021-02-16

### Enhancements

* [Improve select multiple blocks for type conversion](https://github.com/siyuan-note/siyuan/issues/132)
* [Improve Alt+M](https://github.com/siyuan-note/siyuan/issues/1494)
* [Improve update](https://github.com/siyuan-note/siyuan/issues/1521)
* [Change folder to private storage on Android](https://github.com/siyuan-note/siyuan/issues/1522)
* [File tree hide `.md` on Android](https://github.com/siyuan-note/siyuan/issues/1523)
* [Improve sync](https://github.com/siyuan-note/siyuan/issues/1526)
* [Improve navigation bar on Android](https://github.com/siyuan-note/siyuan/issues/1528)
* [When mouse move in dock panel, show its toolbar and tree arrow icon](https://github.com/siyuan-note/siyuan/issues/1531)

### Fix bugs

* [Android set font size can not work](https://github.com/siyuan-note/siyuan/issues/1519)
* [Tag hotkey can not work](https://github.com/siyuan-note/siyuan/issues/1520)
* [Template call is not responding](https://github.com/siyuan-note/siyuan/issues/1529)
* [Empty list exposes ID problem](https://github.com/siyuan-note/siyuan/issues/1530)
* [Error: A JavaScript error occurred in them main process](https://github.com/siyuan-note/siyuan/issues/1533)

## v0.9.8 / 2021-02-15

### Features

* [File tree custom sorting](https://github.com/siyuan-note/siyuan/issues/1513)
* [Highlight panel by focus](https://github.com/siyuan-note/siyuan/issues/1518)

### Enhancements

* [The fold state of the parent block does not affect the child block](https://github.com/siyuan-note/siyuan/issues/1315)
* [Stick toolbar in the backlink tab](https://github.com/siyuan-note/siyuan/issues/1487)
* [Improve the ctrl+z behavior after cut/paste](https://github.com/siyuan-note/siyuan/issues/1509)
* [Android create diary](https://github.com/siyuan-note/siyuan/issues/1510)
* [Optimize performance](https://github.com/siyuan-note/siyuan/issues/1511)
* [Change siyuan to private folder on Android](https://github.com/siyuan-note/siyuan/issues/1516)
  Existing data needs to be manually migrated to the new in-app data directory.

### Fix bugs

* [Paste content in dynamic query embedding will be repeated](https://github.com/siyuan-note/siyuan/issues/1256)
* [Frozen after pressing alt+m twice](https://github.com/siyuan-note/siyuan/issues/1491)
* [Embed block can not use hint and code block](https://github.com/siyuan-note/siyuan/issues/1512)
* [Failed to query content block when folding](https://github.com/siyuan-note/siyuan/issues/1514)
* [Can't rename file when focus is not in editor](https://github.com/siyuan-note/siyuan/issues/1515)
* [Android soft keyboard hide editable content at the bottom](https://github.com/siyuan-note/siyuan/issues/1517)

## v0.9.7 / 2021-02-13

### Features

* [Android open word, excel and hyperlink](https://github.com/siyuan-note/siyuan/issues/1497)

### Enhancements

* [Display tag and bookmark in flat](https://github.com/siyuan-note/siyuan/issues/1340)
* [Ref block needs to be processed when copying as markdown](https://github.com/siyuan-note/siyuan/issues/1472)
* [Android open account settings using the external browser](https://github.com/siyuan-note/siyuan/issues/1499)
* [Remove auto space of inline math](https://github.com/siyuan-note/siyuan/issues/1500)
* [Improve booting](https://github.com/siyuan-note/siyuan/issues/1501)
* [Improve block ref, hyperlink and tag link jump](https://github.com/siyuan-note/siyuan/issues/1502)
* [Right-click menu display is incomplete](https://github.com/siyuan-note/siyuan/issues/1505)

### Fix bugs

* [Copy block ref in search panel is error](https://github.com/siyuan-note/siyuan/issues/1503)
* [Remove block hotkey can not auto save](https://github.com/siyuan-note/siyuan/issues/1504)

## v0.9.6 / 2021-02-11

Happy Chinese New Year 🎉

### Features

* [`/` can quickly prompt frequently used functions](https://github.com/siyuan-note/siyuan/issues/1477)
* [Android add appearance setting](https://github.com/siyuan-note/siyuan/issues/1493)

### Enhancements

* [Improve update mechanism](https://github.com/siyuan-note/siyuan/issues/1486)
* [Android add tag/slash/template hint](https://github.com/siyuan-note/siyuan/issues/1492)

### Fix bugs

* [Android Wrong time zone](https://github.com/siyuan-note/siyuan/issues/1483)
* [Android query embed can not display](https://github.com/siyuan-note/siyuan/issues/1495)

## v0.9.5 / 2021-02-10

### Features

* [Android APP](https://github.com/siyuan-note/siyuan/issues/1061)
* [Android supports synchronizing cloud repositories](https://github.com/siyuan-note/siyuan/issues/1470)
* [Android supports cloning cloud repositories](https://github.com/siyuan-note/siyuan/issues/1474)

### Enhancements

* [Blank lines are generated when using the arrow keys to move out of the code block](https://github.com/siyuan-note/siyuan/issues/372)
* [Distinguish the type of task list block and normal list block](https://github.com/siyuan-note/siyuan/issues/1015)
* [after drag/resize, keep then cursor in the editor](https://github.com/siyuan-note/siyuan/issues/1291)
* [Subtype of blocks](https://github.com/siyuan-note/siyuan/issues/1481)
* [Check existence of kernel binary before booting it](https://github.com/siyuan-note/siyuan/issues/1482)
* [Add icon and name for kernel on Windows](https://github.com/siyuan-note/siyuan/issues/1484)

### Fix bugs

* [List collapsed picture problem](https://github.com/siyuan-note/siyuan/issues/1469)
* [Open more instances of SiYuan on macOS problem](https://github.com/siyuan-note/siyuan/issues/1471)

In addition to the above, the SiYuan static site generator [OceanPress](https://github.com/siyuan-note/oceanpress) developed by the community contributor [崮生](https://github.com/2234839) is officially migrated to the community organization, everyone is welcome to try and contribute ❤️

## v0.9.2 / 2021-02-08

### Enhancements

* [PDF browsing interface optimization](https://github.com/siyuan-note/siyuan/issues/1336)
* [List item ctrl+shift+x problem](https://github.com/siyuan-note/siyuan/issues/1425)
* [Trim trailing newline when copying code block](https://github.com/siyuan-note/siyuan/issues/1458)
* [Improve application exit mechanism](https://github.com/siyuan-note/siyuan/issues/1462)
* [Improve the handling of bold content when copying content from web pages](https://github.com/siyuan-note/siyuan/issues/1466)

### Fix bugs

* [Blockquote in the super block will automatically add blank lines](https://github.com/siyuan-note/siyuan/issues/1243)
* [Image centering does not work when exporting PDF](https://github.com/siyuan-note/siyuan/issues/1269)
* [The cursor is lost when the super block is continuously entered](https://github.com/siyuan-note/siyuan/issues/1375)
* [Inserting a picture into the table causes the problem of adding rows](https://github.com/siyuan-note/siyuan/issues/1382)
* [LaTeX cannot be rendered when exporting to PDF](https://github.com/siyuan-note/siyuan/issues/1430)
* [Docker container crash](https://github.com/siyuan-note/siyuan/issues/1457)
* [After the ordered list exceeds 10, pressing tab will not indent correctly](https://github.com/siyuan-note/siyuan/issues/1459)
* [List tab and then press ctrl+z, the behavior is abnormal](https://github.com/siyuan-note/siyuan/issues/1460)
* [Issue of inserting a picture in the folder name containing '#'](https://github.com/siyuan-note/siyuan/issues/1461)
* [Cannot fold the code block after shift enter](https://github.com/siyuan-note/siyuan/issues/1464)
* [Click the asset file link in preview mode to report an error](https://github.com/siyuan-note/siyuan/issues/1465)
* [Asset tab can not locate on the file tree](https://github.com/siyuan-note/siyuan/issues/1468)

## v0.9.0 / 2021-02-07

### Enhancements

* Member subscription paid function prompt

  If you do not have a paid subscription, you will be prompted when you use [Advanced Features](https://b3log.org/siyuan/en/advanced_features.html). After v1.0.0 is released on 2021-02-19, advanced features can only be used after paid subscription. **If you already have data stored in the cloud and do not plan to pay for subscription, please export it as soon as possible**.
* Search and merge text mode and SQL mode

  Removed the SQL mode button on the quick search box, if you need to use SQL search to write SQL statements directly.
* Android mobile terminal has started public testing, which can be downloaded on GitHub or Baidu Netdisk
* Support shortcut keys for picture setting position
* Block aliases and notes support shortcut keys
* Improvement of floating window interference of relationship graph node
* Online workspace, sharing and publishing entrance adjustment

  Make the entrance bigger and more visible and easier to click.
* Block folding optimization, support <kbd>Alt+Click</kbd> click block icon to collapse

### Development refactoring

* Upgrade Electron framework on desktop

### Fix defects

* File tree location open file display defect
* Modify the content in the floating box of the block quote
* Fix the problem that the label auto-complete list prompts residual
* Fix the problem that the list block cannot be expanded after being collapsed

---

In addition, we have divided the language of the community:

* For Chinese feedback, please go to [Siyuan Notes-Domain-Link Drop](https://ld246.com/domain/siyuan)
* For English feedback, please go to [Issues · siyuan-note/siyuan](https://github.com/siyuan-note/siyuan/issues)

**The content of the wrong partition will be closed or deleted directly**, thank you for your support ❤️

## v0.8.5 / 2021-02-04

### 引入特性

* [支持跨文档拖拽移动块](https://github.com/siyuan-note/siyuan/issues/1025)
* [Android 端支持打开 data 文件夹下的笔记本](https://github.com/siyuan-note/siyuan/issues/1085)

### 改进功能

* [优化导入性能](https://github.com/siyuan-note/siyuan/issues/1435)

### 修复缺陷

* [网页标题粘贴至表格的问题](https://github.com/siyuan-note/siyuan/issues/1252)
* [MS Excel 粘贴带图表格问题](https://github.com/siyuan-note/siyuan/issues/1324)
* [MS Word 表格粘贴问题](https://github.com/siyuan-note/siyuan/issues/1332)
* [文件夹内的文档块不支持书签](https://github.com/siyuan-note/siyuan/issues/1427)
* [WebDAV 连接报错](https://github.com/siyuan-note/siyuan/issues/1432)

## v0.8.0 / 2021-02-03

### 引入特性

* [支持将文档渲染为幻灯片演示](https://github.com/siyuan-note/siyuan/issues/392)

### 改进功能

* [内容块备注展现](https://github.com/siyuan-note/siyuan/issues/1342)
* [支持 CMake 代码高亮](https://github.com/siyuan-note/siyuan/issues/1358)
* [停靠面板加入最小化操作按钮](https://github.com/siyuan-note/siyuan/issues/1420)

### 修复缺陷

* [SQL 动态查询空表名 `dual` 报错问题](https://github.com/siyuan-note/siyuan/issues/1390)
* [列表 Tab 携带同级项问题](https://github.com/siyuan-note/siyuan/issues/1407)
* [文档仅索引 128 个的问题](https://github.com/siyuan-note/siyuan/issues/1408)
* [任务列表空段落问题](https://github.com/siyuan-note/siyuan/issues/1414)
* [设置书签后没有在书签面板中实时刷新的问题](https://github.com/siyuan-note/siyuan/issues/1416)

## v0.7.8 / 2021-02-02

### 引入特性

* [支持 PlantUML 在线渲染](https://github.com/siyuan-note/siyuan/issues/1054)

### 改进功能

* [列表项创建的编辑逻辑优化](https://github.com/siyuan-note/siyuan/issues/1153)
* [统一列表渲染为松散模式](https://github.com/siyuan-note/siyuan/issues/1364)
* [网页端 Favicon ](https://github.com/siyuan-note/siyuan/issues/1377)
* [简化主体界面](https://github.com/siyuan-note/siyuan/issues/1396)
* [列表 Tab 带子项层级缩进](https://github.com/siyuan-note/siyuan/issues/1397)
* [增加图表悬浮提示](https://github.com/siyuan-note/siyuan/issues/1404)

### 修复缺陷

* [标签和列表全选剪切的问题](https://github.com/siyuan-note/siyuan/issues/1309)
* [窗口图标对齐问题](https://github.com/siyuan-note/siyuan/issues/1334)
* [列表缩进关联子项的问题](https://github.com/siyuan-note/siyuan/issues/1381)
* [停靠栏上下方按钮消失问题](https://github.com/siyuan-note/siyuan/issues/1393)
* [超链接和分隔线排版解析问题](https://github.com/siyuan-note/siyuan/issues/1394)

## v0.7.5 / 2021-02-01

### 引入特性

* [界面支持 Dock 停靠栏](https://github.com/siyuan-note/siyuan/issues/635)

### 改进功能

* [自动拉取图片时 jpe 后缀改为 jpg](https://github.com/siyuan-note/siyuan/issues/1383)

### 修复缺陷

* [复制导致 ID 重复的问题](https://github.com/siyuan-note/siyuan/issues/1232)
* [列表回车导致图片缩放失效的问题](https://github.com/siyuan-note/siyuan/issues/1348)
* [访问授权码置空 `BEYOND` 不生效问题](https://github.com/siyuan-note/siyuan/issues/1376)
* [有序列表回车返回父级 ID 暴露问题](https://github.com/siyuan-note/siyuan/issues/1380)
* [大纲中无法显示 HTML 标签包裹文字](https://github.com/siyuan-note/siyuan/issues/1384)

## v0.7.1 / 2021-01-31

### 引入特性

* [引入新的编辑模式 - 专家模式](https://github.com/siyuan-note/siyuan/issues/868)
* [关系图节点支持编辑浮窗](https://github.com/siyuan-note/siyuan/issues/1343)

### 改进功能

* [列表回车跳出需添加当层列表一级](https://github.com/siyuan-note/siyuan/issues/810)
* [多级列表的编辑逻辑优化](https://github.com/siyuan-note/siyuan/issues/961)
* [粘贴代码时代入最近语言](https://github.com/siyuan-note/siyuan/issues/1317)
* [新增百度云、蓝奏云下载渠道](https://github.com/siyuan-note/siyuan/issues/1353)
* [文件树最大列出数量支持配置](https://github.com/siyuan-note/siyuan/issues/1370)

### 修复缺陷

* [脑图模式下列表项查询内容块失败](https://github.com/siyuan-note/siyuan/issues/1118)
* [列表项缩进和反向缩进问题](https://github.com/siyuan-note/siyuan/issues/1240)
* [列表项退格删除问题](https://github.com/siyuan-note/siyuan/issues/1254)
* [列表项之间回车新建列表项问题](https://github.com/siyuan-note/siyuan/issues/1261)
* [列表、列表项间隙不一致的问题](https://github.com/siyuan-note/siyuan/issues/1285)
* [空的列表项回车反向缩进层级问题](https://github.com/siyuan-note/siyuan/issues/1314)
* [标题块模板片段显示异常](https://github.com/siyuan-note/siyuan/issues/1357)
* [使用表达式查询时标题块没有显示下方块的问题](https://github.com/siyuan-note/siyuan/issues/1371)

## v0.7.0 / 2021-01-29

### 引入特性

* [关系图搜索过滤和渲染参数配置](https://github.com/siyuan-note/siyuan/issues/793)
* [展现标签所属块之间的关系](https://github.com/siyuan-note/siyuan/issues/838)

### 改进功能

* [已设置书签的文档需要在书签设置菜单中高亮](https://github.com/siyuan-note/siyuan/issues/1204)
* [悬浮窗无法上下滑动](https://github.com/siyuan-note/siyuan/issues/1248)
* [关系图节点信息优先显示块名或备注](https://github.com/siyuan-note/siyuan/issues/1262)
* [关系图和全局关系图图标区分](https://github.com/siyuan-note/siyuan/issues/1265)
* [双链浮窗 Esc 键关闭](https://github.com/siyuan-note/siyuan/issues/1308)
* [标签面板内的结果排除模板](https://github.com/siyuan-note/siyuan/issues/1316)
* [获取引用浮窗、计数等性能优化](https://github.com/siyuan-note/siyuan/issues/1320)
* [粘贴后撤销行为异常](https://github.com/siyuan-note/siyuan/issues/1325)

### 修复缺陷

* [双链列表项渲染问题](https://github.com/siyuan-note/siyuan/issues/1257)
* [文件树上的文档点击引用计数报错](https://github.com/siyuan-note/siyuan/issues/1259)
* [模板函数无法嵌套文档名变量 `{{.title}}`](https://github.com/siyuan-note/siyuan/issues/1286)
* [导出 PDF 时 Mermaid、YFM 没有渲染的问题](https://github.com/siyuan-note/siyuan/issues/1318)
* [窗口激活时顶部单像素宽的白边](https://github.com/siyuan-note/siyuan/issues/1333)
* [文件树拖拽覆盖重名文档问题](https://github.com/siyuan-note/siyuan/issues/1341)

## v0.6.8 / 2021-01-28

### 引入特性

* [反链页签上下文展现](https://github.com/siyuan-note/siyuan/issues/295)
* [支持停靠栏显示/隐藏](https://github.com/siyuan-note/siyuan/issues/1270)
* [支持 PDF 页码跳转](https://github.com/siyuan-note/siyuan/issues/1307)

### 改进功能

* [标签页签上下文展现](https://github.com/siyuan-note/siyuan/issues/1031)
* [书签页签上下文展现](https://github.com/siyuan-note/siyuan/issues/1158)
* [带样式导出 PDF 和 HTML](https://github.com/siyuan-note/siyuan/issues/1201)
* [`((` 触发块引搜索默认选中优化](https://github.com/siyuan-note/siyuan/issues/1229)
* [搜素页签默认展开第一个搜索结果](https://github.com/siyuan-note/siyuan/issues/1242)
* [同一文件夹下资源文件过多不提示](https://github.com/siyuan-note/siyuan/issues/1278)
* [移除 .sy.md 和 .sy.export.md 识别](https://github.com/siyuan-note/siyuan/issues/1299)
* [搜索默认不仅在根一级上进行](https://github.com/siyuan-note/siyuan/issues/1310)

### 修复缺陷

* [Alt Tab 切换窗口后会触发折叠](https://github.com/siyuan-note/siyuan/issues/1219)
* [文档重命名问题](https://github.com/siyuan-note/siyuan/issues/1271)
* [设置中搜索无法匹配关键词](https://github.com/siyuan-note/siyuan/issues/1274)
* [在本地浏览器打开失败](https://github.com/siyuan-note/siyuan/issues/1294)
* [某些文件保存不了（或者提示没保存）的问题](https://github.com/siyuan-note/siyuan/issues/1295)
* [设置中快捷键设置无效](https://github.com/siyuan-note/siyuan/issues/1297)
* [粘贴不了 MS Office Excel 内容的问题](https://github.com/siyuan-note/siyuan/issues/1300)

## v0.6.7 / 2021-01-25

### 引入特性

* [支持 SQL 查询数据库模板函数](https://github.com/siyuan-note/siyuan/issues/1026)
* [初步引入专家模式](https://github.com/siyuan-note/siyuan/issues/1212)
* [图片支持设置位置](https://github.com/siyuan-note/siyuan/issues/1220)
* [初步引入 Dock 停靠栏](https://github.com/siyuan-note/siyuan/issues/1222)
* [支持创建本地笔记本](https://github.com/siyuan-note/siyuan/issues/1253)

### 改进功能

* [按下 Alt 时鼠标所在位置需高亮](https://github.com/siyuan-note/siyuan/issues/1211)
* [新增安装包下载渠道](https://github.com/siyuan-note/siyuan/issues/1216)
* [链滴社区中为订阅用户赋予“订阅者”头衔](https://github.com/siyuan-note/siyuan/issues/1217)
* [设置 - 帐号中可配置是否显示顶部工具栏中的头衔和 VIP 标识](https://github.com/siyuan-note/siyuan/issues/1237)

### 修复缺陷

* [编辑器内搜索偶尔失效的问题](https://github.com/siyuan-note/siyuan/issues/1228)

## v0.6.6 / 2021-01-21

### 引入特性

* [支持历史文件回滚](https://github.com/siyuan-note/siyuan/issues/880)
* [编辑器支持 Git 冲突标记解析渲染](https://github.com/siyuan-note/siyuan/issues/1200)

### 改进功能

* [撤销操作页面没有跟踪光标处](https://github.com/siyuan-note/siyuan/issues/956)
* [中文右双引号无法输入](https://github.com/siyuan-note/siyuan/issues/1021)
* [导出 HTML 设置编码](https://github.com/siyuan-note/siyuan/issues/1195)
* [导入 `[[wikilink]]` 时锚文本使用模板变量 `{{.text}}`](https://github.com/siyuan-note/siyuan/issues/1197)
* [按下 Alt 时鼠标所在位置的块进行高亮](https://github.com/siyuan-note/siyuan/issues/1199)

### 修复缺陷

* [「Shift + 左箭头」从右向左多选文字时可能出现问题](https://github.com/siyuan-note/siyuan/issues/407)
* [撤回时页面会向上滚动一大截](https://github.com/siyuan-note/siyuan/issues/712)
* [网页复制粘贴自动空格问题](https://github.com/siyuan-note/siyuan/issues/1190)
* [列表项中选中文本新建文档时缩进异常](https://github.com/siyuan-note/siyuan/issues/1191)
* [撤销操作无法复制代码](https://github.com/siyuan-note/siyuan/issues/1194)
* [块引锚文本内行级元素渲染问题](https://github.com/siyuan-note/siyuan/issues/1196)

## v0.6.5 / 2021-01-20

### 引入特性

* [导入 Markdown 到已有笔记本文件夹下](https://github.com/siyuan-note/siyuan/issues/1105)

### 改进功能

* [文件树展开折叠状态保持](https://github.com/siyuan-note/siyuan/issues/668)
* [字体样式设置应放在右键选项中](https://github.com/siyuan-note/siyuan/issues/958)
* [反链里的容器块按子块简化展现](https://github.com/siyuan-note/siyuan/issues/1013)
* [去掉文件夹下对非思源 .md 的导入支持](https://github.com/siyuan-note/siyuan/issues/1104)
* [内容块折叠操作方式优化](https://github.com/siyuan-note/siyuan/issues/1154)

### 修复缺陷

* [清除选中内容中的所有字体格式](https://github.com/siyuan-note/siyuan/issues/1030)
* [删除嵌入块前面的内容导致的解析渲染问题](https://github.com/siyuan-note/siyuan/issues/1047)
* [URL 中的 `&not` 自动转换成字符 `¬`](https://github.com/siyuan-note/siyuan/issues/1160)
* [反链提及重复问题](https://github.com/siyuan-note/siyuan/issues/1161)
* [搜索结果带 HTML 标签时显示异常](https://github.com/siyuan-note/siyuan/issues/1170)
* [主题自定义 (custom.css) 更新问题](https://github.com/siyuan-note/siyuan/issues/1174)
* [内容块动态查询嵌入 SQL 模式问题](https://github.com/siyuan-note/siyuan/issues/1177)
* [列表项的命名块无法使用 `!{{name:xxx}}` 查询](https://github.com/siyuan-note/siyuan/issues/1185)
* [表格块下多次正向链接，在关系图中只显示一个节点的问题](https://github.com/siyuan-note/siyuan/issues/1187)
* [导出 TextBundle/Markdown 时本地图片路径错误](https://github.com/siyuan-note/siyuan/issues/1192)

## v0.6.4 / 2021-01-19

### 引入特性

* [编辑器支持查找替换](https://github.com/siyuan-note/siyuan/issues/344)
* [点击文档块引用计数显示引用出处](https://github.com/siyuan-note/siyuan/issues/1163)

### 改进功能

* [模式选择菜单显示当前选中模式](https://github.com/siyuan-note/siyuan/issues/1122)
* [复制标准 Markdown 和复制 kramdown 分开](https://github.com/siyuan-note/siyuan/issues/1152)
* [拖拽插入资源文件 128M 限制改为 1G](https://github.com/siyuan-note/siyuan/issues/1171)
* [降低 conf.json 配置写入](https://github.com/siyuan-note/siyuan/issues/1183)

### 修复缺陷

* [导出 PDF 代码压缩问题](https://github.com/siyuan-note/siyuan/issues/1092)
* [全屏模式下编辑器工具栏点击识别问题](https://github.com/siyuan-note/siyuan/issues/1143)
* [blockquote 上下键及回车问题修复](https://github.com/siyuan-note/siyuan/issues/1167)
* [IP 网址粘贴创建了空链接](https://github.com/siyuan-note/siyuan/issues/1168)
* [正则搜索时转义符 `\` 处理问题](https://github.com/siyuan-note/siyuan/issues/1172)
* [使用模板生成的日记内容格式混乱](https://github.com/siyuan-note/siyuan/issues/1175)
* [blockquote 中多个代码块之间出现多余空行](https://github.com/siyuan-note/siyuan/issues/1178)
* [块命名丢失及编码问题](https://github.com/siyuan-note/siyuan/issues/1179)

## v0.6.3 / 2021-01-18

### 引入特性

* [大纲搜索过滤](https://github.com/siyuan-note/siyuan/issues/737)
* [内容块别名](https://github.com/siyuan-note/siyuan/issues/1126)

### 改进功能

* [文档块引用计数展示](https://github.com/siyuan-note/siyuan/issues/1005)
* [文档块支持备注](https://github.com/siyuan-note/siyuan/issues/1016)
* [内容块命名的名称展示](https://github.com/siyuan-note/siyuan/issues/1028)
* [带有链接的块折叠时没有视觉提示](https://github.com/siyuan-note/siyuan/issues/1106)
* [方向键上键有时无法控制光标！](https://github.com/siyuan-note/siyuan/issues/1108)
* [使用划选的内容作为搜索引用锚文本或者快速搜索关键字](https://github.com/siyuan-note/siyuan/issues/1134)
* [初始化时设置随机的访问鉴权密码](https://github.com/siyuan-note/siyuan/issues/1146)

### 修复缺陷

* [更新内容块内容后属性丢失](https://github.com/siyuan-note/siyuan/issues/1132)
* [快速搜索中最近使用的块源码暴露问题](https://github.com/siyuan-note/siyuan/issues/1135)
* [多关键词检索时预览区没有高亮](https://github.com/siyuan-note/siyuan/issues/1136)
* [调用模板时，动态内容块嵌入 未渲染问题](https://github.com/siyuan-note/siyuan/issues/1137)
* [正则表达式搜索失效问题](https://github.com/siyuan-note/siyuan/issues/1141)
* [调用模板后，字体颜色效果消失](https://github.com/siyuan-note/siyuan/issues/1142)

## v0.6.2 / 2021-01-17

### 引入特性

* [编辑器内容右键划词搜索并链接](https://github.com/siyuan-note/siyuan/issues/747)
* [模板集市](https://github.com/siyuan-note/siyuan/issues/1037)

### 改进功能

* [只读模式下禁用编辑功能](https://github.com/siyuan-note/siyuan/issues/1058)
* [颜色取消后，粗体页需要取消](https://github.com/siyuan-note/siyuan/issues/1064)
* [在引用块的中间部分按下Enter两次会直接跳出引用块](https://github.com/siyuan-note/siyuan/issues/1081)
* [编辑器右键划词搜索支持新建搜索页签](https://github.com/siyuan-note/siyuan/issues/1110)
* [调整悬浮窗口和搜索、反链等非主编辑区的字号行距](https://github.com/siyuan-note/siyuan/issues/1115)
* [优化行级数学公式光标位置](https://github.com/siyuan-note/siyuan/issues/1121)
* [保留空段落](https://github.com/siyuan-note/siyuan/issues/1125)

### 修复缺陷

* [含有行内公式的句子加粗问题](https://github.com/siyuan-note/siyuan/issues/1093)
* [工具栏设置标题只能设置为一级标题问题](https://github.com/siyuan-note/siyuan/issues/1103)
* [脑图渲染问题](https://github.com/siyuan-note/siyuan/issues/1114)
* [悬浮框编辑时右键菜单重叠被覆盖](https://github.com/siyuan-note/siyuan/issues/1123)
* [搜索页签子标签无法搜索到内容](https://github.com/siyuan-note/siyuan/issues/1124)

## v0.6.1 / 2021-01-16

### 引入特性

* [搜索页签](https://github.com/siyuan-note/siyuan/issues/104)
* [编辑器 Ctrl 点击标签触发搜索页签](https://github.com/siyuan-note/siyuan/issues/945)
* [编辑器划词触发搜索页签](https://github.com/siyuan-note/siyuan/issues/1072)

### 改进功能

* [代码块复制不带 ```lang](https://github.com/siyuan-note/siyuan/issues/995)
* [清理未引用资源时包含文件夹引用情况](https://github.com/siyuan-note/siyuan/issues/1035)
* [`#` 在代码块也会产生不必要的下拉菜单](https://github.com/siyuan-note/siyuan/issues/1091)

### 开发重构

* [包路径重构](https://github.com/siyuan-note/siyuan/issues/1075)

### 修复缺陷

* [内容块嵌入中的文本字体设置失效](https://github.com/siyuan-note/siyuan/issues/977)
* [表格内 Tab 键切换单元格问题](https://github.com/siyuan-note/siyuan/issues/1040)
* [去掉脑图中引用的 `{{.text}}`](https://github.com/siyuan-note/siyuan/issues/1060)
* [图片缩放兼容 Firefox](https://github.com/siyuan-note/siyuan/issues/1066)
* [嵌入块显示的时候空白过大问题](https://github.com/siyuan-note/siyuan/issues/1077)
* [代码块清空内容后仍然保留的问题](https://github.com/siyuan-note/siyuan/issues/1084)
* [复制引用时结尾去掉多余的锚文本](https://github.com/siyuan-note/siyuan/issues/1086)
* [图片路径编辑问题](https://github.com/siyuan-note/siyuan/issues/1087)

## v0.6.0 / 2021-01-14

### 引入特性

* [引入新的编辑模式 - 脑图模式](https://github.com/siyuan-note/siyuan/issues/735)
* [内容块动态查询支持搜索表达式](https://github.com/siyuan-note/siyuan/issues/1011)

### 改进功能

* [支持 Stata 代码块高亮](https://github.com/siyuan-note/siyuan/issues/656)
* [支持 PowerShell 代码块高亮](https://github.com/siyuan-note/siyuan/issues/1002)
* [日记设置中的笔记本名称由输入改为下拉选择](https://github.com/siyuan-note/siyuan/issues/1003)
* [支持在链接文本和代码内容中搜索](https://github.com/siyuan-note/siyuan/issues/1052)

### 修复缺陷

* [编辑器内搜索表格无法定位](https://github.com/siyuan-note/siyuan/issues/922)
* [块嵌入时内部引用渲染问题](https://github.com/siyuan-note/siyuan/issues/1000)
* [文档增删后父级文件夹计数不更新](https://github.com/siyuan-note/siyuan/issues/1004)
* [缩放图片后不居中问题](https://github.com/siyuan-note/siyuan/issues/1010)
* [模板中使用内容块动态查询报错问题](https://github.com/siyuan-note/siyuan/issues/1014)
* [嵌入被错误识别成引用](https://github.com/siyuan-note/siyuan/issues/1046)

## v0.5.9 / 2021-01-11

### 引入特性

* [日记](https://github.com/siyuan-note/siyuan/issues/399)

### 改进功能

* [缩放图片提供常用缩放百分比](https://github.com/siyuan-note/siyuan/issues/969)
* [标签补全提示优化](https://github.com/siyuan-note/siyuan/issues/990)
* [改进内核启动机制](https://github.com/siyuan-note/siyuan/issues/991)

### 修复缺陷

* [数学公式尾行按上键会跳出](https://github.com/siyuan-note/siyuan/issues/982)
* [点击图片偶尔不会显示资源菜单](https://github.com/siyuan-note/siyuan/issues/984)
* [超过 2520 个块的文档打不开问题](https://github.com/siyuan-note/siyuan/issues/988)
* [搜索时搜不到行级排版元素的问题](https://github.com/siyuan-note/siyuan/issues/993)
* [设置背景色后多层级块图标会重叠](https://github.com/siyuan-note/siyuan/issues/994)

## v0.5.8 / 2021-01-08

### 引入特性

* [批量导出标准 Markdown 文件](https://github.com/siyuan-note/siyuan/issues/577)
* [内容块命名、备注和样式](https://github.com/siyuan-note/siyuan/issues/595)
* [笔记本内笔记数量显示](https://github.com/siyuan-note/siyuan/issues/871)

### 改进功能

* [反链提及使用内容块名称进行搜索](https://github.com/siyuan-note/siyuan/issues/953)
* [折叠块时报“查询内容块失败”](https://github.com/siyuan-note/siyuan/issues/970)
* [超级块改进](https://github.com/siyuan-note/siyuan/issues/972)
* [块图标交互修改](https://github.com/siyuan-note/siyuan/issues/974)
* [编辑器右键菜单改进](https://github.com/siyuan-note/siyuan/issues/976)

### 修复缺陷

* [标题块折叠拖动问题](https://github.com/siyuan-note/siyuan/issues/971)
* [引用链接超过 7 个显示异常](https://github.com/siyuan-note/siyuan/issues/975)

## v0.5.7 / 2021-01-07

### 引入特性

* [支持内容块折叠](https://github.com/siyuan-note/siyuan/issues/262)
* [支持插入图片大小设置](https://github.com/siyuan-note/siyuan/issues/315)

### 改进功能

* [左侧图标和系统的最大化图标距离太近了](https://github.com/siyuan-note/siyuan/issues/738)
* [优化文件树文件定位](https://github.com/siyuan-note/siyuan/issues/936)
* [鼠标从右到左选择文字设置字体颜色优化](https://github.com/siyuan-note/siyuan/issues/954)
* [行级属性不暴露在编辑器中](https://github.com/siyuan-note/siyuan/issues/957)
* [标题块拖拽移动时包含下方内容块](https://github.com/siyuan-note/siyuan/issues/963)

### 修复缺陷

* [快捷键重置问题](https://github.com/siyuan-note/siyuan/issues/951)
* [字体彩色变糊问题](https://github.com/siyuan-note/siyuan/issues/952)
* [循环引用导致内存泄漏进程崩溃问题](https://github.com/siyuan-note/siyuan/issues/959)
* [移动文档时 assets 附件不跟随移动的问题](https://github.com/siyuan-note/siyuan/issues/960)

## v0.5.6 / 2021-01-06

### 引入特性

* [支持加粗、强调、删除线和代码设置属性，实现自定义文字颜色等样式](https://github.com/siyuan-note/siyuan/issues/620)
* [自定义快捷键](https://github.com/siyuan-note/siyuan/issues/621)

### 改进功能

* [代码块复制按钮改进](https://github.com/siyuan-note/siyuan/issues/665)
* [简化容器块的反链提及结果](https://github.com/siyuan-note/siyuan/issues/874)
* [引用数标识应显示多个定义块](https://github.com/siyuan-note/siyuan/issues/904)
* [改进 HTML 转换 Markdown 时加粗、斜体等空格的处理](https://github.com/siyuan-note/siyuan/issues/931)
* [文件树上同一文件夹下最多显示 512 个文档](https://github.com/siyuan-note/siyuan/issues/948)

### 开发重构

* [重写底层，降低内存占用](https://github.com/siyuan-note/siyuan/issues/898)
* [文档内容变更以后数据状态通知](https://github.com/siyuan-note/siyuan/issues/907)
* [重构反向链接、书签底层实现](https://github.com/siyuan-note/siyuan/issues/908)

### 修复缺陷

* [反链提及快速链接问题](https://github.com/siyuan-note/siyuan/issues/881)
* [配置搜索报错](https://github.com/siyuan-note/siyuan/issues/928)
* [开启下标语法后删除线语法失效](https://github.com/siyuan-note/siyuan/issues/934)
* [嵌套引用锚文本模板渲染问题](https://github.com/siyuan-note/siyuan/issues/946)
* [使用模板导致标题块图标在错误的位置](https://github.com/siyuan-note/siyuan/issues/949)

## v0.5.5 / 2021-01-01

### 引入特性

* [内容块书签右侧标识](https://github.com/siyuan-note/siyuan/issues/75)
* [支持内容块拖动排版](https://github.com/siyuan-note/siyuan/issues/226)
* [鼠标移动到引用数上查看被引用的块](https://github.com/siyuan-note/siyuan/issues/529)
* [连接 WebDAV 支持文件夹选择](https://github.com/siyuan-note/siyuan/issues/866)

### 改进功能

* [移动端浏览器兼容](https://github.com/siyuan-note/siyuan/issues/651)
* [支持通过鼠标中键关闭页签](https://github.com/siyuan-note/siyuan/issues/686)
* [搜索时包含文档块且文档块排最前面](https://github.com/siyuan-note/siyuan/issues/900)
* [编辑器标题块标识和书签标识是否显示的配置](https://github.com/siyuan-note/siyuan/issues/901)

### 开发重构

* [重构标签、模版等底层实现](https://github.com/siyuan-note/siyuan/issues/897)

### 修复缺陷

* [QQ 拼音输入法自动补全时块引符号时末尾多出 `]]`](https://github.com/siyuan-note/siyuan/issues/320)
* [有时启动会一直 loading 进不去](https://github.com/siyuan-note/siyuan/issues/895)

## v0.5.46 / 2020-12-30

### 引入特性

* [内容块标识区域显示层级结构和引用数](https://github.com/siyuan-note/siyuan/issues/76)
* [邀请订阅奖励机制](https://github.com/siyuan-note/siyuan/issues/872)

### 改进功能

* [页签右键添加关闭左侧、右侧、未修改功能](https://github.com/siyuan-note/siyuan/issues/767)
* [预览悬浮窗口默认可编辑，支持钉住（Pin）](https://github.com/siyuan-note/siyuan/issues/864)
* [内容块加入创建时间显示](https://github.com/siyuan-note/siyuan/issues/867)
* [v1.0.0 发布时间](https://github.com/siyuan-note/siyuan/issues/873)
* [改进文件树上的文档拖拽转换标题时的交互](https://github.com/siyuan-note/siyuan/issues/876)
* [简化全局和块引搜索结果](https://github.com/siyuan-note/siyuan/issues/883)

### 修复缺陷

* [上下标无法解析 `+` 和 `-` 问题](https://github.com/siyuan-note/siyuan/issues/853)
* [模版插入未自动保存问题](https://github.com/siyuan-note/siyuan/issues/858)
* [安装集市主题后自定义修改不回显的问题](https://github.com/siyuan-note/siyuan/issues/861)
* [搜索忽略高亮 `==Mark==` 标记符和空格](https://github.com/siyuan-note/siyuan/issues/862)
* [预览悬浮窗口大小计算问题](https://github.com/siyuan-note/siyuan/issues/877)

## v0.5.45 / 2020-12-28

### 引入特性

* [托盘快捷键](https://github.com/siyuan-note/siyuan/issues/704)
* [文件树上加入刷新操作](https://github.com/siyuan-note/siyuan/issues/794)
* [编辑器内资源右键添加删除功能](https://github.com/siyuan-note/siyuan/issues/852)

### 改进功能

* [双击后快捷键改进](https://github.com/siyuan-note/siyuan/issues/809)
* [块引支持搜索表达式](https://github.com/siyuan-note/siyuan/issues/848)
* [搜索支持锚文本模板](https://github.com/siyuan-note/siyuan/issues/854)

### 文档相关

* [完善 Docker 镜像搭建服务相关文档](https://github.com/siyuan-note/siyuan/issues/812)

### 修复缺陷

* [Windows 上 Alt F4 改为完全退出程序](https://github.com/siyuan-note/siyuan/issues/783)
* [预览时大纲无法定位](https://github.com/siyuan-note/siyuan/issues/819)
* [卸载主题问题](https://github.com/siyuan-note/siyuan/issues/850)

## v0.5.44 / 2020-12-27

### 引入特性

* [主题集市](https://github.com/siyuan-note/siyuan/issues/706)

### 改进功能

* [加入启动参数 `--ssl`](https://github.com/siyuan-note/siyuan/issues/828)
* [重命名时需要判断大小写](https://github.com/siyuan-note/siyuan/issues/829)
* [支持年付订阅](https://github.com/siyuan-note/siyuan/issues/830)
* [全局搜索改进](https://github.com/siyuan-note/siyuan/issues/835)
* [换行时不要强制居中打字机](https://github.com/siyuan-note/siyuan/issues/840)
* [`protocol://` 协议打开其他软件](https://github.com/siyuan-note/siyuan/issues/847)
* [超级块导出去掉标记符](https://github.com/siyuan-note/siyuan/issues/849)

### 修复缺陷

* [火狐使用时无法复制](https://github.com/siyuan-note/siyuan/issues/531)
* [图片块引用展示异常](https://github.com/siyuan-note/siyuan/issues/816)
* [WebDAV 贴图问题](https://github.com/siyuan-note/siyuan/issues/837)
* [引用块无法拷贝 ref id](https://github.com/siyuan-note/siyuan/issues/841)
* [带 Emoji 的文件夹/文档排序不稳定问题](https://github.com/siyuan-note/siyuan/issues/842)
* [列表项块引用修改提示找不到](https://github.com/siyuan-note/siyuan/issues/846)

## v0.5.43 / 2020-12-25

### 引入特性

* [搜索支持表达式](https://github.com/siyuan-note/siyuan/issues/797)

### 改进功能

* [移除清理 ID 功能](https://github.com/siyuan-note/siyuan/issues/807)

### 修复缺陷

* [行级公式渲染大小自适应标题级别](https://github.com/siyuan-note/siyuan/issues/487)
* [块嵌入的表格内换行符消失](https://github.com/siyuan-note/siyuan/issues/654)
* [使用本地绝对路径引用资源时的问题](https://github.com/siyuan-note/siyuan/issues/729)
* [块引用的锚文本行级渲染问题](https://github.com/siyuan-note/siyuan/issues/800)
* [反链提及文档名未正常显示](https://github.com/siyuan-note/siyuan/issues/802)
* [中西文添加空格等选项从编辑时改为预览/导出时](https://github.com/siyuan-note/siyuan/issues/814)
* [移除中文后标点符号自动替换为中文标点](https://github.com/siyuan-note/siyuan/issues/815)
* [不同文件夹下嵌入的图片预览时不显示](https://github.com/siyuan-note/siyuan/issues/825)
* [B 站视频插入播放问题](https://github.com/siyuan-note/siyuan/issues/827)

## v0.5.42 / 2020-12-21

### 引入特性

* [导出时支持配置标签的开闭标记符](https://github.com/siyuan-note/siyuan/issues/572)
* [代码块预览加入行号](https://github.com/siyuan-note/siyuan/issues/774)

### 改进功能

* [文档关系图按逻辑层级呈现](https://github.com/siyuan-note/siyuan/issues/62)
* [导出完成提示自动关闭](https://github.com/siyuan-note/siyuan/issues/780)
* [改进网页上的代码块剪藏](https://github.com/siyuan-note/siyuan/issues/781)
* [改进 `[[wikilink]]` 导入，识别 Obsidian 短路径格式](https://github.com/siyuan-note/siyuan/issues/786)
* [在安装目录下写入应用日志 app.log](https://github.com/siyuan-note/siyuan/issues/787)
* [全局关系图仅体现文档块之间的联系](https://github.com/siyuan-note/siyuan/issues/789)
* [改进内核退出，让退出过程更快一些](https://github.com/siyuan-note/siyuan/issues/795)
* [查看编辑历史性能优化](https://github.com/siyuan-note/siyuan/issues/796)

### 修复缺陷

* [网页内容复制后无法剪藏](https://github.com/siyuan-note/siyuan/issues/752)
* [列表内粘贴插入位置错误](https://github.com/siyuan-note/siyuan/issues/775)
* [配置在安装目录下时自定义外观问题](https://github.com/siyuan-note/siyuan/issues/777)
* [内容块嵌入编辑时内容不保存](https://github.com/siyuan-note/siyuan/issues/778)
* [自定义主题重启不生效以及代码重复生成问题](https://github.com/siyuan-note/siyuan/issues/782)
* [打开空文件夹不应该走导入向导](https://github.com/siyuan-note/siyuan/issues/784)
* [导入导出问题](https://github.com/siyuan-note/siyuan/issues/785)
* [快速插入标签额外多插入了一对 “#”](https://github.com/siyuan-note/siyuan/issues/788)

## v0.5.41 / 2020-12-18

### 引入特性

* [支持文档块书签](https://github.com/siyuan-note/siyuan/issues/339)

### 改进功能

* [去掉代码块预览选项，代码块默认预览高亮](https://github.com/siyuan-note/siyuan/issues/739)
* [去掉实时导出 Markdown 功能](https://github.com/siyuan-note/siyuan/issues/760)
* [上线付费订阅](https://github.com/siyuan-note/siyuan/issues/764)
* [从安装目录下读取配置文件夹](https://github.com/siyuan-note/siyuan/issues/766)
* [废弃锚文本模板变量 `{{.title}}`](https://github.com/siyuan-note/siyuan/issues/771)

### 修复缺陷

* [列表项块反链包含逻辑问题和引用计数问题](https://github.com/siyuan-note/siyuan/issues/571)
* [导出 PDF 有时图片、代码块和图表等渲染有问题](https://github.com/siyuan-note/siyuan/issues/761)
* [笔记本文件夹根一层没有 .md 时的问题](https://github.com/siyuan-note/siyuan/issues/763)
* [全局搜索卡顿问题](https://github.com/siyuan-note/siyuan/issues/768)
* [从托盘处激活报错](https://github.com/siyuan-note/siyuan/issues/769)

## v0.5.4 / 2020-12-16

### 引入特性

* [PDF 导出](https://github.com/siyuan-note/siyuan/issues/79)
* [点击查看大图功能](https://github.com/siyuan-note/siyuan/issues/609)
* [在引用内右键新增删除引用操作](https://github.com/siyuan-note/siyuan/issues/730)

### 改进功能

* [表格编辑改进](https://github.com/siyuan-note/siyuan/issues/555)
* [HTML 块预览开关](https://github.com/siyuan-note/siyuan/issues/607)
* [assets 资源文件支持改进](https://github.com/siyuan-note/siyuan/issues/652)
* [文件树上显示文档更新时间和大小](https://github.com/siyuan-note/siyuan/issues/661)
* [冒号后 emoji 输入直接回车行为改进](https://github.com/siyuan-note/siyuan/issues/669)
* [块引创建文档时支持指定路径](https://github.com/siyuan-note/siyuan/issues/673)
* [优化多开启动](https://github.com/siyuan-note/siyuan/issues/709)
* [动态查询嵌入默认隐藏 SQL](https://github.com/siyuan-note/siyuan/issues/721)
* [文档名去掉 `_id.sy` 段](https://github.com/siyuan-note/siyuan/issues/723)
* [独占一行的图片默认居中](https://github.com/siyuan-note/siyuan/issues/726)
* [搜索面板中的更多修改为右键](https://github.com/siyuan-note/siyuan/issues/731)
* [新增模板变量 `title`](https://github.com/siyuan-note/siyuan/issues/751)

### 文档相关

* [同步第三方远程仓库的操作文档](https://github.com/siyuan-note/siyuan/issues/718)

### 修复缺陷

* [{{.title}} 模板需要修正的几个地方](https://github.com/siyuan-note/siyuan/issues/692)
* [jfif 后缀资源图片清理未引用资源问题](https://github.com/siyuan-note/siyuan/issues/714)
* [剪切块内容时，无法进行撤销](https://github.com/siyuan-note/siyuan/issues/717)
* [文档块标题块转换时需复制关联的资源文件](https://github.com/siyuan-note/siyuan/issues/741)
* [鼠标悬停被任务栏遮挡](https://github.com/siyuan-note/siyuan/issues/748)

## v0.5.3 / 2020-12-12

### 引入特性

* [打通正文与文件树的壁障](https://github.com/siyuan-note/siyuan/issues/556)

### 改进功能

* [图注支持加粗、斜体和公式等行级渲染](https://github.com/siyuan-note/siyuan/issues/566)
* [修改标题块嵌入时提示不支持保存](https://github.com/siyuan-note/siyuan/issues/582)
* [块引搜索不区分大小写，支持类型前缀转义](https://github.com/siyuan-note/siyuan/issues/618)
* [支持分屏并移动](https://github.com/siyuan-note/siyuan/issues/677)
* [文件树排序忽略 Emoji](https://github.com/siyuan-note/siyuan/issues/685)
* [嵌入块的锚文本应当使用 .title](https://github.com/siyuan-note/siyuan/issues/690)
* [右键复制块引用修改为模版变量](https://github.com/siyuan-note/siyuan/issues/695)

### 修复缺陷

* [页内搜索问题](https://github.com/siyuan-note/siyuan/issues/53)
* [打开最近笔记本如果是 WebDAV 的话会报错](https://github.com/siyuan-note/siyuan/issues/650)
* [通过远程 IP 访问时图片不显示的问题](https://github.com/siyuan-note/siyuan/issues/680)
* [大纲渲染 `<foo>` 时的转义问题](https://github.com/siyuan-note/siyuan/issues/689)
* [预览时段落开头空两格对齐](https://github.com/siyuan-note/siyuan/issues/698)
* [清理未引用资源时需要将 HTML src 计入](https://github.com/siyuan-note/siyuan/issues/700)
* [标题上使用模板的问题](https://github.com/siyuan-note/siyuan/issues/702)

## v0.5.2 / 2020-12-07

### 引入特性

* [模板片段](https://github.com/siyuan-note/siyuan/issues/81)
* [块引锚文本支持模板变量](https://github.com/siyuan-note/siyuan/issues/490)
* [新建文档时文档名支持模板片段](https://github.com/siyuan-note/siyuan/issues/615)

### 改进功能

* [内核退出和监测机制改进](https://github.com/siyuan-note/siyuan/issues/624)
* [支持导入 .markdown 后缀](https://github.com/siyuan-note/siyuan/issues/631)
* [在编辑器内复制时不应该带块 ID](https://github.com/siyuan-note/siyuan/issues/637)

### 开发重构

* [重新实现最近使用的块](https://github.com/siyuan-note/siyuan/issues/636)

### 修复缺陷

* [下标渲染为上标问题](https://github.com/siyuan-note/siyuan/issues/628)
* [内容块动态查询嵌入跳转问题](https://github.com/siyuan-note/siyuan/issues/629)
* [音频资源文件插入问题](https://github.com/siyuan-note/siyuan/issues/630)
* [大纲拖拽引起的窗口布局问题](https://github.com/siyuan-note/siyuan/issues/633)
* [复制代码到代码块问题](https://github.com/siyuan-note/siyuan/issues/634)
* [自动空格设置为关闭后还是会添加空格的问题](https://github.com/siyuan-note/siyuan/issues/643)
* [WebDAV 图片显示问题](https://github.com/siyuan-note/siyuan/issues/648)
* [加密配置文件中的 WebDAV 密码字段](https://github.com/siyuan-note/siyuan/issues/649)
* [粘贴不了 Excel 内容的问题](https://github.com/siyuan-note/siyuan/issues/655)

## v0.5.1 / 2020-12-03

### 引入特性

* [最近的笔记本列表](https://github.com/siyuan-note/siyuan/issues/481)
* [支持上标下标语法](https://github.com/siyuan-note/siyuan/issues/534)

### 改进功能

* [块引悬浮框大小支持拖动](https://github.com/siyuan-note/siyuan/issues/526)
* [手机浏览器打开 assets 资源文件](https://github.com/siyuan-note/siyuan/issues/602)
* [稳定表格的 Markdown 格式化](https://github.com/siyuan-note/siyuan/issues/610)
* [代码块高亮支持语言由 45 种扩展为 51 种](https://github.com/siyuan-note/siyuan/issues/611)
* [文件树中文档前加上图标](https://github.com/siyuan-note/siyuan/issues/613)
* [文件树排序配置持久化](https://github.com/siyuan-note/siyuan/issues/614)
* [`private.key` 使用临时随机文件](https://github.com/siyuan-note/siyuan/issues/623)
* [代码块主题样式由 37 种扩展为 98 种](https://github.com/siyuan-note/siyuan/issues/626)
* [同步检查本地笔记本大小时排除 .git 元数据](https://github.com/siyuan-note/siyuan/issues/627)

### 修复缺陷

* [删除空行后公式错位](https://github.com/siyuan-note/siyuan/issues/608)
* [F11 全屏后窗口最大化状态不对的问题](https://github.com/siyuan-note/siyuan/issues/625)

## v0.5.0 / 2020-12-01

### 引入特性

* [超级块 {{{ blocks }}}](https://github.com/siyuan-note/siyuan/issues/73)
* [内容块 URL 定位](https://github.com/siyuan-note/siyuan/issues/568)

### 改进功能

* [改进 ToC 渲染，支持点击跳转](https://github.com/siyuan-note/siyuan/issues/49)
* [Ctrl B 加粗文字后光标位置改进](https://github.com/siyuan-note/siyuan/issues/323)
* [在新窗口打开块引](https://github.com/siyuan-note/siyuan/issues/500)
* [预览模式下粘贴公式到公众号公式尺寸异常](https://github.com/siyuan-note/siyuan/issues/540)
* [块嵌入内容直接选择复制](https://github.com/siyuan-note/siyuan/issues/543)
* [表格内 `<br>` 编辑表现不一致](https://github.com/siyuan-note/siyuan/issues/547)
* [行级公式作为西文对待加空格](https://github.com/siyuan-note/siyuan/issues/565)
* [笔记本路径不能让用户选择在安装路径上](https://github.com/siyuan-note/siyuan/issues/569)
* [`echarts` 代码区编辑体验问题](https://github.com/siyuan-note/siyuan/issues/570)
* [macOS 窗体按钮改进](https://github.com/siyuan-note/siyuan/issues/579)
* [编辑右键菜单“设为文档标题”](https://github.com/siyuan-note/siyuan/issues/580)
* [文件树字母排序考虑拼音](https://github.com/siyuan-note/siyuan/issues/596)
* [改进同步实现](https://github.com/siyuan-note/siyuan/issues/598)
* [内核连接检查](https://github.com/siyuan-note/siyuan/issues/599)

### 修复缺陷

* [YAML Front Matter 中删除问题](https://github.com/siyuan-note/siyuan/issues/109)
* [切换明亮暗黑模式后图表相关渲染没有切换](https://github.com/siyuan-note/siyuan/issues/561)
* [块引用块内按 Ctrl+B 会自动换行](https://github.com/siyuan-note/siyuan/issues/562)
* [大纲层级折叠问题](https://github.com/siyuan-note/siyuan/issues/563)
* [代码块渲染问题](https://github.com/siyuan-note/siyuan/issues/567)
* [预览时图片等附件资源链接错误](https://github.com/siyuan-note/siyuan/issues/588)
* [第一次导入时不应该添加中西文自动空格](https://github.com/siyuan-note/siyuan/issues/589)
* [软换行后粘贴的图片无法正确渲染](https://github.com/siyuan-note/siyuan/issues/603)

## v0.4.9 / 2020-11-23

### 引入特性

* [选中内容右键“作为内容新建文档”](https://github.com/siyuan-note/siyuan/issues/296)
* [编辑器自定义字号](https://github.com/siyuan-note/siyuan/issues/504)
* [支持图片标题渲染](https://github.com/siyuan-note/siyuan/issues/505)
* [流程图、甘特图、时序图、图表、脑图、五线谱、添加暗黑模式](https://github.com/siyuan-note/siyuan/issues/560)

### 改进功能

* [粘贴链接优化](https://github.com/siyuan-note/siyuan/issues/38)
* [列表项批量缩进和取消缩进](https://github.com/siyuan-note/siyuan/issues/56)
* [数学公式块去除背景](https://github.com/siyuan-note/siyuan/issues/63)
* [搜索结果一键复制](https://github.com/siyuan-note/siyuan/issues/506)
* [嵌入编辑进入时不跳到第一行](https://github.com/siyuan-note/siyuan/issues/525)
* [改进启动引导](https://github.com/siyuan-note/siyuan/issues/559)

### 修复缺陷

* [资源附件本地打开问题](https://github.com/siyuan-note/siyuan/issues/515)
* [使用 MathJax 引擎编辑公式时白屏的问题](https://github.com/siyuan-note/siyuan/issues/537)
* [大纲只能折叠根节点下第一层的问题](https://github.com/siyuan-note/siyuan/issues/542)
* [输入 HTML 实体之后无法继续再输入其它字符](https://github.com/siyuan-note/siyuan/issues/548)
* [标签无法显示](https://github.com/siyuan-note/siyuan/issues/550)
* [引用计数的气泡被侧边栏遮住了](https://github.com/siyuan-note/siyuan/issues/553)

## v0.4.8 / 2020-11-19

### 引入特性

* [支持表格编辑](https://github.com/siyuan-note/siyuan/issues/39)
* [大纲折叠](https://github.com/siyuan-note/siyuan/issues/240)

### 改进功能

* [打开笔记本文件夹时提示文案](https://github.com/siyuan-note/siyuan/issues/236)
* [Ctrk J 任务列表后再取消遗留空格](https://github.com/siyuan-note/siyuan/issues/478)
* [大纲中渲染 Latex、行级代码、粗体斜体](https://github.com/siyuan-note/siyuan/issues/488)
* [公式块中的 `\tag` 语法样式改进](https://github.com/siyuan-note/siyuan/issues/517)
* [搜索忽略大小写](https://github.com/siyuan-note/siyuan/issues/524)

### 修复缺陷

* [笔记录音问题](https://github.com/siyuan-note/siyuan/issues/266)
* [鼠标移动到滚动条上的样式问题](https://github.com/siyuan-note/siyuan/issues/518)
* [路径带 `%20` 的图片清理和导出 TextBundle 问题](https://github.com/siyuan-note/siyuan/issues/519)
* [行级数学公式无法正确渲染](https://github.com/siyuan-note/siyuan/issues/523)
* [脑图, e-charts,mermaid 编辑后无法渲染](https://github.com/siyuan-note/siyuan/issues/527)
* [松散任务列表块初始化渲染问题](https://github.com/siyuan-note/siyuan/issues/530)

## v0.4.7 / 2020-11-17

### 引入特性

* [内容块动态查询嵌入](https://github.com/siyuan-note/siyuan/issues/48)
* [内容块 URL](https://github.com/siyuan-note/siyuan/issues/476)

### 改进功能

* [编辑栏的高亮按钮和快捷键](https://github.com/siyuan-note/siyuan/issues/362)
* [Latex 渲染大小自适应标题级别](https://github.com/siyuan-note/siyuan/issues/487)
* [流程图自适应大小](https://github.com/siyuan-note/siyuan/issues/493)
* [字数统计和大文档保存性能优化](https://github.com/siyuan-note/siyuan/issues/512)

### 修复缺陷

* [无序列表变成有序列表后块 ID 改变的问题](https://github.com/siyuan-note/siyuan/issues/249)
* [长文档不能自动保存](https://github.com/siyuan-note/siyuan/issues/354)
* [悬浮预览内容为空的内容块时闪烁问题](https://github.com/siyuan-note/siyuan/issues/513)
* [Markdown 解析异常导致内核启动失败](https://github.com/siyuan-note/siyuan/issues/516)
* [文件夹下文档反链提及搜索为空](https://github.com/siyuan-note/siyuan/issues/521)

## v0.4.6 / 2020-11-15

### 引入特性

* [内容块嵌入编辑](https://github.com/siyuan-note/siyuan/issues/17)
* [块引悬浮预览嵌套浏览](https://github.com/siyuan-note/siyuan/issues/51)
* [搜索支持 SQL](https://github.com/siyuan-note/siyuan/issues/72)

### 改进功能

* [版本管理开关](https://github.com/siyuan-note/siyuan/issues/224)
* [云端笔记本克隆到本地时增加提示](https://github.com/siyuan-note/siyuan/issues/413)
* [粘贴时减少抖动优化](https://github.com/siyuan-note/siyuan/issues/447)
* [支持标签搜索](https://github.com/siyuan-note/siyuan/issues/461)
* [用“剪切，粘贴”移动被引用的块之后，引用丢失目标](https://github.com/siyuan-note/siyuan/issues/463)
* [移动端支持上传](https://github.com/siyuan-note/siyuan/issues/499)
* [同步库名支持空格、短横线等符号](https://github.com/siyuan-note/siyuan/issues/501)

### 修复缺陷

* [块引使用标题前缀 # 过滤时前面多了一个 (](https://github.com/siyuan-note/siyuan/issues/498)
* [使用 assets 路径的 `<img>` 标签图片无法显示](https://github.com/siyuan-note/siyuan/issues/503)

## v0.4.5 / 2020-11-13

### 引入特性

* [反向链接支持搜索过滤](https://github.com/siyuan-note/siyuan/issues/393)
* [反向链接提及支持一键转为内部链接](https://github.com/siyuan-note/siyuan/issues/453)
* [块引用的锚文本支持 Latex、加粗、强调等行级排版](https://github.com/siyuan-note/siyuan/issues/482)
* [支持图片路径带空格的情况](https://github.com/siyuan-note/siyuan/issues/483)

### 改进功能

* [分享发布设置私有时即时生效](https://github.com/siyuan-note/siyuan/issues/441)
* [从选中文字新建文档名称不全的问题](https://github.com/siyuan-note/siyuan/issues/477)

### 修复缺陷

* [块引标题自动完成问题](https://github.com/siyuan-note/siyuan/issues/466)
* [任务列表编辑渲染问题](https://github.com/siyuan-note/siyuan/issues/470)
* [文档块 URL 打开问题](https://github.com/siyuan-note/siyuan/issues/472)

## v0.4.4 / 2020-11-11

### 引入特性

* [浏览器拖拽图文剪藏](https://github.com/siyuan-note/siyuan/issues/405)
* [支持设置浏览器端访问鉴权](https://github.com/siyuan-note/siyuan/issues/458)

### 改进功能

* [脚注改进](https://github.com/siyuan-note/siyuan/issues/437)
* [Windows 版本内置集成 Git ](https://github.com/siyuan-note/siyuan/issues/455)
* [反链提及中默认纳入当前文档名作为锚文本进行搜索](https://github.com/siyuan-note/siyuan/issues/457)
* [链接引用改进](https://github.com/siyuan-note/siyuan/issues/460)
* [加入持久化块 ID 的配置选项](https://github.com/siyuan-note/siyuan/issues/468)

### 修复缺陷

* [修复启动白屏 404 问题](https://github.com/siyuan-note/siyuan/issues/454)
* [预览/引用/嵌入内容重复问题](https://github.com/siyuan-note/siyuan/issues/456)

## v0.4.3 / 2020-11-09

### 引入特性

* [文档块 URL](https://github.com/siyuan-note/siyuan/issues/312)

### 改进功能

* [PDF 预览效果添加使用浏览器和本地 PDF 工具打开](https://github.com/siyuan-note/siyuan/issues/363)
* [改进只读模式](https://github.com/siyuan-note/siyuan/issues/430)
* [在关于页面加入伺服地址](https://github.com/siyuan-note/siyuan/issues/440)
* [为右键菜单加上图标](https://github.com/siyuan-note/siyuan/issues/444)
* [同步依赖官方 Git 安装](https://github.com/siyuan-note/siyuan/issues/445)
* [URL 由 /assets/ 换为 /stage/](https://github.com/siyuan-note/siyuan/issues/450)

### 修复缺陷

* [偶发的启动白屏问题](https://github.com/siyuan-note/siyuan/issues/438)
* [右键菜单遮挡内容问题](https://github.com/siyuan-note/siyuan/issues/446)

## v0.4.2 / 2020-11-06

### 引入特性

* [支持当前编辑器页签打开新文档](https://github.com/siyuan-note/siyuan/issues/183)
* [在线发布](https://github.com/siyuan-note/siyuan/issues/305)

### 改进功能

* [预览模式点击 PDF 无法关闭](https://github.com/siyuan-note/siyuan/issues/414)
* [改进更新检查提示](https://github.com/siyuan-note/siyuan/issues/421)
* [脚注语法支持改进](https://github.com/siyuan-note/siyuan/issues/432)
* [链接引用语法支持改进](https://github.com/siyuan-note/siyuan/issues/434)

### 修复缺陷

* [新建文件夹不显示问题](https://github.com/siyuan-note/siyuan/issues/420)
* [导入时重复建立文件夹的问题](https://github.com/siyuan-note/siyuan/issues/426)
* [HTML 标签 `<code>` 编辑解析问题](https://github.com/siyuan-note/siyuan/issues/427)
* [任务列表暴露 ID 问题](https://github.com/siyuan-note/siyuan/issues/429)

## v0.4.1 / 2020-11-04

### 引入特性

* [自定义书签标识](https://github.com/siyuan-note/siyuan/issues/67)
* [支持设置块引时新建文档默认存储路径](https://github.com/siyuan-note/siyuan/issues/291)
* [文件树排序加上自然序](https://github.com/siyuan-note/siyuan/issues/389)

### 改进功能

* [版本管理从自动保存时提交改为定时提交](https://github.com/siyuan-note/siyuan/issues/401)
* [优化创建、移动文档/文件夹/资源文件的性能](https://github.com/siyuan-note/siyuan/issues/404)

### 修复缺陷

* [账号登录状态过期问题](https://github.com/siyuan-note/siyuan/issues/383)
* [表格快捷键 Ctrl Shift + 失效](https://github.com/siyuan-note/siyuan/issues/396)
* [嵌入块无法复制 ID](https://github.com/siyuan-note/siyuan/issues/397)
* [自动保存时软换行失效问题](https://github.com/siyuan-note/siyuan/issues/400)
* [云端使用图片不显示问题](https://github.com/siyuan-note/siyuan/issues/408)
* [HTML 标签 `<ms>` 导致卡死的问题](https://github.com/siyuan-note/siyuan/issues/411)
* [- 列表项和 Setext 解析冲突导致内核崩溃问题](https://github.com/siyuan-note/siyuan/issues/416)

## v0.4.0 / 2020-11-02

### 引入特性

* [桌面版浏览器支持](https://github.com/siyuan-note/siyuan/issues/188)
* [当前编辑器页签文件树定位](https://github.com/siyuan-note/siyuan/issues/378)
* [内核加入只读模式](https://github.com/siyuan-note/siyuan/issues/386)

### 改进功能

* [数学公式显示优化](https://github.com/siyuan-note/siyuan/issues/333)
* [右键菜单中加入删除/剪切块](https://github.com/siyuan-note/siyuan/issues/368)
* [思源在线工作空间会话鉴权](https://github.com/siyuan-note/siyuan/issues/381)
* [块引用和嵌入加上路径信息](https://github.com/siyuan-note/siyuan/issues/384)

### 修复缺陷

* [粘贴块引用无效](https://github.com/siyuan-note/siyuan/issues/385)
* [文件夹下可以新建空文档名的问题](https://github.com/siyuan-note/siyuan/issues/387)
* [文本加行级代码软换行问题](https://github.com/siyuan-note/siyuan/issues/388)

## v0.3.9 / 2020-10-31

### 引入特性

* [文件树排序](https://github.com/siyuan-note/siyuan/issues/335)
* [自动识别桌面端/移动端浏览器并重定向到对应版本界面](https://github.com/siyuan-note/siyuan/issues/377)

### 改进功能

* [添加粗体、斜体、标签等行级元素文字颜色配置](https://github.com/siyuan-note/siyuan/issues/287)
* [文件上右键新增新建文档/文件入口](https://github.com/siyuan-note/siyuan/issues/361)
* [改进快捷键提示文案与本地系统一致](https://github.com/siyuan-note/siyuan/issues/369)
* [文档关系图层级结构优化](https://github.com/siyuan-note/siyuan/issues/376)

### 修复缺陷

* [任务列表项中嵌入内容块问题](https://github.com/siyuan-note/siyuan/issues/346)
* [内容块标识菜单分屏时无法弹出的问题](https://github.com/siyuan-note/siyuan/issues/366)
* [软换行行级代码失效问题](https://github.com/siyuan-note/siyuan/issues/370)
* [HTML `<scope>` 标签解析渲染问题](https://github.com/siyuan-note/siyuan/issues/374)
* [列表项行级排版自动换行问题](https://github.com/siyuan-note/siyuan/issues/379)

## v0.3.8 / 2020-10-30

### 引入特性

* [以预览模式打开文档](https://github.com/siyuan-note/siyuan/issues/115)

### 改进功能

* [清理未引用资源-图片预览](https://github.com/siyuan-note/siyuan/issues/324)
* [标签及反向链接列表内容和路径分两行显示](https://github.com/siyuan-note/siyuan/issues/349)
* [清理未引用 ID 仅在发生变动情况下才写盘](https://github.com/siyuan-note/siyuan/issues/353)
* [链接/图片路径中存在中文时不进行编码处理](https://github.com/siyuan-note/siyuan/issues/357)
* [代码块、数学公式间距过大](https://github.com/siyuan-note/siyuan/issues/358)

### 开发重构

* [重写右键菜单](https://github.com/siyuan-note/siyuan/issues/351)

### 修复缺陷

* [重命名文件夹后图片显示异常](https://github.com/siyuan-note/siyuan/issues/350)
* [书签丢失问题](https://github.com/siyuan-note/siyuan/issues/355)
* [任务列表暴露 ID 问题](https://github.com/siyuan-note/siyuan/issues/356)
* [行级 HTML 解析问题](https://github.com/siyuan-note/siyuan/issues/360)
* [列表项中嵌入内容块问题](https://github.com/siyuan-note/siyuan/issues/364)
* [移动文档报错问题](https://github.com/siyuan-note/siyuan/issues/365)

## v0.3.7 / 2020-10-28

### 引入特性

* [支持文档导出为 TextBundle](https://github.com/siyuan-note/siyuan/issues/50)
* [块引搜索类型过滤](https://github.com/siyuan-note/siyuan/issues/342)

### 改进功能

* [Mac 窗口按钮重做](https://github.com/siyuan-note/siyuan/issues/288)
* [块引用候选列表内容块预览](https://github.com/siyuan-note/siyuan/issues/297)
* [标签及书签中块列表增加路径信息](https://github.com/siyuan-note/siyuan/issues/322)
* [Shift 单击时新窗口打开优化](https://github.com/siyuan-note/siyuan/issues/332)
* [粘贴后需定位](https://github.com/siyuan-note/siyuan/issues/348)

### 修复缺陷

* [编辑器行级内容拖拽问题](https://github.com/siyuan-note/siyuan/issues/337)
* [表格内容空格消失问题](https://github.com/siyuan-note/siyuan/issues/347)

## v0.3.6 / 2020-10-27

### 引入特性

* [复制内容块快捷操作](https://github.com/siyuan-note/siyuan/issues/313)

### 改进功能

* [选中文本后进行内容块粘贴时锚文本的优化](https://github.com/siyuan-note/siyuan/issues/321)
* [块 ID 复制粘贴改进](https://github.com/siyuan-note/siyuan/issues/338)

### 修复缺陷

* [多开时实例隔离问题](https://github.com/siyuan-note/siyuan/issues/274)
* [标签页签排序不稳定的问题](https://github.com/siyuan-note/siyuan/issues/325)
* [任务列表块编辑渲染问题](https://github.com/siyuan-note/siyuan/issues/334)
* [文件夹拖拽移动问题](https://github.com/siyuan-note/siyuan/issues/336)

## v0.3.5 / 2020-10-26

### 引入特性

* [assets 资源预览页签](https://github.com/siyuan-note/siyuan/issues/120)
* [移动文档](https://github.com/siyuan-note/siyuan/issues/244)

### 改进功能

* [清理未引用资源加上加载中示意](https://github.com/siyuan-note/siyuan/issues/317)
* [增大文件重命名界面宽度](https://github.com/siyuan-note/siyuan/issues/329)

### 修复缺陷

* [Setext 风格标题编辑问题](https://github.com/siyuan-note/siyuan/issues/278)
* [加粗、强调、标记等软换行失效问题](https://github.com/siyuan-note/siyuan/issues/311)
* [块引用搜索展示不全](https://github.com/siyuan-note/siyuan/issues/316)
* [提示窗口关闭回调错误](https://github.com/siyuan-note/siyuan/issues/318)
* [列表项缩进问题](https://github.com/siyuan-note/siyuan/issues/319)
* [清理未引用资源报错问题](https://github.com/siyuan-note/siyuan/issues/330)

## v0.3.4 / 2020-10-23

### 引入特性

* [清理 assets 文件夹未引用资源文件](https://github.com/siyuan-note/siyuan/issues/110)
* [支持列表项块](https://github.com/siyuan-note/siyuan/issues/111)

### 改进功能

* [输入法符号自动补全时块引补全兼容](https://github.com/siyuan-note/siyuan/issues/228)
* [数学公式预览开关](https://github.com/siyuan-note/siyuan/issues/270)
* [反链提及中高亮锚文本](https://github.com/siyuan-note/siyuan/issues/285)

### 修复缺陷

* [自顶向下法新建文档后光标定位问题](https://github.com/siyuan-note/siyuan/issues/299)
* [自动更新在 macOS 和 Linux 上不工作的问题](https://github.com/siyuan-note/siyuan/issues/301)
* [资源文件删除失效问题](https://github.com/siyuan-note/siyuan/issues/307)
* [列表编辑解析问题](https://github.com/siyuan-note/siyuan/issues/309)

## v0.3.3 / 2020-10-21

### 引入特性

* [编辑器右键添加复制、粘贴、剪切](https://github.com/siyuan-note/siyuan/issues/57)
* [新建文档块自顶向下用法](https://github.com/siyuan-note/siyuan/issues/70)
* [自动更新](https://github.com/siyuan-note/siyuan/issues/170)
* [Windows 版发布包增加 Zip 绿色解压版](https://github.com/siyuan-note/siyuan/issues/175)
* [在块的标识上增加单击后的功能【复制块内容】](https://github.com/siyuan-note/siyuan/issues/225)
* [选择文本右键选项“创建以此为标题的新笔记”](https://github.com/siyuan-note/siyuan/issues/283)

### 改进功能

* [优化启动速度](https://github.com/siyuan-note/siyuan/issues/289)
* [设置 - 关于中增加“打开配置文件夹”](https://github.com/siyuan-note/siyuan/issues/290)

### 修复缺陷

* [安装路径中有空格时启动异常](https://github.com/siyuan-note/siyuan/issues/284)

## v0.3.2 / 2020-10-20

### 引入特性

* [反链提及](https://github.com/siyuan-note/siyuan/issues/74)
* [思源在线（Xanadu）移动端添加 PWA](https://github.com/siyuan-note/siyuan/issues/265)

### 改进功能

* [设置 - 外观中增加“点击关闭按钮时的行为”](https://github.com/siyuan-note/siyuan/issues/246)
* [窗口 最大化/向下还原 切换时，分屏布局宽度高度自适应](https://github.com/siyuan-note/siyuan/issues/263)
* [书签、文件树、标签扩大折叠展开箭头的点击范围](https://github.com/siyuan-note/siyuan/issues/275)
* [内核进程增加常驻内存参数](https://github.com/siyuan-note/siyuan/issues/277)
* [macOS 版使用 Windows 风格](https://github.com/siyuan-note/siyuan/issues/281)

### 修复缺陷

* [联动关系图页签关闭问题](https://github.com/siyuan-note/siyuan/issues/267)
* [标签自动完成问题](https://github.com/siyuan-note/siyuan/issues/268)
* [关闭程序后窗口布局持久化、清理 ID 失效问题](https://github.com/siyuan-note/siyuan/issues/271)
* [包含行内代码块的标题无法在大纲中正常渲染](https://github.com/siyuan-note/siyuan/issues/272)
* [编辑器内任务列表复制报错问题](https://github.com/siyuan-note/siyuan/issues/276)
* [导入时处理某些行级 HTML 导致的崩溃问题](https://github.com/siyuan-note/siyuan/issues/280)

## v0.3.1 / 2020-10-18

### 引入特性

* [标签输入自动完成](https://github.com/siyuan-note/siyuan/issues/161)
* [支持调整外观配色](https://github.com/siyuan-note/siyuan/issues/167)
* [退出时清理未使用的块 ID，减少对笔记文本的”污染“](https://github.com/siyuan-note/siyuan/issues/261)

### 改进功能

* [复制块 ID 后，增加粘贴成嵌入块选项](https://github.com/siyuan-note/siyuan/issues/250)
* [工具栏标题快捷键 Ctrl h 取消优化](https://github.com/siyuan-note/siyuan/issues/256)
* [搜索预览窗复制块 ID 和编辑器内复制块 ID 锚文本不一致](https://github.com/siyuan-note/siyuan/issues/257)
* [移动端文件树的滑动问题](https://github.com/siyuan-note/siyuan/issues/259)

## v0.3.0 / 2020-10-17

### 引入特性

* [支持删除云端仓库](https://github.com/siyuan-note/siyuan/issues/243)

### 改进功能

* [导出选项 - 块引锚文本包裹符号](https://github.com/siyuan-note/siyuan/issues/172)
* [启动加载界面](https://github.com/siyuan-note/siyuan/issues/229)
* [块引用悬浮预览窗口加入跳转按钮](https://github.com/siyuan-note/siyuan/issues/233)
* [搜索预览时支持复制内容块 ID](https://github.com/siyuan-note/siyuan/issues/242)

### 修复缺陷

* [联动关系图问题](https://github.com/siyuan-note/siyuan/issues/237)
* [导入时选择原地存储路径导致无限嵌套问题](https://github.com/siyuan-note/siyuan/issues/245)
* [在部分版本的 Windows 10 操作系统上界面样式异常问题](https://github.com/siyuan-note/siyuan/issues/247)
* [快速搜索最近打开的块中包含关闭笔记本的块](https://github.com/siyuan-note/siyuan/issues/248)
* [内容块中存在 `<font>` 时悬浮预览问题](https://github.com/siyuan-note/siyuan/issues/251)
* [标题内容中存在 `<font>` 时大纲点击失效问题](https://github.com/siyuan-note/siyuan/issues/252)

## v0.2.9 / 2020-10-14

### 引入特性

* [从云端仓库克隆笔记本](https://github.com/siyuan-note/siyuan/issues/186)
* [支持 flowchart.js 渲染](https://github.com/siyuan-note/siyuan/issues/215)
* [快速搜索改进并支持正则表达式](https://github.com/siyuan-note/siyuan/issues/218)
* [打开笔记本时新增导入流程](https://github.com/siyuan-note/siyuan/issues/221)

### 改进功能

* [同步后实时刷新文档](https://github.com/siyuan-note/siyuan/issues/212)
* [#标签# 标记符隐藏](https://github.com/siyuan-note/siyuan/issues/232)

### 修复缺陷

* [重命名文件夹打不开问题](https://github.com/siyuan-note/siyuan/issues/203)
* [assets 和新导入的 .md 版本控制问题](https://github.com/siyuan-note/siyuan/issues/214)
* [编辑器复制块引用 `>` 问题](https://github.com/siyuan-note/siyuan/issues/216)
* [修复云端仓库访问控制漏洞](https://github.com/siyuan-note/siyuan/issues/227)

## v0.2.8 / 2020-10-11

### 引入特性

* [移动端云服务](https://github.com/siyuan-note/siyuan/issues/187)
* [移动端加入同步支持](https://github.com/siyuan-note/siyuan/issues/199)
* [文件树空白可以新建，文件夹移上去添加更多和新建按钮](https://github.com/siyuan-note/siyuan/issues/210)

### 改进功能

* [启动时恢复上一次窗口大小和位置](https://github.com/siyuan-note/siyuan/issues/136)
* [文件树交互改进](https://github.com/siyuan-note/siyuan/issues/189)
* [更新账号信息需进行提示](https://github.com/siyuan-note/siyuan/issues/190)
* [初始化树组件异常报错](https://github.com/siyuan-note/siyuan/issues/192)
* [设置 - 同步](https://github.com/siyuan-note/siyuan/issues/193)
* [为页签添加背景色配置](https://github.com/siyuan-note/siyuan/issues/195)
* [为坚果云 WebDAV 做单独的优化](https://github.com/siyuan-note/siyuan/issues/201)

### 修复缺陷

* [WebDAV 缺陷修复](https://github.com/siyuan-note/siyuan/issues/198)
* [文件查询失败](https://github.com/siyuan-note/siyuan/issues/200)
* [YAML Front Matter 导入问题](https://github.com/siyuan-note/siyuan/issues/202)
* [文档开头为空块时关系图连线不显示问题](https://github.com/siyuan-note/siyuan/issues/204)
* [文件夹重命名为同名文件失败无提示](https://github.com/siyuan-note/siyuan/issues/206)
* [粘贴带有 alt 属性的图片后无法显示](https://github.com/siyuan-note/siyuan/issues/207)
* [批量插入图片问题](https://github.com/siyuan-note/siyuan/issues/208)

## v0.2.7 / 2020-10-08

### 引入特性

* [数据同步](https://github.com/siyuan-note/siyuan/issues/87)
* [文件树支持分屏打开文档](https://github.com/siyuan-note/siyuan/issues/144)

### 改进功能

* [内容联动大纲改进](https://github.com/siyuan-note/siyuan/issues/148)
* [快速搜索内容块预览关键词高亮](https://github.com/siyuan-note/siyuan/issues/155)
* [标签页签与书签页签内容块预览](https://github.com/siyuan-note/siyuan/issues/159)
* [解决知乎不支持引用嵌套](https://github.com/siyuan-note/siyuan/issues/162)
* [表格复制到知乎问题](https://github.com/siyuan-note/siyuan/issues/163)
* [细化编辑器标记符配色](https://github.com/siyuan-note/siyuan/issues/168)
* [添加启动日志开头标识](https://github.com/siyuan-note/siyuan/issues/176)
* [移动端浏览图片和块嵌入](https://github.com/siyuan-note/siyuan/issues/177)
* [抽取关系图配色值](https://github.com/siyuan-note/siyuan/issues/180)
* [降低内存占用](https://github.com/siyuan-note/siyuan/issues/182)

### 修复缺陷

* [打开空文件夹失败](https://github.com/siyuan-note/siyuan/issues/173)
* [联动编辑跳转的问题](https://github.com/siyuan-note/siyuan/issues/179)
* [全局关系图在某些情况下没有箭头的问题](https://github.com/siyuan-note/siyuan/issues/181)
* [#标签# 中文空格问题](https://github.com/siyuan-note/siyuan/issues/184)
* [页签拖拽无限复制和拖拽至编辑器问题](https://github.com/siyuan-note/siyuan/issues/185)

## v0.2.6 / 2020-10-06

### 引入特性

* [支持 Windows 系统托盘](https://github.com/siyuan-note/siyuan/issues/37)
* [浏览器上直接使用](https://github.com/siyuan-note/siyuan/issues/121)
* [发布内核 Docker 镜像](https://github.com/siyuan-note/siyuan/issues/171)

### 改进功能

* [内容块引用自动完成列表条目优化](https://github.com/siyuan-note/siyuan/issues/149)
* [Windows 版发布包改为安装程序](https://github.com/siyuan-note/siyuan/issues/157)

### 修复缺陷

* [MathJax 引擎 `\boldsymbol{}` 问题](https://github.com/siyuan-note/siyuan/issues/152)
* [WebDAV 报错导致内核崩溃](https://github.com/siyuan-note/siyuan/issues/153)
* [本地仓库初始化时获取 Git 用户报错](https://github.com/siyuan-note/siyuan/issues/154)
* [快速搜索报错](https://github.com/siyuan-note/siyuan/issues/156)

## v0.2.5 / 2020-10-02

### 引入特性

* [支持版本管理，本地 Git 仓库](https://github.com/siyuan-note/siyuan/issues/86)
* [快速搜索加入内容块预览](https://github.com/siyuan-note/siyuan/issues/103)

### 改进功能

* [修改主题 CSS 时即时呈现](https://github.com/siyuan-note/siyuan/issues/117)
* [内容块联动大纲](https://github.com/siyuan-note/siyuan/issues/122)
* [最大宽度设置优化](https://github.com/siyuan-note/siyuan/issues/129)
* [打开帮助文档优化](https://github.com/siyuan-note/siyuan/issues/131)
* [同时打开反链、关系图会报错](https://github.com/siyuan-note/siyuan/issues/135)
* [设置 - 语言合并到外观中作为一个选项](https://github.com/siyuan-note/siyuan/issues/139)
* [保存布局时，页签多语言失效](https://github.com/siyuan-note/siyuan/issues/140)
* [嵌入内容块能够被选中复制](https://github.com/siyuan-note/siyuan/issues/141)
* [废除软删除 .deleted 机制](https://github.com/siyuan-note/siyuan/issues/145)

### 文档相关

* [用户指南文档独立成库](https://github.com/siyuan-note/siyuan/issues/142)

### 修复缺陷

* [关闭笔记本时清理相关的页签](https://github.com/siyuan-note/siyuan/issues/130)

## v0.2.4 / 2020-09-29

### 引入特性

* [assets 资源文件展现](https://github.com/siyuan-note/siyuan/issues/27)
* [窗口布局持久化](https://github.com/siyuan-note/siyuan/issues/46)
* [支持 asciinema 嵌入播放](https://github.com/siyuan-note/siyuan/issues/106)
* [引入 git 本地仓库](https://github.com/siyuan-note/siyuan/issues/119)

### 改进功能

* [关系图上显示文档块标题块文本](https://github.com/siyuan-note/siyuan/issues/68)
* [文档最大宽度设置](https://github.com/siyuan-note/siyuan/issues/105)
* [修改应用标题](https://github.com/siyuan-note/siyuan/issues/112)
* [重命名实时导出文档](https://github.com/siyuan-note/siyuan/issues/124)
* [嵌入块编辑优化](https://github.com/siyuan-note/siyuan/issues/126)

### 修复缺陷

* [搜索关键词不能定位问题](https://github.com/siyuan-note/siyuan/issues/96)
* [加粗渲染问题](https://github.com/siyuan-note/siyuan/issues/123)

## v0.2.3 / 2020-09-27

### 引入特性

* [标签页签，支持层级标签](https://github.com/siyuan-note/siyuan/issues/91)
* [搜索条件持久化](https://github.com/siyuan-note/siyuan/issues/101)

### 改进功能

* [粘贴图片使用时间戳作为文件名](https://github.com/siyuan-note/siyuan/issues/84)
* [笔记本打开仅支持文件夹](https://github.com/siyuan-note/siyuan/issues/90)
* [==标记==语法自动折行优化](https://github.com/siyuan-note/siyuan/issues/102)
* [移除中文分词，依靠输入时空格分词](https://github.com/siyuan-note/siyuan/issues/107)
* [降低内存使用](https://github.com/siyuan-note/siyuan/issues/108)

### 修复缺陷

* [任务列表起始位置使用 `<font>` 标签的预览问题](https://github.com/siyuan-note/siyuan/issues/33)
* [子列表中粘贴代码块问题](https://github.com/siyuan-note/siyuan/issues/77)
* [复制粘贴内容后搜索引用不到问题](https://github.com/siyuan-note/siyuan/issues/89)
* [任务列表嵌套缩进问题](https://github.com/siyuan-note/siyuan/issues/93)
* [网络图片引用失效](https://github.com/siyuan-note/siyuan/issues/94)
* [修改内容块后书签丢失问题](https://github.com/siyuan-note/siyuan/issues/99)
* [软删除重名问题](https://github.com/siyuan-note/siyuan/issues/100)

## v0.2.2 / 2020-09-25

### 引入特性

* 接入社区账号
* #标签 语法导入为 #标签#
* 本地文件支持使用 Ctrl + Click 打开

### 改进功能

* 反链列表中的引用块支持悬浮预览和关联高亮
* 内容块嵌入编辑体验优化
* 文件夹拖入使用绝对路径

### 文档相关

* 公开外观、文档仓库 https://github.com/siyuan-note/appearance

### 修复缺陷

* 新建文件后，文件树错落
* 同一文档中多次嵌入同一个块的问题
* 嵌入标题块时聚合内容块截断问题

## v0.2.1 / 2020-09-23

### 引入特性

* 自定义外观样式
* 内联 HTML 标签编辑渲染
* #标签# 语法支持

### 改进功能

* 关系图性能优化
* 内联 HTML `<br>` 不折叠渲染
* 嵌入块标识，不允许引用嵌入块
* 搜索和输入法兼容优化
* 引用代码块细节体验优化

### 文档相关

* 自定义外观文档

### 修复缺陷

* 列表内的公式块和列表文字之间空行问题
* 本地图片加载问题
* 强调、加粗和标记等软换行光标丢失问题
* 外观缓存问题
* `[[wikilink|text]]` 导入问题
* mermaid 问题修复

## v0.2.0 / 2020-09-21

### 引入特性

* 文档反向链接页签
* 联动文档关系图页签
* 联动大纲页签
* 联动反向链接页签
* 支持内容块嵌入语法 !((id "text")) 

### 改进功能

* MathJax 引擎 \boldsymbol{} 支持
* 代码块预览开关刷新编辑器
* 块嵌入渲染距离调整
* 搜索结果排序优化
* ==Mark== 必须使用两个等号
* 大纲隐藏 Markdown 标记符
* 新增一些快捷键

### 修复缺陷

* 书签自动收缩问题
* 用回退删除空行后面行被删除的问题
* 关系图节点闪烁
* 预览细节问题修复
* 紧凑列表变松散列表问题
* 关闭笔记本后关系图依然显示问题

## v0.1.9 / 2020-09-19

### 引入特性

* 添加代码块主题配置
* 添加代码块是否预览配置
* 搜索支持精确模式和中文分词

### 改进功能

* 按配置的导出选项进行预览
* 预览时显示内容块嵌入字数统计
* 打开笔记本后自动展开
* 优化导出选项，新增摘要 + 嵌入
* 调小编辑撤销可用时间间隔
* 创建文档/文件夹需要指定名称
* 搜索内容块结果按匹配长度升序
* 加载笔记本性能优化
* 新建文档改进

### 开发重构

* 外观组件化重构

### 修复缺陷

* 解决偶发的”列出笔记本 xxx 文件列表失败“问题
* 修复导出换行丢失问题
* 新建文档时文档块 ID 错误的问题
* 网络拉取图片渲染问题
* 引入 Block IAL 编辑器开发者工具报错
* HTML 块 ID 暴露问题
* 编辑块引用退格问题
* 公式块、代码块退格 ID 暴露
* 内联公式渲染撤销问题

## v0.1.8 / 2020-09-16

### 引入特性

* 页签拖拽插入分屏
* 迁移到 .md 格式

### 改进功能

* 粘贴图片默认放到文档同级 assets 文件夹下
* 编辑器内容最大宽度优化
* iframe 点击打开时使用默认浏览器
* 拖拽后编辑器窗口无法重置
* 拖拽线条进行高亮
* 优化大纲上存在块链时的显示

### 修复缺陷

* B 站视频嵌入代码问题
* 表格增减列、对齐快捷键问题
* 粘贴 `![foo](bar.png)` 图片时渲染问题

## v0.1.7 / 2020-09-11

### 引入特性

* 导出内容块引用可配置是否使用 Blockquote

### 改进功能

* 优化设置界面样式
* 支持文档（根块）书签
* 撤销后光标位置改进
* 拖拽页签到上下左右的小面板中应展开该面板
* 打开笔记本功能移到顶级导航
* 优化 (( 搜索条件为空时的性能

### 修复缺陷

* 汉语拼音中文自动空格问题
* 书签分屏报错
* 任务列表编辑问题
* =标记=中文自动空格问题

## v0.1.6 / 2020-09-08

### 引入特性

* 内容块书签
* 外观图标切换

### 修复缺陷

* 全局搜索打开定位问题
* ==Mark==首次加载渲染问题
* ECharts 图表编辑撤销问题

## v0.1.5 / 2020-09-08

### 引入特性

* 当前文档和文件树选中联动
* 实时导出 Markdown 文件
* 导出可配置是否启用全文引用

### 改进功能

* 内容块图标悬浮选中视觉优化
* 转义符 \ 渲染
* 内容块嵌入渲染自动刷新
* 内容块引用锚文本转义

### 修复缺陷

* 内联公式光标位置错误
* 图片不渲染的问题

## v0.1.4 / 2020-09-07

### 引入特性

* 全局关系图按引用数过滤
* 增加预览和关闭页签的快捷键

### 修复缺陷

* 报错后窗口关不掉问题
* 页签关闭产出空白问题
* 数学公式中出现中文不能渲染问题
* 列表块编辑后引用问题
* 图片渲染以及粘贴时从网络拉取图片问题

## v0.1.3 / 2020-09-06

### 引入特性

* 支持通过配置单击打开文档

### 改进功能

* 优化 (( 块引使用体验
* 内容块悬浮预览稍微延时
* 块搜索不进行限制
* 复制块 ID，粘贴时应进行自动完成
* 优化关系图节点大小
* 中文【【（（ 触发块引
* 代码块闪烁问题
* 设置面板从搜索面板中独立
* 触发搜索由 Double Shift 换成导航图标 Ctrl+p

## v0.1.2 / 2020-09-04

### 引入特性

* 标签页面右键添加关闭全部和关闭其他
* 页签拖拽可以插进到两个页签之间
* 支持“标题块”引用

### 改进功能

* 通过 [[ 触发内容块引用
* 块标识菜单对齐，添加表格块标识
* 标题变大变小快捷键及光标位置
* 标签页大小稍微调大几个像素

### 修复缺陷

* 导出列表块引用时异常问题
* 块链搜索不到的问题
* 复制块 ID 失效问题

## v0.1.1 / 2020-09-03

### 引入特性

* 支持连接 WebDAV

### 改进功能

* 优化块嵌入
* 数学公式块、代码块细节处理

### 修复缺陷

* 删除文件后文件树依然显示问题
* 白屏或者保存失败等界面无响应问题
* 悬浮预览图片问题
* 文档中的图片首次加载渲染问题

## v0.1.0 / 2020-08-30

你好，思源。
