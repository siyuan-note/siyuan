// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"testing/fstest"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestOrdinaryAssetCleanupReferenceChanges(t *testing.T) {
	for _, source := range []string{"document", "new document", "template", "database", "session", "runtime"} {
		for _, stage := range []string{"after backup", "during removal"} {
			t.Run(source+"/"+stage, func(t *testing.T) {
				boxID, docPath := setupUnusedAssetWorkspace(t)
				const asset = "assets/unused.png"
				assetPath := filepath.Join(util.DataDir, asset)
				if err := os.WriteFile(assetPath, []byte("original attachment"), 0644); err != nil {
					t.Fatal(err)
				}
				refPath, updated := docPath, []byte(`{"Type":"NodeDocument","Spec":"1","Children":[{"Type":"NodeLinkDest","Data":"assets/unused.png"}]}`)
				switch source {
				case "new document":
					refPath = filepath.Join(util.DataDir, boxID, "20261026000001-abcdefg.sy")
				case "template":
					refPath, updated = filepath.Join(util.DataDir, "templates", "new.md"), []byte("![image](assets/unused.png)")
				case "database":
					refPath, updated = filepath.Join(util.DataDir, "storage", "av", "20261026000001-abcdefg.json"), []byte(`{"asset":"assets/unused.png"}`)
				case "session", "runtime":
					refPath = filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions", "test", source+".json")
					updated = []byte(`{"entries":[{"type":"user","content":"![image](assets/unused.png)"}]}`)
				}
				if err := os.MkdirAll(filepath.Dir(refPath), 0755); err != nil {
					t.Fatal(err)
				}
				if source == "document" {
					if err := os.WriteFile(refPath, []byte(`{"Type":"NodeDocument","Spec":"1"}`), 0644); err != nil {
						t.Fatal(err)
					}
				}
				verify, release, err := beginOrdinaryAssetCleanup()
				if err != nil {
					t.Fatal(err)
				}
				defer release()
				items, err := UnusedAssets(false)
				if err != nil || len(items) != 1 || items[0].Item != asset {
					t.Fatalf("initial candidates: %v %v", items, err)
				}
				history := t.TempDir()
				if err := filelock.Copy(assetPath, filepath.Join(history, asset)); err != nil {
					t.Fatal(err)
				}
				// A writer not using flushLock saves while cleanup is in progress.
				start, done := make(chan struct{}), make(chan error, 1)
				go func() {
					<-start
					done <- filelock.WriteFile(refPath, updated)
				}()
				writeReference := func() {
					close(start)
					if err := <-done; err != nil {
						t.Fatal(err)
					}
				}
				if stage == "after backup" {
					writeReference()
				}
				removeCalls := 0
				removed, _, err := removeOrdinaryUnusedAssets(items, history, verify, func(p string) error {
					removeCalls++
					if err := os.RemoveAll(p); err != nil {
						return err
					}
					writeReference()
					return nil
				})
				if err == nil || len(removed) != 0 || (stage == "after backup" && removeCalls != 0) {
					t.Fatalf("stale scan admitted removal: %v, %v, calls=%d", removed, err, removeCalls)
				}
				if got, err := os.ReadFile(assetPath); err != nil || string(got) != "original attachment" {
					t.Fatalf("newly referenced attachment lost: %s %v", got, err)
				}
				if got, err := os.ReadFile(refPath); err != nil || string(got) != string(updated) {
					t.Fatalf("concurrent saved reference overwritten: %s %v", got, err)
				}
			})
		}
	}
}

func TestOrdinaryAssetCleanupEmptyResult(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(fmt.Sprint("missing=", missing), func(t *testing.T) {
			setupUnusedAssetWorkspace(t)
			var items []*UnusedItem
			if missing {
				items = []*UnusedItem{{Item: "assets/missing.txt"}}
			}
			checks := 0
			removed, size, err := removeOrdinaryUnusedAssets(items, t.TempDir(), func() error {
				checks++
				return nil
			}, func(string) error {
				t.Fatal("empty cleanup must not remove files")
				return nil
			})
			if err != nil || removed == nil || len(removed) != 0 || size != 0 || checks != 2 {
				t.Fatalf("unexpected empty cleanup result: %v %d %v, checks=%d", removed, size, err, checks)
			}
		})
	}
}

