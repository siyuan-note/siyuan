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
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCheckoutRepoSnapshotBacksUpPreservedAttributes(t *testing.T) {
	for _, scope := range []string{"repository", "file"} {
		t.Run(scope, func(t *testing.T) {
			_, repo, _ := prepareAssetDownloadRepoTest(t)
			file := filepath.Join(util.DataDir, "assets", "probe.txt")
			if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
				t.Fatal(err)
			}
			stamp := time.Unix(1700000100, 100000000)
			write := func(content string) {
				t.Helper()
				if err := os.WriteFile(file, []byte(content), 0644); err != nil {
					t.Fatal(err)
				}
				if err := os.Chtimes(file, stamp, stamp); err != nil {
					t.Fatal(err)
				}
			}
			write("before")
			id, _, err := CreateRepoSnapshot("original")
			if err != nil {
				t.Fatal(err)
			}
			original, err := repo.GetIndex(id)
			if err != nil {
				t.Fatal(err)
			}
			files, err := repo.GetFiles(original)
			if err != nil {
				t.Fatal(err)
			}
			write("AFTER!")
			if scope == "repository" {
				err = checkoutRepoSnapshot(repo, id, func(error) {})
			} else {
				fileID := ""
				for _, item := range files {
					if item.Path == "/assets/probe.txt" {
						fileID = item.ID
					}
				}
				if fileID == "" {
					t.Fatal("original asset missing")
				}
				err = RollbackRepoSnapshotFile(fileID)
			}
			if err != nil {
				t.Fatal(err)
			}
			backup, err := repo.Latest()
			if err != nil || backup.ID == id || backup.Memo != "Backup before checkout" {
				t.Fatalf("current content was not backed up: %v %v", backup, err)
			}
			if content := repoSnapshotTestContent(t, repo, backup.ID, "/assets/probe.txt"); content != "AFTER!" {
				t.Fatalf("backup omitted overwritten content: %q", content)
			}
			if content, readErr := os.ReadFile(file); readErr != nil || string(content) != "before" {
				t.Fatalf("snapshot was not restored: %q %v", content, readErr)
			}
		})
	}
}

func TestRepositoryCheckoutSavesEditorsBeforeBackup(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	file := filepath.Join(util.DataDir, "seed.txt")
	if err := os.WriteFile(file, []byte("snapshot"), 0644); err != nil {
		t.Fatal(err)
	}
	id, _, err := CreateRepoSnapshotWithFullCheck("original", true)
	if err != nil {
		t.Fatal(err)
	}
	first, second := connectSyncCheckoutClient(t, "restore-first"), connectSyncCheckoutClient(t, "restore-second")
	type result struct {
		task *syncCheckoutTask
		err  error
	}
	done := make(chan result, 1)
	go func() { task, err := prepareRepoCheckout(repo); done <- result{task, err} }()
	readPreparing := func(connection interface{ ReadJSON(any) error }) string {
		t.Helper()
		for {
			var message struct {
				Cmd  string
				Data struct{ Phase, Token string }
			}
			if err := connection.ReadJSON(&message); err != nil {
				t.Fatal(err)
			}
			if message.Data.Phase == "preparing" {
				return message.Data.Token
			}
		}
	}
	_ = first.SetReadDeadline(time.Now().Add(5 * time.Second))
	_ = second.SetReadDeadline(time.Now().Add(5 * time.Second))
	a, b := readPreparing(first), readPreparing(second)
	state := GetSyncCheckout("checkout-test", "restore-first").Task
	if !ConfirmSyncCheckout(state.TaskID, a, true) {
		t.Fatal("first editor confirmation rejected")
	}
	select {
	case <-done:
		t.Fatal("restoration proceeded before the second editor saved")
	default:
	}
	// The second window's save must be included in the pre-restore backup.
	if err = os.WriteFile(file, []byte("saved pending edit"), 0644); err != nil {
		t.Fatal(err)
	}
	if !ConfirmSyncCheckout(state.TaskID, b, true) {
		t.Fatal("second editor confirmation rejected")
	}
	var prepared result
	select {
	case prepared = <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("restore preparation blocked")
	}
	if prepared.err != nil {
		t.Fatal(prepared.err)
	}
	checkout := prepared.task
	defer func() {
		if checkout != nil {
			checkout.finish(repo, &err)
		}
	}()
	assertGuard := func() {
		t.Helper()
		if flushLock.TryLock() {
			flushLock.Unlock()
			t.Fatal("restore released transaction exclusion")
		}
		if dataImportAccess.TryRLock() {
			dataImportAccess.RUnlock()
			t.Fatal("restore released API write exclusion")
		}
	}
	assertGuard()
	engine := gin.New()
	written := false
	engine.POST("/test-write", func(c *gin.Context) { c.Set(RoleContextKey, RoleAdministrator) }, CheckReadonly,
		func(c *gin.Context) { written = true; c.Status(http.StatusOK) })
	engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/test-write", nil))
	if written {
		t.Fatal("restore admitted a concurrent write")
	}
	err = checkoutRepoSnapshot(repo, id, func(error) { assertGuard() })
	if err != nil {
		t.Fatal(err)
	}
	backup, err := repo.Latest()
	if err != nil {
		t.Fatal(err)
	}
	if content := repoSnapshotTestContent(t, repo, backup.ID, "/seed.txt"); content != "saved pending edit" {
		t.Fatalf("backup omitted an editor's saved input: %q", content)
	}
	if data, err := os.ReadFile(file); err != nil || string(data) != "snapshot" {
		t.Fatalf("snapshot not restored: %q %v", data, err)
	}
	checkout.finish(repo, &err)
	checkout = nil
	if !flushLock.TryLock() {
		t.Fatal("finished restore retained transaction exclusion")
	}
	flushLock.Unlock()
	engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/test-write", nil))
	if !written {
		t.Fatal("finished restore retained write admission guard")
	}
}

