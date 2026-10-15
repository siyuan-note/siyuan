// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package bazaar

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

const pluginProjectPackagerVersion = "siyuan-plugin-zip-v1"

// buildPluginProjectArchive 只消费冻结允许清单的内存快照，不执行脚本、解析模块或下载依赖，
// 也不将打包结果当作 JavaScript 语法或运行时验证。
func buildPluginProjectArchive(grant *util.PluginDevelopmentGrant, snapshot map[string][]byte) ([]byte, *util.PluginProjectArtifact, error) {
	if len(grant.AllowFiles) == 0 || len(grant.AllowFiles) > util.PluginProjectMaxFiles {
		return nil, nil, errors.New("invalid_path: invalid approved inventory")
	}
	approved := append([]string(nil), grant.AllowFiles...)
	sort.Strings(approved)
	names := []string{}
	seen := map[string]bool{}
	prefixes := map[string]string{}
	inventory := map[string]string{}
	var total int64
	for _, name := range approved {
		if err := util.ValidatePluginProjectFile(name); err != nil {
			return nil, nil, err
		}
		key := strings.ToLower(name)
		if seen[key] {
			return nil, nil, errors.New("invalid_path: duplicate or case-colliding archive member")
		}
		seen[key] = true
		for prefix := name; prefix != "."; prefix = path.Dir(prefix) {
			key := strings.ToLower(prefix)
			if old, ok := prefixes[key]; ok && old != prefix {
				return nil, nil, errors.New("invalid_path: case-colliding archive path prefix")
			}
			prefixes[key] = prefix
		}
		data, ok := snapshot[name]
		if !ok {
			continue
		}
		names = append(names, name)
		if int64(len(data)) > util.PluginProjectMaxFileBytes {
			return nil, nil, errors.New("too_large: archive member exceeds 16 MiB")
		}
		total += int64(len(data))
		if total > util.PluginProjectMaxBytes {
			return nil, nil, errors.New("too_large: project exceeds 64 MiB")
		}
		// 仅提供有限补充扫描；安全边界主要来自已确认并冻结的显式清单。
		if bytes.Contains(data, []byte("-----BEGIN PRIVATE KEY-----")) || bytes.Contains(data, []byte("-----BEGIN RSA PRIVATE KEY-----")) || bytes.Contains(data, []byte("-----BEGIN OPENSSH PRIVATE KEY-----")) || bytes.Contains(data, []byte("-----BEGIN EC PRIVATE KEY-----")) {
			return nil, nil, errors.New("invalid_package: private key material is forbidden")
		}
		inventory[name] = util.PluginProjectDigest(data)
	}
	if len(snapshot) != len(inventory) {
		return nil, nil, errors.New("invalid_package: source contains files outside the approved inventory")
	}
	for name := range seen {
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			if seen[parent] {
				return nil, nil, errors.New("invalid_path: file/directory archive member collision")
			}
		}
	}
	if _, ok := inventory["index.js"]; !ok {
		return nil, nil, errors.New("invalid_package: root index.js is required; TypeScript requires actual provided JavaScript output")
	}
	manifest, ok := snapshot["plugin.json"]
	if !ok {
		return nil, nil, errors.New("invalid_package: root plugin.json is required")
	}
	var pkg *Package
	if err := json.Unmarshal(manifest, &pkg); err != nil || pkg == nil || !IsValidPackageName(pkg.Name) || pkg.Name != grant.PackageName || strings.TrimSpace(pkg.Version) == "" || len(pkg.Version) > 256 {
		return nil, nil, errors.New("invalid_package: plugin manifest name/version does not match the approved plan")
	}
	if !IsTargetSupported(pkg.Frontends, grant.Frontend) {
		return nil, nil, errors.New("invalid_package: manifest does not support the approved frontend")
	}
	if len(pkg.Kernels) > 0 {
		return nil, nil, errors.New("invalid_package: kernel plugins are outside the approved frontend-only workflow")
	}
	for name := range inventory {
		if strings.EqualFold(name, "kernel.js") {
			return nil, nil, errors.New("invalid_package: kernel.js is outside the approved frontend-only workflow")
		}
	}
	resources := []string{}
	for _, name := range pkg.Readme {
		resources = append(resources, name)
	}
	if pkg.Icon != nil {
		resources = append(resources, *pkg.Icon)
	}
	if pkg.Preview != nil {
		resources = append(resources, *pkg.Preview)
	}
	for _, name := range resources {
		if err := util.ValidatePluginProjectFile(name); err != nil {
			return nil, nil, fmt.Errorf("invalid_package: declared resource path is unsafe: %s", name)
		}
		if _, ok := inventory[name]; !ok {
			return nil, nil, fmt.Errorf("invalid_package: declared resource is absent from the approved inventory: %s", name)
		}
	}
	var output bytes.Buffer
	w := zip.NewWriter(&output)
	w.RegisterCompressor(zip.Deflate, func(dst io.Writer) (io.WriteCloser, error) { return flate.NewWriter(dst, flate.BestCompression) })
	for _, name := range names {
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetModTime(time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC))
		header.SetMode(0644)
		file, err := w.CreateHeader(header)
		if err != nil {
			return nil, nil, err
		}
		if _, err = file.Write(snapshot[name]); err != nil {
			return nil, nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, nil, err
	}
	if int64(output.Len()) > MaxLocalPackageArchiveSize {
		return nil, nil, errors.New("too_large: archive exceeds local installation limit")
	}
	sourceRevision := util.PluginProjectTreeRevision(inventory)
	artifact := &util.PluginProjectArtifact{PackageHash: util.PluginProjectDigest(output.Bytes()), SourceRevision: sourceRevision, PackageName: pkg.Name, Version: pkg.Version, Frontend: grant.Frontend, FileListDigest: util.PluginProjectDigest([]byte(strings.Join(names, "\x00"))), PackagerVersion: pluginProjectPackagerVersion, Checks: map[string]string{
		"manifest": "passed", "approvedInventory": "passed", "entryAndDeclaredResources": "passed", "frontendDeclaration": "passed", "deterministicArchive": "passed", "privateKeyScan": "passed (limited supplemental scan)", "javascriptSyntax": "not run", "typescriptBuild": "not run", "installation": "not run", "frontendLoading": "not run", "runtimeBehavior": "not run",
	}}
	return output.Bytes(), artifact, nil
}