func TestOrdinaryAssetCleanupRestoresPartialRemoval(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint("failure=", fail), func(t *testing.T) {
			setupUnusedAssetWorkspace(t)
			history := t.TempDir()
			items := []*UnusedItem{{Item: "assets/file.txt"}, {Item: "assets/directory/"}}
			for _, rel := range []string{"assets/file.txt", "assets/directory/nested.txt"} {
				for _, root := range []string{util.DataDir, history} {
					filename := filepath.Join(root, rel)
					if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(filename, []byte(rel), 0644); err != nil {
						t.Fatal(err)
					}
				}
			}
			injected := errors.New("remove failed after a partial deletion")
			calls := 0
			removed, size, err := removeOrdinaryUnusedAssets(items, history, func() error { return nil }, func(p string) error {
				calls++
				if err := os.RemoveAll(p); err != nil {
					return err
				}
				if fail && calls == 2 {
					return injected
				}
				return nil
			})
			if fail {
				if !errors.Is(err, injected) || len(removed) != 0 || size != 0 {
					t.Fatalf("partial failure: %v %d %v", removed, size, err)
				}
			} else if err != nil || len(removed) != 2 || size == 0 {
				t.Fatalf("successful cleanup: %v %d %v", removed, size, err)
			}
			for _, rel := range []string{"assets/file.txt", "assets/directory/nested.txt"} {
				got, readErr := os.ReadFile(filepath.Join(util.DataDir, rel))
				if fail && (readErr != nil || string(got) != rel) || !fail && !os.IsNotExist(readErr) {
					t.Fatalf("unexpected attachment state %s: %s %v", rel, got, readErr)
				}
			}
		})
	}
}

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
			if missing, err := MissingAssets(); err != nil || len(missing) != 0 {
				t.Fatalf("existing assets reported missing: %+v, %v", missing, err)
			}
			if err := os.Remove(filepath.Join(util.DataDir, "assets", "sub", "image.png")); err != nil {
				t.Fatal(err)
			}
			missing, err := MissingAssets()
			if err != nil || len(missing) != 1 || missing[0].Item != "assets/sub/image.png" || !reflect.DeepEqual(missing[0].BlockIDs, []string{"20260918000002-abcdefg"}) {
				t.Fatalf("missing: %+v, %v", missing, err)
			}
		})
	}
}

