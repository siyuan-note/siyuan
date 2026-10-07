// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package util

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
)

const (
	PluginProjectMissingRevision       = "missing"
	PluginProjectMaxFiles              = 1024
	PluginProjectMaxFileBytes    int64 = 16 * 1024 * 1024
	PluginProjectMaxBytes        int64 = 64 * 1024 * 1024
)

type PluginProjectFile struct {
	Path     string `json:"path"`
	Revision string `json:"revision"`
	Bytes    int64  `json:"bytes"`
}

type PluginProjectMutation struct {
	OldRevision string `json:"oldRevision"`
	NewRevision string `json:"newRevision"`
}

type PluginProjectArtifact struct {
	PackagePath     string            `json:"packagePath"`
	PackageHash     string            `json:"packageHash"`
	SourceRevision  string            `json:"sourceRevision"`
	PackageName     string            `json:"packageName"`
	Version         string            `json:"version"`
	Frontend        string            `json:"frontend"`
	FileListDigest  string            `json:"fileListDigest"`
	PackagerVersion string            `json:"packagerVersion"`
	Checks          map[string]string `json:"checks"`
	DeliveryPath    string            `json:"deliveryPath,omitempty"`
	DownloadURL     string            `json:"downloadURL,omitempty"`
}

// 项目清单不保存授权状态；每次操作都须重新取得可信运行时授权。
type pluginProjectManifest struct {
	Version           int                                `json:"version"`
	PlanHash          string                             `json:"planHash"`
	SourcePath        string                             `json:"sourcePath,omitempty"`
	SourceRevision    string                             `json:"sourceRevision,omitempty"`
	Preparing         bool                               `json:"preparing,omitempty"`
	Baseline          map[string]string                  `json:"baseline"`
	BaselineDirectory string                             `json:"baselineDirectory,omitempty"`
	Current           map[string]string                  `json:"current"`
	Pending           map[string]PluginProjectMutation   `json:"pending,omitempty"`
	Journal           []map[string]PluginProjectMutation `json:"journal,omitempty"`
	TemporaryFiles    map[string]string                  `json:"temporaryFiles,omitempty"`
	Artifact          *PluginProjectArtifact             `json:"artifact,omitempty"`
}

type PluginProjectStatus struct {
	TaskID           string                      `json:"taskId,omitempty"`
	Prepared         bool                        `json:"prepared"`
	SourceRoot       string                      `json:"sourceRoot,omitempty"`
	SourceRevision   string                      `json:"sourceRevision"`
	BaselineRevision string                      `json:"baselineRevision,omitempty"`
	Files            []PluginProjectFile         `json:"files"`
	Excluded         []PluginProjectExcludedFile `json:"excluded,omitempty"`
	Pending          bool                        `json:"pending"`
	ExternalChanges  bool                        `json:"externalChanges"`
	PlanMismatch     bool                        `json:"planMismatch"`
	Artifact         *PluginProjectArtifact      `json:"artifact,omitempty"`
	RecoveryScope    string                      `json:"recoveryScope,omitempty"`
}

func PluginProjectDigest(data []byte) string { return fmt.Sprintf("%x", sha256.Sum256(data)) }

func validPluginProjectRevision(s string) bool {
	if s == PluginProjectMissingRevision {
		return true
	}
	b, err := hex.DecodeString(s)
	return err == nil && len(b) == sha256.Size && s == strings.ToLower(s)
}

// 即使出现在允许清单中，也拒绝平台别名及私密、构建依赖和运行时材料。
func ValidatePluginProjectFile(name string) error {
	if err := validateManagedSkillPath(name); err != nil {
		return fmt.Errorf("invalid_path: %w", err)
	}
	for _, part := range strings.Split(strings.ToLower(name), "/") {
		switch part {
		case "configs", "settings", "cache", "logs", "secrets", "credentials", "data.json", "settings.json", "token.json", "token.txt", "tokens.txt", "auth.json", "auth.txt", "credential.json", "credentials.txt", "secret.json", "secrets.json", "secrets.txt":
			return fmt.Errorf("invalid_path: credential or runtime material is not permitted: %s", name)
		}
		if strings.HasPrefix(part, ".") || strings.HasSuffix(part, ".log") || strings.HasSuffix(part, ".bak") || strings.HasSuffix(part, ".key") || strings.HasSuffix(part, ".pem") || strings.HasSuffix(part, ".p12") || strings.HasSuffix(part, ".pfx") || strings.HasSuffix(part, ".zip") || part == "node_modules" || part == "backup" || part == "backups" || part == "checkpoints" || part == "artifacts" || part == "storage" || part == "conf" || part == "config" || part == "conf.json" || part == "config.json" || part == "credentials.json" || part == "token" || part == "tokens.json" || strings.HasPrefix(part, "id_rsa") || strings.HasPrefix(part, "id_ed25519") {
			return fmt.Errorf("invalid_path: private, runtime or generated archive material is not permitted: %s", name)
		}
	}
	return nil
}

