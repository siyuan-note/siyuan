package sql

import (
	"strings"

	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/siyuan-note/logging"
)

// CalculateEmbedBlockContent 计算只读 SQL 嵌入的搜索内容；空脚本和 JavaScript 嵌入由前端更新。
func CalculateEmbedBlockContent(block *Block) (content string, supported bool) {
	stmt := strings.TrimSpace(block.Markdown)
	stmt = strings.TrimPrefix(stmt, "{{")
	stmt = strings.TrimSuffix(stmt, "}}")
	stmt = html.UnescapeString(stmt)
	stmt = strings.ReplaceAll(stmt, editor.IALValEscNewLine, "\n")
	stmt = strings.TrimSpace(stmt)
	if stmt == "" || strings.HasPrefix(stmt, "//!js") {
		return "", false
	}
	if err := CheckReadonlyBlockQueryStatement(stmt, block.Box); err != nil {
		logging.LogWarnf("skip non-readonly embed block [%s] script: %s", block.ID, err)
		return "", false
	}
	var blocks []*Block
	if IsEncryptedBoxFn != nil && IsEncryptedBoxFn(block.Box) {
		blocks = SelectBlocksRawStmtNoParseInBox(stmt, 102400, block.Box)
	} else {
		blocks = SelectBlocksRawStmtNoParse(stmt, 102400)
	}
	for _, result := range blocks {
		content += result.Content
	}
	if content == "" {
		content = "no query result"
	}
	return content, true
}
