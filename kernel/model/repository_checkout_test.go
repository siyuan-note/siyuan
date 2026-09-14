package model

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu"
)

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
