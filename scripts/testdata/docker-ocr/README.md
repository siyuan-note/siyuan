测试图片由仓库内置霞鹜文楷 GB Lite 和 Liberation Sans 字体生成，只用于 Docker 镜像的真实 OCR 验收。字体许可证分别位于 `app/appearance/fonts/LxgwWenKaiGB-Lite-1.521/LICENSE` 和 PDF 标准字体的上游许可证中。

`chinese.png` 应识别出「思源笔记」，`latin.png` 应识别出「SiYuan OCR 123」，`blank.png` 应返回空结果。验收忽略空白和拉丁字母大小写，不忽略汉字差异。
