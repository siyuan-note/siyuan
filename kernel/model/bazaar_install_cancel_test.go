package model

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLocalBazaarInstallCancellationWhileWaitingForModelLock(t *testing.T) {
	setupBoundInstallModel(t)
	archive, hash := writeBoundInstallArchive(t, "new")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := localBazaarInstallLock.Acquire(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	defer localBazaarInstallLock.Release(1)
	afterExtraction := make(chan struct{})
	checks := 0
	done := make(chan error, 1)
	go func() {
		_, err := InstallLocalBazaarPackageWithOptions(archive, "", true, LocalBazaarInstallOptions{
			Context: ctx, ExpectedPackageHash: hash, ExpectedInstalledRevision: bazaar.MissingInstalledRevision,
			Recheck: func() error {
				checks++
				if checks == 2 {
					close(afterExtraction)
				}
				return nil
			},
		})
		done <- err
	}()
	select {
	case <-afterExtraction:
	case <-time.After(5 * time.Second):
		t.Fatal("installation did not reach the model lock")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("canceled installation kept waiting for the model lock")
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, "plugins", "sample")); !os.IsNotExist(err) {
		t.Fatal("canceled installation created target", err)
	}
}

func TestLocalBazaarInstallKeepsCommittedResultAfterCancellation(t *testing.T) {
	setupBoundInstallModel(t)
	archive, hash := writeBoundInstallArchive(t, "new")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	previous := pushBazaarChanged
	pushBazaarChanged = func(string) { cancel() }
	t.Cleanup(func() { pushBazaarChanged = previous })
	result, err := InstallLocalBazaarPackageWithOptions(archive, "", true, LocalBazaarInstallOptions{
		Context: ctx, ExpectedPackageHash: hash, ExpectedInstalledRevision: bazaar.MissingInstalledRevision,
	})
	if err != nil || result == nil || result.InstalledRevision == "" || ctx.Err() == nil {
		t.Fatalf("committed installation reported as canceled: %+v, %v", result, err)
	}
	if data, err := os.ReadFile(filepath.Join(util.DataDir, "plugins", "sample", "index.js")); err != nil || string(data) != "new" {
		t.Fatal("committed installation missing", err)
	}
}
