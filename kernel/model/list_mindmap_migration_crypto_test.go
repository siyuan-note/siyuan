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
