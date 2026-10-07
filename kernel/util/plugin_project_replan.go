package util

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
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
	if len(manifest.Pending) > 0 {
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
		return PluginProjectArtifactStatus(grant, source)
	}
	checkpoint := "checkpoints/" + PluginProjectDigest([]byte(grant.PlanHash+"\x00"+revision))
	private, err := OpenPluginProjectDirectory(PluginProjectPrivateDir(grant.TaskID), false)
	if err != nil {
		return nil, err
	}
	defer private.Close()
	if err = private.MkdirAll("checkpoints", 0700); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(filepath.Join(PluginProjectPrivateDir(grant.TaskID), "checkpoints"))
	if err != nil {
		return nil, err
	}
	_, existingErr := private.Lstat(checkpoint)
	if len(entries) >= 8 && errors.Is(existingErr, os.ErrNotExist) {
		return nil, errors.New("backup_failed: retained plan checkpoint limit reached; previous recovery points were preserved")
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
	return PluginProjectArtifactStatus(grant, source)
}
