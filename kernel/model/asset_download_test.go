package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func prepareAssetDownloadRepoTest(t *testing.T) (*dejavu.Repo, *dejavu.Repo, string) {
	t.Helper()
	originalConf := Conf
	originalWorkspace, originalData, originalRepo := util.WorkspaceDir, util.DataDir, util.RepoDir
	originalHistory, originalTemp, originalConfDir := util.HistoryDir, util.TempDir, util.ConfDir
	originalStatusBar := util.StatusBarCfg
	t.Cleanup(func() {
		util.StatusBarCfg = originalStatusBar
		Conf = originalConf
		util.WorkspaceDir, util.DataDir, util.RepoDir = originalWorkspace, originalData, originalRepo
		util.HistoryDir, util.TempDir, util.ConfDir = originalHistory, originalTemp, originalConfDir
	})
	base := t.TempDir()
	remote, fullDir := filepath.Join(base, "cloud"), filepath.Join(base, "full")
	key := []byte("0123456789abcdef0123456789abcdef")
	fullData := filepath.Join(fullDir, "data")
	backend := cloud.NewLocal(&cloud.BaseCloud{Conf: &cloud.Conf{Dir: "main", RepoPath: filepath.Join(fullDir, "repo"),
		AvailableSize: 1 << 30, Local: &cloud.ConfLocal{Endpoint: remote}}})
	full, err := dejavu.NewRepo(fullData, filepath.Join(fullDir, "repo"), filepath.Join(fullDir, "history"),
		filepath.Join(fullDir, "temp"), "full", "full", "windows", key, nil, backend)
	if err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"seed.txt": "seed", "assets/file.bin": "version one"} {
		p := filepath.Join(fullData, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(p, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	util.StatusBarCfg = &util.StatusBar{MsgDataSyncDisabled: true}
	Conf.Sync, Conf.Repo, Conf.System, Conf.Search = conf.NewSync(), conf.NewRepo(), conf.NewSystem(), conf.NewSearch()
	Conf.Sync.Local = &conf.Local{Endpoint: remote}
	Conf.SetUser(&conf.User{UserId: "asset-test", UserSiYuanOneTimePayStatus: 1})
	Conf.Sync.Provider, Conf.Sync.CloudName, Conf.Sync.Enabled = conf.ProviderLocal, "main", true
	Conf.Sync.Local.Endpoint, Conf.Sync.AssetDownloadMode = remote, 1
	Conf.Repo.Key = key
	util.WorkspaceDir = filepath.Join(base, "partial")
	util.DataDir, util.RepoDir = filepath.Join(util.WorkspaceDir, "data"), filepath.Join(util.WorkspaceDir, "repo")
	util.HistoryDir, util.TempDir = filepath.Join(util.WorkspaceDir, "history"), filepath.Join(util.WorkspaceDir, "temp")
	util.ConfDir = filepath.Join(util.WorkspaceDir, "conf")
	if _, err = full.Index("first", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = full.Sync(nil); err != nil {
		t.Fatal(err)
	}
	partial, err := newRepository()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, "seed.txt"), []byte("seed"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = partial.Index("partial", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = partial.Sync(nil); err != nil {
		t.Fatal(err)
	}
	id, _, err := partial.AssetDownloadChanges()
	if err != nil {
		t.Fatal(err)
	}
	if err = partial.AcknowledgeAssetDownloadChanges(id); err != nil {
		t.Fatal(err)
	}
	return full, partial, fullData
}

func TestAssetDownloadModePreservesHistoricalRecovery(t *testing.T) {
	full, partial, fullData := prepareAssetDownloadRepoTest(t)
	deferred, err := DeferredSyncAssets()
	if err != nil || len(deferred) != 1 {
		t.Fatalf("expected a deferred asset: %v, %v", deferred, err)
	}
	oldFile := deferred[0]
	if err = requireCompleteAssetDownloads(); err == nil {
		t.Fatal("source change allowed with missing current content")
	}
	assetPath := filepath.Join(fullData, "assets", "file.bin")
	if err = os.WriteFile(assetPath, []byte("version two is different"), 0644); err != nil {
		t.Fatal(err)
	}
	updated := time.UnixMilli(oldFile.Updated).Add(2 * time.Second)
	if err = os.Chtimes(assetPath, updated, updated); err != nil {
		t.Fatal(err)
	}
	if _, err = full.Index("second", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = full.Sync(nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = partial.Sync(nil); err != nil {
		t.Fatal(err)
	}
	localAsset := filepath.Join(util.DataDir, "assets", "file.bin")
	if err = EnsureAssetLocal(localAsset); err != nil {
		t.Fatal(err)
	}
	if !repoFileNeedsDownload(oldFile) {
		t.Fatal("current asset read unexpectedly downloaded its historical version")
	}
	if err = requireCompleteAssetDownloads(); err == nil {
		t.Fatal("source change allowed with missing historical content")
	}
	Conf.Sync.Enabled = false
	if err = SetSyncAssetDownloadMode(0); err == nil || Conf.Sync.AssetDownloadMode != 1 {
		t.Fatalf("offline mode switch discarded the previous mode: %v", err)
	}
	if err = EnsureAssetLocal(localAsset); err != nil {
		t.Fatalf("cached resource unavailable offline: %v", err)
	}
	Conf.Sync.Enabled = true
	if err = SetSyncAssetDownloadMode(0); err != nil {
		t.Fatal(err)
	}
	if Conf.Sync.AssetDownloadMode != 0 || repoFileNeedsDownload(oldFile) {
		t.Fatal("full mode did not complete historical assets")
	}
	if err = requireCompleteAssetDownloads(); err != nil {
		t.Fatalf("complete source cannot be changed: %v", err)
	}
	data, file, err := readRepoFileWithAssets(oldFile.ID)
	if err != nil || file.ID != oldFile.ID || !bytes.Equal(data, []byte("version one")) {
		t.Fatalf("historical read returned the wrong version: %q, %v", data, err)
	}
	if data, err = os.ReadFile(localAsset); err != nil || !bytes.Equal(data, []byte("version two is different")) {
		t.Fatalf("historical read overwrote current asset: %q, %v", data, err)
	}
	if err = clearAssetDownloadState(); err != nil {
		t.Fatal(err)
	}
	if exists, err := assetDownloadStateExists(); err != nil || exists {
		t.Fatalf("authenticated complete state was not cleared: %v", err)
	}
	Conf.Repo.Key = nil
	if err = requireCompleteAssetDownloads(); err != nil {
		t.Fatalf("reset state prevents initializing another key: %v", err)
	}
}

func TestAssetDownloadStateCorruptionPreservesSource(t *testing.T) {
	prepareAssetDownloadRepoTest(t)
	statePath := assetDownloadStatePath()
	data, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-1] ^= 1
	if err = os.WriteFile(statePath, data, 0600); err != nil {
		t.Fatal(err)
	}
	key := append([]byte(nil), Conf.Repo.Key...)
	if err = requireCompleteAssetDownloads(); err == nil {
		t.Fatal("corrupt state accepted for a source change")
	}
	if err = SetSyncAssetDownloadMode(0); err == nil || Conf.Sync.AssetDownloadMode != 1 {
		t.Fatal("corrupt state was discarded during a mode change")
	}
	if err = clearAssetDownloadState(); err == nil {
		t.Fatal("corrupt state was discarded before changing the key")
	}
	remaining, err := os.ReadFile(statePath)
	if err != nil || !bytes.Equal(data, remaining) || !bytes.Equal(key, Conf.Repo.Key) {
		t.Fatal("failure changed source state or recovery key")
	}
}

func TestAssetDownloadUsesLocalSnapshotChunksWhileLoggedOut(t *testing.T) {
	_, partial, _ := prepareAssetDownloadRepoTest(t)
	files, err := DeferredSyncAssets()
	if err != nil || len(files) != 1 {
		t.Fatalf("expected deferred resource: %v", err)
	}
	if err = partial.EnsureFileChunks(files[0], nil); err != nil {
		t.Fatal(err)
	}
	assetPath := filepath.Join(util.DataDir, "assets", "file.bin")
	if _, err = os.Stat(assetPath); !os.IsNotExist(err) {
		t.Fatal("snapshot chunk download unexpectedly materialized workspace content")
	}
	Conf.Sync.Enabled = false
	Conf.SetUser(nil)
	if err = EnsureAssetLocal(assetPath); err != nil {
		t.Fatalf("offline local chunks were not reused: %v", err)
	}
	data, err := os.ReadFile(assetPath)
	if err != nil || !bytes.Equal(data, []byte("version one")) {
		t.Fatalf("offline materialization changed content: %q, %v", data, err)
	}
}

func TestAssetDownloadScopeIdentity(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	c := &cloud.Conf{Dir: "main", S3: &cloud.ConfS3{Endpoint: "https://storage.invalid", Bucket: "first"}}
	scope := assetDownloadScope(conf.ProviderS3, c, key)
	c.Dir = "bucket-display-name"
	c.S3.Timeout = 120
	if got := assetDownloadScope(conf.ProviderS3, c, key); got != scope {
		t.Fatal("connection/display settings changed the S3 resource identity")
	}
	c.S3.Bucket = "second"
	if got := assetDownloadScope(conf.ProviderS3, c, key); got == scope {
		t.Fatal("different S3 buckets share an identity")
	}
	c.S3.Bucket = "first"
	key[0] ^= 1
	if got := assetDownloadScope(conf.ProviderS3, c, key); got == scope {
		t.Fatal("different repository keys share an identity")
	}
	if !repoFileNeedsDownload(&entity.File{Chunks: []string{"invalid"}}) {
		t.Fatal("malformed chunk metadata marked complete")
	}
}
