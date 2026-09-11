package model

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTableCellRichDocumentReaders(t *testing.T) {
	originalConf := Conf
	Conf = NewAppConf()
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	t.Cleanup(func() { Conf = originalConf })
	legacy, err := os.ReadFile("../treenode/testdata/table-cell-legacy.sy")
	if nil != err {
		t.Fatal(err)
	}
	readers := map[string]func([]byte) (*parse.Tree, error){
		"document": func(data []byte) (*parse.Tree, error) {
			return filesys.LoadTreeByData(data, "20260908000000-box0001", "/20260908000000-root001.sy", util.NewLute())
		},
		"history and recovery": loadTreeByData0,
		"history diff":         func(data []byte) (*parse.Tree, error) { return parseDocVersionTree(data, "20260908000000-root001") },
		"backup and snapshot": func(data []byte) (*parse.Tree, error) {
			_, tree, err := parseTreeInSnapshot(data, util.NewLute())
			return tree, err
		},
	}
	source := "- **first**\n- second\n\n```go\na | b\nc\n```"
	for name, read := range readers {
		t.Run(name, func(t *testing.T) {
			tree, err := read(legacy)
			if nil != err {
				t.Fatal(err)
			}
			cell := tree.Root.FirstChild.LastChild.FirstChild
			if tree.Root.Spec != "2" || cell.TableCellRich != nil || cell.FirstChild.TokensStr() != "**literal** - list" || cell.IALAttr("colspan") != "2" {
				t.Fatal("legacy cell must retain its content, format, and document version")
			}
			cell.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: source}
			treenode.UpgradeSpec(tree)
			luteEngine := util.NewLute()
			data := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
			restored, err := read(data)
			if nil != err {
				t.Fatal(err)
			}
			restoredCell := restored.Root.FirstChild.LastChild.FirstChild
			if restoredCell.TableCellRich.Content != source || !strings.Contains(restoredCell.Text(), "first") || strings.Contains(restoredCell.Text(), "literal") {
				t.Fatal("reader must preserve rich source and rebuild its inline projection")
			}
			unknown := bytes.Replace(data, []byte(`"spec": 1`), []byte(`"spec": 99`), 1)
			if bytes.Equal(unknown, data) {
				unknown = bytes.Replace(data, []byte(`"spec":1`), []byte(`"spec":99`), 1)
			}
			original := bytes.Clone(unknown)
			if _, err = read(unknown); nil == err {
				t.Fatal("unsupported rich format must fail before normalization")
			}
			if !bytes.Equal(original, unknown) {
				t.Fatal("reader changed unsupported input")
			}
		})
	}
}

func TestTableCellRichHTMLAndMarkdownExports(t *testing.T) {
	luteEngine := util.NewLute()
	source := "- **first**\n- second\n\n```go\na | b\nc\n```\n\n![image](assets/original.png)"
	tree := parse.Parse("", []byte("| Header |\n| --- |\n| value |"), luteEngine.ParseOptions)
	cell := tree.Root.FirstChild.LastChild.FirstChild
	cell.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: source}
	if err := treenode.RefreshTableCellRichProjection(tree.Root); nil != err {
		t.Fatal(err)
	}
	markdown := string(render.NewProtyleExportMdRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render())
	for _, unexpected := range []string{"table-cell-rich", "data-sy-table", "```go"} {
		if strings.Contains(markdown, unexpected) {
			t.Fatalf("standard Markdown contains internal rich source: %s", markdown)
		}
	}
	if !strings.Contains(markdown, "first") || !strings.Contains(markdown, "original.png") {
		t.Fatal("Markdown projection lost content")
	}
	if err := treenode.MaterializeTableCellRichExport(tree.Root); nil != err {
		t.Fatal(err)
	}
	ast.Walk(cell, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeLinkDest {
			node.Tokens = []byte("assets/exported.png")
		}
		return ast.WalkContinue
	})
	for name, html := range map[string]string{
		"html and pdf": string(render.NewProtyleExportRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()),
		"word":         string(render.NewProtyleExportDocxRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()),
	} {
		t.Run(name, func(t *testing.T) {
			expectedHTML := []string{"<ul", "<li", "<strong", "<code", "assets/exported.png"}
			if name == "html and pdf" {
				expectedHTML = []string{`data-type="NodeList"`, `data-type="NodeListItem"`, `data-type="strong"`, `data-type="NodeCodeBlock"`, "assets/exported.png"}
			}
			for _, expected := range expectedHTML {
				if !strings.Contains(html, expected) {
					t.Fatalf("export missing %q: %s", expected, html)
				}
			}
			if strings.Contains(html, "original.png") || strings.Contains(html, "table-cell-rich") {
				t.Fatal("export used stale source")
			}
		})
	}
}