func pluginProjectAllowFiles(grant *PluginDevelopmentGrant) ([]string, error) {
	if len(grant.AllowFiles) == 0 || len(grant.AllowFiles) > PluginProjectMaxFiles {
		return nil, errors.New("invalid_path: approved file inventory is empty or too large")
	}
	files := append([]string(nil), grant.AllowFiles...)
	sort.Strings(files)
	seen := map[string]bool{}
	for _, name := range files {
		if err := ValidatePluginProjectFile(name); err != nil {
			return nil, err
		}
		key := strings.ToLower(name)
		if seen[key] {
			return nil, errors.New("invalid_path: duplicate or case-colliding approved file")
		}
		seen[key] = true
	}
	for key := range seen {
		for parent := path.Dir(key); parent != "."; parent = path.Dir(parent) {
			if seen[parent] {
				return nil, errors.New("invalid_path: file/directory collision")
			}
		}
	}
	return files, nil
}

// PluginProjectRegularFile 仅做打开前的普通文件预检；打开后还须用跨平台句柄检查硬链接数。
func PluginProjectRegularFile(info os.FileInfo) bool {
	if info == nil || !info.Mode().IsRegular() {
		return false
	}
	v := reflect.ValueOf(info.Sys())
	if v.Kind() == reflect.Pointer && !v.IsNil() {
		v = v.Elem()
	}
	if v.Kind() == reflect.Struct {
		links := v.FieldByName("Nlink")
		if links.IsValid() && links.CanUint() && links.Uint() > 1 {
			return false
		}
	}
	return true
}

// OpenPluginProjectDirectory 从工作空间目录句柄逐层打开，拒绝链接及目录身份变化。
func OpenPluginProjectDirectory(abs string, create bool) (*os.Root, error) {
	rel, err := filepath.Rel(WorkspaceDir, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return nil, errors.New("invalid_path: project path escapes workspace")
	}
	root, err := os.OpenRoot(WorkspaceDir)
	if err != nil {
		return nil, err
	}
	if rel == "." {
		return root, nil
	}
	for _, part := range strings.Split(filepath.ToSlash(rel), "/") {
		if part == "" || part == "." || part == ".." {
			root.Close()
			return nil, errors.New("invalid_path")
		}
		if create {
			if err = root.Mkdir(part, 0700); err != nil && !errors.Is(err, fs.ErrExist) {
				root.Close()
				return nil, err
			}
		}
		info, statErr := root.Lstat(part)
		if statErr != nil {
			root.Close()
			return nil, statErr
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			root.Close()
			return nil, errors.New("invalid_path: linked project directory")
		}
		next, openErr := root.OpenRoot(part)
		if openErr != nil {
			root.Close()
			return nil, openErr
		}
		actual, statErr := next.Stat(".")
		root.Close()
		if statErr != nil || !os.SameFile(info, actual) {
			next.Close()
			return nil, errors.New("invalid_path: project directory changed")
		}
		root = next
	}
	return root, nil
}

