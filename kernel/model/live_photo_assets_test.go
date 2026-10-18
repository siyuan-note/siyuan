package model

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLivePhotoRichTableResourceRewritePersistence(t *testing.T) {
	previousData, previousProvider := util.DataDir, filesys.DEKProvider
	previousAcquire, previousRelease := filesys.DEKLockAcquire, filesys.DEKLockRelease
	util.DataDir = t.TempDir()
	filesys.DEKProvider = func(string) ([]byte, error) { return nil, nil }
	filesys.DEKLockAcquire, filesys.DEKLockRelease = nil, nil
	t.Cleanup(func() {
		cache.ClearTreeCache()
		util.DataDir, filesys.DEKProvider = previousData, previousProvider
		filesys.DEKLockAcquire, filesys.DEKLockRelease = previousAcquire, previousRelease
	})
	legacy, err := os.ReadFile("../treenode/testdata/table-cell-legacy.sy")
	if err != nil {
		t.Fatal(err)
	}
	for name, rewrite := range map[string]func(*parse.Tree){
		"relink": func(tree *parse.Tree) {
			r, _ := newAssetRelinker("assets/old.mov", "assets/new.mov")
			r.tree(tree, apicontract.AssetReference{})
			if r.changes != 1 {
				t.Fatalf("unexpected relink count: %d", r.changes)
			}
		},
		"rewrite": func(tree *parse.Tree) {
			rewriteTreeAssetReferences(tree, assetReferenceRewriteOptions{pathMap: map[string]string{"assets/old.mov": "assets/new.mov"}})
		},
		"rename": func(tree *parse.Tree) {
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.Type == ast.NodeImage {
					setAssetsLinkDest(n, "assets/old.mov", "assets/new.mov")
				}
				return ast.WalkContinue
			})
		},
	} {
		t.Run(name, func(t *testing.T) {
			tree, err := filesys.LoadTreeByData(legacy, "20260908000000-box0001", "/20260908000000-root001.sy", util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			cell := tree.Root.FirstChild.LastChild.FirstChild
			cell.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: `![first](assets/a.heic){: custom-sy-live-photo="1" custom-sy-live-photo-video="assets/old.mov?x=1&y=2"} ` +
				`![second](assets/b.heic){: custom-sy-live-photo="1" custom-sy-live-photo-video="assets/other.mov"} assets/old.mov`}
			treenode.UpgradeSpec(tree)
			if err := treenode.RefreshTableCellRichProjection(tree.Root); err != nil {
				t.Fatal(err)
			}
			if _, err := filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			rewrite(tree)
			if _, err := filesys.WriteTree(tree); err != nil {
				t.Fatalf("save rewritten rich table: %v", err)
			}
			cache.ClearTreeCache()
			loaded, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			var videos []string
			ast.Walk(loaded.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.Type == ast.NodeImage {
					videos = append(videos, treenode.ImageLivePhotoVideo(n))
				}
				return ast.WalkContinue
			})
			if !reflect.DeepEqual(videos, []string{"assets/new.mov?x=1&y=2", "assets/other.mov"}) {
				t.Fatalf("reloaded associations: %v", videos)
			}
			if !strings.Contains(loaded.Root.FirstChild.LastChild.FirstChild.TableCellRich.Content, " assets/old.mov") {
				t.Fatal("plain text changed")
			}
		})
	}
}

