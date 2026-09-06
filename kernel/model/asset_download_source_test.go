package model

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAssetRepositoryCreationWaitsForSourceChange(t *testing.T) {
	_, partial, _ := prepareAssetDownloadRepoTest(t)
	if err := partial.EnsureAllAssets(nil); err != nil {
		t.Fatal(err)
	}
	if err := partial.EnsureAllSnapshotChunks(nil); err != nil {
		t.Fatal(err)
	}
	assetDownloadSourceMu.Lock()
	locked := true
	defer func() {
		if locked {
			assetDownloadSourceMu.Unlock()
		}
	}()
	if err := clearAssetDownloadState(); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	created := make(chan error, 1)
	go func() {
		close(started)
		_, err := newRepository()
		created <- err
	}()
	<-started
	select {
	case err := <-created:
		t.Fatalf("repository was created during source change: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	if _, err := os.Stat(assetDownloadStatePath()); !os.IsNotExist(err) {
		t.Fatalf("old source state was recreated: %v", err)
	}
	Conf.Repo.Key = []byte("abcdef0123456789abcdef0123456789")
	assetDownloadSourceMu.Unlock()
	locked = false
	select {
	case err := <-created:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("repository creation did not resume")
	}
	if _, err := dejavu.ReadAssetDownloadScope(assetDownloadStatePath(), Conf.Repo.Key); err != nil {
		t.Fatalf("new source state does not authenticate: %v", err)
	}
}

func TestAssetDownloadIndexIgnoreRequiresAccess(t *testing.T) {
	_, partial, _ := prepareAssetDownloadRepoTest(t)
	deferred, err := partial.DeferredAssets()
	if err != nil || len(deferred) != 1 {
		t.Fatalf("unexpected deferred resources: %v %v", deferred, err)
	}
	ignorePath := filepath.Join(util.DataDir, ".siyuan", "syncignore")
	if err = os.MkdirAll(filepath.Dir(ignorePath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(ignorePath, []byte("/assets/file.bin"), 0644); err != nil {
		t.Fatal(err)
	}
	Conf.Sync.Enabled = false
	if _, err = IndexRepo("offline ignore change"); err == nil {
		t.Fatal("local snapshot downloaded an ignored resource without access")
	}
	if deferred, err = partial.DeferredAssets(); err != nil || len(deferred) != 1 {
		t.Fatalf("failed snapshot lost resource state: %v %v", deferred, err)
	}
	if err = partial.EnsureFileChunks(deferred[0], nil); err != nil {
		t.Fatal(err)
	}
	if _, err = IndexRepo("locally available ignore change"); err != nil {
		t.Fatalf("local chunks cannot preserve an ignored resource offline: %v", err)
	}
	if data, readErr := os.ReadFile(filepath.Join(util.DataDir, "assets", "file.bin")); readErr != nil || string(data) != "version one" {
		t.Fatalf("ignored resource was not preserved: %q %v", data, readErr)
	}
}
