// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/cloud"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncSourcePreviewThroughWriteAdmission(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	if err := repo.EnsureAllAssets(nil); err != nil {
		t.Fatal(err)
	}
	id, _, err := repo.AssetDownloadChanges()
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.AcknowledgeAssetDownloadChanges(id); err != nil {
		t.Fatal(err)
	}
	previousReadonly := util.ReadOnly
	util.ReadOnly = false
	t.Cleanup(func() { util.ReadOnly = previousReadonly })
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(RoleContextKey, RoleAdministrator) }, CheckReadonly)
	engine.POST("/api/sync/setCloudSyncDir", func(c *gin.Context) {
		if err := SetCloudSyncDir("other"); err != nil {
			t.Errorf("source change failed through write admission: %s", err)
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Status(http.StatusNoContent)
	})
	engine.POST("/api/sync/getSyncSourceState", func(c *gin.Context) {
		state, previewErr := GetSyncSourceState()
		if previewErr != nil {
			t.Errorf("preview failed through write admission: %s", previewErr)
			c.Status(http.StatusInternalServerError)
			return
		}
		if state.Source == "" || state.LocalID == "" || state.LocalFiles == 0 || state.Pending || state.CloudID != "" {
			t.Errorf("unexpected empty-source preview: %+v", state)
		}
		c.Status(http.StatusNoContent)
	})
	for _, path := range []string{"/api/sync/setCloudSyncDir", "/api/sync/getSyncSourceState"} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, nil))
		if recorder.Code != http.StatusNoContent {
			t.Fatalf("%s response: %d %s", path, recorder.Code, recorder.Body.String())
		}
	}
	if !dataImportAccess.TryLock() {
		t.Fatal("preview retained write admission after completing")
	}
	dataImportAccess.Unlock()
}

func TestSyncSourceIdentity(t *testing.T) {
	c := &cloud.Conf{Dir: "main", Server: "server", UserID: "user", S3: &cloud.ConfS3{Endpoint: "https://s3", Bucket: "notes"},
		WebDAV: &cloud.ConfWebDAV{Endpoint: "https://dav", Username: "user"}, Local: &cloud.ConfLocal{Endpoint: "/cloud"}}
	for _, provider := range []int{conf.ProviderSiYuan, conf.ProviderS3, conf.ProviderWebDAV, conf.ProviderLocal} {
		before := syncSourceIdentity(provider, c)
		if before != syncSourceIdentity(provider, c) {
			t.Fatal("unstable identity")
		}
		copy := *c
		copy.Dir = "other"
		if (before == syncSourceIdentity(provider, &copy)) != (provider == conf.ProviderS3) {
			t.Fatal("directory identity mismatch")
		}
	}
	before := syncSourceIdentity(conf.ProviderSiYuan, c)
	c.UserID = "other"
	if before == syncSourceIdentity(conf.ProviderSiYuan, c) {
		t.Fatal("account not included")
	}
	before = syncSourceIdentity(conf.ProviderS3, c)
	c.S3.SecretKey, c.S3.AccessKey, c.S3.Timeout = "new", "rotated", 99
	if before != syncSourceIdentity(conf.ProviderS3, c) {
		t.Fatal("credentials or options change source")
	}
}

func TestSyncSourceLegacySwitchBackupAndPreview(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	if err := repo.EnsureAllAssets(nil); err != nil {
		t.Fatal(err)
	}
	id, _, err := repo.AssetDownloadChanges()
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.AcknowledgeAssetDownloadChanges(id); err != nil {
		t.Fatal(err)
	}
	// Simulate a workspace last synchronized by a released version without the binding.
	if err = os.Remove(filepath.Join(repo.Path, "refs", "latest-sync-source")); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, "new.txt"), []byte("local content"), 0644); err != nil {
		t.Fatal(err)
	}
	if err = SetCloudSyncDir("other"); err != nil {
		t.Fatal(err)
	}
	backup, err := repo.Latest()
	if err != nil || backup.Memo != "Backup before changing sync source" {
		t.Fatalf("backup missing: %v %v", backup, err)
	}
	if got := repoSnapshotTestContent(t, repo, backup.ID, "/new.txt"); got != "local content" {
		t.Fatalf("backup content %q", got)
	}
	current, err := newRepository()
	if err != nil {
		t.Fatal(err)
	}
	if changed, err := current.SyncSourceChanged(); err != nil || !changed {
		t.Fatalf("legacy switch not guarded: %v %v", changed, err)
	}
	// Empty targets do not need a decision and must preserve local files.
	state, err := GetSyncSourceState()
	if err != nil || state.Pending {
		t.Fatalf("empty preview: %v %v", state, err)
	}
	if state.Source == "" || state.CloudID != "" {
		t.Fatalf("empty target missing pinned upload: %+v", state)
	}
	emptyContext := newSyncContext()
	if err = applySyncSourceDecision(emptyContext, []SyncSourceDecision{{Source: state.Source, LocalID: state.LocalID}}); err != nil {
		t.Fatal(err)
	}
	if _, err = current.SyncUpload(emptyContext); err != nil {
		t.Fatal(err)
	}
	// Return to the original, older nonempty source.
	if err = SetCloudSyncDir("main"); err != nil {
		t.Fatal(err)
	}
	state, err = GetSyncSourceState()
	if err != nil || !state.Pending || state.LocalFiles != len(backup.Files) || state.UploadFiles != state.LocalFiles-state.CloudFiles || state.RemoveFiles != state.UploadFiles || state.RemoveFiles == 0 || state.OverwriteFiles != 0 {
		t.Fatalf("unexpected preview: %+v %v", state, err)
	}
	current, err = newRepository()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = current.Sync(nil); !errors.Is(err, dejavu.ErrSyncSourceChanged) {
		t.Fatalf("automatic sync not blocked: %v", err)
	}
	context := newSyncContext()
	if err = applySyncSourceDecision(context, []SyncSourceDecision{{Source: "stale", LocalID: state.LocalID, CloudID: state.CloudID}}); !errors.Is(err, dejavu.ErrSyncSourcePreviewChanged) {
		t.Fatalf("stale source accepted: %v", err)
	}
	if err = applySyncSourceDecision(context, []SyncSourceDecision{{Source: state.Source, LocalID: state.LocalID, CloudID: state.CloudID}}); err != nil {
		t.Fatal(err)
	}
	if err = syncRepoUploadWithDecision([]SyncSourceDecision{{Source: state.Source, LocalID: state.LocalID, CloudID: state.CloudID}}); err != nil {
		t.Fatal(err)
	}
	state, err = GetSyncSourceState()
	if err != nil || state.Pending {
		t.Fatalf("successful choice did not clear pending state: %v %v", state, err)
	}
}
