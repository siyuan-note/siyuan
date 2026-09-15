package model

import (
	"bytes"
	"testing"
	"text/template"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestRenderTemplateTabsSelection(t *testing.T) {
	fixture := setupFileOperationTest(t)
	cases := []struct {
		name     string
		markdown string
		selected []int
	}{
		{"loop defaults to first", `::: tabs
.action{range $d := list 1 2 3 4 5 6 7}
@tab Day .action{$d}
{: id="20260508163109-j8gbxj3"}

Body
{: id="20260914104947-8ob57sy"}

.action{end}
:::
{: tabs-position="left" tabs-task="true"}
`, []int{0}},
		{"explicit active marker", `::: tabs
@tab First
{: id="20260915120000-item001"}

First body
@tab:active Second
{: id="20260915120000-item002"}

Second body
:::
`, []int{1}},
		{"explicit active ID", `::: tabs
@tab First
{: id="20260915120000-item001"}

First body
@tab Second
{: id="20260915120000-item002"}

Second body
:::
{: tabs-active-id="20260915120000-item002"}
`, []int{1}},
		{"invalid active ID", `::: tabs
@tab First

First body
@tab Second

Second body
:::
{: tabs-active-id="20260915120000-missing"}
`, []int{0}},
		{"nested repeated groups", `:::: tabs
.action{range $d := list 1 2}
@tab Outer .action{$d}
{: id="20260915120000-outer01"}

::: tabs
@tab Inner first
{: id="20260915120000-inner01"}

First body
@tab Inner second
{: id="20260915120000-inner02"}

Second body
:::
{: tabs-active-id="20260915120000-inner02"}

.action{end}
::::
`, []int{0, 1, 1}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assertSelection := func(root *ast.Node) {
				t.Helper()
				groupIndex := 0
				ids := map[string]bool{}
				ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
					if !entering || ast.NodeTabs != node.Type {
						return ast.WalkContinue
					}
					if groupIndex >= len(tc.selected) {
						t.Fatal("unexpected tab group")
					}
					index := 0
					for item := node.FirstChild; nil != item; item = item.Next {
						if ast.NodeTabItem != item.Type {
							continue
						}
						if "" == item.ID || ids[item.ID] {
							t.Fatalf("tab ID was not regenerated uniquely: %q", item.ID)
						}
						ids[item.ID] = true
						if index == tc.selected[groupIndex] && node.IALAttr(treenode.TabsActiveIDAttr) != item.ID {
							t.Fatalf("group %d selected %q, expected item %d (%q)", groupIndex,
								node.IALAttr(treenode.TabsActiveIDAttr), index, item.ID)
						}
						index++
					}
					groupIndex++
					return ast.WalkContinue
				})
				if groupIndex != len(tc.selected) {
					t.Fatalf("got %d groups, expected %d", groupIndex, len(tc.selected))
				}
			}
			p := writeTemplateDocTreeTestFile(t, tc.markdown)
			for _, mode := range []TemplateRenderMode{TemplateRenderModePreview, TemplateRenderModeEditorInsert} {
				tree, dom, _, err := RenderTemplateWithMode(p, fixture.childID, mode)
				if nil != err {
					t.Fatal(err)
				}
				assertSelection(tree.Root)
				assertSelection(NewLute().BlockDOM2Tree(dom).Root)
			}

			tpl, err := template.New("tabs").Delims(".action{", "}").Funcs(template.FuncMap{
				"list": func(values ...int) []int { return values },
			}).Parse(tc.markdown)
			if nil != err {
				t.Fatal(err)
			}
			var expanded bytes.Buffer
			if err = tpl.Execute(&expanded, nil); nil != err {
				t.Fatal(err)
			}
			childTree, err := renderTemplateDocTreeMarkdown(expanded.Bytes(), fixture.box.ID)
			if nil != err {
				t.Fatal(err)
			}
			assertSelection(childTree.Root)
		})
	}
}
