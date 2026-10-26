//go:build fts5

package model

import (
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLegacyDocumentCreation(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	testLegacyDocumentCreation(t, prepareDocumentTitleFeatureBox(t))
}

func TestLegacyDocumentCreationCollectsNewBlocks(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	fixture, view, _ := setupBlockCollectionTest(t)
	rule := view.Automations.Rules[0]
	rule.BlockSource.DocumentIDs = nil
	rule.BlockSource.NotebookIDs = []string{fixture.box.ID}
	rule.BlockSource.Tags = nil
	rule.BlockSource.Types = []string{"d", "p"}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err := treenode.SetDocumentMetadataState(fixture.box.ID, "ready"); err != nil {
		t.Fatal(err)
	}
	id, err := CreateWithMarkdown("", fixture.box.ID, "/New/Middle/Leaf", "Collected content", "", ast.NewNodeID(), false, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	created, err := LoadTreeByBlockID(id)
	if err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	for _, blockID := range []string{created.ID, created.Root.FirstChild.ID} {
		if view.GetBlockValueByBoundID(blockID) == nil {
			t.Fatal("new document blocks were not collected", blockID)
		}
	}
}

func TestLegacyDocumentCreationRejectsConcurrentMissingParent(t *testing.T) {
	if !documentTitleFeatureTestProcess(t) {
		return
	}
	box := prepareDocumentTitleFeatureBox(t)
	if err := treenode.SetDocumentMetadataState(box, "ready"); err != nil {
		t.Fatal(err)
	}
	raw := treenode.NewTree(box, "/"+ast.NewNodeID()+".sy", "/Race", "Race")
	entered, release := make(chan struct{}), make(chan struct{})
	rawDone, createDone := make(chan error, 1), make(chan error, 1)
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	go func() {
		_, err := filesys.WriteTreeWithPreflight(raw, func() error {
			close(entered)
			<-release
			return nil
		})
		rawDone <- err
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("raw source writer did not enter preflight")
	}
	go func() {
		_, err := CreateWithMarkdown("", box, "/Race/Leaf", "body", "", ast.NewNodeID(), false, "", nil)
		createDone <- err
	}()
	// 原始写入持有源锁但尚未提交；等 legacy 事务发布自己的待创建父文档。
	var pending *treenode.BlockTree
	deadline := time.After(5 * time.Second)
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
waitPending:
	for {
		select {
		case <-ticker.C:
			if pending = treenode.GetBlockTreeRootByHPath(box, "/Race"); pending != nil {
				break waitPending
			}
		case err := <-createDone:
			t.Fatal("creation ended before its source preflight", err)
		case <-deadline:
			t.Fatal("legacy parent did not reach source preflight")
		}
	}
	unblock()
	if err := <-rawDone; err != nil {
		t.Fatal("concurrent raw source commit", err)
	}
	if err := <-createDone; !errors.Is(err, treenode.ErrDocumentMetadataUnavailable) {
		t.Fatal("new concurrent parent did not invalidate creation", err)
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, box, pending.Path)); !os.IsNotExist(err) {
		t.Fatal("rejected legacy parent was persisted", err)
	}
	if tree, err := filesys.LoadTree(box, raw.Path, util.NewLute()); err != nil || tree.ID != raw.ID {
		t.Fatal("concurrent source was damaged", err)
	}
}

func testLegacyDocumentCreation(t *testing.T, box string) {
	t.Helper()
	trimmed := newHPathTestDoc(t, box, "/", "Padded", 1)
	padded := newHPathTestDoc(t, box, "/", "Initial", 1)
	paragraph := &ast.Node{Type: ast.NodeParagraph}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: " Padded "})
	if err := treenode.SetDocumentTitleParagraph(padded.Root, paragraph); err != nil {
		t.Fatal(err)
	}
	padded.HPath = "/ Padded "
	saveDocumentTitleFeatureTree(t, padded)
	newHPathTestDoc(t, box, trimmed.Path, "Branch", 1)
	if err := treenode.SetDocumentMetadataState(box, "ready"); err != nil {
		t.Fatal(err)
	}
	for _, parentID := range []string{padded.ID, ""} {
		id, err := CreateWithMarkdown("", box, "/ Padded /Child", "body", parentID, ast.NewNodeID(), false, "", nil)
		if err != nil {
			t.Fatal("create under exact rich parent", err)
		}
		bt := treenode.GetBlockTreeInExactBox(id, box)
		if bt == nil || path.Dir(bt.Path) != strings.TrimSuffix(padded.Path, ".sy") || bt.HPath != "/ Padded /Child" {
			t.Fatal("rich parent whitespace changed the destination", bt)
		}
	}
	// 缺失的后代仍归属已选富标题祖先，不能切换到 trim 后的同名祖先已有的后代。
	id, err := CreateWithMarkdown("", box, "/ Padded /Branch/Leaf", "nested body", padded.ID, ast.NewNodeID(), false, "", nil)
	if err != nil {
		t.Fatal("create missing rich-parent descendant", err)
	}
	bt := treenode.GetBlockTreeInExactBox(id, box)
	if bt == nil || !strings.HasPrefix(bt.Path, strings.TrimSuffix(padded.Path, ".sy")+"/") || bt.HPath != "/ Padded /Branch/Leaf" {
		t.Fatal("missing descendant switched to trimmed ancestor", bt)
	}
	// 旧版调用允许首尾空白和不匹配的父 ID；没有精确前缀时仍按 trim 后的路径回退。
	id, err = CreateWithMarkdown("", box, "/  Padded  / Fallback ", "fallback body", padded.ID, ast.NewNodeID(), false, "", nil)
	if err != nil {
		t.Fatal("legacy whitespace fallback", err)
	}
	bt = treenode.GetBlockTreeInExactBox(id, box)
	if bt == nil || path.Dir(bt.Path) != strings.TrimSuffix(trimmed.Path, ".sy") || bt.HPath != "/Padded/Fallback" {
		t.Fatal("mismatching parent ID changed legacy fallback", bt)
	}
	// 每个缺失祖先必须先完成提交，后续祖先和目标文档才能继续创建。
	id, err = CreateWithMarkdown("", box, "/Missing/ Middle /Leaf.sy", "missing ancestor body", "", ast.NewNodeID(), false, "", nil)
	if err != nil {
		t.Fatal("create missing ancestors", err)
	}
	bt = treenode.GetBlockTreeInExactBox(id, box)
	if bt == nil || bt.HPath != "/Missing/Middle/Leaf" {
		t.Fatal("missing ancestor path", bt)
	}
	for p, title := bt.Path, "Leaf"; ; {
		tree, loadErr := filesys.LoadTree(box, p, util.NewLute())
		if loadErr != nil || treenode.ReadDocumentTitle(tree.Root).Text != title {
			t.Fatal("created ancestor is not readable", p, loadErr)
		}
		if title == "Leaf" && !strings.Contains(tree.Root.Text(), "missing ancestor body") {
			t.Fatal("created leaf lost its content")
		}
		if title == "Missing" {
			break
		}
		p = path.Dir(p) + ".sy"
		if title == "Leaf" {
			title = "Middle"
		} else {
			title = "Missing"
		}
	}
}
