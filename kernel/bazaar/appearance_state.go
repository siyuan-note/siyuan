package bazaar

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// AppearancePackageState 将包内容和安装状态绑定为同一个同步单元。
type AppearancePackageState struct {
	Version   int  `json:"version"`
	Deleted   bool `json:"deleted"`
	Migration bool `json:"migration"`
	PackageInfo
	Files map[string]string `json:"files"`
}

// ErrAppearancePackageEmpty 表示包中没有可同步的文件，迁移可保留原目录并跳过。
var ErrAppearancePackageEmpty = errors.New("appearance package contains no synchronizable files")

func isAppearanceKind(kind string) bool { return kind == "themes" || kind == "icons" }

func appearancePackagePaths(kind, name string) (payload, state string, err error) {
	payload = util.AppearancePackagePath(kind, name)
	if payload == "" || !IsValidPackageName(name) || !isAppearanceKind(kind) ||
		(kind == "themes" && (strings.EqualFold(name, "daylight") || strings.EqualFold(name, "midnight"))) ||
		(kind == "icons" && strings.EqualFold(name, "litheness")) {
		return "", "", fmt.Errorf("invalid third-party appearance package: %s/%s", kind, name)
	}
	return payload, filepath.Join(util.DataDir, "storage", "bazaar", kind, name+".json"), nil
}

func appearanceLockPath() string { return filepath.Join(util.DataDir, ".siyuan-appearance") }

func readAppearanceState(filePath string) (*AppearancePackageState, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	var state AppearancePackageState
	if err = json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	if err = validateAppearanceState(&state); err != nil {
		return nil, fmt.Errorf("%s: %w", filePath, err)
	}
	return &state, nil
}

func validateAppearanceState(state *AppearancePackageState) error {
	if state.Version != 1 || state.Files == nil || (state.Deleted && len(state.Files) != 0) || (!state.Deleted && len(state.Files) == 0) {
		return errors.New("unsupported or invalid appearance state")
	}
	paths := map[string]bool{}
	for name, digest := range state.Files {
		if name == "" || name == "." || strings.HasPrefix(name, "/") || strings.HasPrefix(name, "../") ||
			path.Clean(name) != name || strings.ContainsAny(name, "\\:\x00") || len(digest) != 64 || strings.ToLower(digest) != digest {
			return fmt.Errorf("invalid appearance file record: %s", name)
		}
		folded := strings.ToLower(name)
		if paths[folded] {
			return fmt.Errorf("appearance file path collision: %s", name)
		}
		paths[folded] = true
		if _, err := hex.DecodeString(digest); err != nil {
			return err
		}
	}
	return nil
}

func writeAppearanceState(filePath string, state *AppearancePackageState) error {
	if err := validateAppearanceState(state); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "\t")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return err
	}
	return filelock.WriteFile(filePath, data)
}

func appearanceFiles(root string) (map[string]string, error) {
	ret := map[string]string{}
	err := filepath.WalkDir(root, func(filePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if filePath != root && (strings.HasPrefix(entry.Name(), ".") || strings.HasSuffix(entry.Name(), ".tmp")) {
				return nil
			}
			return fmt.Errorf("appearance synchronization does not follow symlinks: %s", filePath)
		}
		if filePath == root {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, filePath)
		if err != nil {
			return err
		}
		ignored, err := dejavu.IgnorePath(info, filePath, filepath.ToSlash(rel), "", ".siyuan")
		if err != nil {
			return err
		}
		if ignored || entry.IsDir() {
			return nil
		}
		data, err := filelock.ReadFile(filePath)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(data)
		ret[filepath.ToSlash(rel)] = hex.EncodeToString(digest[:])
		return nil
	})
	return ret, err
}

