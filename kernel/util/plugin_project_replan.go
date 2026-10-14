package util

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func pluginProjectBaselinePath(grant *PluginDevelopmentGrant, manifest *pluginProjectManifest) string {
	directory := manifest.BaselineDirectory
	if directory == "" {
		directory = "baseline"
	}
	return filepath.Join(PluginProjectPrivateDir(grant.TaskID), filepath.FromSlash(directory))
}

// 重新确认方案不覆盖源码。先验证当前清单和版本，保存新的代码基线，再切换方案绑定。
func replanPluginProject(ctx context.Context, grant *PluginDevelopmentGrant, allowed []string, expected string) (*PluginProjectStatus, error) {
	manifest, err := readPluginProjectManifestForStatus(grant)
	if err != nil {
		return nil, err
	}
	if manifest.SourcePath != grant.SourcePath || manifest.SourceRevision != grant.SourceRevision {
		return nil, errors.New("revision_conflict: changing import provenance requires a new plugin development task")
	}
	if manifest.mutationPending() {
		return nil, errors.New("result_unknown: resolve interrupted source mutation before preparing a new plan")
	}
	if err = validateProjectBaseline(grant, manifest); err != nil {
		return nil, err
	}
	source, err := OpenPluginProjectDirectory(grant.SourceRoot, false)
	if err != nil {
		return nil, err
	}
	defer source.Close()
	files, err := SnapshotPluginProject(source, nil)
	if err != nil {
		return nil, err
	}
	inventory := projectInventory(files)
	revision := PluginProjectTreeRevision(inventory)
	if expected == "" || expected != revision || revision != PluginProjectTreeRevision(manifest.Current) {
		return nil, errors.New("revision_conflict: replan requires expectedSourceRevision and unchanged recorded source")
	}
	set := map[string]bool{}
	for _, name := range allowed {
		set[name] = true
	}
	for name := range files {
		if !set[name] {
			return nil, fmt.Errorf("invalid_path: existing file %s must remain in the approved write scope, including when it will be explicitly deleted", name)
		}
	}
	if manifest.PlanHash == grant.PlanHash {
		if err = cleanPluginProjectCheckpoints(grant, manifest); err != nil {
			return nil, err
		}
		return PluginProjectArtifactStatus(grant, source)
	}
	checkpoint := "checkpoints/" + PluginProjectDigest([]byte(grant.PlanHash+"\x00"+revision))
	if err = cleanPluginProjectCheckpoints(grant, manifest, checkpoint); err != nil {
		return nil, err
	}
	if err = ensurePluginProjectCheckpoint(grant, checkpoint, files); err != nil {
		return nil, err
	}

	manifest.BaselineDirectory, manifest.Baseline = checkpoint, inventory
	if err = validateProjectBaseline(grant, manifest); err != nil {
		return nil, err
	}
	if err = RecheckPluginProjectGrant(ctx, grant); err != nil {
		return nil, err
	}
	again, err := SnapshotPluginProject(source, nil)
	if err != nil {
		return nil, err
	}
	if PluginProjectTreeRevision(projectInventory(again)) != expected {
		return nil, errors.New("revision_conflict: source changed while preparing new checkpoint")
	}
	for _, name := range allowed {
		if err = source.MkdirAll(path.Dir(name), 0700); err != nil {
			return nil, err
		}
	}
	manifest.PlanHash, manifest.Artifact = grant.PlanHash, nil
	if err = savePluginProjectManifest(grant, manifest); err != nil {
		return nil, err
	}
	if err = cleanPluginProjectCheckpoints(grant, manifest); err != nil {
		return nil, err
	}
	return PluginProjectArtifactStatus(grant, source)
}

// 仅整理宿主检查点命名空间；当前清单指向的基线和待复用检查点始终保留。
// 调用方持有项目锁，且已确认没有待完成写入；清单原子切换后才能删除上一基线。
func cleanPluginProjectCheckpoints(grant *PluginDevelopmentGrant, manifest *pluginProjectManifest, retain ...string) error {
	if manifest.Preparing || manifest.mutationPending() {
		return errors.New("result_unknown: pending project recovery evidence must be preserved")
	}
	if err := validateProjectBaseline(grant, manifest); err != nil {
		return err
	}
	current := manifest.BaselineDirectory
	if current == "" {
		current = "baseline"
	}
	keep := map[string]bool{current: true}
	for _, name := range retain {
		keep[name] = true
	}
	private, err := OpenPluginProjectDirectory(PluginProjectPrivateDir(grant.TaskID), false)
	if err != nil {
		return err
	}
	defer private.Close()
	remove := func(name string) error {
		if keep[name] {
			return nil
		}
		info, statErr := private.Lstat(name)
		if errors.Is(statErr, os.ErrNotExist) {
			return nil
		}
		if statErr != nil {
			return statErr
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil
		}
		return private.RemoveAll(name)
	}
	if err = remove("baseline"); err != nil {
		return fmt.Errorf("backup_failed: obsolete checkpoint cleanup failed; current baseline preserved: %w", err)
	}
	entries, err := fs.ReadDir(private.FS(), ".")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if suffix, ok := strings.CutPrefix(name, ".checkpoint-"); ok && len(suffix) == 26 && strings.Trim(suffix, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567") == "" {
			if err = remove(name); err != nil {
				return fmt.Errorf("backup_failed: staged checkpoint cleanup failed: %w", err)
			}
		}
	}
	info, err := private.Lstat("checkpoints")
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("backup_failed: checkpoint directory must be an unlinked directory")
	}
	entries, err = fs.ReadDir(private.FS(), "checkpoints")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() == PluginProjectMissingRevision || !validPluginProjectRevision(entry.Name()) {
			continue
		}
		if err = remove(path.Join("checkpoints", entry.Name())); err != nil {
			return fmt.Errorf("backup_failed: obsolete checkpoint cleanup failed; current baseline preserved: %w", err)
		}
	}
	return nil
}
