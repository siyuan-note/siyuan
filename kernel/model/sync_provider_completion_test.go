package model

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncProviderCompletionPreservesHistory(t *testing.T) {
	for _, mode := range []int{0, 1} {
		t.Run(map[int]string{0: "full", 1: "on-demand"}[mode], func(t *testing.T) {
			full, partial, fullData := prepareAssetDownloadRepoTest(t)
			deferred, err := deferredSyncAssets()
			if err != nil || len(deferred) != 1 {
				t.Fatalf("expected deferred asset: %v %v", deferred, err)
			}
			oldFile := deferred[0]
			p := filepath.Join(fullData, "assets", "file.bin")
			if err = os.WriteFile(p, []byte("second version with different content"), 0644); err != nil {
				t.Fatal(err)
			}
			stamp := time.UnixMilli(oldFile.Updated).Add(2 * time.Second)
			if err = os.Chtimes(p, stamp, stamp); err != nil {
				t.Fatal(err)
			}
			if _, err = full.Index("second version", true, nil); err != nil {
				t.Fatal(err)
			}
			if _, _, err = full.Sync(nil); err != nil {
				t.Fatal(err)
			}
			if _, _, err = partial.Sync(nil); err != nil {
				t.Fatal(err)
			}
			// 保留缺失历史内容的状态，覆盖配置恢复后已经显示全部下载的情况。
			Conf.Sync.AssetDownloadMode = mode
			key := append([]byte(nil), Conf.Repo.Key...)
			if err = SetSyncProvider(conf.ProviderS3, false); err == nil {
				t.Fatal("legacy request unexpectedly downloaded missing content")
			}
			if err = SetSyncProvider(conf.ProviderS3, true); err != nil {
				t.Fatal(err)
			}
			if Conf.Sync.Provider != conf.ProviderS3 || Conf.Sync.AssetDownloadMode != mode || !bytes.Equal(Conf.Repo.Key, key) {
				t.Fatal("completion changed the mode or recovery key")
			}
			if incomplete, err := partial.HasIncompleteSnapshots(); err != nil || incomplete {
				t.Fatalf("incomplete history after switching: %v %v", incomplete, err)
			}
			if data, err := partial.OpenFile(oldFile); err != nil || string(data) != "version one" {
				t.Fatalf("historical version unavailable: %q %v", data, err)
			}
			if data, err := os.ReadFile(filepath.Join(util.DataDir, "assets", "file.bin")); err != nil || string(data) != "second version with different content" {
				t.Fatalf("current asset overwritten: %q %v", data, err)
			}
		})
	}
}

func TestSyncProviderCompletionFailurePreservesSource(t *testing.T) {
	for _, failure := range []string{"offline", "missing-current-chunk", "corrupt-state"} {
		t.Run(failure, func(t *testing.T) {
			prepareAssetDownloadRepoTest(t)
			beforeDeferred, err := deferredSyncAssets()
			if err != nil {
				t.Fatal(err)
			}
			if failure == "offline" {
				Conf.Sync.Enabled = false
			} else if failure == "missing-current-chunk" {
				files, err := deferredSyncAssets()
				if err != nil || len(files) != 1 {
					t.Fatalf("expected deferred asset: %v %v", files, err)
				}
				chunk := files[0].Chunks[0]
				if err = os.Remove(filepath.Join(Conf.Sync.Local.Endpoint, "main", "objects", chunk[:2], chunk[2:])); err != nil {
					t.Fatal(err)
				}
			} else {
				state, err := os.ReadFile(assetDownloadStatePath())
				if err != nil {
					t.Fatal(err)
				}
				state[len(state)-1] ^= 1
				if err = os.WriteFile(assetDownloadStatePath(), state, 0600); err != nil {
					t.Fatal(err)
				}
			}
			state, err := os.ReadFile(assetDownloadStatePath())
			if err != nil {
				t.Fatal(err)
			}
			key := append([]byte(nil), Conf.Repo.Key...)
			if err = SetSyncProvider(conf.ProviderS3, true); err == nil {
				t.Fatal("failed completion allowed source change")
			}
			if Conf.Sync.Provider != conf.ProviderLocal || Conf.Sync.AssetDownloadMode != 1 || !bytes.Equal(Conf.Repo.Key, key) {
				t.Fatal("failed completion changed source, mode or key")
			}
			remaining, err := os.ReadFile(assetDownloadStatePath())
			if err != nil || failure == "corrupt-state" && !bytes.Equal(state, remaining) {
				t.Fatal("failed completion discarded recovery state")
			}
			if failure != "corrupt-state" {
				afterDeferred, err := deferredSyncAssets()
				if err != nil || !reflect.DeepEqual(beforeDeferred, afterDeferred) {
					t.Fatal("failed completion changed authenticated deferred assets")
				}
			}
		})
	}
}

