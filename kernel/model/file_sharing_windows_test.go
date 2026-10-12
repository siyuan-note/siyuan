package model

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"golang.org/x/sys/windows"
)

func lockFirstByteForTest(t *testing.T, path string) func() {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !info.Mode().IsRegular() || info.Size() == 0 {
		t.Fatalf("read-lock fixture must be a nonempty regular file: %q", path)
	}
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(ptr, windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	var overlapped windows.Overlapped
	locked := false
	release := func() {
		t.Helper()
		if handle == windows.InvalidHandle {
			return
		}
		var unlockErr error
		if locked {
			unlockErr = windows.UnlockFileEx(handle, 0, 1, 0, &overlapped)
		}
		closeErr := windows.CloseHandle(handle)
		handle = windows.InvalidHandle
		if err := errors.Join(unlockErr, closeErr); err != nil {
			t.Fatalf("release read-lock fixture %q: %v", path, err)
		}
	}
	t.Cleanup(release)
	// 独占首字节阻止其他句柄的实际读取，不依赖打开句柄时的共享检查。
	if err = windows.LockFileEx(handle, windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlapped); err != nil {
		t.Fatal(err)
	}
	locked = true
	_, beforeStatErr := os.ReadFile(path)
	if _, err = os.Stat(path); err != nil {
		t.Fatal(err)
	}
	_, afterStatErr := os.ReadFile(path)
	if !errors.Is(beforeStatErr, windows.ERROR_LOCK_VIOLATION) || !errors.Is(afterStatErr, windows.ERROR_LOCK_VIOLATION) {
		t.Fatalf("byte-range read lock failed: path=%q, go=%s, read before Stat=%v, read after Stat=%v", path, runtime.Version(), beforeStatErr, afterStatErr)
	}
	return release
}

func TestReadLockFixtureRangeAndCleanup(t *testing.T) {
	for _, test := range []struct {
		name     string
		explicit bool
	}{{name: "cleanup"}, {name: "explicit release", explicit: true}} {
		path := filepath.Join(t.TempDir(), "locked.txt")
		if err := os.WriteFile(path, []byte("ab"), 0644); err != nil {
			t.Fatal(err)
		}
		t.Run(test.name, func(t *testing.T) {
			release := lockFirstByteForTest(t, path)
			file, err := os.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			var data [1]byte
			if n, readErr := file.ReadAt(data[:], 1); readErr != nil || n != 1 || data[0] != 'b' {
				t.Fatalf("unlocked byte could not be read: n=%d, data=%q, error=%v", n, data, readErr)
			}
			if _, readErr := file.ReadAt(data[:], 0); !errors.Is(readErr, windows.ERROR_LOCK_VIOLATION) {
				t.Fatalf("first byte was not exclusively locked: %v", readErr)
			}
			if test.explicit {
				release()
				release()
			}
		})
		if data, err := os.ReadFile(path); err != nil || string(data) != "ab" {
			t.Fatalf("fixture cleanup did not restore unchanged readable data: %q, %v", data, err)
		}
	}
}
