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
