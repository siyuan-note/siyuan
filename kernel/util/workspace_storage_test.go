package util

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func writeStorageFixture(t *testing.T, root, name string, size int) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, size), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestWorkspaceStorageLocalFiles(t *testing.T) {
	root := t.TempDir()
	for path, size := range map[string]int{
		"data/assets/global.bin":                                            10,
		"data/20260924120000-abcdefg/assets/encrypted.bin":                  20,
		"data/20260924120000-abcdefg/20260924120001-abcdefg/assets/doc.bin": 30,
		"data/20260924120000-abcdefg/doc.sy":                                40,
		"data/plugins/demo/assets/icon.png":                                 50,
		"data/myassets/file.bin":                                            60,
		"data/storage/local.json":                                           70,
		"repo/objects/01/object":                                            80,
		"history/snapshot/old.sy":                                           90,
		"temp/siyuan.db":                                                    100,
		"conf/asset-downloads.json":                                         110,
		"custom/private.bin":                                                120,
		".lock":                                                             130,
	} {
		writeStorageFixture(t, root, path, size)
	}
	if err := os.Mkdir(filepath.Join(root, "empty"), 0755); err != nil {
		t.Fatal(err)
	}
	got, err := GetWorkspaceStorage(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int64{"data": 280, "repo": 80, "history": 90, "temp": 100, "conf": 110, "other": 250}
	if !reflect.DeepEqual(got.Directories, want) || got.TotalSize != 910 || got.AssetsSize != 60 || got.CalculatedAt <= 0 {
		t.Fatalf("unexpected storage: %+v", got)
	}
	// 已落盘文件按字节计数，统计无需解析资源状态或加密内容，也不能创建延期资源。
	before, err := os.ReadFile(filepath.Join(root, "conf", "asset-downloads.json"))
	if err != nil {
		t.Fatal(err)
	}
	writeStorageFixture(t, root, "data/assets/downloaded.bin", 200)
	after, err := GetWorkspaceStorage(context.Background(), root)
	if err != nil || after.TotalSize != got.TotalSize+200 || after.AssetsSize != got.AssetsSize+200 {
		t.Fatalf("refresh reused stale data: %+v, %v", after, err)
	}
	state, err := os.ReadFile(filepath.Join(root, "conf", "asset-downloads.json"))
	if err != nil || !reflect.DeepEqual(before, state) {
		t.Fatal("storage scan changed download state")
	}
}

func TestWorkspaceStorageEmptyAndFailure(t *testing.T) {
	root := t.TempDir()
	got, err := GetWorkspaceStorage(context.Background(), root)
	if err != nil || got.TotalSize != 0 || got.AssetsSize != 0 || len(got.Directories) != 6 {
		t.Fatalf("empty workspace: %+v, %v", got, err)
	}
	_, err = GetWorkspaceStorage(context.Background(), filepath.Join(root, "missing"))
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing workspace must fail: %v", err)
	}
	writeStorageFixture(t, root, "file", 1)
	if _, err = GetWorkspaceStorage(context.Background(), filepath.Join(root, "file")); err == nil {
		t.Fatal("a file cannot be measured as a workspace")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = GetWorkspaceStorage(ctx, root); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled scan: %v", err)
	}
	writeStorageFixture(t, root, "data/assets/test.bin", 10)
	got, err = measureWorkspaceStorage(context.Background(), root, func(root string, fn fs.WalkDirFunc) error {
		if err := filepath.WalkDir(root, fn); err != nil {
			return err
		}
		return fn(filepath.Join(root, "unreadable"), nil, fs.ErrPermission)
	})
	if !errors.Is(err, fs.ErrPermission) || got.TotalSize != 0 || got.Directories != nil {
		t.Fatalf("partial result must not be returned: %+v, %v", got, err)
	}
	got, err = measureWorkspaceStorage(context.Background(), root, func(root string, fn fs.WalkDirFunc) error {
		if err := filepath.WalkDir(root, fn); err != nil {
			return err
		}
		panic("invalid remote metadata")
	})
	if err == nil || got.TotalSize != 0 || got.Directories != nil {
		t.Fatalf("platform walker panic must fail without partial data: %+v, %v", got, err)
	}
}