func TestTableCellRichPreviewNormalization(t *testing.T) {
	luteEngine := util.NewLute()
	tree := parse.Parse("", []byte("| 1 | 2 | 3 |\n| --- | --- | --- |\n| 123 | text | next |\n\n| Key | Text |\n| --- | --- |\n| 111 | value |"), luteEngine.ParseOptions)
	table := tree.Root.FirstChild
	var cell *ast.Node
	index := 0
	ast.Walk(table, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeTableCell {
			if index == 2 {
				cell = node
			}
			index++
		}
		return ast.WalkContinue
	})
	cell.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: "3\n\n## 4\n\n5"}
	var lastTable *ast.Node
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeTable {
			lastTable = node
		}
		return ast.WalkContinue
	})
	second := lastTable.LastChild.LastChild
	second.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: "- first\n- second"}
	if err := treenode.MaterializeTableCellRichExport(tree.Root); err != nil {
		t.Fatal(err)
	}
	previewTree := normalizeExportPreviewTree(tree, luteEngine)
	tableCount := 0
	ast.Walk(previewTree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeTable {
			tableCount++
		}
		if entering && node.Type == ast.NodeHeading && node.Parent.Type != ast.NodeTableCell {
			t.Fatal("cell heading escaped the table")
		}
		return ast.WalkContinue
	})
	if tableCount != 2 || table.Parent != previewTree.Root || cell.ChildByType(ast.NodeHeading) == nil ||
		second.ChildByType(ast.NodeList) == nil {
		t.Fatalf("preview normalization changed rich table structure: tables=%d parent=%v heading=%v list=%v html=%s", tableCount, table.Parent == previewTree.Root, cell.ChildByType(ast.NodeHeading) != nil, second.ChildByType(ast.NodeList) != nil, luteEngine.ProtylePreview(previewTree, luteEngine.RenderOptions, luteEngine.ParseOptions))
	}
	html := luteEngine.ProtylePreview(previewTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	for _, expected := range []string{"<table", "<h2", "<ul", "first", "second", "123"} {
		if !strings.Contains(html, expected) {
			t.Fatalf("preview missing %q: %s", expected, html)
		}
	}
	if strings.Contains(html, "table-cell-preview-") || strings.Contains(html, "## 4") {
		t.Fatalf("preview leaked normalization markers: %s", html)
	}
}