func TestRepositoryCheckoutRejectsUnsavedEditor(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	before, err := repo.Latest()
	if err != nil {
		t.Fatal(err)
	}
	connection := connectSyncCheckoutClient(t, "unsaved-restore")
	done := make(chan error, 1)
	go func() { _, err := prepareRepoCheckout(repo); done <- err }()
	var stateID, token string
	for token == "" {
		state := readSyncCheckoutState(t, connection)
		if state.Phase == "preparing" {
			stateID, token = state.TaskID, state.Token
		}
	}
	if !ConfirmSyncCheckout(stateID, token, false) {
		t.Fatal("unsaved confirmation rejected")
	}
	select {
	case err = <-done:
		if !errors.Is(err, dejavu.ErrIndexFileChanged) {
			t.Fatalf("unexpected preparation error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("unsaved editor did not abort restoration")
	}
	after, err := repo.Latest()
	if err != nil || after.ID != before.ID {
		t.Fatalf("failed preparation changed snapshots: %v", err)
	}
	if GetSyncCheckout("", "").Task != nil {
		t.Fatal("failed preparation left an active restore")
	}
	if !dataImportAccess.TryLock() {
		t.Fatal("failed preparation retained write exclusion")
	}
	dataImportAccess.Unlock()
}

func TestCheckoutRepoSnapshotStopsWhenBackupFails(t *testing.T) {
	_, repo, _ := prepareAssetDownloadRepoTest(t)
	id, _, err := CreateRepoSnapshot("original")
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(util.DataDir, "seed.txt")
	if err = os.WriteFile(file, []byte("current"), 0644); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(repo.Path, "refs", "latest"), []byte("invalid"), 0644); err != nil {
		t.Fatal(err)
	}
	refreshed := false
	err = checkoutRepoSnapshot(repo, id, func(error) { refreshed = true })
	if err == nil || refreshed {
		t.Fatalf("checkout continued after backup failure: refreshed=%v err=%v", refreshed, err)
	}
	if content, readErr := os.ReadFile(file); readErr != nil || string(content) != "current" {
		t.Fatalf("failed backup allowed content replacement: %q %v", content, readErr)
	}
}

func TestCheckoutRepoSnapshotRefreshesPartialFailure(t *testing.T) {
	previousConf := Conf
	Conf = &AppConf{Lang: "en"}
	t.Cleanup(func() { Conf = previousConf })
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "partial failure"}[fail], func(t *testing.T) {
			base := t.TempDir()
			dataDir := filepath.Join(base, "data")
			repo, err := dejavu.NewRepo(dataDir, filepath.Join(base, "repo"), filepath.Join(base, "history"),
				filepath.Join(base, "temp"), "device", "device", "windows", []byte("0123456789abcdef0123456789abcdef"), nil, nil)
			if err != nil {
				t.Fatal(err)
			}
			first := filepath.Join(dataDir, "notebook", "first.sy")
			second := filepath.Join(dataDir, "notebook", "nested", "second.sy")
			write := func(name, content string, tick int64) {
				t.Helper()
				if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(name, []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
				stamp := time.Unix(1700000000+tick, 0)
				if err := os.Chtimes(name, stamp, stamp); err != nil {
					t.Fatal(err)
				}
			}
			write(first, "snapshot first", 10)
			write(second, "snapshot second", 10)
			snapshot, err := repo.Index("snapshot", false, nil)
			if err != nil {
				t.Fatal(err)
			}
			write(first, "current first", 20)
			write(second, "current second", 20)
			if fail {
				if err := os.Remove(second); err != nil {
					t.Fatal(err)
				}
				write(filepath.Join(second, "keep"), "occupied", 20)
			}
			var refreshErr error
			calls := 0
			visibleContent := "current first"
			err = checkoutRepoSnapshot(repo, snapshot.ID, func(checkoutErr error) {
				calls++
				refreshErr = checkoutErr
				content, readErr := os.ReadFile(first)
				if readErr != nil {
					t.Fatal(readErr)
				}
				visibleContent = string(content)
			})
			if (err != nil) != fail || !errors.Is(err, refreshErr) {
				t.Fatalf("checkout result was not preserved: returned %v, refreshed %v", err, refreshErr)
			}
			if calls != 1 || visibleContent != "snapshot first" {
				t.Fatalf("partially restored content was not refreshed: calls=%d, content=%q", calls, visibleContent)
			}
			if fail {
				if content, readErr := os.ReadFile(filepath.Join(second, "keep")); readErr != nil || string(content) != "occupied" {
					t.Fatalf("failed destination changed: %q, %v", content, readErr)
				}
				if _, readErr := repo.GetIndex(snapshot.ID); readErr != nil {
					t.Fatalf("recovery snapshot lost: %v", readErr)
				}
			}
		})
	}
}