func TestLivePhotoAssetReferences(t *testing.T) {
	const sourceBox = "20260812000000-source0"
	const targetBox = "20260812000001-target0"
	tree := treenode.NewTree(sourceBox, "/20260812000002-doc0000.sy", "/Document", "Document")
	p := treenode.NewParagraph("20260812000003-block00")
	tree.Root.AppendChild(p)
	for _, name := range []string{"first", "second"} {
		image := &ast.Node{Type: ast.NodeImage}
		image.SetIALAttr(treenode.LivePhotoVersionAttr, treenode.LivePhotoVersion)
		image.SetIALAttr(treenode.LivePhotoVideoAttr, "assets/"+name+".mov?box="+sourceBox+"&x=1")
		image.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("assets/" + name + ".heic")})
		p.AppendChild(image)
	}
	if got, want := getAssetsLinkDests(tree.Root, false), []string{
		"assets/first.mov?box=" + sourceBox + "&x=1", "assets/first.heic",
		"assets/second.mov?box=" + sourceBox + "&x=1", "assets/second.heic",
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("asset references = %v, want %v", got, want)
	}
	rewriteTreeAssetReferences(tree, assetReferenceRewriteOptions{
		pathMap:     map[string]string{"assets/first.mov": "assets/encrypted-first.mov"},
		targetBoxID: targetBox, bindTargetBox: true,
	})
	if got := treenode.ImageLivePhotoVideo(p.FirstChild); got != "assets/encrypted-first.mov?box="+targetBox+"&x=1" {
		t.Fatal(got)
	}
	if got := treenode.ImageLivePhotoVideo(p.LastChild); got != "assets/second.mov?box="+sourceBox+"&x=1" {
		t.Fatalf("unmapped image changed: %s", got)
	}
	setAssetsLinkDest(p.LastChild, "assets/second.mov", "assets/renamed.mov")
	if got := treenode.ImageLivePhotoVideo(p.LastChild); got != "assets/renamed.mov?box="+sourceBox+"&x=1" {
		t.Fatal(got)
	}
	// 未知版本仍参与资源清理，后续版本的数据不会被误判为未引用资源。
	p.LastChild.SetIALAttr(treenode.LivePhotoVersionAttr, "99")
	if got := getAssetsLinkDests(p.LastChild, false); len(got) != 2 {
		t.Fatalf("unknown version lost resources: %v", got)
	}
}

func TestLivePhotoAssetRelink(t *testing.T) {
	tree := treenode.NewTree("20260914000000-abcdefg", "/20260914000001-abcdefg.sy", "/Document", "Document")
	p := treenode.NewParagraph("20260914000002-abcdefg")
	tree.Root.AppendChild(p)
	for _, path := range []string{"assets/a.mov?x=1&y=2#clip", "assets/a.mov.bak"} {
		image := &ast.Node{Type: ast.NodeImage}
		image.SetIALAttr(treenode.LivePhotoVideoAttr, path)
		p.AppendChild(image)
	}
	r, err := newAssetRelinker("assets/a.mov", "assets/b.mov")
	if err != nil {
		t.Fatal(err)
	}
	r.tree(tree, apicontract.AssetReference{})
	if got := treenode.ImageLivePhotoVideo(p.FirstChild); got != "assets/b.mov?x=1&y=2#clip" {
		t.Fatal(got)
	}
	if got := treenode.ImageLivePhotoVideo(p.LastChild); got != "assets/a.mov.bak" {
		t.Fatal(got)
	}
	if len(r.result.References) != 1 || r.result.References[0].BlockID != p.ID || r.result.References[0].Type != "attribute" {
		t.Fatalf("wrong relink reference: %+v", r.result.References)
	}
}

func TestEncryptedLivePhotoAssetsAreRetained(t *testing.T) {
	boxID, docPath, dek := setupEncryptedCleanupTest(t)
	originals := map[string][]byte{}
	for _, name := range []string{"photo.heic", "photo.mov"} {
		originals[name] = writeEncryptedCleanupAsset(t, boxID, name, dek, false)
	}
	writeEncryptedCleanupAsset(t, boxID, "unused.mov", dek, false)
	writeEncryptedCleanupDoc(t, boxID, docPath, dek,
		`{"Type":"NodeParagraph","ID":"20261017000001-abcdefg","Children":[{"Type":"NodeImage","Properties":{"custom-sy-live-photo":"1","custom-sy-live-photo-video":"assets/photo.mov?box=`+boxID+`"},"Children":[{"Type":"NodeLinkDest","Data":"assets/photo.heic"}]}]}`)
	items, err := UnusedEncryptedBoxAssets(context.Background(), boxID)
	if err != nil || len(items) != 1 || items[0].Item != "assets/unused.mov" {
		t.Fatalf("paired resources classified as unused: %+v, %v", items, err)
	}
	if _, err = RemoveUnusedEncryptedBoxAssets(context.Background(), boxID, []string{"assets/photo.mov"}); err == nil {
		t.Fatal("accepted paired video for deletion")
	}
	for name, original := range originals {
		got, err := os.ReadFile(filepath.Join(util.DataDir, boxID, "assets", name))
		if err != nil || !bytes.Equal(got, original) {
			t.Fatalf("changed original %s: %v", name, err)
		}
	}
}
