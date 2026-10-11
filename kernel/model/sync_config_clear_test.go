package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func prepareSyncConfigClearTest(t *testing.T) {
	t.Helper()
	previous, readOnly := Conf, util.ReadOnly
	confDir, dataDir, repoDir := util.ConfDir, util.DataDir, util.RepoDir
	t.Cleanup(func() {
		Conf, util.ReadOnly = previous, readOnly
		util.ConfDir, util.DataDir, util.RepoDir = confDir, dataDir, repoDir
	})
	root := t.TempDir()
	util.ConfDir, util.DataDir, util.RepoDir = root, filepath.Join(root, "data"), filepath.Join(root, "repo")
	util.ReadOnly = false
	Conf = NewAppConf()
	{
		confSectionValue0, confSectionValue1 := conf.NewSync(), conf.NewRepo()
		Conf.Sync.Store(confSectionValue0)
		Conf.Repo.Store(confSectionValue1)
	}
	Conf.Sync.Load().S3 = &conf.S3{Endpoint: "https://s3.example", AccessKey: "access", SecretKey: "secret", Bucket: "notes", Region: "auto"}
	Conf.Sync.Load().WebDAV = &conf.WebDAV{Endpoint: "https://dav.example", Username: "name", Password: "password"}
	Conf.Sync.Load().Local = &conf.Local{Endpoint: filepath.Join(root, "cloud")}
	Conf.Repo.Load().Key = []byte("0123456789abcdef0123456789abcdef")
	Conf.Sync.Load().Enabled = true
	Conf.Sync.Load().AssetDownloadMode = 1
	// 与启动加载一致，测试配置先经过规范化
	Conf.Sync.Store(conf.NormalizeSync(Conf.Sync.Load()))
	Conf.Save()
}

func TestClearSyncProviderConfiguration(t *testing.T) {
	for _, provider := range []int{conf.ProviderS3, conf.ProviderWebDAV, conf.ProviderLocal} {
		for _, active := range []bool{true, false} {
			t.Run(conf.ProviderToStr(provider)+"/active="+map[bool]string{true: "true", false: "false"}[active], func(t *testing.T) {
				prepareSyncConfigClearTest(t)
				if active {
					Conf.Sync.Load().Provider = provider
				}
				old := *Conf.Sync.Load()
				key := append([]byte(nil), Conf.Repo.Load().Key...)
				if err := ClearSyncProviderConfig(provider); err != nil {
					t.Fatal(err)
				}
				if Conf.Sync.Load().Enabled == active || Conf.Sync.Load().Provider != old.Provider || Conf.Sync.Load().AssetDownloadMode != 1 || !reflect.DeepEqual(Conf.Repo.Load().Key, key) {
					t.Fatal("clear changed unrelated preferences or failed to disable the current service")
				}
				if provider == conf.ProviderS3 {
					if Conf.Sync.Load().S3.Endpoint != "" || Conf.Sync.Load().S3.AccessKey != "" || Conf.Sync.Load().S3.SecretKey != "" || Conf.Sync.Load().S3.Bucket != "" || Conf.Sync.Load().S3.Region != "" || Conf.Sync.Load().S3.Timeout < 7 {
						t.Fatal("S3 configuration was not cleared")
					}
				} else if !reflect.DeepEqual(Conf.Sync.Load().S3, old.S3) {
					t.Fatal("unrelated S3 configuration changed")
				}
				if provider == conf.ProviderWebDAV {
					if Conf.Sync.Load().WebDAV.Endpoint != "" || Conf.Sync.Load().WebDAV.Username != "" || Conf.Sync.Load().WebDAV.Password != "" || Conf.Sync.Load().WebDAV.Timeout < 7 {
						t.Fatal("WebDAV configuration was not cleared")
					}
				} else if !reflect.DeepEqual(Conf.Sync.Load().WebDAV, old.WebDAV) {
					t.Fatal("unrelated WebDAV configuration changed")
				}
				if provider == conf.ProviderLocal {
					if Conf.Sync.Load().Local.Endpoint != "" || Conf.Sync.Load().Local.Timeout < 7 {
						t.Fatal("local configuration was not cleared")
					}
				} else if !reflect.DeepEqual(Conf.Sync.Load().Local, old.Local) {
					t.Fatal("unrelated local configuration changed")
				}
				data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
				if err != nil {
					t.Fatal(err)
				}
				var saved AppConf
				if err = json.Unmarshal(data, &saved); err != nil || !reflect.DeepEqual(saved.Sync.Load(), Conf.Sync.Load()) {
					t.Fatalf("cleared configuration was not persisted: %v", err)
				}
			})
		}
	}
}

func TestClearSyncProviderConfigurationFailure(t *testing.T) {
	prepareSyncConfigClearTest(t)
	Conf.Sync.Load().Provider = conf.ProviderS3
	previous := Conf.Sync.Load()
	for _, provider := range []int{-1, 0, 1, 5} {
		if err := ClearSyncProviderConfig(provider); err == nil || Conf.Sync.Load() != previous {
			t.Fatal("invalid provider changed configuration")
		}
	}
	util.ReadOnly = true
	if err := ClearSyncProviderConfig(conf.ProviderS3); err == nil || Conf.Sync.Load() != previous {
		t.Fatal("readonly clear changed configuration")
	}
	util.ReadOnly = false
	if err := os.Remove(filepath.Join(util.ConfDir, "conf.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(util.ConfDir, "conf.json"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := ClearSyncProviderConfig(conf.ProviderS3); err == nil || Conf.Sync.Load() != previous || !Conf.Sync.Load().Enabled {
		t.Fatal("failed persistence discarded the active configuration")
	}
}