func TestAssetListReferences(t *testing.T) {
	for _, kind := range []string{"attribute", "widget", "html"} {
		t.Run(kind, func(t *testing.T) {
			root := &ast.Node{Type: ast.NodeDocument}
			switch kind {
			case "attribute":
				paragraph := &ast.Node{Type: ast.NodeParagraph}
				paragraph.SetIALAttr("custom-data-assets-list", "assets/a.png assets/b.png,assets/c.png")
				root.AppendChild(paragraph)
			case "widget":
				widget := &ast.Node{Type: ast.NodeWidget}
				widget.SetIALAttr("data-assets", "assets/a.png assets/b.png,assets/c.png")
				root.AppendChild(widget)
			case "html":
				root.AppendChild(&ast.Node{Type: ast.NodeHTMLBlock, Tokens: []byte(`<div custom-data-assets-list="assets/a.png assets/b.png,assets/c.png"></div>`)})
			}
			dests := getAssetsLinkDestsWithOptions(root, false, nil, assetLinkScanOptions{expandAssetLists: true}, normalizeAssetScanLinkDest)
			for _, want := range []string{"assets/a.png", "assets/b.png", "assets/c.png"} {
				found := false
				for _, dest := range dests {
					found = found || dest == want
				}
				if !found {
					t.Errorf("missing resource %s in %v", want, dests)
				}
			}
		})
	}
	paragraph := &ast.Node{Type: ast.NodeParagraph}
	paragraph.SetIALAttr("custom-data-assets", "assets/space name.png")
	if got := getAssetsLinkDests(paragraph, false, normalizeAssetScanLinkDest); !reflect.DeepEqual(got, []string{"assets/space name.png"}) {
		t.Fatalf("ordinary reference extraction split a filename: %v", got)
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
	Conf.FileTree.Store(conf.NewFileTree())
	Conf.Sync.Store(conf.NewSync())
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

func TestUnusedAssetsTemplateReferences(t *testing.T) {
	setupUnusedAssetWorkspace(t)
	templateDir := filepath.Join(util.DataDir, "templates", "nested")
	if err := os.MkdirAll(templateDir, 0755); err != nil {
		t.Fatal(err)
	}
	content := "![template](../assets/space%20name.png?preview#image)\n\n[PDF](assets/file.pdf?page=2)\n\n<img src=\"/assets/html.png\">\n\n{{now | date \"2006\"}}\n"
	if err := os.WriteFile(filepath.Join(templateDir, "example.md"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"space name.png", "file.pdf", "file.pdf.sya", "html.png", "unused.png"} {
		if err := os.WriteFile(filepath.Join(util.DataDir, "assets", name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	items, err := UnusedAssets(false)
	if err != nil || len(items) != 1 || items[0].Item != "assets/unused.png" {
		t.Fatalf("template assets reported unused: %+v, %v", items, err)
	}
}

func TestUnusedAssetsTemplatePaths(t *testing.T) {
	for _, mode := range []string{"uppercase extension", "symlink root"} {
		t.Run(mode, func(t *testing.T) {
			setupUnusedAssetWorkspace(t)
			Conf.Search.Store(conf.NewSearch())
			templateDir := filepath.Join(util.DataDir, "templates")
			name := "example.MD"
			if mode == "symlink root" {
				target := t.TempDir()
				if err := os.Symlink(target, templateDir); err != nil {
					t.Skipf("symlink unavailable: %v", err)
				}
				templateDir, name = target, "example.md"
			}
			if err := os.MkdirAll(templateDir, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(templateDir, name), []byte("![image](assets/template.png)"), 0644); err != nil {
				t.Fatal(err)
			}
			if matches := SearchTemplate(""); len(matches) != 1 {
				t.Fatalf("template manager did not expose the fixture: %v", matches)
			}
			if err := os.WriteFile(filepath.Join(util.DataDir, "assets", "template.png"), []byte("image"), 0644); err != nil {
				t.Fatal(err)
			}
			unused, err := UnusedAssets(false)
			if err != nil || len(unused) != 0 {
				t.Fatalf("supported template asset listed for deletion: %+v, %v", unused, err)
			}
		})
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

func TestAndroidNotificationAssetDeletionPaths(t *testing.T) {
	boxID, docPath := setupUnusedAssetWorkspace(t)
	for _, name := range []string{"assets/android-notification-texts.txt", "assets/sub/android-notification-texts.txt", "assets/other-android-notification-texts.txt", boxID + "/assets/android-notification-texts.txt", "assets/ocr-texts.json"} {
		p := filepath.Join(util.DataDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("original"), 0644); err != nil {
			t.Fatal(err)
		}
		if _, _, err := ResolveUnusedDataAssetPath(name); (err == nil) != (name == "assets/android-notification-texts.txt") {
			t.Fatalf("unexpected deletion admission for %s: %v", name, err)
		}
	}
	if err := os.WriteFile(docPath, []byte(`{"Type":"NodeDocument","Spec":"99"}`), 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ResolveUnusedDataAssetPath("assets/android-notification-texts.txt"); err != nil {
		t.Fatalf("explicit switch deletion must not depend on document scanning: %v", err)
	}
	for _, name := range []string{"../assets/android-notification-texts.txt", "/assets/android-notification-texts.txt", "assets/../../android-notification-texts.txt"} {
		if _, _, err := ResolveUnusedDataAssetPath(name); err == nil {
			t.Fatalf("invalid path admitted: %s", name)
		}
	}
	p := filepath.Join(util.DataDir, "assets", "android-notification-texts.txt")
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ResolveUnusedDataAssetPath("assets/android-notification-texts.txt"); err == nil {
		t.Fatal("missing switch admitted")
	}
	if err := os.Mkdir(p, 0755); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ResolveUnusedDataAssetPath("assets/android-notification-texts.txt"); err == nil {
		t.Fatal("directory admitted as notification switch")
	}
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(util.DataDir, "assets", "ocr-texts.json"), p); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, _, err := ResolveUnusedDataAssetPath("assets/android-notification-texts.txt"); err == nil {
		t.Fatal("symlink admitted as notification switch")
	}
}