// GetAppearancePackageInfo 读取独立包状态；旧记录只作为迁移时的只读后备。
func GetAppearancePackageInfo(kind, name string) (*PackageInfo, error) {
	_, statePath, err := appearancePackagePaths(kind, name)
	if err != nil {
		return nil, err
	}
	state, err := readAppearanceState(statePath)
	if err == nil {
		return &state.PackageInfo, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	getBazaarInfo()
	bazaarInfoCacheLock.RLock()
	defer bazaarInfoCacheLock.RUnlock()
	if bazaarInfoCache != nil && bazaarInfoCache.Packages[kind] != nil {
		if info := bazaarInfoCache.Packages[kind][name]; info != nil {
			copy := *info
			return &copy, nil
		}
	}
	return &PackageInfo{}, nil
}

// ValidateAppearancePackage 拒绝加载不完整或未知格式的已记录外观包，保留没有状态文件的本地开发包。
func ValidateAppearancePackage(kind, name string) error {
	payload, statePath, err := appearancePackagePaths(kind, name)
	if err != nil {
		return err
	}
	state, err := readAppearanceState(statePath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if state.Deleted {
		return fmt.Errorf("appearance package is deleted: %s/%s", kind, name)
	}
	files, err := appearanceFiles(payload)
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(files, state.Files) {
		return fmt.Errorf("appearance package content does not match state: %s/%s", kind, name)
	}
	return nil
}

// PrepareAppearancePackages 在恢复完成后、建立快照前记录本地手工修改和删除。
func PrepareAppearancePackages(ignored ...func(kind, name string) bool) error {
	if err := util.EnsureAppearanceSyncIsolation(); err != nil {
		return err
	}
	filelock.Lock(appearanceLockPath())
	defer filelock.Unlock(appearanceLockPath())
	if err := recoverAppearanceOperations(); err != nil {
		return err
	}
	for _, kind := range []string{"themes", "icons"} {
		names := map[string]bool{}
		entries, err := os.ReadDir(filepath.Join(util.DataDir, kind))
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), ".") {
				continue
			}
			if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
				names[entry.Name()] = true
			}
		}
		entries, err = os.ReadDir(filepath.Join(util.DataDir, "storage", "bazaar", kind))
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
				names[strings.TrimSuffix(entry.Name(), ".json")] = true
			}
		}
		for name := range names {
			if len(ignored) > 0 && ignored[0] != nil && ignored[0](kind, name) {
				continue
			}
			payload, statePath, pathErr := appearancePackagePaths(kind, name)
			if pathErr != nil {
				continue
			}
			state, readErr := readAppearanceState(statePath)
			if readErr != nil && !os.IsNotExist(readErr) {
				return readErr
			}
			_, statErr := os.Lstat(payload)
			if state == nil {
				if stat, linkErr := os.Lstat(payload); linkErr == nil && stat.Mode()&os.ModeSymlink != 0 {
					continue
				}
			}
			deleted := os.IsNotExist(statErr)
			if statErr != nil && !deleted {
				return statErr
			}
			files := map[string]string{}
			if !deleted {
				var scanErr error
				files, scanErr = appearanceFiles(payload)
				if scanErr != nil {
					return scanErr
				}
				if len(files) == 0 {
					// 删除后保留的空目录和本机忽略文件不构成重新安装。
					if state == nil || state.Deleted {
						continue
					}
					return fmt.Errorf("%w: %s/%s", ErrAppearancePackageEmpty, kind, name)
				}
			}
			if state != nil && state.Deleted && !deleted {
				return fmt.Errorf("appearance package has a deletion record; reinstall explicitly: %s/%s", kind, name)
			}
			if state != nil && state.Deleted == deleted && reflect.DeepEqual(state.Files, files) {
				continue
			}
			if state == nil {
				info, infoErr := GetAppearancePackageInfo(kind, name)
				if infoErr != nil {
					return infoErr
				}
				if info.InstallTime == 0 {
					if stat, statErr := os.Stat(payload); statErr == nil {
						info.InstallTime = stat.ModTime().UnixMilli()
					}
				}
				state = &AppearancePackageState{Version: 1, PackageInfo: *info}
			} else {
				state.UpdateTime = time.Now().UnixMilli()
				state.Migration = false
			}
			state.Deleted, state.Files = deleted, files
			if err = writeAppearanceState(statePath, state); err != nil {
				return err
			}
		}
	}
	return nil
}

// HasAppearancePackageSymlink 判定需要保留在本机的开发包，不遍历链接指向的外部目录。
func HasAppearancePackageSymlink(root string) (bool, error) {
	found := false
	err := filepath.WalkDir(root, func(filePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if filePath != root && (strings.HasPrefix(entry.Name(), ".") || strings.HasSuffix(entry.Name(), ".tmp")) {
				return nil
			}
			found = true
			return filepath.SkipAll
		}
		if filePath != root && entry.IsDir() && strings.HasPrefix(entry.Name(), ".") && entry.Name() != ".siyuan" {
			return filepath.SkipDir
		}
		return nil
	})
	return found, err
}

type appearanceOperation struct {
	Version      int                    `json:"version"`
	Kind         string                 `json:"kind"`
	Name         string                 `json:"name"`
	State        AppearancePackageState `json:"state"`
	BeforeExists bool                   `json:"beforeExists"`
	Before       map[string]string      `json:"before"`
	BeforeLink   string                 `json:"beforeLink,omitempty"`
	BeforeState  string                 `json:"beforeState"`
}

func appearanceOperationsPath() string { return filepath.Join(util.DataDir, ".siyuan-appearance-ops") }

