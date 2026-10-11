package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestThirdPartySyncAddressValidation(t *testing.T) {
	for _, provider := range []int{conf.ProviderWebDAV, conf.ProviderLocal} {
		t.Run(conf.ProviderToStr(provider), func(t *testing.T) {
			prepareSyncDirectoryTest(t)
			Conf.Sync.Load().Provider, Conf.Sync.Load().Enabled = provider, true
			Conf.Sync.Load().WebDAV = &conf.WebDAV{Endpoint: "https://dav.example", Username: "old", Password: "secret"}
			Conf.Sync.Load().Local = &conf.Local{Endpoint: t.TempDir()}
			Conf.Save()
			configPath := filepath.Join(util.ConfDir, "conf.json")
			before, err := os.ReadFile(configPath)
			if err != nil {
				t.Fatal(err)
			}
			oldDAV, oldLocal := Conf.Sync.Load().WebDAV, Conf.Sync.Load().Local
			values := []string{"", " \t\n "}
			if provider == conf.ProviderWebDAV {
				values = append(values, "https://", "ftp://dav.example", "https://bad host/")
			}
			for _, value := range values {
				if provider == conf.ProviderWebDAV {
					err = SetSyncProviderWebDAV(&conf.WebDAV{Endpoint: value})
				} else {
					err = SetSyncProviderLocal(&conf.Local{Endpoint: value})
				}
				if err == nil || !Conf.Sync.Load().Enabled || Conf.Sync.Load().WebDAV != oldDAV || Conf.Sync.Load().Local != oldLocal {
					t.Fatalf("invalid %s address %q changed configuration: %v", conf.ProviderToStr(provider), value, err)
				}
				after, readErr := os.ReadFile(configPath)
				if readErr != nil || !bytes.Equal(before, after) {
					t.Fatal("rejected address changed persisted configuration")
				}
			}
			Conf.Sync.Load().WebDAV, Conf.Sync.Load().Local = &conf.WebDAV{}, &conf.Local{}
			if _, err = newCloudRepositoryWithAssetSourceLocked(); err == nil {
				t.Fatal("cloud operations accepted an existing empty address")
			}
			if _, err = newSyncRepositoryWithAssetSourceLocked(); err == nil || !Conf.Sync.Load().Enabled {
				t.Fatal("sync validation failed to preserve the enabled flag")
			}
			if _, err = newRepository(); err != nil {
				t.Fatalf("empty cloud configuration blocked local snapshots: %v", err)
			}
		})
	}
}

func TestThirdPartySyncAddressCompatibility(t *testing.T) {
	prepareSyncDirectoryTest(t)
	for _, endpoint := range []string{"https://dav.example/path", "http://localhost:9000/dav", "dav.example/path", "http(s)://dav.example/path"} {
		candidate := &conf.WebDAV{Endpoint: " " + endpoint + " ", Username: "", Password: ""}
		if err := SetSyncProviderWebDAV(candidate); err != nil {
			t.Fatalf("anonymous WebDAV address %q was rejected: %v", endpoint, err)
		}
		if Conf.Sync.Load().WebDAV.Endpoint != util.NormalizeEndpoint(endpoint) || Conf.Sync.Load().WebDAV.Username != "" || Conf.Sync.Load().WebDAV.Password != "" {
			t.Fatal("anonymous access or endpoint normalization changed")
		}
	}
	if err := SetSyncProviderLocal(&conf.Local{Endpoint: t.TempDir()}); err != nil {
		t.Fatalf("valid local directory was rejected: %v", err)
	}
	if err := SetSyncProviderWebDAV(nil); err == nil {
		t.Fatal("nil WebDAV configuration was accepted")
	}
	if err := SetSyncProviderLocal(nil); err == nil {
		t.Fatal("nil local configuration was accepted")
	}
}
