//go:build fts5

package model

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentTitleDynamicPersistence(t *testing.T) {
	const helper = "SIYUAN_TEST_TITLE_REF_PROPAGATION"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDocumentTitleDynamicPersistence$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("title propagation subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	testDocumentTitleDynamicPersistence(t, box.ID)
}

func TestDocumentTitleDynamicConcurrentEdits(t *testing.T) {
	if !documentTitleTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	testDocumentTitleDynamicConcurrentEdits(t, box.ID)
}

func testDocumentTitleDynamicConcurrentEdits(t *testing.T, boxID string) {
	for _, referenceSource := range []string{"title", "body"} {
		for _, edit := range []string{"title", "body"} {
			t.Run(referenceSource+" reference/concurrent "+edit, func(t *testing.T) {
				base := newHPathTestDoc(t, boxID, "/", "Before", 1)
				ref := newHPathTestDoc(t, boxID, "/", "Reference", 1)
				body := treenode.NewParagraph("")
				ref.Root.AppendChild(body)
				if referenceSource == "title" {
					ref.Root.DocumentTitle = testDynamicTitle(t, ref.ID, "ref ", base.ID).DocumentTitle
					if _, err := refreshDocumentTitleAnchors(ref.Root, ref); err != nil {
						t.Fatal(err)
					}
				} else {
					ref.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
						TextMarkBlockRefID: base.ID, TextMarkBlockRefSubtype: "d", TextMarkTextContent: "Before"})
				}
				if err := indexWriteTreeUpsertQueue(ref); err != nil {
					t.Fatal(err)
				}
				base.Root.SetIALAttr("title", "After")
				if err := indexWriteTreeUpsertQueue(base); err != nil {
					t.Fatal(err)
				}
				sql.FlushQueue()
				bodyID := body.ID
				snapshotReady, resume := make(chan struct{}), make(chan struct{})
				resumed := false
				defer func() {
					if !resumed {
						close(resume)
					}
				}()
				type refreshResult struct {
					failed bool
					err    error
				}
				finished := make(chan refreshResult, 1)
				go func() {
					var writeErr error
					_, failed := refreshDynamicRefTextsWithWriter(map[string]*ast.Node{base.ID: base.Root},
						map[string]*parse.Tree{base.ID: base}, func(tree *parse.Tree, original []byte) error {
							close(snapshotReady)
							<-resume
							writeErr = writeDynamicRefTree(tree, original)
							return writeErr
						})
					finished <- refreshResult{failed, writeErr}
				}()
				select {
				case <-snapshotReady:
				case <-time.After(5 * time.Second):
					t.Fatal("reference refresh never reached its write window")
				}
				var editTx *Transaction
				if edit == "title" {
					// 保留显示文字，修改完整源，验证标题自身的 CAS 不能被后台旧树绕过。
					editTx = titleWriteTestTransaction(t, ref, treenode.ReadDocumentTitle(ref.Root).Text)
				} else {
					editTx = &Transaction{DoOperations: []*Operation{{Action: "update", ID: bodyID,
						Data: `<div data-node-id="` + bodyID + `" data-type="NodeParagraph"><div contenteditable="true">Concurrent body</div></div>`}}}
				}
				if err := PerformTxSync(editTx); err != nil {
					t.Fatal(err)
				}
				committed, original, err := filesys.LoadTreeSnapshot(ref.Box, ref.Path, util.NewLute())
				if err != nil {
					t.Fatal(err)
				}
				if edit == "body" {
					body := treenode.GetNodeInTree(committed, bodyID)
					if body == nil || body.FirstChild == nil || body.FirstChild.TokensStr() != "Concurrent body" {
						t.Fatal("body edit was not committed before the reference refresh resumed")
					}
				}
				revision := treenode.DocumentTitleRevision(committed.Root)
				close(resume)
				resumed = true
				select {
				case result := <-finished:
					if !result.failed || !errors.Is(result.err, util.ErrFileChanged) {
						t.Fatalf("concurrent edit was not protected: %+v", result)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("reference refresh did not finish")
				}
				_, after, err := filesys.LoadTreeSnapshot(ref.Box, ref.Path, util.NewLute())
				if err != nil || !bytes.Equal(original, after) {
					t.Fatalf("background refresh replaced committed source: %v", err)
				}
				key := dynamicRefTextRetryKey{boxID, base.ID}
				dynamicRefTextRetries.Lock()
				_, pending := dynamicRefTextRetries.pending[key]
				dynamicRefTextRetries.pending[key] = time.Time{}
				dynamicRefTextRetries.Unlock()
				if !pending {
					t.Fatal("conflicting refresh was not queued")
				}
				flushDynamicRefTextRetries()
				sql.FlushQueue()
				drainHPathRefreshTest(t)
				current, raw, err := filesys.LoadTreeSnapshot(ref.Box, ref.Path, util.NewLute())
				if err != nil || treenode.DocumentTitleRevision(current.Root) != revision {
					t.Fatalf("retry changed the committed title source: %v", err)
				}
				if edit == "body" && treenode.GetNodeInTree(current, bodyID).FirstChild.TokensStr() != "Concurrent body" {
					t.Fatal("retry lost the committed body edit")
				}
				if referenceSource == "title" && edit == "body" && treenode.ReadDocumentTitle(current.Root).Text != "ref After" {
					t.Fatal("retry did not refresh the current title anchor")
				}
				if referenceSource == "body" {
					_, text, _ := treenode.GetBlockRef(current.Root.FirstChild.FirstChild)
					if text != "After" {
						t.Fatal("retry did not refresh the current body anchor")
					}
				}
				dynamicRefTextRetries.Lock()
				pending = len(dynamicRefTextRetries.pending) != 0
				dynamicRefTextRetries.Unlock()
				if pending {
					t.Fatal("successful refresh remained queued")
				}
				if IsEncryptedBox(boxID) && (!util.IsCiphertext(raw) || sql.GetBlock(ref.ID) != nil) {
					t.Fatal("concurrent refresh escaped the encrypted notebook boundary")
				}
			})
		}
	}
	t.Run("stale caller snapshot", func(t *testing.T) {
		base := newHPathTestDoc(t, boxID, "/", "Before", 1)
		ref := newHPathTestDoc(t, boxID, "/", "Reference", 1)
		ref.Root.DocumentTitle = testDynamicTitle(t, ref.ID, "ref ", base.ID).DocumentTitle
		if _, err := refreshDocumentTitleAnchors(ref.Root, ref); err != nil {
			t.Fatal(err)
		}
		if err := indexWriteTreeUpsertQueue(ref); err != nil {
			t.Fatal(err)
		}
		base.Root.SetIALAttr("title", "After")
		if err := indexWriteTreeUpsertQueue(base); err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
		paragraph, err := treenode.DocumentTitleParagraph(ref.Root)
		if err != nil {
			t.Fatal(err)
		}
		paragraph.FirstChild.Type, paragraph.FirstChild.Tokens = ast.NodeTextMark, nil
		paragraph.FirstChild.TextMarkType, paragraph.FirstChild.TextMarkTextContent = "strong", "ref "
		source, err := render.NewDocumentTitle(paragraph)
		if err != nil {
			t.Fatal(err)
		}
		tx := &Transaction{DoOperations: []*Operation{{Action: "setDocTitle", ID: ref.ID,
			Data: map[string]any{"source": source, "expectedRevision": treenode.DocumentTitleRevision(ref.Root)}}}}
		if err = PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
		if _, failed := refreshDynamicRefTextsWithWriter(map[string]*ast.Node{base.ID: base.Root},
			map[string]*parse.Tree{base.ID: base, ref.ID: ref}, writeDynamicRefTree); failed {
			t.Fatal("refresh rejected a readable current source")
		}
		current, err := filesys.LoadTree(ref.Box, ref.Path, util.NewLute())
		if err != nil || treenode.DocumentTitleRevision(current.Root) != tx.DoOperations[0].RetData {
			t.Fatalf("refresh wrote the caller's stale title source: %v", err)
		}
	})
}

