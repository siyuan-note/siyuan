package model

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func prepareSyncDirectoryTest(t *testing.T) {
	t.Helper()
	originalConf := Conf
	originalData, originalRepo, originalConfDir := util.DataDir, util.RepoDir, util.ConfDir
	originalHistory, originalTemp := util.HistoryDir, util.TempDir
	t.Cleanup(func() {
		Conf = originalConf
		util.DataDir, util.RepoDir, util.ConfDir = originalData, originalRepo, originalConfDir
		util.HistoryDir, util.TempDir = originalHistory, originalTemp
	})
	base := t.TempDir()
	util.DataDir, util.RepoDir, util.ConfDir = filepath.Join(base, "data"), filepath.Join(base, "repo"), filepath.Join(base, "conf")
	util.HistoryDir, util.TempDir = filepath.Join(base, "history"), filepath.Join(base, "temp")
	if err := os.MkdirAll(util.ConfDir, 0755); err != nil {
		t.Fatal(err)
	}
	Conf = NewAppConf()
	Conf.Sync, Conf.Repo, Conf.System = conf.NewSync(), conf.NewRepo(), conf.NewSystem()
	Conf.Sync.Provider = conf.ProviderS3
	Conf.Sync.S3 = &conf.S3{Bucket: "notes.backup", Region: "us-east-1", Timeout: 5, PathStyle: true,
		AccessKey: "test-key", SecretKey: "test-secret"}
	Conf.Repo.Key = []byte("0123456789abcdef0123456789abcdef")
}

func TestS3DirectoryListingPreservesConfiguration(t *testing.T) {
	for _, name := range []string{"work", "notes.backup", ""} {
		for _, result := range []string{"matched", "unmatched", "empty", "denied"} {
			t.Run(name+"/"+result, func(t *testing.T) {
				prepareSyncDirectoryTest(t)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method != http.MethodGet || r.URL.Path != "/" {
						t.Errorf("unexpected S3 request: %s %s", r.Method, r.URL.Path)
					}
					w.Header().Set("Content-Type", "application/xml")
					if result == "denied" {
						w.WriteHeader(http.StatusForbidden)
						fmt.Fprint(w, `<Error><Code>AccessDenied</Code><Message>Denied</Message></Error>`)
						return
					}
					bucket := ""
					if result == "matched" || result == "unmatched" {
						bucketName := "notes.backup"
						if result == "unmatched" {
							bucketName = "another-bucket"
						}
						bucket = fmt.Sprintf(`<Bucket><Name>%s</Name><CreationDate>2026-01-01T00:00:00Z</CreationDate></Bucket>`, bucketName)
					}
					fmt.Fprintf(w, `<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Buckets>%s</Buckets></ListAllMyBucketsResult>`, bucket)
				}))
				defer server.Close()
				Conf.Sync.S3.Endpoint, Conf.Sync.CloudName = server.URL, name
				Conf.Save()
				confPath := filepath.Join(util.ConfDir, "conf.json")
				before, err := os.ReadFile(confPath)
				if err != nil {
					t.Fatal(err)
				}
				scope := lanSyncScope()
				dirs, _, err := ListCloudSyncDir()
				if (err != nil) != (result == "denied") {
					t.Fatalf("unexpected listing error: %v", err)
				}
				if result == "matched" {
					if len(dirs) != 1 || dirs[0].CloudName != "notes.backup" {
						t.Fatalf("expected the configured bucket: %+v", dirs)
					}
				} else if len(dirs) != 0 {
					t.Fatalf("unexpected fallback directory: %+v", dirs)
				}
				after, err := os.ReadFile(confPath)
				if err != nil || !bytes.Equal(before, after) || Conf.Sync.CloudName != name || lanSyncScope() != scope {
					t.Fatalf("listing changed configuration or LAN scope: name=%q, err=%v", Conf.Sync.CloudName, err)
				}
				if name == "work" && result == "matched" {
					for _, provider := range []int{conf.ProviderSiYuan, conf.ProviderLocal, conf.ProviderWebDAV} {
						if err = SetSyncProvider(provider); err != nil || Conf.Sync.CloudName != name {
							t.Fatalf("provider %d did not retain the chosen directory: %v", provider, err)
						}
					}
				}
			})
		}
	}
}

func TestS3DirectorySelectionIsRejected(t *testing.T) {
	prepareSyncDirectoryTest(t)
	Conf.Sync.CloudName = "work"
	Conf.Save()
	confPath := filepath.Join(util.ConfDir, "conf.json")
	before, err := os.ReadFile(confPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"another-bucket", "work", ""} {
		if err = SetCloudSyncDir(name); err == nil {
			t.Fatalf("S3 directory selection accepted %q", name)
		}
	}
	after, err := os.ReadFile(confPath)
	if err != nil || !bytes.Equal(before, after) || Conf.Sync.CloudName != "work" {
		t.Fatalf("rejected selection changed configuration: %v", err)
	}
	for _, provider := range []int{conf.ProviderSiYuan, conf.ProviderLocal, conf.ProviderWebDAV} {
		Conf.Sync.Provider = provider
		name := fmt.Sprintf("chosen-%d", provider)
		if err = SetCloudSyncDir(name); err != nil || Conf.Sync.CloudName != name {
			t.Fatalf("provider %d cannot select a directory: %v", provider, err)
		}
	}
}

func TestS3SyncIgnoresDirectoryValidation(t *testing.T) {
	prepareSyncDirectoryTest(t)
	Conf.Sync.Enabled = true
	Conf.SetUser(&conf.User{UserId: "sync-test", UserSiYuanOneTimePayStatus: 1})
	for _, name := range []string{"notes.backup", ""} {
		Conf.Sync.CloudName = name
		if !checkSync(false, false, true) {
			t.Fatalf("S3 sync rejected an unused directory name: %q", name)
		}
		Conf.Sync.Provider = conf.ProviderWebDAV
		if checkSync(false, false, false) {
			t.Fatalf("WebDAV sync accepted an invalid directory: %q", name)
		}
		Conf.Sync.Provider = conf.ProviderS3
	}
}