func TestWorkspaceStorageLinks(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	writeStorageFixture(t, root, "data/assets/local.bin", 10)
	writeStorageFixture(t, outside, "external.bin", 1000)
	if err := os.Symlink(outside, filepath.Join(root, "external")); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
	if err := os.Symlink(filepath.Join(outside, "external.bin"), filepath.Join(root, "data", "assets", "link.bin")); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(t.TempDir(), "workspace")
	if err := os.Symlink(root, alias); err != nil {
		t.Fatal(err)
	}
	got, err := GetWorkspaceStorage(context.Background(), alias)
	if err != nil || got.TotalSize != 10 || got.AssetsSize != 10 {
		t.Fatalf("links escaped workspace or aliased root was skipped: %+v, %v", got, err)
	}
	// 模拟 Android 遍历器已跟随链接、仅返回目标类型的元信息。
	got, err = measureWorkspaceStorage(context.Background(), root, func(root string, fn fs.WalkDirFunc) error {
		for _, name := range []string{"data/assets/local.bin", "data/assets/link.bin", "external"} {
			path := filepath.Join(root, filepath.FromSlash(name))
			info, err := os.Stat(path)
			if err != nil {
				return err
			}
			err = fn(path, fs.FileInfoToDirEntry(info), nil)
			if name == "external" && !errors.Is(err, fs.SkipDir) {
				t.Fatalf("remote directory link must be skipped: %v", err)
			}
			if err != nil && !errors.Is(err, fs.SkipDir) {
				return err
			}
		}
		return nil
	})
	if err != nil || got.TotalSize != 10 || got.AssetsSize != 10 {
		t.Fatalf("remote metadata counted link targets: %+v, %v", got, err)
	}
}

func TestWorkspaceStorageConcurrentRemoval(t *testing.T) {
	root := t.TempDir()
	writeStorageFixture(t, root, "data/assets/keep.bin", 10)
	writeStorageFixture(t, root, "temp/removed.bin", 20)
	got, err := measureWorkspaceStorage(context.Background(), root, func(root string, fn fs.WalkDirFunc) error {
		return filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
			if filepath.Base(path) == "removed.bin" {
				if err := os.Remove(path); err != nil {
					return err
				}
			}
			if err := fn(path, entry, walkErr); err != nil {
				return err
			}
			return fn(filepath.Join(root, "disappeared"), nil, fs.ErrNotExist)
		})
	})
	if err != nil || got.TotalSize != 10 || got.AssetsSize != 10 {
		t.Fatalf("concurrent cleanup must not fail the scan: %+v, %v", got, err)
	}
	got, err = measureWorkspaceStorage(context.Background(), root, func(root string, fn fs.WalkDirFunc) error {
		return fn(root, nil, fs.ErrNotExist)
	})
	if !errors.Is(err, fs.ErrNotExist) || got.Directories != nil {
		t.Fatalf("a missing workspace root must fail: %+v, %v", got, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	got, err = measureWorkspaceStorage(ctx, root, func(root string, fn fs.WalkDirFunc) error {
		cancel()
		return nil
	})
	if !errors.Is(err, context.Canceled) || got.Directories != nil {
		t.Fatalf("cancellation during an empty walk must fail: %+v, %v", got, err)
	}
}

func TestWorkspaceStorageSharedScanCancellation(t *testing.T) {
	root := t.TempDir()
	scan := &workspaceStorageScan{done: make(chan struct{})}
	workspaceStorageScans.Lock()
	workspaceStorageScans.pending[root] = scan
	workspaceStorageScans.Unlock()
	t.Cleanup(func() {
		workspaceStorageScans.Lock()
		delete(workspaceStorageScans.pending, root)
		workspaceStorageScans.Unlock()
	})
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := GetWorkspaceStorage(ctx, root)
		result <- err
	}()
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("caller cancellation was ignored: %v", err)
	}
	select {
	case <-scan.done:
		t.Fatal("canceling one caller terminated the shared scan")
	default:
	}
	scan.data = WorkspaceStorage{TotalSize: 123}
	close(scan.done)
	got, err := GetWorkspaceStorage(context.Background(), root)
	if err != nil || got.TotalSize != 123 {
		t.Fatalf("another caller did not receive shared result: %+v, %v", got, err)
	}
}
