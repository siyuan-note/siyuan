package model

import (
	"fmt"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLANSyncScopeS3IdentityAndCompatibility(t *testing.T) {
	prepareSyncDirectoryTest(t)
	Conf.Sync.S3.Endpoint = "https://storage.example.com"
	legacyScope := "v1:2:notes.backup:https://storage.example.com:notes.backup:us-east-1"
	for _, name := range []string{"main", "work", "notes.backup", ""} {
		Conf.Sync.CloudName = name
		if got := lanSyncScope(); got != legacyScope {
			t.Fatalf("S3 scope depends on directory %q or breaks bucket-named peers: %q", name, got)
		}
	}
	originalS3 := *Conf.Sync.S3
	for _, field := range []*string{&Conf.Sync.S3.Endpoint, &Conf.Sync.S3.Bucket, &Conf.Sync.S3.Region} {
		*field += "-other"
		if lanSyncScope() == legacyScope {
			t.Fatal("different S3 repositories share a LAN scope")
		}
		*Conf.Sync.S3 = originalS3
	}
	Conf.Sync.S3.AccessKey, Conf.Sync.S3.SecretKey = "rotated-key", "rotated-secret"
	Conf.Sync.S3.Timeout = 60
	if lanSyncScope() != legacyScope {
		t.Fatal("connection settings changed the LAN scope")
	}
	Conf.Sync.S3 = nil
	if got := lanSyncScope(); got != "v1:2:" {
		t.Fatalf("unconfigured S3 depends on a directory: %q", got)
	}
}

func TestLANSyncScopePreservesOtherProviders(t *testing.T) {
	prepareSyncDirectoryTest(t)
	Conf.SetUser(&conf.User{UserId: "scope-user"})
	Conf.Sync.WebDAV = &conf.WebDAV{Endpoint: "https://dav.example.com"}
	Conf.Sync.Local = &conf.Local{Endpoint: "local-sync"}
	for _, tc := range []struct {
		provider int
		suffix   string
	}{
		{conf.ProviderSiYuan, fmt.Sprintf("%d:scope-user", util.CurrentCloudRegion)},
		{conf.ProviderWebDAV, "https://dav.example.com"},
		{conf.ProviderLocal, "local-sync"},
	} {
		Conf.Sync.Provider = tc.provider
		for _, name := range []string{"main", "work"} {
			Conf.Sync.CloudName = name
			want := fmt.Sprintf("v1:%d:%s:%s", tc.provider, name, tc.suffix)
			if got := lanSyncScope(); got != want {
				t.Fatalf("provider %d scope changed: got %q, want %q", tc.provider, got, want)
			}
		}
	}
}
