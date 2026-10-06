// 本文件移植自 https://github.com/grafana/sobek-webapi-encoding 的 encoding/types.go（提交 5785852a34），
// 按 Apache License 2.0 使用，许可证全文见同目录 LICENSE。
// 修改：以 github.com/dop251/goja 替换 github.com/grafana/sobek。

package encoding

// Name is the identifier of an encoding format as defined by the WHATWG Encoding spec.
// See https://encoding.spec.whatwg.org/#names-and-labels
type Name string

const (
	// UTF8EncodingFormat is the encoding format for UTF-8.
	UTF8EncodingFormat Name = "utf-8"

	// UTF16LEEncodingFormat is the encoding format for UTF-16LE (little-endian).
	UTF16LEEncodingFormat Name = "utf-16le"

	// UTF16BEEncodingFormat is the encoding format for UTF-16BE (big-endian).
	UTF16BEEncodingFormat Name = "utf-16be"
)