// PublishAppearancePackage 用可恢复的整目录事务发布包及其摘要，安装中断后继续完成同一事务。
func PublishAppearancePackage(sourcePath, kind, name string, info PackageInfo, migration, update bool) error {
	if err := util.EnsureAppearanceSyncIsolation(); err != nil {
		return err
	}
	filelock.Lock(appearanceLockPath())
	defer filelock.Unlock(appearanceLockPath())
	if err := recoverAppearanceOperations(); err != nil {
		return err
	}
	payload, statePath, err := appearancePackagePaths(kind, name)
	if err != nil {
		return err
	}
	if _, err = readAppearanceState(statePath); err != nil && !os.IsNotExist(err) {
		return err
	}
	contains, err := PackageDirContainsFile(payload)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if !update && contains {
		return errors.New("marketplace package install path already exists")
	}
	if update && os.IsNotExist(err) {
		return os.ErrNotExist
	}
	files, err := appearanceFiles(sourcePath)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return ErrAppearancePackageEmpty
	}
	state := AppearancePackageState{Version: 1, Migration: migration, PackageInfo: info, Files: files}
	return publishAppearanceOperation(&appearanceOperation{Version: 1, Kind: kind, Name: name, State: state}, sourcePath)
}

// DeleteAppearancePackage 保留同步删除标记，并在记录发布前保留旧包以支持中断恢复。
func DeleteAppearancePackage(kind, name string) error {
	if err := util.EnsureAppearanceSyncIsolation(); err != nil {
		return err
	}
	filelock.Lock(appearanceLockPath())
	defer filelock.Unlock(appearanceLockPath())
	if err := recoverAppearanceOperations(); err != nil {
		return err
	}
	info, err := GetAppearancePackageInfo(kind, name)
	if err != nil {
		return err
	}
	info.UpdateTime = time.Now().UnixMilli()
	state := AppearancePackageState{Version: 1, Deleted: true, PackageInfo: *info, Files: map[string]string{}}
	return publishAppearanceOperation(&appearanceOperation{Version: 1, Kind: kind, Name: name, State: state}, "")
}

func publishAppearanceOperation(operation *appearanceOperation, sourcePath string) error {
	if err := validateAppearanceState(&operation.State); err != nil {
		return err
	}
	payload, statePath, err := appearancePackagePaths(operation.Kind, operation.Name)
	if err != nil {
		return err
	}
	stat, err := os.Lstat(payload)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	operation.BeforeExists = err == nil
	if operation.BeforeExists {
		if stat.Mode()&os.ModeSymlink != 0 {
			operation.BeforeLink, err = os.Readlink(payload)
		} else {
			operation.Before, err = appearanceFiles(payload)
		}
		if err != nil {
			return err
		}
	}
	operation.BeforeState, err = appearanceStateDigest(statePath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(appearanceOperationsPath(), 0755); err != nil {
		return err
	}
	opDir, err := os.MkdirTemp(appearanceOperationsPath(), "package-")
	if err != nil {
		return err
	}
	if sourcePath != "" {
		if err = filelock.Copy(sourcePath, filepath.Join(opDir, "staging")); err != nil {
			_ = os.RemoveAll(opDir)
			return err
		}
		files, scanErr := appearanceFiles(filepath.Join(opDir, "staging"))
		if scanErr != nil || !reflect.DeepEqual(files, operation.State.Files) {
			_ = os.RemoveAll(opDir)
			return fmt.Errorf("appearance package changed while staging: %v", scanErr)
		}
	}
	if err = verifyAppearanceOperationBefore(payload, statePath, operation); err != nil {
		_ = os.RemoveAll(opDir)
		return err
	}
	data, err := json.Marshal(operation)
	if err != nil {
		return err
	}
	if err = filelock.WriteFile(filepath.Join(opDir, "operation.json"), data); err != nil {
		return err
	}
	return applyAppearanceOperation(opDir, operation)
}

func applyAppearanceOperation(opDir string, operation *appearanceOperation) error {
	if operation.Version != 1 || operation.State.Version != 1 || operation.State.Files == nil {
		return errors.New("unsupported appearance operation")
	}
	if err := validateAppearanceState(&operation.State); err != nil {
		return err
	}
	payload, statePath, err := appearancePackagePaths(operation.Kind, operation.Name)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(payload), 0755); err != nil {
		return err
	}
	staging, backup := filepath.Join(opDir, "staging"), filepath.Join(opDir, "backup")
	_, stageErr := os.Stat(staging)
	if !operation.State.Deleted && stageErr == nil {
		files, scanErr := appearanceFiles(staging)
		if scanErr != nil {
			return scanErr
		}
		if !reflect.DeepEqual(files, operation.State.Files) {
			return errors.New("appearance recovery staging does not match state")
		}
	}
	if operation.State.Deleted || stageErr == nil {
		if _, backupErr := os.Lstat(backup); os.IsNotExist(backupErr) {
			if err = verifyAppearanceOperationBefore(payload, statePath, operation); err != nil {
				return err
			}
			if _, targetErr := os.Lstat(payload); targetErr == nil {
				if err = os.Rename(payload, backup); err != nil {
					return err
				}
			} else if !os.IsNotExist(targetErr) {
				return targetErr
			}
		} else if backupErr != nil {
			return backupErr
		}
		if !operation.State.Deleted {
			if err = os.Rename(staging, payload); err != nil {
				return err
			}
		}
	} else if !os.IsNotExist(stageErr) {
		return stageErr
	}
	if !operation.State.Deleted {
		files, scanErr := appearanceFiles(payload)
		if scanErr != nil {
			return scanErr
		}
		if !reflect.DeepEqual(files, operation.State.Files) {
			return errors.New("appearance recovery target does not match staged package")
		}
	} else if _, targetErr := os.Lstat(payload); !os.IsNotExist(targetErr) {
		return errors.New("appearance deletion recovery target reappeared")
	}
	if err = verifyAppearanceOperationState(statePath, operation); err != nil {
		return err
	}
	if err = writeAppearanceState(statePath, &operation.State); err != nil {
		return err
	}
	// 保留旧目录，避免外部编辑器仍持有旧文件句柄时丢失迟到的写入。
	if _, backupErr := os.Lstat(backup); backupErr == nil {
		backupRoot := filepath.Join(util.DataDir, ".siyuan-appearance-backups")
		if err = os.MkdirAll(backupRoot, 0755); err != nil {
			return err
		}
		if err = os.Rename(backup, filepath.Join(backupRoot, filepath.Base(opDir))); err != nil {
			return err
		}
	} else if !os.IsNotExist(backupErr) {
		return backupErr
	}
	return os.RemoveAll(opDir)
}