func readPluginProjectFile(root *os.Root, name string) ([]byte, error) {
	if err := checkManagedSkillPath(root, name); err != nil {
		return nil, err
	}
	info, err := root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !PluginProjectRegularFile(info) {
		return nil, errors.New("invalid_path: linked or special file")
	}
	if info.Size() > PluginProjectMaxFileBytes {
		return nil, errors.New("too_large: project file exceeds 16 MiB")
	}
	f, err := OpenFileNoFollow(root, name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	actual, err := f.Stat()
	if err != nil || !PluginProjectRegularFile(actual) || !os.SameFile(info, actual) {
		return nil, errors.New("revision_conflict: file identity changed")
	}
	if err = CheckSingleLinkRegularFile(f); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(f, PluginProjectMaxFileBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > PluginProjectMaxFileBytes {
		return nil, errors.New("too_large: project file exceeds 16 MiB")
	}
	return data, nil
}

// SnapshotPluginProject 读取有界不可变字节快照，拒绝所有不安全的受管成员。
func SnapshotPluginProject(root *os.Root, authorize func(string) error) (map[string][]byte, error) {
	return snapshotPluginProject(root, authorize, nil)
}

func snapshotPluginProject(root *os.Root, authorize func(string) error, temporaryFiles map[string]string) (map[string][]byte, error) {
	files := map[string][]byte{}
	seen := map[string]bool{}
	var total int64
	err := fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if name == "." {
			return nil
		}
		if revision, recorded := temporaryFiles[name]; recorded {

			data, err := readPluginProjectFile(root, name)
			if err != nil || PluginProjectDigest(data) != revision {
				return errors.New("result_unknown: recorded temporary file has incomplete or unknown bytes; preserved for inspection")
			}
			return nil
		}
		if authorize != nil {
			if err := authorize(filepath.Join(root.Name(), filepath.FromSlash(name))); err != nil {
				return err
			}
		}
		if err := ValidatePluginProjectFile(name); err != nil {
			return err
		}
		key := strings.ToLower(name)
		if seen[key] {
			return errors.New("invalid_path: case-colliding project paths")
		}
		seen[key] = true
		if len(seen) > PluginProjectMaxFiles*2 {
			return errors.New("too_large: project contains too many paths")
		}
		info, err := root.Lstat(name)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("invalid_path: linked project member")
		}
		if info.IsDir() {
			return nil
		}
		if len(files) >= PluginProjectMaxFiles {
			return errors.New("too_large: project contains too many files")
		}
		data, err := readPluginProjectFile(root, name)
		if err != nil {
			return err
		}
		total += int64(len(data))
		if total > PluginProjectMaxBytes {
			return errors.New("too_large: project exceeds 64 MiB")
		}
		files[name] = data
		return nil
	})
	return files, err
}

func projectInventory(files map[string][]byte) map[string]string {
	ret := map[string]string{}
	for name, data := range files {
		ret[name] = PluginProjectDigest(data)
	}
	return ret
}

