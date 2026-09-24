package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestExportPreviewJSEmbed(t *testing.T) {
	const boxID = "20260924010000-box0001"
	const docID = "20260924010001-doc0001"
	setupExportRelatedTest(t, boxID)
	Conf.Editor = conf.NewEditor()
	Conf.Search = conf.NewSearch()
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Export", "Export")
	script := "//!js\nitem.innerHTML = '<b>&amp; content</b>';"
	for range 2 {
		embed := &ast.Node{Type: ast.NodeBlockQueryEmbed, ID: ast.NewNodeID()}
		embed.SetIALAttr("custom-heading-mode", "1")
		embed.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript, Tokens: []byte(script)})
		tree.Root.AppendChild(embed)
	}
	writeExportRelatedTestTree(t, tree)
	_, content, _ := ExportPreviewHTMLWithTitle(docID, false, false, false, "", true)
	if strings.Count(content, `data-type="NodeBlockQueryEmbed"`) != 2 ||
		strings.Contains(content, "<b>") || !strings.Contains(content, `data-notebook="`+boxID+`"`) ||
		!strings.Contains(content, `custom-heading-mode="1"`) || strings.Contains(content, "<protyle-html") {
		t.Fatalf("invalid export placeholders: %s", content)
	}
	loaded, err := LoadTreeByBlockID(docID)
	if err != nil || loaded.Root.LastChild.Type != ast.NodeBlockQueryEmbed ||
		loaded.Root.LastChild.FirstChild.TokensStr() != script {
		t.Fatalf("export modified source: %v", err)
	}
}
