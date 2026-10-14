package model

import (
	"fmt"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLANSyncScopeS3IdentityAndCompatibility(t *testing.T) {
	prepareSyncDirectoryTest(t)
	Conf.Sync.Load().S3.Endpoint = "https://storage.example.com"
	legacyScope := "v1:2:notes.backup:https://storage.example.com:notes.backup:us-east-1"
	for _, name := range []string{"main", "work", "notes.backup", ""} {
		Conf.Sync.Load().CloudName = name
		if got := lanSyncScope(); got != legacyScope {
			t.Fatalf("S3 scope depends on directory %q or breaks bucket-named peers: %q", name, got)
		}
	}
	originalS3 := *Conf.Sync.Load().S3
	for _, field := range []*string{&Conf.Sync.Load().S3.Endpoint, &Conf.Sync.Load().S3.Bucket, &Conf.Sync.Load().S3.Region} {
		*field += "-other"
		if lanSyncScope() == legacyScope {
			t.Fatal("different S3 repositories share a LAN scope")
		}
		*Conf.Sync.Load().S3 = originalS3
	}
	Conf.Sync.Load().S3.AccessKey, Conf.Sync.Load().S3.SecretKey = "rotated-key", "rotated-secret"
	Conf.Sync.Load().S3.Timeout = 60
	if lanSyncScope() != legacyScope {
		t.Fatal("connection settings changed the LAN scope")
	}
	Conf.Sync.Load().S3 = nil
	if got := lanSyncScope(); got != "v1:2:" {
		t.Fatalf("unconfigured S3 depends on a directory: %q", got)
	}
}

func TestLANSyncScopePreservesOtherProviders(t *testing.T) {
	prepareSyncDirectoryTest(t)
	Conf.SetUser(&conf.User{UserId: "scope-user"})
	Conf.Sync.Load().WebDAV = &conf.WebDAV{Endpoint: "https://dav.example.com"}
	Conf.Sync.Load().Local = &conf.Local{Endpoint: "local-sync"}
	for _, tc := range []struct {
		provider int
		suffix   string
	}{
		{conf.ProviderSiYuan, fmt.Sprintf("%d:scope-user", util.CurrentCloudRegion)},
		{conf.ProviderWebDAV, "https://dav.example.com"},
		{conf.ProviderLocal, "local-sync"},
	} {
		Conf.Sync.Load().Provider = tc.provider
		for _, name := range []string{"main", "work"} {
			Conf.Sync.Load().CloudName = name
			want := fmt.Sprintf("v1:%d:%s:%s", tc.provider, name, tc.suffix)
			if got := lanSyncScope(); got != want {
				t.Fatalf("provider %d scope changed: got %q, want %q", tc.provider, got, want)
			}
		}
	}
}
