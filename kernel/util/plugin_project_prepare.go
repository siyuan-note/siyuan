package util

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"reflect"
)

// 后续检查必须仍是同一任务、同一冻结方案，不能借用期间替换的新授权。
func RecheckPluginProjectGrant(ctx context.Context, expected *PluginDevelopmentGrant) error {
	return recheckPluginProjectGrantOperation(ctx, expected, "write")
}

func recheckPluginProjectGrantOperation(ctx context.Context, expected *PluginDevelopmentGrant, operation string) error {
	current, err := RequirePluginDevelopment(ctx, operation)
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(current, expected) {
		return errors.New("revision_conflict: plugin development grant changed during the operation")
	}
	return nil
}

// 检查点先在宿主私有临时目录完成；只有完整匹配的既有检查点才可安全复用。
func ensurePluginProjectCheckpoint(grant *PluginDevelopmentGrant, directory string, files map[string][]byte) error {
	private, err := OpenPluginProjectDirectory(PluginProjectPrivateDir(grant.TaskID), true)
	if err != nil {
		return fmt.Errorf("backup_failed: %w", err)
	}
	defer private.Close()
	if _, statErr := private.Lstat(directory); statErr == nil {
		baseline, err := OpenPluginProjectDirectory(filepath.Join(PluginProjectPrivateDir(grant.TaskID), filepath.FromSlash(directory)), false)
		if err != nil {
			return fmt.Errorf("backup_failed: %w", err)
		}
		defer baseline.Close()
		existing, err := SnapshotPluginProject(baseline, nil)
		if err != nil || PluginProjectTreeRevision(projectInventory(existing)) != PluginProjectTreeRevision(projectInventory(files)) {
			return errors.New("backup_failed: existing checkpoint does not match the frozen source")
		}
		return nil
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return statErr
	}
	tmp := ".checkpoint-" + rand.Text()
	if err = private.Mkdir(tmp, 0700); err != nil {
		return err
	}
	defer private.RemoveAll(tmp)
	stage, err := private.OpenRoot(tmp)
	if err != nil {
		return err
	}
	for name, data := range files {
		if err = writePluginProjectBytes(stage, name, data); err != nil {
			stage.Close()
			return fmt.Errorf("backup_failed: %w", err)
		}
	}
	verify, err := SnapshotPluginProject(stage, nil)
	stage.Close()
	if err != nil || PluginProjectTreeRevision(projectInventory(verify)) != PluginProjectTreeRevision(projectInventory(files)) {
		return errors.New("backup_failed: staged checkpoint verification failed")
	}
	if err = private.MkdirAll(path.Dir(directory), 0700); err != nil {
		return err
	}
	if err = private.Rename(tmp, directory); err != nil {
		return fmt.Errorf("backup_failed: %w", err)
	}
	return nil
}

// 私有日志先于源码发布持久化。未发布的整目录暂存可重建；已发布源码必须完整匹配基线。
func resumePluginProjectPreparation(ctx context.Context, grant *PluginDevelopmentGrant, manifest *pluginProjectManifest, allowed []string, recoveryOnly bool) (*PluginProjectStatus, error) {
	operation := "write"
	if recoveryOnly {
		operation = "recover"
	}
	if err := validateProjectBaseline(grant, manifest); err != nil {
		return nil, err
	}
	if err := recheckPluginProjectGrantOperation(ctx, grant, operation); err != nil {
		return nil, err
	}
	baseline, err := OpenPluginProjectDirectory(pluginProjectBaselinePath(grant, manifest), false)
	if err != nil {
		return nil, err
	}
	defer baseline.Close()
	files, err := SnapshotPluginProject(baseline, nil)
	if err != nil {
		return nil, err
	}
	project, err := OpenPluginProjectDirectory(PluginProjectRoot(grant.TaskID), true)
	if err != nil {
		return nil, err
	}
	defer project.Close()
	if _, statErr := project.Lstat("source"); errors.Is(statErr, os.ErrNotExist) {
		// 此精确路径只存放尚未提交的宿主复制，不是用户源码或恢复点。
		if err = project.RemoveAll(".prepare-source"); err != nil {
			return nil, err
		}
		if err = project.Mkdir(".prepare-source", 0700); err != nil {
			return nil, err
		}
		stage, openErr := project.OpenRoot(".prepare-source")
		if openErr != nil {
			return nil, openErr
		}
		for _, name := range allowed {
			if err = stage.MkdirAll(path.Dir(name), 0700); err != nil {
				stage.Close()
				return nil, err
			}
		}
		for name, data := range files {
			if err = writePluginProjectBytes(stage, name, data); err != nil {
				stage.Close()
				return nil, fmt.Errorf("result_unknown: preparation interrupted; retry prepare_project to rebuild uncommitted staging: %w", err)
			}
		}
		verify, verifyErr := SnapshotPluginProject(stage, nil)
		stage.Close()
		if verifyErr != nil || PluginProjectTreeRevision(projectInventory(verify)) != PluginProjectTreeRevision(manifest.Baseline) {
			return nil, errors.New("result_unknown: staged source differs; preparation journal and checkpoint preserved")
		}
		if err = recheckPluginProjectGrantOperation(ctx, grant, operation); err != nil {
			return nil, err
		}
		if err = project.Rename(".prepare-source", "source"); err != nil {
			return nil, fmt.Errorf("result_unknown: source publication failed; preparation is resumable: %w", err)
		}
	} else if statErr != nil {
		return nil, statErr
	}
	source, err := OpenPluginProjectDirectory(grant.SourceRoot, false)
	if err != nil {
		return nil, err
	}
	defer source.Close()
	actual, err := SnapshotPluginProject(source, nil)
	if err != nil {
		return nil, err
	}
	if PluginProjectTreeRevision(projectInventory(actual)) != PluginProjectTreeRevision(manifest.Baseline) {
		return nil, errors.New("revision_conflict: published preparation source has external changes; preserved")
	}
	manifest.Current, manifest.Preparing = projectInventory(actual), false
	if err = savePluginProjectManifest(grant, manifest); err != nil {
		return nil, fmt.Errorf("result_unknown: complete source and checkpoint retained; retry prepare_project to finish journal: %w", err)
	}
	if recoveryOnly {
		if _, err = RequirePluginDevelopment(ctx, "recovered"); err != nil {
			return nil, fmt.Errorf("result_unknown: preparation completed but recovery grant could not be consumed: %w", err)
		}
	}
	return PluginProjectArtifactStatus(grant, source)
}
