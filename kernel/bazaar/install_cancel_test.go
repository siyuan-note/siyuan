package bazaar

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLocalInstallCancellationWhileWaitingForPackageLock(t *testing.T) {
	source, target := useInstallRevisionFixture(t)
	options := installRevisionOptions(target)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	options.Context = ctx
	if err := packageInstallLock.Acquire(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	defer packageInstallLock.Release(1)
	done := make(chan error, 1)
	go func() {
		_, err := replacePackageDirectoryWithOptions(source, target, true, options)
		done <- err
	}()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("canceled installation kept waiting for the package lock")
	}
	if data, err := os.ReadFile(filepath.Join(target, "index.js")); err != nil || string(data) != "old" {
		t.Fatal("canceled installation replaced target", err)
	}
}

func TestLocalInstallCancellationImmediatelyBeforeReplacement(t *testing.T) {
	source, target := useInstallRevisionFixture(t)
	options := installRevisionOptions(target)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	options.Context = ctx
	options.BeforeReplace = func() error { cancel(); return nil }
	if _, err := replacePackageDirectoryWithOptions(source, target, true, options); !errors.Is(err, context.Canceled) {
		t.Fatalf("late cancellation was ignored: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(target, "index.js")); err != nil || string(data) != "old" {
		t.Fatal("late cancellation replaced target", err)
	}
	entries, err := os.ReadDir(filepath.Dir(target))
	if err != nil || len(entries) != 1 {
		t.Fatal("canceled staging directory was retained", entries, err)
	}
}

func TestLocalInstallRechecksApprovalAtReplacement(t *testing.T) {
	source, target := useInstallRevisionFixture(t)
	options := installRevisionOptions(target)
	ready := false
	changed := errors.New("approval is no longer current")
	options.BeforeReplace = func() error { ready = true; return nil }
	options.Recheck = func() error {
		if ready {
			return changed
		}
		return nil
	}
	if _, err := replacePackageDirectoryWithOptions(source, target, true, options); !errors.Is(err, changed) {
		t.Fatalf("approval was not rechecked at replacement: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(target, "index.js")); err != nil || string(data) != "old" {
		t.Fatal("changed approval replaced target", err)
	}
}

type cancelExtractionContext struct {
	context.Context
	checks int
}

func (ctx *cancelExtractionContext) Err() error {
	ctx.checks++
	if ctx.checks >= 4 {
		return context.Canceled
	}
	return nil
}

func TestLocalPackageExtractionObservesCancellationDuringFile(t *testing.T) {
	content := strings.Repeat("code", 32768)
	data := buildInstallPackageArchive(t, map[string]string{"index.js": content})
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	ctx := &cancelExtractionContext{Context: context.Background()}
	destination := t.TempDir()
	if err = extractLocalPackageReaderContext(ctx, reader, destination); !errors.Is(err, context.Canceled) {
		t.Fatalf("extraction ignored cancellation: %v", err)
	}
	info, err := os.Stat(filepath.Join(destination, "index.js"))
	if err != nil || info.Size() <= 0 || info.Size() >= int64(len(content)) {
		t.Fatal("cancellation did not interrupt the file's contents", info, err)
	}
}
