//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMigrateLegacyMindmapsEncrypted(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_MINDMAP_CRYPTO") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestMigrateLegacyMindmapsEncrypted$")
		command.Env = append(os.Environ(), "SIYUAN_TEST_MINDMAP_CRYPTO=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("encrypted migration subprocess failed: %v\n%s", err, output)
		}
		return
	}
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	util.WorkspaceDir = filepath.Dir(util.HistoryDir)
	const password = "mindmap-migration-test"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Mind map migration", password)
	if err != nil {
		t.Fatal(err)
	}
	docID := ast.NewNodeID()
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Mind map", "Mind map")
	engine := util.NewLute()
	_, source := engine.Md2BlockDOMTree("```mindmap\n- Confidential root\n  - [/] Child\n```", false)
	code := firstContentBlock(source.Root)
	code.Unlink()
	tree.Root.AppendChild(code)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	path := filepath.Join(util.DataDir, boxID, tree.Path)
	before, err := os.ReadFile(path)
	if err != nil || !util.IsCiphertext(before) {
		t.Fatalf("source is not encrypted: %v", err)
	}
	tx, _, err := MigrateLegacyMindmaps(docID)
	if err != nil || len(tx.DoOperations) != 1 {
		t.Fatalf("encrypted migration failed: %+v, %v", tx, err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !util.IsCiphertext(after) || bytes.Equal(before, after) || bytes.Contains(after, []byte("Confidential")) {
		t.Fatalf("migration did not preserve encryption: %v", err)
	}
	histories, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-format", boxID, docID+".sy"))
	if err != nil || len(histories) != 1 {
		t.Fatalf("missing encrypted history: %v, %v", histories, err)
	}
	history, err := os.ReadFile(histories[0])
	if err != nil || !bytes.Equal(before, history) {
		t.Fatalf("encrypted recovery data changed: %v", err)
	}
	relative, err := filepath.Rel(util.WorkspaceDir, histories[0])
	if err != nil {
		t.Fatal(err)
	}
	_, _, content, _, err := GetDocHistoryContent(relative, "", false)
	if err != nil || !strings.Contains(content, `data-type="NodeCodeBlock"`) || !strings.Contains(content, "mindmap") ||
		!strings.Contains(content, "Confidential root") {
		t.Fatalf("encrypted history cannot recover the source: %v", err)
	}
	for _, operations := range [][]*Operation{tx.UndoOperations, tx.DoOperations} {
		replay := &Transaction{DoOperations: operations}
		replay.MarkReplay()
		if err = PerformTxSync(replay); err != nil {
			t.Fatal(err)
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil || !util.IsCiphertext(data) {
			t.Fatalf("undo or redo wrote plaintext: %v", readErr)
		}
	}
	oldDocID := ast.NewNodeID()
	oldTree := treenode.NewTree(boxID, "/"+oldDocID+".sy", "/Old list", "Old list")
	_, oldSource := engine.Md2BlockDOMTree("- Secret root\n  - Secret child\n", false)
	oldList := firstContentBlock(oldSource.Root)
	oldList.Unlink()
	oldList.SetIALAttr(listMindmapViewAttr, "1")
	oldList.SetIALAttr(listMindmapMetadataAttr, `{"version":1,"nodes":{},"relations":[]}`)
	oldTree.Root.AppendChild(oldList)
	if _, err = filesys.WriteTree(oldTree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(oldTree)
	oldPath := filepath.Join(util.DataDir, boxID, oldTree.Path)
	oldBefore, err := os.ReadFile(oldPath)
	if err != nil || !util.IsCiphertext(oldBefore) {
		t.Fatalf("old list source is not encrypted: %v", err)
	}
	oldTx, _, err := MigrateLegacyMindmaps(oldDocID)
	if err != nil || len(oldTx.DoOperations) != 1 {
		t.Fatalf("encrypted old list migration failed: %+v, %v", oldTx, err)
	}
	oldAfter, err := os.ReadFile(oldPath)
	if err != nil || !util.IsCiphertext(oldAfter) || bytes.Equal(oldBefore, oldAfter) || bytes.Contains(oldAfter, []byte("Secret root")) {
		t.Fatalf("old list migration did not preserve encryption: %v", err)
	}
	migrated, err := LoadTreeByBlockID(oldDocID)
	if err != nil {
		t.Fatal(err)
	}
	newList := treenode.GetNodeInTree(migrated, oldList.ID)
	if newList == nil || newList.Type != ast.NodeMindmap || newList.IALAttr(listMindmapViewAttr) != "" ||
		newList.IALAttr(listMindmapMetadataAttr) != oldList.IALAttr(listMindmapMetadataAttr) {
		t.Fatal("encrypted old list lost its identity or metadata")
	}
	oldHistories, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-format", boxID, oldDocID+".sy"))
	if err != nil || len(oldHistories) != 1 {
		t.Fatalf("missing encrypted old list history: %v, %v", oldHistories, err)
	}
	oldHistory, err := os.ReadFile(oldHistories[0])
	if err != nil || !bytes.Equal(oldBefore, oldHistory) {
		t.Fatal("encrypted old list recovery data changed")
	}
	oldRelative, err := filepath.Rel(util.WorkspaceDir, oldHistories[0])
	if err != nil {
		t.Fatal(err)
	}
	_, _, oldContent, _, err := GetDocHistoryContent(oldRelative, "", false)
	if err != nil || !strings.Contains(oldContent, `data-type="NodeList"`) || !strings.Contains(oldContent, "Secret root") {
		t.Fatalf("encrypted old list history cannot recover the source: %v", err)
	}
	corrupt, _ := os.ReadFile(path)
	corrupt[len(corrupt)-1] ^= 1
	if err = os.WriteFile(path, corrupt, 0644); err != nil {
		t.Fatal(err)
	}
	cache.RemoveTreeData(docID)
	if _, _, err = MigrateLegacyMindmaps(docID); err == nil {
		t.Fatal("corrupt ciphertext was accepted")
	}
	retained, _ := os.ReadFile(path)
	if !bytes.Equal(retained, corrupt) {
		t.Fatal("failed authentication overwrote the original data")
	}
}
