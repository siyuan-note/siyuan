package treenode

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func richTableTree(t *testing.T, source string) (*parse.Tree, *ast.Node) {
	t.Helper()
	luteEngine := util.NewLute()
	tree := parse.Parse("", []byte("| Header |\n| --- |\n| Existing |\n"), luteEngine.ParseOptions)
	tree.Root.Spec = "2"
	cell := tree.Root.FirstChild.LastChild.FirstChild
	cell.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: source}
	if err := RefreshTableCellRichProjection(tree.Root); nil != err {
		t.Fatal(err)
	}
	return tree, cell
}

func TestTableCellRichSourceProjectionAndSpec(t *testing.T) {
	sources := []string{
		"- **first**\n- second\n\n> quotation\n\n```go\na | b\nc\n```\n\n$$\nx^2\n$$",
		"- [ ] open\n- [x] done\n\n![image](assets/image.png) ((20240101000000-abcdefg 'reference'))",
		"<span data-type=\"text\" style=\"color: var(--b3-font-color1);\">styled</span>",
		"",
	}
	for _, source := range sources {
		t.Run(source, func(t *testing.T) {
			tree, cell := richTableTree(t, source)
			if !UpgradeSpec(tree) || tree.Root.Spec != "4" {
				t.Fatal("rich cells must raise the document spec")
			}
			ast.Walk(cell, func(node *ast.Node, entering bool) ast.WalkStatus {
				if entering && node != cell && (node.IsBlock() || node.ID != "") {
					t.Fatalf("projection contains document block identity: %s", node.Type)
				}
				return ast.WalkContinue
			})
			if err := SyncTableCellRichInlineChanges(tree.Root); nil != err {
				t.Fatal(err)
			}
			if source != cell.TableCellRich.Content {
				t.Fatal("unchanged source must not be rewritten")
			}
			luteEngine := util.NewLute()
			data := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
			if err := CheckSpecJSON(data); nil != err {
				t.Fatal(err)
			}
			cell.TableCellRich = nil
			if UpgradeSpec(tree) || tree.Root.Spec != "4" {
				t.Fatal("document spec must not be downgraded")
			}
		})
	}
}

func TestTableCellRichSynchronizesAssetReferenceAndText(t *testing.T) {
	tree, cell := richTableTree(t, "![image](assets/old.png) ((20240101000000-abcdefg 'reference')) text\n\n```go\nold\n```")
	ast.Walk(cell, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if node.Type == ast.NodeLinkDest {
			node.Tokens = []byte("assets/new.png")
		}
		if node.IsTextMarkType("block-ref") {
			node.TextMarkBlockRefID = "20240102000000-abcdefg"
		}
		if node.IsTextMarkType("code") {
			node.TextMarkTextContent = "&lt;new&gt; &amp; value"
		}
		return ast.WalkContinue
	})
	if err := SyncTableCellRichInlineChanges(tree.Root); nil != err {
		t.Fatal(err)
	}
	for _, expected := range []string{"assets/new.png", "20240102000000-abcdefg", "<new> & value"} {
		if !strings.Contains(cell.TableCellRich.Content, expected) {
			t.Fatalf("source does not contain %q: %s", expected, cell.TableCellRich.Content)
		}
	}
	if _, err := av.ParseTableCellRich(cell.TableCellRich); nil != err {
		t.Fatal(err)
	}
}

func TestTableCellRichRejectsProjectionReplacement(t *testing.T) {
	tree, cell := richTableTree(t, "- first\n- second")
	source := cell.TableCellRich.Content
	cell.FirstChild.Unlink()
	if err := SyncTableCellRichInlineChanges(tree.Root); nil == err {
		t.Fatal("a projection-only structural edit must fail")
	}
	if source != cell.TableCellRich.Content {
		t.Fatal("rejected edits must preserve source")
	}
}

func TestTableCellRichFrontendProjectionParity(t *testing.T) {
	styled := `<span data-type="text">styled</span>{: style="font-family: ` +
		`var(--b3-font-family-emoji-reset), 'A&#92;&#92;B &gt; C', ` +
		`var(--b3-font-family-editor), var(--b3-font-family);"}`
	for _, source := range []string{
		"- **first**\n- second\n\n```go\na < b && c\nd\n```\n\n$$\nx < y\n$$",
		"![image](assets/image.png) ((20240101000000-abcdefg 'reference')) `a & b`",
		styled,
		`<span data-type="text">styled</span>{: style='font-family: ` +
			`var(--b3-font-family-emoji-reset), &quot;A&#92;&#92;B&quot;, ` +
			`var(--b3-font-family-editor), var(--b3-font-family);'}`,
		"```text\n" + styled + "\n```\n\n" + styled,
		"`" + styled + "`\n\n" + styled,
	} {
		t.Run(source, func(t *testing.T) {
			tree, _ := richTableTree(t, source)
			luteEngine := util.NewLute()
			dom := luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
			restored := luteEngine.BlockDOM2Tree(luteEngine.SpinBlockDOM(dom))
			before := string(render.NewJSONRenderer(restored, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()) + "\nexpected:\n" +
				string(render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render())
			if err := SyncTableCellRichInlineChanges(restored.Root); nil != err {
				t.Fatalf("%s\n%s", err, before)
			}
			cell := restored.Root.FirstChild.LastChild.FirstChild
			if cell.TableCellRich == nil || cell.TableCellRich.Content != source {
				t.Fatalf("an unchanged frontend transaction rewrote its rich source: %#v\n%s", cell.TableCellRich, before)
			}
		})
	}
}

func TestTableCellRichRejectsInvalidPayloadBeforeJSONParsing(t *testing.T) {
	for _, payload := range []string{
		`null`, `{}`, `{"spec":2,"format":"kramdown","content":"source"}`,
		`{"spec":1,"format":"html","content":"source"}`, `{"spec":1,"format":"kramdown","content":null}`,
		`{"spec":1,"format":"kramdown","content":"source","unknown":true}`,
		`{"spec":1,"format":"kramdown","content":"before\u0000after"}`,
		`{"spec":1,"format":"kramdown","content":"| h |\n|---|\n| nested |"}`,
	} {
		data := []byte(`{"Type":"NodeDocument","Spec":"4","Children":[{"Type":"NodeTable","Children":[{"Type":"NodeTableRow","Children":[{"Type":"NodeTableCell","TableCellRich":` + payload + `}]}]}]}`)
		if err := CheckSpecJSON(data); nil == err {
			t.Fatalf("accepted invalid payload: %s", payload)
		}
	}
	misplaced := []byte(`{"Type":"NodeDocument","Spec":"4","Children":[{"Type":"NodeTableCell","TableCellRich":{"spec":1,"format":"kramdown","content":"source"}}]}`)
	if err := CheckSpecJSON(misplaced); nil == err {
		t.Fatal("rich cells outside a table must fail before repair")
	}
}
