package model

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"testing/fstest"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestUnusedAssetsPathPrefixes(t *testing.T) {
	for _, prefix := range []string{"/", "./", "../", "../../", "%2e%2e/", "assets/../../"} {
		t.Run(prefix, func(t *testing.T) {
			boxID, docPath := setupUnusedAssetWorkspace(t)
			boxConf := conf.NewBoxConf()
			boxConf.Closed = false
			if err := (&Box{ID: boxID}).SaveConf(boxConf); err != nil {
				t.Fatal(err)
			}
			root := &ast.Node{Type: ast.NodeDocument, ID: "20260918000001-abcdefg", Spec: treenode.CurrentSpec}
			root.SetIALAttr("title-img", "background-image: url("+prefix+"assets/title.png)")
			root.AppendChild(&ast.Node{Type: ast.NodeHTMLBlock, ID: "20260918000002-abcdefg", Tokens: []byte(`<iframe src="` + prefix + `assets/frame.html?v=3&amp;iframe=true"></iframe><img src="` + prefix + `assets/sub/image.png#preview">`)})
			root.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte(prefix + "assets/link.png")})
			root.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: prefix + "assets/space%20name.png"})
			widget := &ast.Node{Type: ast.NodeWidget}
			widget.SetIALAttr("custom-data-assets", prefix+"assets/widget/")
			root.AppendChild(widget)
			engine := util.NewLute()
			data := render.NewJSONRenderer(&parse.Tree{Root: root}, engine.RenderOptions, engine.ParseOptions).Render()
			if err := os.WriteFile(docPath, data, 0644); err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"title.png", "frame.html", "sub/image.png", "link.png", "space name.png", "widget/index.html", "unused.png"} {
				filename := filepath.Join(util.DataDir, "assets", name)
				if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filename, []byte(name), 0644); err != nil {
					t.Fatal(err)
				}
			}
			items, err := UnusedAssets(false)
			if err != nil || len(items) != 1 || items[0].Item != "assets/unused.png" {
				t.Fatalf("unused: %+v, %v", items, err)
			}
			if missing := MissingAssets(); len(missing) != 0 {
				t.Fatalf("existing assets reported missing: %+v", missing)
			}
			if err := os.Remove(filepath.Join(util.DataDir, "assets", "sub", "image.png")); err != nil {
				t.Fatal(err)
			}
			missing := MissingAssets()
			if len(missing) != 1 || missing[0].Item != "assets/sub/image.png" || !reflect.DeepEqual(missing[0].BlockIDs, []string{"20260918000002-abcdefg"}) {
				t.Fatalf("missing: %+v", missing)
			}
		})
	}
}

func TestNormalizeAssetScanLinkDest(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"/assets/a.png?x=1#part", "assets/a.png?x=1#part"},
		{"../assets/sub/../a.png", "assets/a.png"},
		{"%2e%2e/assets/a.png", "assets/a.png"},
		{"assets/%2e%2e/a.png", ""},
		{"assets/../a.png", ""},
		{"//assets/a.png", ""},
		{"https://example.com/assets/a.png", ""},
		{"data:assets/a.png", ""},
		{`..\assets/a.png`, ""},
		{"./assets/folder/", "assets/folder/"},
		{"./assets/a%23b.png#part", "assets/a%23b.png#part"},
		{"../assets/100%.png", "assets/100%.png"},
	} {
		if got := normalizeAssetScanLinkDest(test.input); got != test.want {
			t.Errorf("%q: got %q, want %q", test.input, got, test.want)
		}
	}
	value := &av.Value{URL: &av.ValueURL{Content: "../assets/url.png"}, MAsset: []*av.ValueAsset{{Content: "/assets/cell.png"}}}
	if got := getAttributeViewValueAssetsLinkDests(value, false, normalizeAssetScanLinkDest); !reflect.DeepEqual(got, []string{"assets/url.png", "assets/cell.png"}) {
		t.Fatalf("database references: %v", got)
	}
	if got := getAttributeViewValueAssetsLinkDests(value, false); len(got) != 0 {
		t.Fatalf("changed non-scan behavior: %v", got)
	}
}

