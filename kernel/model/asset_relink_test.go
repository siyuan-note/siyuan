package model

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAssetRelinkExactReferences(t *testing.T) {
	for _, test := range []struct{ old, next, raw, kind, want string }{
		{"assets/a.png", "assets/a.webp", "assets/a.png?page=2#preview", "link", "assets/a.webp?page=2#preview"},
		{"assets/a.png", "assets/a.webp", "assets/a.png.bak", "link", "assets/a.png.bak"},
		{"assets/a.png", "assets/a.webp", "assets/a.png/child", "link", "assets/a.png/child"},
		{"assets/a%23b.png", "assets/c%23d.webp", "assets/a%23b.png#anchor", "link", "assets/c%23d.webp#anchor"},
		{"assets/a.png", "assets/a.webp", "/assets/a.png?x=%23&y=2", "link", "/assets/a.webp?x=%23&y=2"},
		{"assets/a.pdf", "assets/b.pdf", "assets/a.pdf/20260914000001-abcdefg?page=2#x", "annotation", "assets/b.pdf/20260914000001-abcdefg?page=2#x"},
		{"assets/a.pdf", "assets/b.webp", "assets/a.pdf/20260914000001-abcdefg", "annotation", "assets/a.pdf/20260914000001-abcdefg"},
		{"assets/a.png", "assets/a.webp", "https://example.com/assets/a.png", "link", "https://example.com/assets/a.png"},
	} {
		r, err := newAssetRelinker(test.old, test.next)
		if err != nil {
			t.Fatal(err)
		}
		if got := r.reference(test.raw, test.kind, apicontract.AssetReference{}); got != test.want {
			t.Errorf("%q: got %q, want %q", test.raw, got, test.want)
		}
		if test.next == "assets/b.webp" && (len(r.result.References) != 1 || r.result.References[0].Relinkable) {
			t.Fatal("annotation format change was not blocked")
		}
	}
	for _, invalid := range []string{"", "../assets/a.png", "assets/../a.png", "assets/%2e%2e/a.png", "assets/a.png?box=20260914000001-abcdefg", "assets/a.png#x", "assets/a.png:stream", "https://example.com/assets/a.png"} {
		if _, err := newAssetRelinker(invalid, "assets/b.png"); err == nil {
			t.Errorf("accepted invalid request path %q", invalid)
		}
	}
}

func TestAssetRelinkSemanticTree(t *testing.T) {
	r, _ := newAssetRelinker("assets/a.png", "assets/b.webp")
	tree := treenode.NewTree("20260914000000-abcdefg", "/20260914000001-abcdefg.sy", "/Document", "Document")
	tree.Root.SetIALAttr("title-img", `background-image: url("assets/a.png#cover");`)
	p := treenode.NewParagraph("20260914000002-abcdefg")
	p.SetIALAttr("custom-data-assets-list", "assets/a.png assets/a.png.bak,assets/a.png?x=1")
	p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("assets/a.png")})
	p.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("assets/a.png?page=2")})
	p.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "assets/a.png#anchor", TextMarkTextContent: "assets/a.png"})
	tree.Root.AppendChild(p)
	code := &ast.Node{Type: ast.NodeCodeBlockCode, Tokens: []byte("assets/a.png")}
	tree.Root.AppendChild(code)
	markup := &ast.Node{Type: ast.NodeHTMLBlock, Tokens: []byte(`<div title="assets/a.png">assets/a.png<!-- assets/a.png --><img src='assets/a.png?x=1&amp;y=2'><a href=assets/a.png.bak>same</a><script>let a = "assets/a.png";</script></div>`)}
	tree.Root.AppendChild(markup)
	inline := &ast.Node{Type: ast.NodeInlineHTML, Tokens: []byte(`<img src="assets/a.png">`)}
	tree.Root.AppendChild(inline)
	r.tree(tree, apicontract.AssetReference{})
	if len(r.result.References) != 7 {
		t.Fatalf("unexpected references: %+v", r.result.References)
	}
	if p.FirstChild.TokensStr() != "assets/a.png" || code.TokensStr() != "assets/a.png" || p.LastChild.TextMarkTextContent != "assets/a.png" {
		t.Fatal("ordinary text or code changed")
	}
	if got := p.IALAttr("custom-data-assets-list"); got != "assets/b.webp assets/a.png.bak,assets/b.webp?x=1" {
		t.Fatal(got)
	}
	if got := markup.TokensStr(); !strings.Contains(got, "src='assets/b.webp?x=1&amp;y=2'") || !strings.Contains(got, `title="assets/a.png">assets/a.png`) || !strings.Contains(got, `<script>let a = "assets/a.png";</script>`) {
		t.Fatal(got)
	}
	if inline.TokensStr() != `<img src="assets/b.webp">` {
		t.Fatal(inline.TokensStr())
	}
}

