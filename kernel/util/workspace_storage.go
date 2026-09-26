package util

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
)

type WorkspaceStorage struct {
	Directories  map[string]int64
	AssetsSize   int64
	TotalSize    int64
	CalculatedAt int64
}

type workspaceStorageScan struct {
	done chan struct{}
	data WorkspaceStorage
	err  error
}

var workspaceStorageScans = struct {
	sync.Mutex
	pending map[string]*workspaceStorageScan
}{pending: map[string]*workspaceStorageScan{}}

// GetWorkspaceStorage 合并同一工作空间的并发扫描，完成后不缓存，手动刷新读取最新文件大小。
func GetWorkspaceStorage(ctx context.Context, workspacePath string) (WorkspaceStorage, error) {
	if err := ctx.Err(); err != nil {
		return WorkspaceStorage{}, err
	}
	workspaceStorageScans.Lock()
	scan := workspaceStorageScans.pending[workspacePath]
	if scan == nil {
		scan = &workspaceStorageScan{done: make(chan struct{})}
		workspaceStorageScans.pending[workspacePath] = scan
		go func() {
			// 单个页面关闭不取消其他页面共用的扫描，超时限制后台扫描的持续时间。
			scanCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			scan.data, scan.err = measureWorkspaceStorage(scanCtx, workspacePath, filelock.Walk)
			workspaceStorageScans.Lock()
			delete(workspaceStorageScans.pending, workspacePath)
			close(scan.done)
			workspaceStorageScans.Unlock()
		}()
	}
	workspaceStorageScans.Unlock()
	select {
	case <-ctx.Done():
		return WorkspaceStorage{}, ctx.Err()
	case <-scan.done:
		return scan.data, scan.err
	}
}

// measureWorkspaceStorage 只读取文件元信息，不读取内容、不解密，也不补下载资源。
func measureWorkspaceStorage(ctx context.Context, workspacePath string, walk func(string, fs.WalkDirFunc) error) (ret WorkspaceStorage, err error) {
	// 平台遍历器解析远端元信息时可能发生异常，转换为错误，保证后台扫描完成并释放等待者。
	defer func() {
		if recovered := recover(); recovered != nil {
			ret = WorkspaceStorage{}
			err = fmt.Errorf("workspace storage scan failed: %v", recovered)
		}
	}()
	ret = WorkspaceStorage{Directories: map[string]int64{"data": 0, "repo": 0, "history": 0, "temp": 0, "conf": 0, "other": 0}}
	root, err := filepath.EvalSymlinks(workspacePath)
	if err != nil {
		return WorkspaceStorage{}, err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return WorkspaceStorage{}, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return WorkspaceStorage{}, err
	}
	if !info.IsDir() {
		return WorkspaceStorage{}, fmt.Errorf("workspace is not a directory")
	}
	err = walk(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			if path != root && errors.Is(walkErr, fs.ErrNotExist) {
				return nil
			}
			return walkErr
		}
		// Android 遍历返回的元信息不包含链接类型，使用 Lstat 统一识别，避免统计链接目标。
		info, err := os.Lstat(path)
		if err != nil {
			// 同步和缓存清理可能在目录枚举后删除文件，按扫描时可见的文件统计。
			if path != root && errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		if info.Mode()&fs.ModeSymlink != 0 {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("workspace entry is outside the workspace")
		}
		parts := strings.Split(filepath.ToSlash(rel), "/")
		group := "other"
		if len(parts) > 1 {
			if _, ok := ret.Directories[parts[0]]; ok {
				group = parts[0]
			}
		}
		ret.Directories[group] += info.Size()
		ret.TotalSize += info.Size()
		if group == "data" && workspaceStorageAsset(parts[1:]) {
			ret.AssetsSize += info.Size()
		}
		return nil
	})
	if err == nil {
		err = ctx.Err()
	}
	if err != nil {
		// 不将中途失败的部分统计作为完整容量返回。
		return WorkspaceStorage{}, err
	}
	ret.CalculatedAt = time.Now().UnixMilli()
	return ret, nil
}

// workspaceStorageAsset 包含全局、笔记本和文档资源目录内的文件，不包含插件等包内的同名目录。
func workspaceStorageAsset(parts []string) bool {
	for _, part := range parts[:len(parts)-1] {
		if part == "assets" {
			return true
		}
		if !ast.IsNodeIDPattern(part) {
			return false
		}
	}
	return false
}
