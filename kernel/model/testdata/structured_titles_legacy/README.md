# 结构化标题升级样本

本目录由已发布的 `v3.8.9-alpha.4` 源码（提交 `335d16ddc182606864d1b5b89c07f411c8a78636`）实际写入生成，包含普通及加密笔记本各两篇父子文档、旧版笔记本配置、密钥包络及恢复材料。文档采用 Spec 2，配置尚无结构化寻址标记。全部内容和密码均为专门生成的公开测试数据。

`manifest.json` 记录原身份、层级、标题、生成版本和文件 SHA-256；`notebook-crypto.json` 保留旧版本生成的主密码配置。测试必须先校验样本哈希，再复制到临时目录，不能直接修改样本或用当前写入器重新生成旧格式密文。

重新生成时，将 `generate_test.go.txt` 复制到该历史提交的独立源码副本 `kernel/model/structured_titles_legacy_generate_test.go`，设置 `SIYUAN_LEGACY_FIXTURE_DESTINATION` 为新建空目录、`SIYUAN_LEGACY_FIXTURE_COMMIT` 为上述完整提交号，从该副本的 `kernel/` 执行 `go test -tags=fts5,sqlcipher ./model -run=^TestGenerateStructuredTitlesLegacyFixture$ -count=1`。将输出文件复制至样本目录，并在清单的 `sha256` 对象中登记除清单自身外所有生成数据文件的摘要。生成过程使用 Go 1.26.10，随机 ID、盐和密文随机数每次会不同。

这些样本证明旧版本写出的数据能够认证读取和升级；它们不代表旧客户端已经具备对新模式的保护能力，也不替代真实客户端混用验收。
