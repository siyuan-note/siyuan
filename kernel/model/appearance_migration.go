package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var appearanceMigrationMu sync.Mutex

type appearanceMigrationState struct {
	Version   int  `json:"version"`
	Completed bool `json:"completed"`
}

// MigrateAppearancePackages 保留原目录并逐包迁移；已有目标或删除记录优先，完成标记仅保存在本机。
func MigrateAppearancePackages() error {
	appearanceMigrationMu.Lock()
	defer appearanceMigrationMu.Unlock()
	journalPath := filepath.Join(util.ConfDir, "appearance-migration.json")
	completed := false
	data, err := os.ReadFile(journalPath)
	if err == nil {
		var state appearanceMigrationState
		if err = json.Unmarshal(data, &state); err != nil {
			return err
		}
		if state.Version != 1 {
			return fmt.Errorf("unsupported appearance migration version: %d", state.Version)
		}
		completed = state.Completed
	} else if !os.IsNotExist(err) {
		return err
	}
	if err = util.EnsureAppearanceSyncIsolation(); err != nil {
		return err
	}
	for _, root := range []string{util.ThemesPath, util.IconsPath} {
		if err = os.MkdirAll(root, 0755); err != nil {
			return err
		}
	}
	if err = bazaar.RecoverAppearancePackages(); err != nil {
		return err
	}
	if completed {
		return nil
	}

	sourceRoot := util.AppearancePath
	if util.Mode == "dev" {
		sourceRoot = filepath.Join(util.WorkingDir, "appearance")
	}
	for _, kind := range []string{"themes", "icons"} {
		entries, readErr := bazaar.ReadInstalledPackageDirs(filepath.Join(sourceRoot, kind))
		if readErr != nil {
			return readErr
		}
		for _, entry := range entries {
			name := entry.Name()
			if (kind == "themes" && isBuiltInTheme(name)) || (kind == "icons" && isBuiltInIcon(name)) {
				continue
			}
			target := util.AppearancePackagePath(kind, name)
			if target == "" {
				continue
			}
			if _, statErr := os.Lstat(target); statErr == nil {
				continue
			} else if !os.IsNotExist(statErr) {
				return statErr
			}
			statePath := filepath.Join(util.DataDir, "storage", "bazaar", kind, name+".json")
			if _, statErr := os.Lstat(statePath); statErr == nil {
				continue
			} else if !os.IsNotExist(statErr) {
				return statErr
			}
			source := filepath.Join(sourceRoot, kind, name)
			linked, linkErr := bazaar.HasAppearancePackageSymlink(source)
			if linkErr != nil {
				return linkErr
			}
			if linked {
				// 开发包保留链接关系和原目录，仅普通目录进入同步。
				linkTarget, resolveErr := filepath.EvalSymlinks(source)
				if resolveErr != nil {
					return resolveErr
				}
				if err = os.Symlink(linkTarget, target); err != nil {
					return err
				}
				continue
			}
			info, infoErr := bazaar.GetAppearancePackageInfo(kind, name)
			if infoErr != nil {
				return infoErr
			}
			if info.InstallTime < 1 {
				stat, statErr := os.Stat(source)
				if statErr != nil {
					return statErr
				}
				info.InstallTime = stat.ModTime().UnixMilli()
			}
			if err = bazaar.PublishAppearancePackage(source, kind, name, *info, true, false); err != nil &&
				!errors.Is(err, bazaar.ErrAppearancePackageEmpty) {
				return err
			}
		}
	}
	data, err = json.Marshal(appearanceMigrationState{Version: 1, Completed: true})
	if err != nil {
		return err
	}
	return filelock.WriteFile(journalPath, data)
}
