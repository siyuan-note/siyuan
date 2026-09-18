package model

import (
	"os"
	"path/filepath"
	"sync"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var appearanceMigrationMu sync.Mutex

// MigrateAppearancePackages 将第三方外观目录移入数据目录，已有目标优先，迁移成功后移除原目录。
func MigrateAppearancePackages() error {
	appearanceMigrationMu.Lock()
	defer appearanceMigrationMu.Unlock()
	if err := util.MigrateAppearanceSyncIgnore(); err != nil {
		return err
	}
	sourceRoot := util.AppearancePath
	if util.Mode == "dev" {
		sourceRoot = filepath.Join(util.WorkingDir, "appearance")
	}
	for _, kind := range []string{"themes", "icons"} {
		targetRoot := filepath.Join(util.DataDir, kind)
		if err := os.MkdirAll(targetRoot, 0755); err != nil {
			return err
		}
		entries, err := bazaar.ReadInstalledPackageDirs(filepath.Join(sourceRoot, kind))
		if err != nil {
			return err
		}
		for _, entry := range entries {
			name := entry.Name()
			if (kind == "themes" && isBuiltInTheme(name)) || (kind == "icons" && isBuiltInIcon(name)) {
				continue
			}
			source, target := filepath.Join(sourceRoot, kind, name), util.AppearancePackagePath(kind, name)
			if target == "" || filepath.Clean(source) == filepath.Clean(target) {
				continue
			}
			if err = moveAppearancePackage(source, target); err != nil {
				return err
			}
		}
	}
	return nil
}

func moveAppearancePackage(source, target string) error {
	if _, err := os.Lstat(target); err == nil {
		sourceInfo, sourceErr := os.Stat(source)
		targetInfo, targetErr := os.Stat(target)
		if sourceErr != nil {
			return sourceErr
		}
		if targetErr != nil {
			return targetErr
		}
		if os.SameFile(sourceInfo, targetInfo) {
			return nil
		}
		return os.RemoveAll(source)
	} else if !os.IsNotExist(err) {
		return err
	}
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		// 将相对链接转换为绝对链接，迁移目录后仍指向同一份开发文件。
		link, err := filepath.EvalSymlinks(source)
		if err != nil {
			return err
		}
		if err = os.Symlink(link, target); err != nil {
			return err
		}
		return os.Remove(source)
	}
	if err = os.Rename(source, target); err == nil {
		return nil
	}
	// 跨文件系统时先完整复制到临时目录，发布成功后才移除来源。
	staging, err := os.MkdirTemp(filepath.Dir(target), ".appearance-migrate-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	if err = filelock.Copy(source, staging); err != nil {
		return err
	}
	if err = os.Rename(staging, target); err != nil {
		return err
	}
	return os.RemoveAll(source)
}
