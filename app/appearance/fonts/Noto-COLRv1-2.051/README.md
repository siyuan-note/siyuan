# Noto COLRv1 2.051

来源：[googlefonts/noto-emoji v2.051](https://github.com/googlefonts/noto-emoji/releases/tag/v2.051)，固定提交 `8998f5dd683424a73e2314a8c1f1e359c19e8742`。字体和许可证分别取自该提交的 `fonts/Noto-COLRv1.ttf` 和 `fonts/LICENSE`，许可证为 OFL-1.1。

原始 TTF 的 SHA-256：`0ae57fe58645638523ba35f388d93739d292539a9acb84df5700c81b1e1a28d2`。

使用 Python、fontTools 4.65.0 和 Brotli 1.2.0 压缩，保留完整字形、COLR/CPAL 彩色表及 GSUB 组合规则，不做字符子集化：

```sh
python -m pip install fonttools==4.65.0 brotli==1.2.0
python -m fontTools.ttLib.woff2 compress Noto-COLRv1.ttf -o Noto-COLRv1.woff2
```

生成的 WOFF2 的 SHA-256：`eea43aa18f7ae8ac50828d3b0907d2a881d0896a8ca4f5f6da471beecc7c13a2`，大小为 1,972,940 字节。

同次更新的八个表情条目使用 [CLDR 48](https://github.com/unicode-org/cldr/tree/acd6d88ae493633240e19a87a721076a8a75c310/common/annotations) 的英文、简体中文及日文名称和关键词。沿用面板不枚举肤色组合的规则，已有表情标识保持不变。

回归数据 `app/tests/fixtures/unicode17-emoji.json` 来自 [Unicode 17.0 emoji-test.txt](https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt) 中全部 163 条 `fully-qualified`、`E17.0` 序列，按原顺序保留。源文件 SHA-256 为 `1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda`，适用仓库第三方声明中的 Unicode-3.0 许可证。

在 `app/` 目录运行 `node --import tsx --test src/util/emojiFont.test.ts tests/emojiFont.test.js`，检查新增列表、补充范围、实际字形组合和离线字体加载。浏览器测试使用 Electron，分别检查三种平台样式分支；这不替代实际 Apple WebKit 和移动端的兼容性验证。

当前前端和离线 HTML 导出使用本目录。内核仅清理内容与原版一致的 `Noto-COLRv1-2.047` 历史副本；旧字体 URL 在文件缺失时映射到本目录，用户修改过的旧文件优先保留和使用。
