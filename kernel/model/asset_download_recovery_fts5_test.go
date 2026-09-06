//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	dejavuutil "github.com/siyuan-note/dejavu/util"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAssetDownloadRecoveryUpdatesDocumentCache(t *testing.T) {
	const childEnv = "SIYUAN_TEST_ASSET_RECOVERY"
	if os.Getenv(childEnv) == "" {
		for _, stage := range []string{"pending", "applied"} {
			t.Run(stage, func(t *testing.T) {
				cmd := exec.Command(os.Args[0], "-test.run=^TestAssetDownloadRecoveryUpdatesDocumentCache$", "-test.v")
				cmd.Env = append(os.Environ(), childEnv+"="+stage)
				if output, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("recovery subprocess failed: %v\n%s", err, output)
				}
			})
		}
		return
	}
	fixture, full, partial, fullData := prepareAssetDownloadDocumentTest(t)
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	if err := os.MkdirAll(util.TempDir, 0755); err != nil {
		t.Fatal(err)
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	tree := treenode.NewTree(fixture.box.ID, "/20260905210005-abcdefg.sy", "/OldTitle", "OldTitle")
	writeAssetDownloadDocumentTest(t, tree)
	if _, err := partial.Index("local document", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := partial.Sync(nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := full.Sync(nil); err != nil {
		t.Fatal(err)
	}
	index, _ := partial.Latest()
	files, _ := partial.GetFiles(index)
	var before *entity.File
	for _, file := range files {
		if file.Path == "/"+tree.Box+tree.Path {
			before = file
		}
	}
	if before == nil {
		t.Fatal("missing original document metadata")
	}
	localDoc := filepath.Join(util.DataDir, tree.Box, tree.Path)
	oldData, err := os.ReadFile(localDoc)
	if err != nil {
		t.Fatal(err)
	}
	remoteData := bytes.ReplaceAll(oldData, []byte("OldTitle"), []byte("RemoteTitle"))
	remoteDoc := filepath.Join(fullData, tree.Box, tree.Path)
	if err = os.WriteFile(remoteDoc, remoteData, 0644); err != nil {
		t.Fatal(err)
	}
	stamp := time.UnixMilli(before.Updated).Add(time.Minute)
	if err = os.Chtimes(remoteDoc, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	if _, err = full.Index("remote document", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = full.Sync(nil); err != nil {
		t.Fatal(err)
	}
	target, _ := full.Latest()
	if _, _, _, err = partial.DownloadIndex(target.ID, nil); err != nil {
		t.Fatal(err)
	}
	files, _ = full.GetFiles(target)
	var after *entity.File
	for _, file := range files {
		if file.Path == before.Path {
			after = file
		}
	}
	if after == nil {
		t.Fatal("missing updated document metadata")
	}
	cache.RemoveTreeData(tree.ID)
	oldTree, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
	if err != nil || oldTree.Root.IALAttr("title") != "OldTitle" {
		t.Fatalf("old cache setup failed: %v", err)
	}
	deferred, err := DeferredSyncAssets()
	if err != nil {
		t.Fatal(err)
	}
	scope, err := dejavu.ReadAssetDownloadScope(assetDownloadStatePath(), Conf.Repo.Key)
	if err != nil {
		t.Fatal(err)
	}
	deferredMap := map[string]*entity.File{}
	for _, file := range deferred {
		deferredMap[file.Path] = file
	}
	state, err := json.Marshal(map[string]any{"version": 1, "scope": scope, "deferred": deferredMap, "pending": map[string]any{
		"index": target, "base": target, "deferred": deferredMap, "upserts": []*entity.File{after}, "before": map[string]*entity.File{before.Path: before},
	}})
	if err != nil {
		t.Fatal(err)
	}
	store, err := dejavu.NewStore(t.TempDir(), Conf.Repo.Key)
	if err != nil {
		t.Fatal(err)
	}
	chunk := &entity.Chunk{ID: dejavuutil.Hash(state), Data: state}
	if err = store.PutChunk(chunk); err != nil {
		t.Fatal(err)
	}
	_, stateObject := store.AbsPath(chunk.ID)
	ciphertext, err := os.ReadFile(stateObject)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(assetDownloadStatePath(), ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := newRepository()
	if err != nil {
		t.Fatal(err)
	}
	disk, err := os.ReadFile(localDoc)
	if err != nil || !bytes.Contains(disk, []byte("OldTitle")) {
		t.Fatalf("repository construction changed the document: %v", err)
	}
	if os.Getenv(childEnv) == "applied" {
		if _, _, err = reopened.RecoverAssetDownloads(nil); err != nil {
			t.Fatal(err)
		}
		if reopened, err = newRepository(); err != nil {
			t.Fatal(err)
		}
		uploadErr := errors.New("upload interrupted")
		operationErr := uploadErr
		finishAssetDownloadRecovery(reopened, &operationErr)
		if !errors.Is(operationErr, uploadErr) {
			t.Fatalf("reconciliation lost the sync error: %v", operationErr)
		}
	} else if err = processAssetDownloadRecovery(reopened, true); err != nil {
		t.Fatal(err)
	}
	if block := sql.GetBlock(tree.ID); block == nil || block.Content != "RemoteTitle" {
		t.Fatalf("recovered document was not indexed: %+v", block)
	}
	if id, _, readErr := reopened.AssetDownloadChanges(); readErr != nil || id != "" {
		t.Fatalf("completed indexing was not acknowledged: %q %v", id, readErr)
	}
	disk, err = os.ReadFile(localDoc)
	if err != nil || !bytes.Contains(disk, []byte("RemoteTitle")) {
		t.Fatalf("disk recovery failed: %v", err)
	}
	merge, _, err := reopened.Sync(nil)
	if err != nil {
		t.Fatal(err)
	}
	read, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	if merge.DataChanged() {
		t.Fatal("completed recovery unexpectedly changed the sync baseline")
	}
	if read.Root.IALAttr("title") != "RemoteTitle" {
		t.Fatalf("disk is RemoteTitle but cached document is %q, and retry reports zero changed files", read.Root.IALAttr("title"))
	}
}