func testDocumentTitleDynamicPersistence(t *testing.T, boxID string) {
	save := func(tree *parse.Tree) {
		t.Helper()
		if err := writeTreeUpsertQueue(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	setTitle := func(tree *parse.Tree, text, target string) {
		t.Helper()
		root := testDynamicTitle(t, tree.ID, text, target)
		tree.Root.DocumentTitle = root.DocumentTitle
		if err := treenode.RefreshDocumentTitle(tree.Root); err != nil {
			t.Fatal(err)
		}
		tree.HPath = "/" + treenode.ReadDocumentTitle(tree.Root).Text
	}
	load := func(tree *parse.Tree) *parse.Tree {
		t.Helper()
		if IsEncryptedBox(tree.Box) {
			data, err := os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
			if err != nil || !util.IsCiphertext(data) || sql.GetBlock(tree.ID) != nil {
				t.Fatalf("encrypted title escaped notebook boundary: %v", err)
			}
		}
		ret, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		return ret
	}
	base := newHPathTestDoc(t, boxID, "/", "Before", 1)
	previous := base.ID
	var chain []*parse.Tree
	for i := 0; i < 12; i++ {
		tree := newHPathTestDoc(t, boxID, "/", "Reference", 1)
		setTitle(tree, "ref ", previous)
		save(tree)
		chain = append(chain, tree)
		previous = tree.ID
	}
	child := newHPathTestDoc(t, boxID, chain[0].Path, "Child", 1)
	childFile := filepath.Join(util.DataDir, child.Box, child.Path)
	childBefore, err := os.ReadFile(childFile)
	if err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	base.Root.SetIALAttr("title", "After")
	save(base)
	sql.FlushQueue()
	if _, failed := refreshDynamicRefTextsWithWriter(map[string]*ast.Node{base.ID: base.Root}, map[string]*parse.Tree{base.ID: base}, writeDynamicRefTree); failed {
		t.Fatal("chain propagation failed")
	}
	sql.FlushQueue()
	drainHPathRefreshTest(t)
	if bt := treenode.GetBlockTreeInExactBox(child.ID, child.Box); bt == nil || bt.HPath != "/ref After/Child" {
		t.Fatalf("derived title did not refresh descendant path: %+v", bt)
	}
	if after, err := os.ReadFile(childFile); err != nil || !bytes.Equal(childBefore, after) {
		t.Fatalf("derived title rewrote descendant source: %v", err)
	}
	for i, tree := range chain {
		want := strings.Repeat("ref ", i+1) + "After"
		if got := treenode.ReadDocumentTitle(load(tree).Root).Text; got != want {
			t.Fatalf("chain %d: %q != %q", i, got, want)
		}
		if bt := treenode.GetBlockTreeInExactBox(tree.ID, tree.Box); bt == nil || bt.HPath != "/"+want {
			t.Fatalf("title-derived path not updated: %+v", bt)
		}
	}
	left := newHPathTestDoc(t, boxID, "/", "Left", 1)
	right := newHPathTestDoc(t, boxID, "/", "Right", 1)
	setTitle(left, "A ", right.ID)
	setTitle(right, "B ", left.ID)
	save(left)
	save(right)
	sql.FlushQueue()
	for round := 0; round < 3; round++ {
		left = load(left)
		writes := 0
		_, failed := refreshDynamicRefTextsWithWriter(map[string]*ast.Node{left.ID: left.Root}, map[string]*parse.Tree{left.ID: left}, func(tree *parse.Tree, original []byte) error {
			writes++
			return writeDynamicRefTree(tree, original)
		})
		if failed || (round > 0 && writes != 0) {
			t.Fatalf("cycle did not converge: round=%d writes=%d failed=%v", round, writes, failed)
		}
		sql.FlushQueue()
		if got := treenode.ReadDocumentTitle(load(left).Root).Text; got != "A B" {
			t.Fatalf("left cycle title: %q", got)
		}
		if got := treenode.ReadDocumentTitle(load(right).Root).Text; got != "B A" {
			t.Fatalf("right cycle title: %q", got)
		}
	}
	// A failed derived write preserves the complete original title source and
	// its index; publishing replacement labels only happens after persistence.
	first := load(chain[0])
	file := filepath.Join(util.DataDir, first.Box, first.Path)
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	base.Root.SetIALAttr("title", "Later")
	save(base)
	sql.FlushQueue()
	_, failed := refreshDynamicRefTextsWithWriter(map[string]*ast.Node{base.ID: base.Root}, map[string]*parse.Tree{base.ID: base, first.ID: first}, func(tree *parse.Tree, original []byte) error {
		return errors.New("injected title write failure")
	})
	after, err := os.ReadFile(file)
	if err != nil || !failed || !bytes.Equal(before, after) || treenode.ReadDocumentTitle(first.Root).Text != "ref After" {
		t.Fatalf("failed title write changed source: failed=%v err=%v", failed, err)
	}
	if bt := treenode.GetBlockTreeInExactBox(first.ID, first.Box); bt.HPath != "/ref After" {
		t.Fatalf("failed title write changed path index: %+v", bt)
	}
}