func setupUnusedAssetWorkspace(t *testing.T) (boxID, docPath string) {
	t.Helper()
	originalConf, originalData, originalWorkspace := Conf, util.DataDir, util.WorkspaceDir
	Conf = NewAppConf()
	Conf.FileTree = conf.NewFileTree()
	Conf.Sync = conf.NewSync()
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	t.Cleanup(func() { Conf, util.DataDir, util.WorkspaceDir = originalConf, originalData, originalWorkspace })
	boxID = "20260918000000-abcdefg"
	box := &Box{ID: boxID}
	if err := box.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	return boxID, filepath.Join(util.DataDir, boxID, "20260918000001-abcdefg.sy")
}

func TestUnusedAssetsHTMLReferences(t *testing.T) {
	_, docPath := setupUnusedAssetWorkspace(t)
	root := &ast.Node{Type: ast.NodeDocument, ID: "20260918000001-abcdefg", Spec: treenode.CurrentSpec}
	root.AppendChild(&ast.Node{Type: ast.NodeHTMLBlock, Tokens: []byte(`<div><img src="assets/first.png"><img src='assets/second.png'><a href=assets/file.pdf>download</a><img SRC = "assets/a&amp;b.png"><img src="assets/a&amp;amp;b.png"><video poster="assets/poster.png"><source src="assets/movie.webm"></video></div>`)})
	root.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("assets/fragment.svg#icon")})
	root.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("assets/query.pdf?page=2#page")})
	root.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("assets/encoded%23name.png#icon")})
	root.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("assets/space%20name.png")})
	root.AppendChild(&ast.Node{Type: ast.NodeInlineHTML, Tokens: []byte(`<img src="assets/inline.png">`)})
	luteEngine := util.NewLute()
	data := render.NewJSONRenderer(&parse.Tree{Root: root}, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
	if err := os.WriteFile(docPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"first.png", "second.png", "file.pdf", "file.pdf.sya", "a&b.png", "a&amp;b.png", "poster.png", "movie.webm", "fragment.svg", "query.pdf", "query.pdf.sya", "encoded#name.png", "encoded%23name.png", "space name.png", "inline.png", "unused.png"} {
		if err := os.WriteFile(filepath.Join(util.DataDir, "assets", name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	items, err := UnusedAssets(false)
	if err != nil || len(items) != 1 || items[0].Item != "assets/unused.png" {
		t.Fatalf("unexpected unused assets: %+v, %v", items, err)
	}
}

func TestHTMLAssetLinkDests(t *testing.T) {
	for _, typ := range []ast.NodeType{ast.NodeHTMLBlock, ast.NodeInlineHTML, ast.NodeIFrame, ast.NodeAudio, ast.NodeVideo} {
		node := &ast.Node{Type: typ, Tokens: []byte(`<video src='assets/a.webm?x=1&amp;y=2#part' poster=assets/poster.png><source src="assets/b.webm"></video><a href="https://example.com/a">external</a>`)}
		want := []string{"assets/a.webm?x=1&y=2#part", "assets/poster.png", "assets/b.webm"}
		if got := getAssetsLinkDests(node, false); !reflect.DeepEqual(got, want) {
			t.Fatalf("%v references: got %v, want %v", typ, got, want)
		}
	}
	widget := &ast.Node{Type: ast.NodeWidget, Tokens: []byte(`<iframe src="/widgets/example"></iframe>`)}
	widget.SetIALAttr("custom-data-assets", "assets/widget/")
	if got := getAssetsLinkDests(widget, false); !reflect.DeepEqual(got, []string{"assets/widget/"}) {
		t.Fatalf("widget references: %v", got)
	}
}

func TestUnusedAssetsAbortUnreadableDocument(t *testing.T) {
	for _, test := range []struct{ name, data string }{
		{"new spec", `{"Type":"NodeDocument","Spec":"99"}`},
		{"invalid spec", `{"Type":"NodeDocument","Spec":"invalid"}`},
		{"corrupt JSON", `{"Type":`},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, docPath := setupUnusedAssetWorkspace(t)
			if err := os.WriteFile(docPath, []byte(test.data), 0644); err != nil {
				t.Fatal(err)
			}
			assetPath := filepath.Join(util.DataDir, "assets", "protected.png")
			if err := os.WriteFile(assetPath, []byte("original"), 0644); err != nil {
				t.Fatal(err)
			}
			items, err := UnusedAssets(false)
			if err == nil || len(items) != 0 {
				t.Fatalf("incomplete scan returned candidates: %v, %v", items, err)
			}
			if test.name == "new spec" && !errors.Is(err, treenode.ErrSpecTooNew) {
				t.Fatalf("lost spec error: %v", err)
			}
			if _, _, err = ResolveUnusedDataAssetPath("assets/protected.png"); err == nil {
				t.Fatal("single asset deletion admitted an incomplete scan")
			}
			if removed, removeErr := RemoveUnusedAssets(); removeErr == nil || len(removed) != 0 {
				t.Fatalf("cleanup admitted an incomplete scan: %v, %v", removed, removeErr)
			}
			if data, readErr := os.ReadFile(assetPath); readErr != nil || string(data) != "original" {
				t.Fatalf("asset changed: %q, %v", data, readErr)
			}
			if _, statErr := os.Stat(filepath.Join(util.WorkspaceDir, "history")); !os.IsNotExist(statErr) {
				t.Fatalf("failed scan created cleanup history: %v", statErr)
			}
		})
	}
}

func TestUnusedAssetsWalkFailure(t *testing.T) {
	if _, err := pagedPathsWithError(filepath.Join(t.TempDir(), "missing"), 32); err == nil {
		t.Fatal("missing document directory must fail scanning")
	}
}

func TestPagedPathsErrorModes(t *testing.T) {
	entries, err := fs.ReadDir(fstest.MapFS{"before.sy": &fstest.MapFile{}, "after.sy": &fstest.MapFile{}}, ".")
	if err != nil {
		t.Fatal(err)
	}
	walkErr := &fs.PathError{Op: "readdir", Path: "unreadable", Err: fs.ErrPermission}
	walk := func(root string, visit fs.WalkDirFunc) error {
		if err := visit("before.sy", entries[1], nil); err != nil {
			return err
		}
		if err := visit("unreadable", nil, walkErr); err != nil {
			return err
		}
		return visit("after.sy", entries[0], nil)
	}
	pages, err := pagedPathsWithWalker("notebook", 1, false, walk)
	if err != nil || !reflect.DeepEqual(pages, map[int][]string{1: {"before.sy"}, 2: {"after.sy"}}) {
		t.Fatalf("legacy callers lost readable sibling documents: %v, %v", pages, err)
	}
	if _, err = pagedPathsWithWalker("notebook", 1, true, walk); !errors.Is(err, fs.ErrPermission) {
		t.Fatalf("cleanup must reject incomplete directory traversal: %v", err)
	}
}

func TestUnusedAssetsExcludesEncryptedNotebook(t *testing.T) {
	boxID, docPath := setupUnusedAssetWorkspace(t)
	markRuntimeEncryptedBox(boxID)
	t.Cleanup(func() { forgetRuntimeEncryptedBox(boxID) })
	assetPath := filepath.Join(util.DataDir, boxID, "assets", "encrypted.png")
	if err := os.MkdirAll(filepath.Dir(assetPath), 0755); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{assetPath, docPath} {
		if err := os.WriteFile(p, []byte("opaque encrypted data"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	items, err := UnusedAssets(false)
	if err != nil || len(items) != 0 {
		t.Fatalf("encrypted notebook must remain outside global cleanup: %v, %v", items, err)
	}
}
