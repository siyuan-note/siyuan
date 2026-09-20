package sql

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// IAL 属性值在 .sy 中以转义形态存储，IALAttr 读取时已解码一次，
// 索引构建不得再解码，否则用户输入的字面量实体文本会在索引中变成原始 HTML
func TestBuildBlockFromNodeDecodesIALAttrOnce(t *testing.T) {
	engine := util.NewLute()
	for _, tc := range []struct{ name, typed, want string }{
		{"raw html typed by user", "<b>", "<b>"},
		{"literal entity typed by user", "&lt;b&gt;", "&lt;b&gt;"},
		{"plain text", "R&D", "R&D"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tree := parse.Parse("", []byte("hello"), engine.ParseOptions)
			tree.Box = "20260919000000-box0000"
			tree.Path = "/20260919000000-root000.sy"
			tree.HPath = "/doc"
			tree.Root.ID = "20260919000000-root000"

			node := tree.Root.FirstChild
			if nil == node || ast.NodeParagraph != node.Type {
				t.Fatalf("unexpected first child: %v", node)
			}
			node.ID = "20260919000000-para000"
			node.SetIALAttr("name", tc.typed)
			node.SetIALAttr("alias", tc.typed)
			node.SetIALAttr("memo", tc.typed)

			block, _ := buildBlockFromNode(node, tree)
			for field, got := range map[string]string{"name": block.Name, "alias": block.Alias, "memo": block.Memo} {
				if got != tc.want {
					t.Errorf("%s: want %q, got %q", field, tc.want, got)
				}
			}
		})
	}
}

// 文档级 tags 属性同样只能解码一次，标签索引不得出现原始 HTML
func TestTagFromNodeDecodesTagsOnce(t *testing.T) {
	node := &ast.Node{Type: ast.NodeDocument}
	node.SetIALAttr("tags", "&lt;b&gt;,plain")

	got := tagFromNode(node)
	want := "#&lt;b&gt;# #plain#"
	if got != want {
		t.Fatalf("want %q, got %q", want, got)
	}
	if strings.ContainsAny(got, "<>") {
		t.Fatalf("tag index contains raw HTML: %q", got)
	}
}
