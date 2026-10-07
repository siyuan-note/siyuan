//go:build !windows

package bazaar

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestInstallReadRejectsRegularFileReplacedWithFIFO(t *testing.T) {
	directory := t.TempDir()
	name := filepath.Join(directory, "package.zip")
	if err := os.WriteFile(name, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	expected, err := root.Lstat("package.zip")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(name); err != nil {
		t.Fatal(err)
	}
	if err = unix.Mkfifo(name, 0600); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := readInstallFileAt(root, "package.zip", expected, MaxLocalPackageArchiveSize)
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("replaced FIFO was accepted")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("installer blocked opening a replaced FIFO")
	}
}