func TestSyncProviderCompletionHistoricalDocument(t *testing.T) {
	for _, available := range []bool{true, false} {
		t.Run(map[bool]string{true: "available", false: "missing-from-cloud"}[available], func(t *testing.T) {
			full, _, fullData := prepareAssetDownloadRepoTest(t)
			if err := SetSyncAssetDownloadMode(0); err != nil {
				t.Fatal(err)
			}
			repo, err := newRepository()
			if err != nil {
				t.Fatal(err)
			}
			var oldFile *entity.File
			for i, content := range []string{"historical document contents", "current document contents are different"} {
				p := filepath.Join(fullData, "history.txt")
				if err = os.WriteFile(p, []byte(content), 0644); err != nil {
					t.Fatal(err)
				}
				stamp := time.Now().Add(time.Duration(i+1) * time.Minute)
				if err = os.Chtimes(p, stamp, stamp); err != nil {
					t.Fatal(err)
				}
				index, err := full.Index("document version", true, nil)
				if err != nil {
					t.Fatal(err)
				}
				if i == 0 {
					files, err := full.GetFiles(index)
					if err != nil {
						t.Fatal(err)
					}
					for _, file := range files {
						if file.Path == "/history.txt" {
							oldFile = file
						}
					}
				}
				if _, _, err = full.Sync(nil); err != nil {
					t.Fatal(err)
				}
				if _, err = repo.Index("before sync", true, nil); err != nil {
					t.Fatal(err)
				}
				if _, _, err = repo.Sync(nil); err != nil {
					t.Fatal(err)
				}
			}
			if oldFile == nil {
				t.Fatal("historical document not found")
			}
			chunk := oldFile.Chunks[0]
			if err = os.Remove(filepath.Join(util.RepoDir, "objects", chunk[:2], chunk[2:])); err != nil {
				t.Fatal(err)
			}
			if !available {
				if err = os.Remove(filepath.Join(Conf.Sync.Local.Endpoint, "main", "objects", chunk[:2], chunk[2:])); err != nil {
					t.Fatal(err)
				}
			}
			if files, err := deferredSyncAssets(); err != nil || len(files) != 0 {
				t.Fatalf("unexpected deferred resources: %v %v", files, err)
			}
			if err = SetSyncProvider(conf.ProviderS3, true); (err == nil) != available {
				t.Fatalf("unexpected historical completion result: %v", err)
			}
			provider := conf.ProviderLocal
			if available {
				provider = conf.ProviderS3
				if data, err := repo.OpenFile(oldFile); err != nil || string(data) != "historical document contents" {
					t.Fatalf("historical document unavailable: %q %v", data, err)
				}
			}
			if Conf.Sync.Provider != provider || Conf.Sync.AssetDownloadMode != 0 {
				t.Fatal("unexpected provider or download mode")
			}
			if data, err := os.ReadFile(filepath.Join(util.DataDir, "history.txt")); err != nil || string(data) != "current document contents are different" {
				t.Fatalf("current document overwritten: %q %v", data, err)
			}
		})
	}
}

func TestSyncProviderCompletionOfflineCompleteRepo(t *testing.T) {
	_, partial, _ := prepareAssetDownloadRepoTest(t)
	if err := SetSyncAssetDownloadMode(0); err != nil {
		t.Fatal(err)
	}
	Conf.Sync.Enabled = false
	if err := SetSyncProvider(conf.ProviderS3, true); err != nil {
		t.Fatalf("complete repository should switch without cloud access: %v", err)
	}
	if incomplete, err := partial.HasIncompleteSnapshots(); err != nil || incomplete {
		t.Fatalf("complete repository changed: %v %v", incomplete, err)
	}
}