func TestAttributeViewRichTextExport(t *testing.T) {
	luteEngine := util.NewLute()
	tree := parse.Parse("", []byte("| Key | Text |\n| --- | --- |\n| 111 | |"), luteEngine.ParseOptions)
	cell := tree.Root.FirstChild.LastChild.LastChild
	value := &av.ValueText{Content: "foo\n123\n123", Rich: &av.ValueTextRich{
		Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown,
		Content: "**foo**\n\n- 123\n  - 123",
	}}
	if err := appendAttributeViewRichTextExport(cell, value); err != nil {
		t.Fatal(err)
	}
	preview := normalizeExportPreviewTree(tree, luteEngine)
	for name, output := range map[string]string{
		"preview": luteEngine.ProtylePreview(preview, luteEngine.RenderOptions, luteEngine.ParseOptions),
		"html":    string(render.NewProtyleExportRenderer(preview, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()),
		"word":    string(render.NewProtyleExportDocxRenderer(preview, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()),
	} {
		t.Run(name, func(t *testing.T) {
			// 各输出对嵌套列表与加粗使用的标记不同：预览为原生 ul/span，HTML 导出为带 data-type 的块级结构，Word 导出沿用 ul/strong
			listMarker, boldMarker := "<ul", "<strong"
			if name == "preview" {
				boldMarker = `data-type="strong"`
			}
			if name == "html" {
				listMarker, boldMarker = `data-type="NodeList"`, `data-type="strong"`
			}
			if strings.Count(output, listMarker) != 2 || !strings.Contains(output, boldMarker) ||
				!strings.Contains(output, "foo") || strings.Count(output, "123") != 2 {
				t.Fatalf("database rich text lost nested lists or formatting (markers %q/%q): %s", listMarker, boldMarker, output)
			}
		})
	}
	invalid := &av.ValueText{Rich: &av.ValueTextRich{Spec: 99, Format: av.ValueTextRichFormatKramdown}}
	empty := &ast.Node{Type: ast.NodeTableCell}
	if err := appendAttributeViewRichTextExport(empty, invalid); err == nil || empty.FirstChild != nil {
		t.Fatal("invalid rich text must return an error without populating the cell")
	}
}

func TestTableCellRichFootnoteExport(t *testing.T) {
	fixture, _, _, _ := prepareAssetDownloadDocumentTest(t)
	luteEngine := util.NewLute()
	target := treenode.NewTree(fixture.box.ID, "/20260908000001-target1.sy", "/Rich target", "Rich target")
	parsed := parse.Parse("", []byte("| Header |\n| --- |\n| value |"), luteEngine.ParseOptions)
	table := parsed.Root.FirstChild
	cell := table.LastChild.FirstChild
	source := "- first\n- second\n\n```go\na < b && c\n```\n\n![image](assets/file.bin)"
	cell.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: source}
	if err := treenode.RefreshTableCellRichProjection(parsed.Root); err != nil {
		t.Fatal(err)
	}
	target.Root.AppendChild(table)
	writeAssetDownloadDocumentTest(t, target)
	referring := treenode.NewTree(fixture.box.ID, "/20260908000002-source1.sy", "/Referring", "Referring")
	referring.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
		TextMarkBlockRefID: table.ID, TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Rich target"})
	writeAssetDownloadDocumentTest(t, referring)
	exported, err := exportTree(prepareExportTree(getExportBlockTree(referring.ID)), true, true, false, true,
		4, 0, 0, "#", "#", "", "", false, "", false, true, true)
	if err != nil {
		t.Fatal(err)
	}
	if treenode.HasTableCellRich(exported.Root) || len(exported.Root.ChildrenByType(ast.NodeFootnotesDef)) != 1 ||
		len(exported.Root.ChildrenByType(ast.NodeCodeBlock)) != 1 {
		t.Fatal("footnote tables must be materialized before rich HTML export")
	}
	html := string(render.NewProtyleExportRenderer(exported, luteEngine.RenderOptions, luteEngine.ParseOptions).Render())
	if !strings.Contains(html, `data-type="NodeList"`) || !strings.Contains(html, "assets/file.bin") {
		t.Fatal("rich footnote export lost fragment content or its resource")
	}
	restored, err := filesys.LoadTree(fixture.box.ID, target.Path, luteEngine)
	if err != nil {
		t.Fatal(err)
	}
	if treenode.GetNodeInTree(restored, table.ID).LastChild.FirstChild.TableCellRich.Content != source {
		t.Fatal("export must not write the materialized tree back to the source document")
	}
}
