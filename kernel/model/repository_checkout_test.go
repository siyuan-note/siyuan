package model

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

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
