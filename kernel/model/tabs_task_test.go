package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTabTaskPersistsInDocumentNode(t *testing.T) {
	l := util.NewLute()
	dom := l.Md2BlockDOM("::: tabs\n@tab Task\n{: tabs-task=\"/\"}\n\nBody\n:::\n", false)
	tree := l.BlockDOM2Tree(dom)
	encoded := render.NewJSONRenderer(tree, l.RenderOptions, l.ParseOptions).Render()
	if !strings.Contains(string(encoded), `"tabs-task": "/"`) && !strings.Contains(string(encoded), `"tabs-task":"/"`) {
		t.Fatalf("task marker missing from document: %s", encoded)
	}
	restored, _, err := dataparser.ParseJSON(encoded, l.ParseOptions)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	ast.Walk(restored.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeTabItem && node.IALAttr("tabs-task") == "/" {
			found = true
		}
		return ast.WalkContinue
	})
	if !found {
		t.Fatal("task marker missing after document reload")
	}
	if !strings.Contains(l.BlockDOM2StdMd(dom), `tabs-task="/"`) {
		t.Fatal("task marker missing from Markdown export")
	}
}
