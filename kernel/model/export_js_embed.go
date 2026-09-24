package model

import (
	"html"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/parse"
)

// preserveExportJSEmbeds 将脚本作为属性文本保留，交由受信任的导出预览渲染。
func preserveExportJSEmbeds(tree *parse.Tree) {
	var originals, replacements []*ast.Node
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || node.Type != ast.NodeBlockQueryEmbed {
			return ast.WalkContinue
		}
		script := node.ChildByType(ast.NodeBlockQueryEmbedScript)
		if script == nil {
			return ast.WalkSkipChildren
		}
		content := strings.ReplaceAll(html.UnescapeString(script.TokensStr()), editor.IALValEscNewLine, "\n")
		if !strings.HasPrefix(content, "//!js") {
			return ast.WalkSkipChildren
		}
		queryNotebook := ""
		if IsEncryptedBox(tree.Box) {
			queryNotebook = tree.Box
		}
		placeholder := `<div data-type="NodeBlockQueryEmbed" data-node-id="` + html.EscapeString(node.ID) +
			`" data-content="` + html.EscapeString(html.EscapeString(content)) + `" data-notebook="` + html.EscapeString(tree.Box) +
			`" data-root-id="` + html.EscapeString(tree.ID) +
			`" data-query-notebook="` + html.EscapeString(queryNotebook) +
			`" custom-heading-mode="` + html.EscapeString(node.IALAttr("custom-heading-mode")) + `"></div>`
		replacement := &ast.Node{Type: ast.NodeHTMLBlock, ID: node.ID, Tokens: []byte(placeholder), KramdownIAL: node.KramdownIAL}
		replacement.SetIALAttr("data-export-js-embed", "true")
		originals = append(originals, node)
		replacements = append(replacements, replacement)
		return ast.WalkSkipChildren
	})
	for i, node := range originals {
		node.InsertBefore(replacements[i])
		node.Unlink()
	}
}