func TestAssetRelinkAttributeView(t *testing.T) {
	r, _ := newAssetRelinker("assets/a.png", "assets/b.webp")
	value := &av.Value{ID: "value", Text: &av.ValueText{Rich: &av.ValueTextRich{Spec: av.ValueTextRichSpec, Format: av.ValueTextRichFormatKramdown, Content: "[Image](assets/a.png) assets/a.png"}}}
	view := &av.AttributeView{KeyValues: []*av.KeyValues{{Values: []*av.Value{
		{MAsset: []*av.ValueAsset{{Content: "assets/a.png?page=2"}, {Content: "assets/a.png.bak"}}},
		{URL: &av.ValueURL{Content: "assets/a.png#x"}}, value,
	}}}}
	if err := r.attributeView(view, apicontract.AssetReference{AvID: "database"}); err != nil {
		t.Fatal(err)
	}
	if len(r.result.References) != 3 || !strings.Contains(value.Text.Rich.Content, "assets/b.webp") || !strings.Contains(value.Text.Rich.Content, " assets/a.png") {
		t.Fatalf("unexpected rewrite: %+v %s", r.result.References, value.Text.Rich.Content)
	}
}

func setupAssetRelinkTest(t *testing.T) string {
	t.Helper()
	previousData, previousWorkspace, previousHistory := util.DataDir, util.WorkspaceDir, util.HistoryDir
	util.WorkspaceDir = t.TempDir()
	util.DataDir, util.HistoryDir = filepath.Join(util.WorkspaceDir, "data"), filepath.Join(util.WorkspaceDir, "history")
	t.Cleanup(func() {
		util.DataDir, util.WorkspaceDir, util.HistoryDir = previousData, previousWorkspace, previousHistory
	})
	writeAssetRelinkTestFile(t, "assets/a.png", []byte("source"))
	writeAssetRelinkTestFile(t, "assets/b.webp", []byte("target"))
	return util.DataDir
}

func writeAssetRelinkTestFile(t *testing.T, rel string, data []byte) {
	t.Helper()
	abs := filepath.Join(util.DataDir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, data, 0644); err != nil {
		t.Fatal(err)
	}
}

func assetRelinkTestTree(t *testing.T) (*parse.Tree, []byte) {
	t.Helper()
	const box = "20260914010000-relink0"
	writeAssetRelinkTestFile(t, box+"/.siyuan/conf.json", []byte(`{"name":"Notebook"}`))
	tree := treenode.NewTree(box, "/20260914010001-relink1.sy", "/Document", "Document")
	p := treenode.NewParagraph("20260914010002-relink2")
	p.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "assets/a.png?page=2#x", TextMarkTextContent: "assets/a.png"})
	tree.Root.AppendChild(p)
	l := util.NewLute()
	data := render.NewJSONRenderer(tree, l.RenderOptions, l.ParseOptions).Render()
	writeAssetRelinkTestFile(t, box+tree.Path, data)
	t.Cleanup(func() { cache.RemoveTreeData(tree.Root.ID); forgetRuntimeNormalBox(box) })
	return tree, data
}