func appearanceStateDigest(statePath string) (string, error) {
	data, err := os.ReadFile(statePath)
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}

func verifyAppearanceOperationState(statePath string, operation *appearanceOperation) error {
	digest, err := appearanceStateDigest(statePath)
	if err != nil {
		return err
	}
	if digest != operation.BeforeState {
		current, readErr := readAppearanceState(statePath)
		if readErr != nil || !reflect.DeepEqual(current, &operation.State) {
			return errors.New("appearance metadata changed during pending operation")
		}
	}
	return nil
}

func verifyAppearanceOperationBefore(payload, statePath string, operation *appearanceOperation) error {
	if err := verifyAppearanceOperationState(statePath, operation); err != nil {
		return err
	}
	stat, err := os.Lstat(payload)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if operation.State.Deleted && os.IsNotExist(err) {
		current, stateErr := readAppearanceState(statePath)
		if stateErr == nil && reflect.DeepEqual(current, &operation.State) {
			return nil
		}
	}
	if !operation.BeforeExists && os.IsNotExist(err) {
		return nil
	}
	if operation.BeforeExists && err == nil {
		if operation.BeforeLink != "" && stat.Mode()&os.ModeSymlink != 0 {
			link, linkErr := os.Readlink(payload)
			if linkErr == nil && link == operation.BeforeLink {
				return nil
			}
		} else if stat.Mode()&os.ModeSymlink == 0 {
			files, scanErr := appearanceFiles(payload)
			if scanErr == nil && reflect.DeepEqual(files, operation.Before) {
				return nil
			}
		}
	}
	return errors.New("appearance package changed during pending operation; original files and recovery journal preserved")
}

func recoverAppearanceOperations() error {
	entries, err := os.ReadDir(appearanceOperationsPath())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		opDir := filepath.Join(appearanceOperationsPath(), entry.Name())
		data, readErr := os.ReadFile(filepath.Join(opDir, "operation.json"))
		if os.IsNotExist(readErr) {
			continue
		}
		if readErr != nil {
			return readErr
		}
		var operation appearanceOperation
		if err = json.Unmarshal(data, &operation); err != nil {
			return err
		}
		if err = applyAppearanceOperation(opDir, &operation); err != nil {
			return err
		}
	}
	return nil
}

// RecoverAppearancePackages 在启动和外观目录迁移前完成本机安装事务。
func RecoverAppearancePackages() error {
	if err := util.EnsureAppearanceSyncIsolation(); err != nil {
		return err
	}
	filelock.Lock(appearanceLockPath())
	defer filelock.Unlock(appearanceLockPath())
	return recoverAppearanceOperations()
}