func PluginProjectTreeRevision(inventory map[string]string) string {
	names := make([]string, 0, len(inventory))
	for name := range inventory {
		names = append(names, name)
	}
	sort.Strings(names)
	h := sha256.New()
	for _, name := range names {
		fmt.Fprintf(h, "file\x00%s\x00%s\x00", name, inventory[name])
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

func projectStatus(files map[string][]byte) *PluginProjectStatus {
	ret := &PluginProjectStatus{SourceRevision: PluginProjectTreeRevision(projectInventory(files)), Files: []PluginProjectFile{}}
	for name, data := range files {
		ret.Files = append(ret.Files, PluginProjectFile{name, PluginProjectDigest(data), int64(len(data))})
	}
	sort.Slice(ret.Files, func(i, j int) bool { return ret.Files[i].Path < ret.Files[j].Path })
	return ret
}

func InspectPluginProjectSource(abs string, authorize func(string) error, selected ...[]string) (*PluginProjectStatus, error) {
	if authorize != nil {
		if err := authorize(abs); err != nil {
			return nil, err
		}
	}
	root, err := OpenPluginProjectDirectory(abs, false)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	if len(selected) == 0 {
		return inspectPluginProjectCandidate(root, authorize)
	}
	if len(selected) != 1 {
		return nil, errors.New("invalid_path: invalid selected source inventory")
	}
	files, err := snapshotSelectedPluginSource(root, selected[0], authorize)
	if err != nil {
		return nil, err
	}
	return projectStatus(files), nil
}

func checkPluginProjectGrant(grant *PluginDevelopmentGrant, taskID string) error {
	if taskID == "" || grant.TaskID != taskID || !fs.ValidPath(taskID) || strings.ContainsAny(taskID, "/\\:.") {
		return errors.New("invalid_path: invalid project task")
	}
	want := filepath.Join(PluginProjectRoot(taskID), "source")
	if grant.SourceRoot != want {
		return errors.New("invalid_path: source root does not match host project")
	}
	return nil
}

func writePluginProjectBytes(root *os.Root, name string, data []byte) error {
	if err := root.MkdirAll(path.Dir(name), 0700); err != nil {
		return err
	}
	if err := checkManagedSkillPath(root, name); err != nil {
		return err
	}
	f, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func readPluginProjectManifest(grant *PluginDevelopmentGrant) (*pluginProjectManifest, error) {
	manifest, err := readPluginProjectManifestForStatus(grant)
	if err != nil {
		return nil, err
	}
	if manifest.PlanHash != grant.PlanHash {
		return nil, errors.New("revision_conflict: prepare_project with expectedSourceRevision is required for the newly approved plan")
	}
	return manifest, nil
}

func readPluginProjectManifestForStatus(grant *PluginDevelopmentGrant) (*pluginProjectManifest, error) {
	root, err := OpenPluginProjectDirectory(PluginProjectPrivateDir(grant.TaskID), false)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	data, err := readPluginProjectFile(root, "project.json")
	if err != nil {
		return nil, err
	}
	var manifest pluginProjectManifest
	if err = json.Unmarshal(data, &manifest); err != nil {
		return nil, err
	}
	if manifest.Version != 1 || manifest.Baseline == nil || manifest.Current == nil {
		return nil, errors.New("revision_conflict: project belongs to another approved plan")
	}
	return &manifest, nil
}

func savePluginProjectManifest(grant *PluginDevelopmentGrant, manifest *pluginProjectManifest) error {
	root, err := OpenPluginProjectDirectory(PluginProjectPrivateDir(grant.TaskID), false)
	if err != nil {
		return err
	}
	defer root.Close()
	data, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	name := ".project-" + rand.Text() + ".tmp"
	if err = writePluginProjectBytes(root, name, data); err != nil {
		return err
	}
	defer root.Remove(name)
	return root.Rename(name, "project.json")
}

func validateProjectBaseline(grant *PluginDevelopmentGrant, manifest *pluginProjectManifest) error {
	root, err := OpenPluginProjectDirectory(pluginProjectBaselinePath(grant, manifest), false)
	if err != nil {
		return fmt.Errorf("backup_failed: %w", err)
	}
	defer root.Close()
	files, err := SnapshotPluginProject(root, nil)
	if err != nil || PluginProjectTreeRevision(projectInventory(files)) != PluginProjectTreeRevision(manifest.Baseline) {
		return errors.New("backup_failed: baseline checkpoint is missing or changed")
	}
	return nil
}

func PreparePluginProject(ctx context.Context, taskID string, authorize func(string) error, expectedSourceRevision ...string) (ret *PluginProjectStatus, err error) {
	err = WithPluginProjectLockContext(ctx, taskID, func() error {
		grant, err := RequirePluginDevelopment(ctx, "write")
		recoveryOnly := false
		if err != nil {
			grant, err = RequirePluginDevelopment(ctx, "recover")
			if err != nil {
				return err
			}
			recoveryOnly = true
		}
		if err = checkPluginProjectGrant(grant, taskID); err != nil {
			return err
		}
		allowed, err := pluginProjectAllowFiles(grant)
		if err != nil {
			return err
		}
		if err = validatePluginProjectPrefixes(allowed); err != nil {
			return err
		}
		if manifest, readErr := readPluginProjectManifestForStatus(grant); readErr == nil {
			if manifest.Preparing {
				if manifest.PlanHash != grant.PlanHash || manifest.SourcePath != grant.SourcePath || manifest.SourceRevision != grant.SourceRevision {
					return errors.New("revision_conflict: finish interrupted preparation before changing plans")
				}
				ret, err = resumePluginProjectPreparation(ctx, grant, manifest, allowed, recoveryOnly)
				return err
			}
			if recoveryOnly {
				return errors.New("recovery-only approval cannot initialize or replan a project")
			}
			expected := ""
			if len(expectedSourceRevision) == 1 {
				expected = expectedSourceRevision[0]
			}
			ret, err = replanPluginProject(ctx, grant, allowed, expected)
			return err
		} else if !errors.Is(readErr, os.ErrNotExist) {
			return readErr
		}
		if recoveryOnly {
			return errors.New("recovery-only approval cannot initialize a project")
		}
		if _, err = os.Lstat(PluginProjectRoot(taskID)); err == nil {
			return errors.New("result_unknown: unregistered project source exists; preserved for inspection")
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		selected := map[string][]byte{}
		if grant.SourcePath != "" {
			if filepath.IsAbs(grant.SourcePath) || !IsPublishRelativePath(grant.SourcePath) {
				return errors.New("invalid_path: sourcePath must be workspace relative")
			}
			abs := filepath.Join(WorkspaceDir, filepath.FromSlash(grant.SourcePath))
			if authorize != nil {
				if err = authorize(abs); err != nil {
					return err
				}
			}
			root, openErr := OpenPluginProjectDirectory(abs, false)
			if openErr != nil {
				return openErr
			}
			defer root.Close()
			identity, statErr := root.Stat(".")
			if statErr != nil {
				return statErr
			}
			selected, err = snapshotSelectedPluginSource(root, allowed, authorize)
			if err != nil {
				return err
			}
			if PluginProjectTreeRevision(projectInventory(selected)) != grant.SourceRevision {
				return errors.New("revision_conflict: approved selected import source changed; inspect with sourceFiles matching the approved allowFiles")
			}
			again, inspectErr := InspectPluginProjectSource(abs, authorize, allowed)
			actual, statErr := os.Stat(abs)
			if inspectErr != nil || statErr != nil || !os.SameFile(identity, actual) || again.SourceRevision != grant.SourceRevision {
				return errors.New("revision_conflict: selected import source changed while freezing")
			}
		}
		if err = ensurePluginProjectCheckpoint(grant, "baseline", selected); err != nil {
			return err
		}
		manifest := &pluginProjectManifest{Version: 1, PlanHash: grant.PlanHash, SourcePath: grant.SourcePath, SourceRevision: grant.SourceRevision, Preparing: true, Baseline: projectInventory(selected), Current: map[string]string{}}
		if err = savePluginProjectManifest(grant, manifest); err != nil {
			return fmt.Errorf("backup_failed: preparation journal not saved; source was not created: %w", err)
		}
		ret, err = resumePluginProjectPreparation(ctx, grant, manifest, allowed, false)
		return err
	})
	return
}

func workspacePluginProjectPath(abs string) string {
	rel, _ := filepath.Rel(WorkspaceDir, abs)
	return filepath.ToSlash(rel)
}

func WithPluginProjectSource(ctx context.Context, write bool, fn func(*PluginDevelopmentGrant, *os.Root) error) error {
	operation := "read"
	if write {
		operation = "write"
	}
	grant, err := RequirePluginDevelopment(ctx, operation)
	if err != nil {
		return err
	}
	lockedTaskID := grant.TaskID
	return WithPluginProjectLockContext(ctx, lockedTaskID, func() error {
		grant, err = RequirePluginDevelopment(ctx, operation)
		if err != nil {
			return err
		}
		if grant.TaskID != lockedTaskID {
			return errors.New("revision_conflict: active task changed while waiting for the project lock")
		}
		if err = checkPluginProjectGrant(grant, grant.TaskID); err != nil {
			return err
		}
		manifest, err := readPluginProjectManifestForStatus(grant)
		if err != nil {
			return err
		}
		if write {
			if manifest.Preparing {
				return errors.New("result_unknown: retry prepare_project to finish interrupted preparation")
			}
			if manifest.PlanHash != grant.PlanHash {
				return errors.New("revision_conflict: prepare_project is required for the newly approved plan")
			}
			if len(manifest.Pending) != 0 {
				return errors.New("result_unknown: interrupted mutation requires project_status and restore_project")
			}
			if err = validateProjectBaseline(grant, manifest); err != nil {
				return err
			}
		}
		root, err := OpenPluginProjectDirectory(grant.SourceRoot, false)
		if err != nil {
			return err
		}
		defer root.Close()
		return fn(grant, root)
	})
}

func GetPluginProjectStatus(ctx context.Context, taskID string) (ret *PluginProjectStatus, err error) {
	err = WithPluginProjectLockContext(ctx, taskID, func() error {
		grant, grantErr := RequirePluginDevelopment(ctx, "read")
		if grantErr != nil {
			return grantErr
		}
		if err = checkPluginProjectGrant(grant, taskID); err != nil {
			return err
		}
		manifest, readErr := readPluginProjectManifestForStatus(grant)
		if readErr != nil {
			return readErr
		}
		root, openErr := OpenPluginProjectDirectory(grant.SourceRoot, false)
		if errors.Is(openErr, os.ErrNotExist) && manifest.Preparing {
			ret = &PluginProjectStatus{TaskID: taskID, Prepared: false, Pending: true, SourceRoot: workspacePluginProjectPath(grant.SourceRoot), SourceRevision: PluginProjectMissingRevision, BaselineRevision: PluginProjectTreeRevision(manifest.Baseline), Files: []PluginProjectFile{}, PlanMismatch: manifest.PlanHash != grant.PlanHash, RecoveryScope: "preparation interrupted before source publication; retry prepare_project with the same approved plan"}
			return nil
		}
		if openErr != nil {
			return openErr
		}
		defer root.Close()
		ret, err = PluginProjectArtifactStatus(grant, root)
		return err
	})
	return
}

// PluginProjectArtifactStatus 只读投影项目及制品状态，调用方须持有项目锁。
func PluginProjectArtifactStatus(grant *PluginDevelopmentGrant, root *os.Root) (*PluginProjectStatus, error) {
	manifest, err := readPluginProjectManifestForStatus(grant)
	if err != nil {
		return nil, err
	}
	files, err := snapshotPluginProject(root, nil, manifest.TemporaryFiles)
	if err != nil {
		if len(manifest.Pending) > 0 {
			return nil, fmt.Errorf("result_unknown: pending project cannot be safely inspected; manual inspection required; source and journal preserved: %w", err)
		}
		return nil, err
	}
	ret := projectStatus(files)
	ret.TaskID, ret.Prepared, ret.SourceRoot = grant.TaskID, !manifest.Preparing, workspacePluginProjectPath(grant.SourceRoot)
	ret.BaselineRevision = PluginProjectTreeRevision(manifest.Baseline)
	ret.Pending = manifest.Preparing || len(manifest.Pending) > 0
	ret.ExternalChanges = ret.SourceRevision != PluginProjectTreeRevision(manifest.Current)
	ret.PlanMismatch = manifest.PlanHash != grant.PlanHash
	if !ret.Pending && !ret.ExternalChanges && !ret.PlanMismatch && manifest.Artifact != nil && manifest.Artifact.SourceRevision == ret.SourceRevision {
		ret.Artifact = manifest.Artifact
	}
	ret.RecoveryScope = "code only; restoration refuses external edits; multi-file restoration is not atomic"
	return ret, nil
}

// Begin/Finish 在 WithPluginProjectSource 的锁内执行；重命名的两个路径共用一条操作日志。
func BeginPluginProjectMutations(grant *PluginDevelopmentGrant, changes map[string]PluginProjectMutation, temporaryPaths ...string) error {
	manifest, err := readPluginProjectManifest(grant)
	if err != nil {
		return err
	}
	if len(changes) == 0 || len(manifest.Pending) > 0 {
		return errors.New("result_unknown: pending or empty project mutation")
	}
	if err = validateProjectBaseline(grant, manifest); err != nil {
		return err
	}
	allowed, err := pluginProjectAllowFiles(grant)
	if err != nil {
		return err
	}
	set := map[string]bool{}
	for _, name := range allowed {
		set[name] = true
	}
	root, err := OpenPluginProjectDirectory(grant.SourceRoot, false)
	if err != nil {
		return err
	}
	defer root.Close()
	files, err := SnapshotPluginProject(root, nil)
	if err != nil {
		return err
	}
	if PluginProjectTreeRevision(projectInventory(files)) != PluginProjectTreeRevision(manifest.Current) {
		return errors.New("revision_conflict: source contains external edits")
	}
	for name, change := range changes {
		if !set[name] || !validPluginProjectRevision(change.OldRevision) || !validPluginProjectRevision(change.NewRevision) {
			return errors.New("invalid_path: mutation is outside the approved inventory")
		}
		old := manifest.Current[name]
		if old == "" {
			old = PluginProjectMissingRevision
		}
		if old != change.OldRevision {
			return errors.New("revision_conflict: mutation old revision differs")
		}
	}
	manifest.Pending, manifest.Artifact = changes, nil
	manifest.TemporaryFiles = map[string]string{}
	if len(temporaryPaths) > 0 {
		if len(changes) != 1 || len(temporaryPaths) != 1 {
			return errors.New("invalid_path: temporary file requires one mutation")
		}
		for name, change := range changes {
			tmp := temporaryPaths[0]
			if path.Dir(tmp) != path.Dir(name) || !strings.HasPrefix(path.Base(tmp), ".text-file-") || validateManagedSkillPath(tmp) != nil || change.NewRevision == PluginProjectMissingRevision {
				return errors.New("invalid_path: invalid host temporary file")
			}
			manifest.TemporaryFiles[tmp] = change.NewRevision
		}
	}
	if len(manifest.Journal) >= 512 {
		return errors.New("backup_failed: project journal limit reached; recovery history was preserved")
	}
	manifest.Journal = append(manifest.Journal, changes)
	if err = savePluginProjectManifest(grant, manifest); err != nil {
		return fmt.Errorf("backup_failed: mutation journal could not be saved: %w", err)
	}
	return nil
}

func BeginPluginProjectMutation(grant *PluginDevelopmentGrant, name, oldRevision, newRevision string, temporaryPaths ...string) error {
	return BeginPluginProjectMutations(grant, map[string]PluginProjectMutation{name: {OldRevision: oldRevision, NewRevision: newRevision}}, temporaryPaths...)
}

func FinishPluginProjectMutations(grant *PluginDevelopmentGrant, paths []string) error {
	manifest, err := readPluginProjectManifest(grant)
	if err != nil {
		return err
	}
	if len(paths) != len(manifest.Pending) {
		return errors.New("result_unknown: incomplete mutation completion")
	}
	root, err := OpenPluginProjectDirectory(grant.SourceRoot, false)
	if err != nil {
		return err
	}
	defer root.Close()
	files, err := SnapshotPluginProject(root, nil)
	if err != nil {
		return err
	}
	for _, name := range paths {
		change, ok := manifest.Pending[name]
		if !ok {
			return errors.New("result_unknown: mutation journal mismatch")
		}
		actual := PluginProjectMissingRevision
		if data, ok := files[name]; ok {
			actual = PluginProjectDigest(data)
		}
		if actual != change.NewRevision {
			return errors.New("result_unknown: mutation result differs; journal preserved")
		}
		if actual == PluginProjectMissingRevision {
			delete(manifest.Current, name)
		} else {
			manifest.Current[name] = actual
		}
	}
	if PluginProjectTreeRevision(projectInventory(files)) != PluginProjectTreeRevision(manifest.Current) {
		return errors.New("result_unknown: source changed while completing mutation")
	}
	manifest.Pending = nil
	manifest.TemporaryFiles = nil
	return savePluginProjectManifest(grant, manifest)
}

func FinishPluginProjectMutation(grant *PluginDevelopmentGrant, name string) error {
	return FinishPluginProjectMutations(grant, []string{name})
}

// RecordPluginProjectArtifact 在 ZIP 原子发布后、项目锁内记录制品。
func RecordPluginProjectArtifact(grant *PluginDevelopmentGrant, artifact *PluginProjectArtifact) error {
	manifest, err := readPluginProjectManifest(grant)
	if err != nil {
		return err
	}
	if len(manifest.Pending) > 0 || artifact.SourceRevision != PluginProjectTreeRevision(manifest.Current) {
		return errors.New("revision_conflict: artifact source is not the recorded project revision")
	}
	manifest.Artifact = artifact
	return savePluginProjectManifest(grant, manifest)
}

// RestorePluginProject 先持久化整次恢复日志；崩溃可能留下部分恢复结果。
// 再次恢复只接受各文件记录的旧版或新版字节，不覆盖未知外部修改。
func RestorePluginProject(ctx context.Context, taskID, expectedRevision string) (ret *PluginProjectStatus, err error) {
	err = WithPluginProjectLockContext(ctx, taskID, func() (operationErr error) {
		restorationStarted := false
		defer func() {
			if restorationStarted && operationErr != nil && !strings.Contains(operationErr.Error(), "result_unknown") {
				operationErr = fmt.Errorf("result_unknown: restoration may be partial; journal and checkpoints preserved: %w", operationErr)
			}
		}()
		grant, err := RequirePluginDevelopment(ctx, "recover")
		if err != nil {
			return err
		}
		if err = checkPluginProjectGrant(grant, taskID); err != nil {
			return err
		}
		manifest, err := readPluginProjectManifest(grant)
		if err != nil {
			return err
		}
		if err = validateProjectBaseline(grant, manifest); err != nil {
			return err
		}
		root, err := OpenPluginProjectDirectory(grant.SourceRoot, false)
		if err != nil {
			return err
		}
		defer root.Close()
		files, err := snapshotPluginProject(root, nil, manifest.TemporaryFiles)
		if err != nil {
			if len(manifest.Pending) > 0 {
				return fmt.Errorf("result_unknown: pending project cannot be safely restored; manual inspection required; source and journal preserved: %w", err)
			}
			return err
		}
		inventory := projectInventory(files)
		if expectedRevision == "" || PluginProjectTreeRevision(inventory) != expectedRevision {
			return errors.New("revision_conflict: current project revision changed")
		}
		known := map[string]string{}
		for name, rev := range manifest.Current {
			known[name] = rev
		}
		for name, change := range manifest.Pending {
			actual := inventory[name]
			if actual == "" {
				actual = PluginProjectMissingRevision
			}
			if actual != change.OldRevision && actual != change.NewRevision {
				return errors.New("revision_conflict: recovery would overwrite an external edit")
			}
			if actual == PluginProjectMissingRevision {
				delete(known, name)
			} else {
				known[name] = actual
			}
		}
		if PluginProjectTreeRevision(known) != expectedRevision {
			return errors.New("revision_conflict: recovery would overwrite an external edit")
		}
		baseline, err := OpenPluginProjectDirectory(pluginProjectBaselinePath(grant, manifest), false)
		if err != nil {
			return err
		}
		defer baseline.Close()
		baselineFiles, err := SnapshotPluginProject(baseline, nil)
		if err != nil {
			return err
		}
		if err = recheckPluginProjectGrantOperation(ctx, grant, "recover"); err != nil {
			return err
		}
		restorationStarted = true
		changes := map[string]PluginProjectMutation{}
		for name, old := range inventory {
			next := manifest.Baseline[name]
			if next == "" {
				next = PluginProjectMissingRevision
			}
			if old != next {
				changes[name] = PluginProjectMutation{old, next}
			}
		}
		for name, next := range manifest.Baseline {
			if _, ok := inventory[name]; !ok {
				changes[name] = PluginProjectMutation{PluginProjectMissingRevision, next}
			}
		}
		manifest.Current, manifest.Pending, manifest.Artifact = inventory, changes, nil
		if len(manifest.Journal) >= 512 {
			return errors.New("backup_failed: project journal limit reached; recovery history was preserved")
		}
		manifest.Journal = append(manifest.Journal, changes)
		if manifest.TemporaryFiles == nil {
			manifest.TemporaryFiles = map[string]string{}
		}
		for name, change := range changes {
			if change.NewRevision != PluginProjectMissingRevision {
				manifest.TemporaryFiles[path.Join(path.Dir(name), ".restore-"+PluginProjectDigest([]byte(name))+".tmp")] = change.NewRevision
			}
		}
		if err = savePluginProjectManifest(grant, manifest); err != nil {
			return fmt.Errorf("backup_failed: %w", err)
		}
		restorationStarted = true
		for name, revision := range manifest.TemporaryFiles {
			data, readErr := readPluginProjectFile(root, name)
			if errors.Is(readErr, os.ErrNotExist) {
				continue
			}
			if readErr != nil || PluginProjectDigest(data) != revision {
				return errors.New("result_unknown: temporary file changed during restoration; preserved")
			}
			if err = root.Remove(name); err != nil {
				return err
			}
		}
		for name, change := range changes {
			if err = recheckPluginProjectGrantOperation(ctx, grant, "recover"); err != nil {
				return err
			}
			actual := PluginProjectMissingRevision
			data, readErr := readPluginProjectFile(root, name)
			if readErr == nil {
				actual = PluginProjectDigest(data)
			} else if !errors.Is(readErr, fs.ErrNotExist) {
				return readErr
			}
			if actual != change.OldRevision {
				return errors.New("revision_conflict: source changed during restoration; journal preserved")
			}
			if change.NewRevision == PluginProjectMissingRevision {
				err = root.Remove(name)
			} else {
				tmp := path.Join(path.Dir(name), ".restore-"+PluginProjectDigest([]byte(name))+".tmp")
				if err = writePluginProjectBytes(root, tmp, baselineFiles[name]); err == nil {
					err = root.Rename(tmp, name)
				}
				if err != nil {
					_ = root.Remove(tmp)
				}
			}
			if err != nil {
				return fmt.Errorf("result_unknown: restoration interrupted; journal preserved: %w", err)
			}
		}
		restored, err := SnapshotPluginProject(root, nil)
		if err != nil {
			return err
		}
		if PluginProjectTreeRevision(projectInventory(restored)) != PluginProjectTreeRevision(manifest.Baseline) {
			return errors.New("result_unknown: restored source differs; journal preserved")
		}
		manifest.Current, manifest.Pending = projectInventory(restored), nil
		manifest.TemporaryFiles = nil
		if err = savePluginProjectManifest(grant, manifest); err != nil {
			return err
		}
		if _, err = RequirePluginDevelopment(ctx, "recovered"); err != nil {
			return err
		}
		ret = projectStatus(restored)
		ret.Prepared, ret.TaskID, ret.SourceRoot, ret.BaselineRevision = true, taskID, workspacePluginProjectPath(grant.SourceRoot), ret.SourceRevision
		ret.RecoveryScope = "code baseline restored; runtime data, configuration and running plugins were not restored"
		return nil
	})
	return
}
