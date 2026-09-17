//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestEncryptedDocumentHPathRefresh(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_ENCRYPTED_HPATH_REFRESH") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestEncryptedDocumentHPathRefresh$", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_ENCRYPTED_HPATH_REFRESH=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("encrypted hpath refresh subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	password := "hpath-refresh-test-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Encrypted", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(boxID); err != nil {
		t.Fatal(err)
	}
	parent := newHPathTestDoc(t, boxID, "/", "PrivateParent", 1)
	child := newHPathTestDoc(t, boxID, parent.Path, "PrivateChild", 400)
	// 先完成测试构造树的常规格式规范化，再保存用于检查重命名兼容性的密文基线。
	for _, docPath := range []string{parent.Path, child.Path} {
		cache.RemoveTreeData(util.GetTreeID(docPath))
		if _, err = filesys.LoadTree(boxID, docPath, util.NewLute()); err != nil {
			t.Fatal(err)
		}
	}
	sql.FlushQueue()
	childFile := filepath.Join(util.DataDir, boxID, child.Path)
	before, err := os.ReadFile(childFile)
	if err != nil || !util.IsCiphertext(before) {
		t.Fatalf("fixture is not encrypted: %v", err)
	}
	if err = RenameDoc(boxID, parent.Path, "PrivateRenamed"); err != nil {
		t.Fatal(err)
	}
	assertChildCiphertext := func(stage string) {
		t.Helper()
		data, readErr := os.ReadFile(childFile)
		if readErr != nil || !bytes.Equal(before, data) {
			t.Fatalf("descendant ciphertext changed at %s: %v", stage, readErr)
		}
	}
	assertChildCiphertext("rename")
	journal, err := os.ReadFile(filepath.Join(util.QueueDir, "hpath-refresh.queue"))
	if err != nil || bytes.Contains(journal, []byte("Private")) {
		t.Fatalf("task journal leaked titles: %s, %v", journal, err)
	}
	boxEncryption, err := GetBoxEncryption(boxID)
	if err != nil {
		t.Fatal(err)
	}
	LockBox(boxID)
	assertChildCiphertext("lock")
	// 重建普通索引不得丢弃独立加密笔记本在锁定前留下的恢复记录。
	sql.InitDatabase(true)
	RefreshHPathsJob()
	if len(hpathRefresh.tasks) != 1 {
		t.Fatal("locked notebook lost its pending task")
	}
	if sql.GetEncryptedDB(boxID) != nil || treenode.GetBlockTreeInBox(child.ID, boxID) != nil {
		t.Fatal("background reopened a locked notebook")
	}
	if err = UnlockBox(boxID, password, boxEncryption); err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(boxID); err != nil {
		t.Fatal(err)
	}
	assertChildCiphertext("mount")
	// 锁定会删除派生索引；解锁后使用认证过的原文件重建，再恢复未完成的任务。
	for _, original := range []struct{ id, path string }{{parent.ID, parent.Path}, {child.ID, child.Path}} {
		tree, loadErr := filesys.LoadTree(boxID, original.path, util.NewLute())
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		assertChildCiphertext("load for reindex")
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}
	drainHPathRefreshTest(t)
	assertHPathTestDoc(t, sql.GetEncryptedDB(boxID), child, "/PrivateRenamed/PrivateChild")
	after, err := os.ReadFile(childFile)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("rename or recovery rewrote descendant ciphertext: %v", err)
	}
	if sql.GetBlock(child.ID) != nil {
		t.Fatal("encrypted block escaped into the global index")
	}

	// 恢复时必须认证源密文；认证失败既不能回退明文，也不能清除恢复记录。
	if err = RenameDoc(boxID, parent.Path, "PrivateRetry"); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	parentFile := filepath.Join(util.DataDir, boxID, parent.Path)
	original, err := os.ReadFile(parentFile)
	if err != nil {
		t.Fatal(err)
	}
	corrupt := append([]byte(nil), original...)
	corrupt[len(corrupt)-1] ^= 1
	if err = os.WriteFile(parentFile, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	cache.RemoveTreeData(parent.ID)
	hpathRefresh.Lock()
	hpathRefresh.tasks, hpathRefresh.file = nil, ""
	if err = loadHPathRefreshLocked(); err != nil {
		t.Fatal(err)
	}
	task := hpathRefresh.tasks[boxID+"/"+parent.ID]
	_, recoveryErr := refreshHPathsTask(task)
	hpathRefresh.Unlock()
	if recoveryErr == nil {
		t.Fatal("corrupted source was accepted during recovery")
	}
	preserved, err := os.ReadFile(parentFile)
	if err != nil || !bytes.Equal(corrupt, preserved) || len(hpathRefresh.tasks) == 0 {
		t.Fatal("failed authentication changed source or dropped recovery")
	}
	if err = os.WriteFile(parentFile, original, 0600); err != nil {
		t.Fatal(err)
	}
	drainHPathRefreshTest(t)
	assertHPathTestDoc(t, sql.GetEncryptedDB(boxID), child, "/PrivateRetry/PrivateChild")
}