func TestAssetRelinkDryRunAndBlockers(t *testing.T) {
	setupAssetRelinkTest(t)
	tree, original := assetRelinkTestTree(t)
	result, err := RelinkAsset("assets/a.png", "assets/b.webp", true)
	if err != nil || len(result.References) != 1 || result.Updated != 0 || result.HistoryPath != "" || !result.References[0].Relinkable {
		t.Fatalf("dry run failed: %+v %v", result, err)
	}
	if _, err = os.Stat(util.HistoryDir); !os.IsNotExist(err) {
		t.Fatal("dry run created history")
	}
	current, _ := os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
	if !bytes.Equal(current, original) {
		t.Fatal("dry run wrote document")
	}
	writeAssetRelinkTestFile(t, "assets/a.png.sya", []byte(`{}`))
	result, err = RelinkAsset("assets/a.png", "assets/b.webp", false)
	if err == nil || result.Updated != 0 || result.HistoryPath != "" {
		t.Fatalf("blocked relink wrote data: %+v %v", result, err)
	}
	current, _ = os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
	if !bytes.Equal(current, original) {
		t.Fatal("blocked relink wrote document")
	}
}

func TestAssetRelinkEncryptedAndCorruptSources(t *testing.T) {
	setupAssetRelinkTest(t)
	const encryptedBox = "20260914010003-crypt00"
	writeAssetRelinkTestFile(t, encryptedBox+"/.siyuan/conf.json", []byte(`{"encrypted":true}`))
	writeAssetRelinkTestFile(t, encryptedBox+"/20260914010004-crypt01.sy", []byte("ciphertext fixture must remain untouched"))
	t.Cleanup(func() { forgetRuntimeEncryptedBox(encryptedBox) })
	result, err := FindAssetReferences("assets/a.png")
	if err != nil || len(result.SkippedNotebooks) != 1 || result.SkippedNotebooks[0] != encryptedBox {
		t.Fatalf("encrypted notebook was not excluded: %+v %v", result, err)
	}
	if _, err = RelinkAsset("assets/a.png?box="+encryptedBox, "assets/b.webp", true); err == nil {
		t.Fatal("encrypted locator accepted")
	}
	r, _ := newAssetRelinker("assets/a.png", "assets/b.webp")
	r.reference("assets/a.png?x=1&amp;box="+encryptedBox, "link", apicontract.AssetReference{})
	if len(r.result.References) != 1 || r.result.References[0].Relinkable {
		t.Fatal("encrypted reference accepted")
	}
	tree, _ := assetRelinkTestTree(t)
	writeAssetRelinkTestFile(t, tree.Box+tree.Path, []byte(`{"broken":`))
	if _, err = RelinkAsset("assets/a.png", "assets/b.webp", false); err == nil {
		t.Fatal("corrupt document accepted")
	}
	if _, err = os.Stat(util.HistoryDir); !os.IsNotExist(err) {
		t.Fatal("corrupt source created history")
	}
}

func TestAssetRelinkAmbiguousAndMissingTarget(t *testing.T) {
	setupAssetRelinkTest(t)
	if _, err := RelinkAsset("assets/a.png", "assets/missing.webp", true); err == nil {
		t.Fatal("missing target accepted")
	}
	tree, _ := assetRelinkTestTree(t)
	writeAssetRelinkTestFile(t, tree.Box+"/assets/a.png", []byte("other"))
	if _, err := FindAssetReferences("assets/a.png"); err == nil {
		t.Fatal("ambiguous source accepted")
	}
}

func TestAssetRelinkSourceChangedDuringScan(t *testing.T) {
	setupAssetRelinkTest(t)
	tree, original := assetRelinkTestTree(t)
	r, _ := newAssetRelinker("assets/a.png", "assets/b.webp")
	plan := &assetRelinkPlan{assetRelinker: r}
	if err := plan.scan(); err != nil {
		t.Fatal(err)
	}
	changed := append(append([]byte(nil), original...), '\n')
	writeAssetRelinkTestFile(t, tree.Box+tree.Path, changed)
	if err := plan.apply(); err == nil || plan.result.Updated != 0 {
		t.Fatalf("concurrent edit accepted: %v", err)
	}
	current, _ := os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
	if !bytes.Equal(current, changed) {
		t.Fatal("concurrent edit overwritten")
	}
}
