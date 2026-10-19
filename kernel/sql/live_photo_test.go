package sql

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLivePhotoIndexesBothAssetsInOneImageSpan(t *testing.T) {
	previousDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previousDataDir })
	tree := treenode.NewTree("20260914000000-abcdefg", "/20260914000001-abcdefg.sy", "/Document", "Document")
	p := treenode.NewParagraph("20260914000002-abcdefg")
	tree.Root.AppendChild(p)
	image := &ast.Node{Type: ast.NodeImage}
	image.SetIALAttr(treenode.LivePhotoVersionAttr, treenode.LivePhotoVersion)
	image.SetIALAttr(treenode.LivePhotoVideoAttr, "assets/photo.mov?box="+tree.Box)
	image.AppendChild(&ast.Node{Type: ast.NodeLinkText, Tokens: []byte("photo")})
	image.AppendChild(&ast.Node{Type: ast.NodeLinkDest, Tokens: []byte("assets/photo.heic")})
	p.AppendChild(image)
	_, spans, assets, _, _ := buildSpanFromNode(image, tree, tree.ID, tree.Box, tree.Path)
	if len(spans) != 1 || len(assets) != 2 {
		t.Fatalf("spans=%d, assets=%+v", len(spans), assets)
	}
	for i, path := range []string{"assets/photo.heic", "assets/photo.mov"} {
		if assets[i].Path != path || assets[i].BlockID != p.ID || assets[i].Box != tree.Box {
			t.Fatalf("wrong asset index: %+v", assets[i])
		}
	}
}
