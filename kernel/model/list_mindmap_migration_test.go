package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLegacyMindmapList(t *testing.T) {
	engine := util.NewLute()
	for _, source := range []string{
		"- Root\n  - Child\n    - Grandchild\n",
		"- First\n- Second\n",
		"3. First\n4. Second\n",
		"- [ ] Todo\n- [X] Done\n- [/] Progress\n",
		"- **Bold** ~~deleted~~ [link](https://example.com) `code`\n\n  Another paragraph\n\n  ![image](assets/image.png)\n\n  - Child\n",
		"- Text\n  {: id=\"20260920000000-content\" custom-test=\"keep\"}\n",
	} {
		t.Run(source, func(t *testing.T) {
			_, parsed := engine.Md2BlockDOMTree("```mindmap\n"+source+"```", false)
			code := firstContentBlock(parsed.Root)
			code.ID = "20260920000000-oldcode"
			code.SetIALAttr("id", "20260920000000-oldcode")
			code.SetIALAttr("name", "Name")
			code.SetIALAttr("alias", "Alias")
			code.SetIALAttr("custom-test", "preserved")
			before := engine.RenderNodeBlockDOM(code)
			list := legacyMindmapList(code, engine)
			if list == nil || list.ID != code.ID || list.Type != ast.NodeList || list.IALAttr(listMindmapViewAttr) != "1" {
				t.Fatalf("conversion failed: %+v", list)
			}
			if list.IALAttr("name") != "Name" || list.IALAttr("alias") != "Alias" || list.IALAttr("custom-test") != "preserved" {
				t.Fatal("block attributes were lost")
			}
			if engine.RenderNodeBlockDOM(code) != before {
				t.Fatal("source was mutated while preparing conversion")
			}
			ids := map[string]bool{code.ID: true}
			ast.Walk(list, func(node *ast.Node, entering bool) ast.WalkStatus {
				if entering && node.IsBlock() && node != list && node.Type != ast.NodeKramdownBlockIAL {
					if !ast.IsNodeIDPattern(node.ID) || ids[node.ID] || node.ID == "20260920000000-content" {
						t.Fatalf("descendant did not receive a fresh ID: %s", node.ID)
					}
					ids[node.ID] = true
				}
				return ast.WalkContinue
			})
			dom := engine.RenderNodeBlockDOM(list)
			for _, expected := range []string{"assets/image.png", "https://example.com", "Another paragraph", "Grandchild"} {
				if strings.Contains(source, expected) && !strings.Contains(dom, expected) {
					t.Fatalf("content disappeared: %s", expected)
				}
			}
			if strings.Contains(source, "[X]") && !strings.Contains(dom, `data-task="X"`) {
				t.Fatalf("task state changed: %s", dom)
			}
		})
	}
}

func TestLegacyMindmapListRejectsPartialConversion(t *testing.T) {
	engine := util.NewLute()
	for _, source := range []string{"", "Plain text\n", "- List\n\nOutside text\n", "- First\n\n1. Second\n"} {
		_, parsed := engine.Md2BlockDOMTree("```mindmap\n"+source+"```", false)
		node := firstContentBlock(parsed.Root)
		before := engine.RenderNodeBlockDOM(node)
		if legacyMindmapList(node, engine) != nil || before != engine.RenderNodeBlockDOM(node) {
			t.Fatalf("unsupported source was partially converted: %q", source)
		}
		node.SetIALAttr("custom-test", "preserved")
		before = engine.RenderNodeBlockDOM(node)
		dom := legacyMindmapCodeDOM(node, engine)
		if before != engine.RenderNodeBlockDOM(node) || !isLegacyMindmap(node) {
			t.Fatal("fallback mutated the source needed for undo")
		}
		if !strings.Contains(dom, `class="code-block"`) || !strings.Contains(dom, `custom-test="preserved"`) ||
			!strings.Contains(dom, `data-node-id="`+node.ID+`"`) {
			t.Fatalf("fallback lost code block identity or attributes: %s", dom)
		}
		restored := engine.BlockDOM2Tree(dom)
		code := firstContentBlock(restored.Root)
		if code.Type != ast.NodeCodeBlock || !isLegacyMindmap(code) || code.IALAttr(legacyMindmapCodeAttr) != "1" ||
			string(code.ChildByType(ast.NodeCodeBlockFenceInfoMarker).CodeBlockInfo) != "mindmap" ||
			string(code.ChildByType(ast.NodeCodeBlockCode).Tokens) != string(node.ChildByType(ast.NodeCodeBlockCode).Tokens) {
			t.Fatalf("fallback changed source text: %q", source)
		}
		code.ChildByType(ast.NodeCodeBlockCode).Tokens = []byte("- Now a valid list\n")
		if legacyMindmapList(code, engine) != nil {
			t.Fatal("a converted code block must remain code after editing")
		}
	}
}
