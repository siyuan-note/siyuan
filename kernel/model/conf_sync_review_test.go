package model

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestConfSyncPatchValidatesRawAddressesAndPreservesRejectedState(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	util.ReadOnly = true
	for _, patch := range []string{
		`{"webdav":{"endpoint":""}}`, `{"webdav":{"endpoint":"ftp://dav.example"}}`,
		`{"webdav":{"endpoint":"https://"}}`, `{"local":{"endpoint":" \t "}}`,
		`{"local":{"endpoint":"` + strings.ReplaceAll(util.DataDir, `\`, `/`) + `"}}`,
	} {
		held, revision := Conf.Sync.Load(), ConfNamespaceRevision("sync")
		if _, err := ApplySyncSettingPatch([]byte(patch)); err == nil {
			t.Fatalf("invalid address was accepted: %s", patch)
		}
		if Conf.Sync.Load() != held || ConfNamespaceRevision("sync") != revision {
			t.Fatal("rejected patch replaced its snapshot or sent a notification")
		}
	}
	if _, err := ApplySyncSettingPatch([]byte(`{"webdav":{"endpoint":"dav.example","username":"","password":""}}`)); err != nil {
		t.Fatal(err)
	}
	if Conf.Sync.Load().WebDAV.Endpoint != util.NormalizeEndpoint("dav.example") {
		t.Fatal("anonymous WebDAV address was not normalized")
	}
}

func TestConfSyncPatchSchedulesTheNormalizedInterval(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	util.ReadOnly = true
	UpdateSyncConf(func(value *conf.Sync) { value.Interval = 60 })
	syncPlanTimeLock.Lock()
	previous := syncPlanTime
	syncPlanTimeLock.Unlock()
	t.Cleanup(func() {
		syncPlanTimeLock.Lock()
		syncPlanTime = previous
		syncPlanTimeLock.Unlock()
	})
	if _, err := ApplySyncSettingPatch([]byte(`{"interval":1}`)); err != nil {
		t.Fatal(err)
	}
	syncPlanTimeLock.Lock()
	delay := time.Until(syncPlanTime)
	syncPlanTimeLock.Unlock()
	if Conf.Sync.Load().Interval != 30 || delay < 28*time.Second || delay > 31*time.Second {
		t.Fatalf("sync timer disagrees with stored interval: %d, %s", Conf.Sync.Load().Interval, delay)
	}
}

func TestConfSyncProviderSettersKeepHeldInputsImmutable(t *testing.T) {
	prepareConfConsistencyTest(t)
	normalizeAppConf(Conf)
	util.ReadOnly = true
	input := cloneConfSection(Conf.Sync.Load())
	input.S3 = &conf.S3{Endpoint: "s3.example", AccessKey: " key ", SecretKey: " secret ", Bucket: " bucket ", Region: " region "}
	input.WebDAV = &conf.WebDAV{Endpoint: "dav.example", Username: " user ", Password: " password "}
	input.Local = &conf.Local{Endpoint: t.TempDir()}
	Conf.Sync.Store(input)
	before, _ := json.Marshal(input)
	for _, err := range []error{SetSyncProviderS3(input.S3), SetSyncProviderWebDAV(input.WebDAV), SetSyncProviderLocal(input.Local)} {
		if err != nil {
			t.Fatal(err)
		}
	}
	after, _ := json.Marshal(input)
	if !bytes.Equal(before, after) {
		t.Fatal("provider setters mutated their held input snapshot")
	}
}
