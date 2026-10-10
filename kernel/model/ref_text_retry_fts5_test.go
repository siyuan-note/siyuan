//go:build fts5

package model

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDynamicRefTextWriteFailureRetry(t *testing.T) {
	const helper = "SIYUAN_TEST_REF_TEXT_RETRY"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDynamicRefTextWriteFailureRetry$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("reference refresh subprocess: %v\n%s", err, output)
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
	testDynamicRefTextWriteFailureRetry(t, box.ID)
}

func testDynamicRefTextWriteFailureRetry(t *testing.T, boxID string) {
	box := &Box{ID: boxID}
	definition := newHPathTestDoc(t, box.ID, "/", "Definition", 1)
	def := definition.Root.FirstChild
	def.SetIALAttr("name", "original")
	save := func(tree *parse.Tree) {
		t.Helper()
		if err := writeTreeUpsertQueue(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	addReference := func(tree *parse.Tree, defID, subtype, text string) *ast.Node {
		block := treenode.NewParagraph("")
		block.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
			TextMarkBlockRefID: defID, TextMarkBlockRefSubtype: subtype, TextMarkTextContent: text})
		tree.Root.AppendChild(block)
		return block
	}
	reference := newHPathTestDoc(t, box.ID, "/", "Reference", 1)
	addReference(reference, def.ID, "d", "original")
	secondRef := addReference(reference, def.ID, "d", "original")
	addReference(reference, def.ID, "s", "manual anchor")
	other := newHPathTestDoc(t, box.ID, "/", "Other", 1)
	addReference(other, def.ID, "d", "original")
	chained := newHPathTestDoc(t, box.ID, "/", "Chained", 1)
	addReference(chained, secondRef.ID, "d", "original")
	for _, tree := range []*parse.Tree{definition, reference, other, chained} {
		save(tree)
	}
	sql.FlushQueue()
	read := func(tree *parse.Tree) []byte {
		t.Helper()
		data, err := os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	anchors := func(tree *parse.Tree) []string {
		var values []string
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && treenode.IsBlockRef(node) {
				_, text, _ := treenode.GetBlockRef(node)
				values = append(values, text)
			}
			return ast.WalkContinue
		})
		return values
	}
	before := read(reference)
	def.SetIALAttr("name", "saved edit")
	save(definition)
	sql.FlushQueue()
	sourceBefore := read(definition)
	writeCalls := 0
	_, failed := refreshDynamicRefTextsWithWriter(map[string]*ast.Node{def.ID: def},
		map[string]*parse.Tree{definition.ID: definition, reference.ID: reference}, func(tree *parse.Tree) error {
			writeCalls++
			if tree.ID == reference.ID {
				return errors.New("injected disk write failure")
			}
			return writeTreeUpsertQueue(tree)
		})
	if !failed || writeCalls != 2 {
		t.Fatalf("failed refresh must still save unrelated reference trees: failed=%v writes=%d", failed, writeCalls)
	}
	if !bytes.Equal(sourceBefore, read(definition)) || !bytes.Equal(before, read(reference)) {
		t.Fatal("derived write failure changed the saved edit or original reference document")
	}
	if got := anchors(reference); !reflect.DeepEqual(got, []string{"original", "original", "manual anchor"}) {
		t.Fatalf("failed refresh mutated the submitted tree: %v", got)
	}
	sql.FlushQueue()
	for _, ref := range sql.GetRefsCacheByDefIDInBox(def.ID, box.ID) {
		if ref.RootID == reference.ID && ref.Content != "original" && ref.Content != "manual anchor" {
			t.Fatalf("failed refresh published an unpersisted SQL reference: %+v", ref)
		}
	}
	for key := range setRefDynamicTextLatestTasks {
		if strings.HasPrefix(key, reference.ID+"\x00") {
			t.Fatal("failed refresh published an unpersisted UI update")
		}
	}
	key := dynamicRefTextRetryKey{box.ID, def.ID}
	if len(dynamicRefTextRetries.pending) != 1 {
		t.Fatalf("write failure was not queued once: %v", dynamicRefTextRetries.pending)
	}
	// 后续编辑保存在磁盘，重试必须重新读取定义与引用文档。
	def.SetIALAttr("name", "latest edit")
	save(definition)
	laterEdit := treenode.NewParagraph("")
	laterEdit.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("independent later edit")})
	reference.Root.AppendChild(laterEdit)
	save(reference)
	sql.FlushQueue()
	if IsEncryptedBox(box.ID) {
		boxEncryption, err := GetBoxEncryption(box.ID)
		if err != nil {
			t.Fatal(err)
		}
		LockBox(box.ID)
		dynamicRefTextRetries.pending[key] = time.Time{}
		flushDynamicRefTextRetries()
		if _, pending := dynamicRefTextRetries.pending[key]; !pending {
			t.Fatal("locking encrypted notebook discarded the pending reference refresh")
		}
		if sql.GetEncryptedDB(box.ID) != nil {
			t.Fatal("retry reopened a locked encrypted notebook")
		}
		if err = UnlockBox(box.ID, "ref-retry-test-password", boxEncryption); err != nil {
			t.Fatal(err)
		}
		if _, err = Mount(box.ID); err != nil {
			t.Fatal(err)
		}
		for _, tree := range []*parse.Tree{definition, reference, other, chained} {
			loaded, loadErr := filesys.LoadTree(box.ID, tree.Path, util.NewLute())
			if loadErr != nil {
				t.Fatal(loadErr)
			}
			treenode.UpsertBlockTree(loaded)
			sql.IndexTreeQueue(loaded)
		}
		sql.FlushQueue()
	}
	dynamicRefTextRetries.pending[key] = time.Time{}
	flushDynamicRefTextRetries()
	sql.FlushQueue()
	if len(dynamicRefTextRetries.pending) != 0 {
		t.Fatalf("successful retry remains queued: %v", dynamicRefTextRetries.pending)
	}
	for _, tree := range []*parse.Tree{reference, other, chained} {
		loaded, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		want := []string{"latest edit"}
		if tree == reference {
			want = []string{"latest edit", "latest edit", "manual anchor"}
			preserved := false
			ast.Walk(loaded.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
				if entering && strings.Contains(string(node.Tokens), "independent later edit") {
					preserved = true
				}
				return ast.WalkContinue
			})
			if !preserved {
				t.Fatal("retry overwrote later reference document content")
			}
		}
		if IsEncryptedBox(box.ID) && (!util.IsCiphertext(read(tree)) || sql.GetBlock(tree.ID) != nil) {
			t.Fatal("retry exposed encrypted data in a plaintext file or the global index")
		}
		if got := anchors(loaded); !reflect.DeepEqual(got, want) {
			t.Fatalf("retry or chained propagation used stale text in %s: got=%v want=%v", tree.ID, got, want)
		}
	}

	// 锁定的加密笔记本保留重试标识，禁止读取内容；已删除的普通区块可以取消重试。
	lockedBox := ast.NewNodeID()
	markRuntimeEncryptedBox(lockedBox)
	defer forgetRuntimeEncryptedBox(lockedBox)
	lockedKey := dynamicRefTextRetryKey{lockedBox, ast.NewNodeID()}
	dynamicRefTextRetries.pending[lockedKey] = time.Time{}
	flushDynamicRefTextRetries()
	if _, pending := dynamicRefTextRetries.pending[lockedKey]; !pending {
		t.Fatal("locked encrypted notebook retry was discarded")
	}
	delete(dynamicRefTextRetries.pending, lockedKey)
	if !IsEncryptedBox(box.ID) && !retryDynamicRefText(dynamicRefTextRetryKey{box.ID, ast.NewNodeID()}) {
		t.Fatal("deleted definition should not be retried forever")
	}

	// 订正时间戳写入失败时，块树仍指向原始文件。
	originalPath := definition.Path
	definition.Path = "/../invalid.sy"
	definition.Root.SetIALAttr("updated", "")
	reindexTree0(definition, 0, 1)
	if got := treenode.GetBlockTreeInBox(definition.ID, box.ID); got == nil || got.Path != originalPath {
		t.Fatalf("failed timestamp repair changed the block tree: %+v", got)
	}
}
