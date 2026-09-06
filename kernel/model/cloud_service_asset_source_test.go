package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCloudAssetSourceAllowsOriginalAccountAfterLogout(t *testing.T) {
	originalConf := Conf
	originalData, originalRepo, originalConfDir := util.DataDir, util.RepoDir, util.ConfDir
	originalHistory, originalTemp, originalRegion := util.HistoryDir, util.TempDir, util.CurrentCloudRegion
	t.Cleanup(func() {
		Conf = originalConf
		util.DataDir, util.RepoDir, util.ConfDir = originalData, originalRepo, originalConfDir
		util.HistoryDir, util.TempDir, util.CurrentCloudRegion = originalHistory, originalTemp, originalRegion
	})
	base := t.TempDir()
	remote := filepath.Join(base, "cloud")
	key := []byte("0123456789abcdef0123456789abcdef")
	owner := &conf.User{UserId: "asset-owner", UserName: "owner"}
	Conf = NewAppConf()
	Conf.Sync, Conf.Repo, Conf.System = conf.NewSync(), conf.NewRepo(), conf.NewSystem()
	Conf.Sync.Provider, Conf.Sync.CloudName, Conf.Sync.Enabled = conf.ProviderSiYuan, "main", true
	Conf.Sync.AssetDownloadMode = 1
	Conf.Repo.Key = key
	Conf.SetUser(owner)
	Conf.CloudRegion, util.CurrentCloudRegion = 0, 0
	deviceDir := filepath.Join(base, "partial")
	util.DataDir, util.RepoDir, util.ConfDir = filepath.Join(deviceDir, "data"), filepath.Join(deviceDir, "repo"), filepath.Join(deviceDir, "conf")
	util.HistoryDir, util.TempDir = filepath.Join(deviceDir, "history"), filepath.Join(deviceDir, "temp")
	cloudConf, err := buildCloudConf()
	if err != nil {
		t.Fatal(err)
	}
	scope := assetDownloadScope(conf.ProviderSiYuan, cloudConf, key)
	makeRepo := func(name string, onDemand bool) *dejavu.Repo {
		t.Helper()
		dir := filepath.Join(base, name)
		repoPath := filepath.Join(dir, "repo")
		backend := cloud.NewLocal(&cloud.BaseCloud{Conf: &cloud.Conf{Dir: "main", RepoPath: repoPath,
			AvailableSize: 1024 * 1024 * 1024, Local: &cloud.ConfLocal{Endpoint: remote}}})
		repo, createErr := dejavu.NewRepo(filepath.Join(dir, "data"), repoPath, filepath.Join(dir, "history"),
			filepath.Join(dir, "temp"), name, name, "windows", key, nil, backend)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if createErr = os.MkdirAll(filepath.Join(dir, "data"), 0755); createErr != nil {
			t.Fatal(createErr)
		}
		if createErr = os.WriteFile(filepath.Join(dir, "data", "seed.txt"), []byte("seed"), 0644); createErr != nil {
			t.Fatal(createErr)
		}
		if _, createErr = repo.Index("seed", true, nil); createErr != nil {
			t.Fatal(createErr)
		}
		if createErr = repo.ConfigureAssetDownloads(onDemand, filepath.Join(dir, "conf", "asset-downloads.json"), scope); createErr != nil {
			t.Fatal(createErr)
		}
		return repo
	}
	full := makeRepo("full", false)
	if err = os.MkdirAll(filepath.Join(base, "full", "data", "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(base, "full", "data", "assets", "remote.bin"), []byte("remote asset"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = full.Index("asset", true, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err = full.Sync(nil); err != nil {
		t.Fatal(err)
	}
	partial := makeRepo("partial", true)
	if _, _, err = partial.Sync(nil); err != nil {
		t.Fatal(err)
	}
	deferred, err := DeferredSyncAssets()
	if err != nil || len(deferred) != 1 {
		t.Fatalf("expected an undownloaded asset: %v, %v", deferred, err)
	}
	LogoutUser()
	if Conf.GetUser() != nil {
		t.Fatal("logout retained the cloud session")
	}
	if err = validateCloudUserAssetSource(owner); err != nil {
		t.Fatalf("original account cannot authenticate after logout: %v", err)
	}
	if err = validateCloudUserAssetSource(&conf.User{UserId: "different-owner"}); !IsCloudAssetSourceChange(err) {
		t.Fatalf("different account accepted despite undownloaded data: %v", err)
	}
	if snapshots, _, _, snapshotErr := GetRepoSnapshots(1); snapshotErr != nil || len(snapshots) == 0 {
		t.Fatalf("local snapshots unavailable after logout: %v, %v", snapshots, snapshotErr)
	}
	if err = checkAssetDownloadAccess(); err == nil {
		t.Fatal("cloud asset downloads accepted without a cloud session")
	}
	result := Login("different-owner", "unused-password", "", 1)
	if result.Code == 0 || Conf.CloudRegion != 0 || util.CurrentCloudRegion != 0 {
		t.Fatalf("cross-region login changed the source: result=%v, region=%d", result, util.CurrentCloudRegion)
	}
	if err = DeactivateUser(); err == nil {
		t.Fatal("account deactivation accepted despite undownloaded data")
	}
	if err = os.Rename(assetDownloadStatePath(), assetDownloadStatePath()+".saved"); err != nil {
		t.Fatal(err)
	}
	if err = validateCloudUserAssetSource(owner); !IsCloudAssetSourceChange(err) {
		t.Fatalf("missing asset state was accepted during authentication: %v", err)
	}
	result = Login("different-owner", "unused-password", "", 1)
	if result.Code == 0 || Conf.CloudRegion != 0 || util.CurrentCloudRegion != 0 {
		t.Fatalf("cross-region login discarded a source with missing state: %v", result)
	}
	if _, err = os.Stat(filepath.Join(util.RepoDir, "asset-downloads-v1")); err != nil {
		t.Fatalf("missing-state protection removed the repository marker: %v", err)
	}
}