// PackagePluginProject 在全部校验通过后发布内容寻址归档。
// 仅单个 ZIP 发布是原子的；清单另行保存，失败时不将其标记为可安装。
func PackagePluginProject(ctx context.Context, taskID, expectedRevision string) (ret *util.PluginProjectArtifact, err error) {
	err = util.WithPluginProjectSource(ctx, true, func(grant *util.PluginDevelopmentGrant, root *os.Root) error {
		if grant.TaskID != taskID {
			return errors.New("invalid_path: task mismatch")
		}
		status, err := util.PluginProjectArtifactStatus(grant, root)
		if err != nil {
			return err
		}
		if status.Pending || status.ExternalChanges {
			return errors.New("revision_conflict: project has interrupted or external changes")
		}
		snapshot, err := util.SnapshotPluginProject(root, nil)
		if err != nil {
			return err
		}
		archive, artifact, err := buildPluginProjectArchive(grant, snapshot)
		if err != nil {
			return err
		}
		if expectedRevision == "" || artifact.SourceRevision != expectedRevision {
			return errors.New("revision_conflict: source differs from the expected revision")
		}
		// 归档始终消费上面的不可变字节快照，发布前再核对当前源码。
		again, err := util.SnapshotPluginProject(root, nil)
		if err != nil {
			return err
		}
		inventory := map[string]string{}
		for name, data := range again {
			inventory[name] = util.PluginProjectDigest(data)
		}
		if util.PluginProjectTreeRevision(inventory) != expectedRevision {
			return errors.New("revision_conflict: source changed while packaging")
		}
		if err = util.RecheckPluginProjectGrant(ctx, grant); err != nil {
			return err
		}
		artifactsPath := filepath.Join(util.PluginProjectRoot(taskID), "artifacts")
		artifacts, err := util.OpenPluginProjectDirectory(artifactsPath, true)
		if err != nil {
			return err
		}
		defer artifacts.Close()
		name := artifact.PackageHash + ".zip"
		if info, statErr := artifacts.Lstat(name); statErr == nil {
			if !util.PluginProjectRegularFile(info) {
				return errors.New("invalid_path: existing artifact is not a regular file")
			}
			file, readErr := util.OpenFileNoFollow(artifacts, name)
			if readErr != nil {
				return readErr
			}
			if readErr = util.CheckSingleLinkRegularFile(file); readErr != nil {
				file.Close()
				return readErr
			}
			existing, readErr := io.ReadAll(io.LimitReader(file, MaxLocalPackageArchiveSize+1))
			file.Close()
			if readErr != nil || int64(len(existing)) > MaxLocalPackageArchiveSize || util.PluginProjectDigest(existing) != artifact.PackageHash {
				return errors.New("revision_conflict: published archive changed")
			}
		} else {
			if !errors.Is(statErr, os.ErrNotExist) {
				return statErr
			}
			entries, readErr := os.ReadDir(artifactsPath)
			if readErr != nil {
				return readErr
			}
			var stored int64
			for _, entry := range entries {
				info, infoErr := entry.Info()
				if infoErr != nil {
					return infoErr
				}
				stored += info.Size()
			}
			if len(entries) >= 8 || stored+int64(len(archive)) > 256*1024*1024 {
				return errors.New("too_large: retained artifact limit reached; existing recovery artifacts were preserved")
			}
			tmp := ".package-" + artifact.PackageHash + ".tmp"
			file, writeErr := artifacts.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if writeErr != nil {
				return writeErr
			}
			defer artifacts.Remove(tmp)
			_, writeErr = file.Write(archive)
			if writeErr == nil {
				writeErr = file.Sync()
			}
			closeErr := file.Close()
			if writeErr != nil {
				return writeErr
			}
			if closeErr != nil {
				return closeErr
			}
			if err = artifacts.Rename(tmp, name); err != nil {
				return err
			}
		}
		abs := filepath.Join(artifactsPath, name)
		rel, _ := filepath.Rel(util.WorkspaceDir, abs)
		artifact.PackagePath = filepath.ToSlash(rel)
		ret = artifact
		if err = publishPluginProjectDelivery(grant, artifact, archive); err != nil {
			return fmt.Errorf("result_unknown: authoritative archive retained; delivery publication failed: %w", err)
		}
		if err = util.RecordPluginProjectArtifact(grant, artifact); err != nil {
			return fmt.Errorf("result_unknown: archive retained; ready metadata was not saved: %w", err)
		}
		ret = artifact
		return nil
	})
	return
}

// ResolvePluginProjectArtifact 仅解析当前有效的宿主归档，不开放任意受管文件。
// 安装仍须经过独立的原生工具权限确认。
func ResolvePluginProjectArtifact(ctx context.Context, taskID, archivePath, expectedHash string) (ret string, err error) {
	err = util.WithPluginProjectSource(ctx, false, func(grant *util.PluginDevelopmentGrant, root *os.Root) error {
		if grant.TaskID != taskID {
			return errors.New("invalid_path: task mismatch")
		}
		if err := util.RecheckPluginProjectGrant(ctx, grant); err != nil {
			return err
		}
		status, err := util.PluginProjectArtifactStatus(grant, root)
		if err != nil {
			return err
		}
		if status.Artifact == nil || (status.Artifact.PackagePath != archivePath && status.Artifact.DeliveryPath != archivePath) || status.Artifact.PackageHash != expectedHash {
			return errors.New("revision_conflict: archive is not the current approved project artifact")
		}
		ret = filepath.Join(util.WorkspaceDir, filepath.FromSlash(status.Artifact.PackagePath))
		return nil
	})
	return
}
