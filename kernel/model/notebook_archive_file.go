package model

import (
	"archive/zip"
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
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	ErrNotebookArchiveInvalid        = errors.New("invalid encrypted notebook archive")
	ErrNotebookArchiveChanged        = errors.New("encrypted notebook archive sources changed")
	ErrNotebookArchiveBusy           = errors.New("encrypted notebook archive operation is busy")
	ErrNotebookArchiveConfigured     = errors.New("encrypted notebook recovery requires an unconfigured workspace")
	ErrNotebookArchiveAuthentication = errors.New("encrypted notebook archive authentication failed")
)

const notebookArchiveFormat = "siyuan-encrypted-notebooks"
const notebookArchiveMaxEntries = 1000000
const notebookArchiveMaxManifestSize = 128 * 1024 * 1024

type notebookArchiveFile struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// notebookArchiveManifest 仅封装原始密文，不改变密文、AAD、文件名或密钥包络的既有格式。
type notebookArchiveManifest struct {
	Format    string                         `json:"format"`
	Version   int                            `json:"version"`
	ID        string                         `json:"id"`
	Notebooks []string                       `json:"notebooks"`
	Roots     []string                       `json:"roots"`
	Files     map[string]notebookArchiveFile `json:"files"`
}

func notebookArchiveBase() string {
	return filepath.Join(util.ConfDir, "notebook-archives")
}

func notebookArchiveDirectory(id string) (string, error) {
	if !ast.IsNodeIDPattern(id) {
		return "", ErrNotebookArchiveInvalid
	}
	return filepath.Join(notebookArchiveBase(), id), nil
}

// archiveRelativePath 拒绝跨平台路径歧义、目录穿越和符号链接目标，不把归档路径当作任意磁盘路径。
func archiveRelativePath(name string) bool {
	if name == "" || path.Clean(name) != name || strings.HasPrefix(name, "/") || strings.ContainsAny(name, "\\:\x00<>\"|?*") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		base := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		reserved := base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" ||
			(len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '1' && base[3] <= '9')
		if part == "." || part == ".." || strings.TrimRight(part, ". ") != part || reserved {
			return false
		}
	}
	return true
}

func archiveSourcePath(root string) (string, error) {
	if !archiveRelativePath(root) {
		return "", ErrNotebookArchiveInvalid
	}
	parts := strings.Split(root, "/")
	if len(parts) == 2 && parts[0] == "data" && ast.IsNodeIDPattern(parts[1]) {
		return filepath.Join(util.DataDir, parts[1]), nil
	}
	if len(parts) == 3 && parts[0] == "history" && ast.IsNodeIDPattern(parts[2]) {
		return filepath.Join(util.HistoryDir, parts[1], parts[2]), nil
	}
	return "", ErrNotebookArchiveInvalid
}

func archiveFingerprint(reader io.Reader) (notebookArchiveFile, error) {
	hash := sha256.New()
	size, err := io.Copy(hash, reader)
	return notebookArchiveFile{Size: size, SHA256: hex.EncodeToString(hash.Sum(nil))}, err
}

func archiveCopyFile(source, destination string) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return ErrNotebookArchiveInvalid
	}
	if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	if copyErr == nil {
		copyErr = output.Sync()
	}
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func archiveWalk(root string, visit func(string, string) error) error {
	return filepath.WalkDir(root, func(fullPath string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return ErrNotebookArchiveInvalid
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return ErrNotebookArchiveInvalid
		}
		rel, err := filepath.Rel(root, fullPath)
		if err != nil || !archiveRelativePath(filepath.ToSlash(rel)) {
			return ErrNotebookArchiveInvalid
		}
		return visit(filepath.ToSlash(rel), fullPath)
	})
}

func archiveDirectoryFiles(root string) (map[string]notebookArchiveFile, error) {
	files := map[string]notebookArchiveFile{}
	err := archiveWalk(root, func(name, fullPath string) error {
		file, err := os.Open(fullPath)
		if err != nil {
			return err
		}
		defer file.Close()
		fingerprint, err := archiveFingerprint(file)
		files[name] = fingerprint
		return err
	})
	return files, err
}

func writeNotebookArchive(directory string, manifest *notebookArchiveManifest) error {
	payload := filepath.Join(directory, "payload")
	var err error
	manifest.Files, err = archiveDirectoryFiles(payload)
	if err != nil {
		return err
	}
	if len(manifest.Files) > notebookArchiveMaxEntries {
		return ErrNotebookArchiveInvalid
	}
	data, err := json.Marshal(manifest)
	if err != nil || len(data) > notebookArchiveMaxManifestSize {
		return ErrNotebookArchiveInvalid
	}
	file, err := os.OpenFile(filepath.Join(directory, "archive.zip"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	writer := zip.NewWriter(file)
	entry, err := writer.Create("manifest.json")
	if err != nil {
		return err
	}
	if _, err = entry.Write(data); err != nil {
		return err
	}
	names := make([]string, 0, len(manifest.Files))
	for name := range manifest.Files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		entry, err = writer.Create(name)
		if err != nil {
			return err
		}
		input, openErr := os.Open(filepath.Join(payload, filepath.FromSlash(name)))
		if openErr != nil {
			return openErr
		}
		_, err = io.Copy(entry, input)
		input.Close()
		if err != nil {
			return err
		}
	}
	if err = writer.Close(); err != nil {
		return err
	}
	return file.Sync()
}

// readNotebookArchive 完整校验清单与所有条目，再向独立暂存目录写入；摘要只证明复制完整性。
func readNotebookArchive(archivePath, destination string) (*notebookArchiveManifest, error) {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNotebookArchiveInvalid, err)
	}
	defer reader.Close()
	if len(reader.File) > notebookArchiveMaxEntries+1 {
		return nil, ErrNotebookArchiveInvalid
	}
	entries := map[string]*zip.File{}
	caseNames := map[string]bool{}
	for _, file := range reader.File {
		if !archiveRelativePath(file.Name) || !file.Mode().IsRegular() || caseNames[strings.ToLower(file.Name)] {
			return nil, ErrNotebookArchiveInvalid
		}
		entries[file.Name] = file
		caseNames[strings.ToLower(file.Name)] = true
	}
	metadata := entries["manifest.json"]
	if metadata == nil || metadata.UncompressedSize64 > notebookArchiveMaxManifestSize {
		return nil, ErrNotebookArchiveInvalid
	}
	input, err := metadata.Open()
	if err != nil {
		return nil, err
	}
	data, readErr := io.ReadAll(io.LimitReader(input, notebookArchiveMaxManifestSize+1))
	input.Close()
	manifest := &notebookArchiveManifest{}
	if readErr != nil || json.Unmarshal(data, manifest) != nil || validateNotebookArchiveManifest(manifest) != nil || len(entries) != len(manifest.Files)+1 {
		return nil, ErrNotebookArchiveInvalid
	}
	for name, expected := range manifest.Files {
		file := entries[name]
		if file == nil || expected.Size < 0 || uint64(expected.Size) != file.UncompressedSize64 {
			return nil, ErrNotebookArchiveInvalid
		}
		input, err = file.Open()
		if err != nil {
			return nil, err
		}
		var output *os.File
		var target io.Writer = io.Discard
		if destination != "" {
			fullPath := filepath.Join(destination, filepath.FromSlash(name))
			if err = os.MkdirAll(filepath.Dir(fullPath), 0700); err == nil {
				output, err = os.OpenFile(fullPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			}
			if err != nil {
				input.Close()
				return nil, err
			}
			target = output
		}
		actual, copyErr := archiveFingerprint(io.TeeReader(io.LimitReader(input, expected.Size+1), target))
		closeErr := input.Close()
		if output != nil {
			if syncErr := output.Sync(); copyErr == nil {
				copyErr = syncErr
			}
			if outputErr := output.Close(); copyErr == nil {
				copyErr = outputErr
			}
		}
		if copyErr != nil || closeErr != nil || actual != expected {
			return nil, ErrNotebookArchiveInvalid
		}
	}
	return manifest, nil
}

func validateNotebookArchiveManifest(manifest *notebookArchiveManifest) error {
	if manifest.Format != notebookArchiveFormat || manifest.Version != 1 || !ast.IsNodeIDPattern(manifest.ID) || len(manifest.Notebooks) == 0 || len(manifest.Files) == 0 {
		return ErrNotebookArchiveInvalid
	}
	ids := map[string]bool{}
	for _, id := range manifest.Notebooks {
		if !ast.IsNodeIDPattern(id) || ids[id] {
			return ErrNotebookArchiveInvalid
		}
		ids[id] = true
	}
	roots := map[string]bool{}
	covered := map[string]bool{}
	for _, root := range manifest.Roots {
		if _, err := archiveSourcePath(root); err != nil || roots[root] || !ids[path.Base(root)] {
			return ErrNotebookArchiveInvalid
		}
		roots[root] = true
		covered[path.Base(root)] = true
	}
	for name, file := range manifest.Files {
		if !archiveRelativePath(name) || file.Size < 0 || len(file.SHA256) != 64 {
			return ErrNotebookArchiveInvalid
		}
		valid := name == "keys/conf.json" || name == "keys/persisted-conf.json" || name == "keys/backup.json" || name == "keys/migration.json"
		for root := range roots {
			valid = valid || strings.HasPrefix(name, root+"/")
		}
		parts := strings.Split(name, "/")
		if len(parts) >= 4 && parts[0] == "snapshots" && len(parts[1]) == 40 {
			valid = ids[parts[2]] || (parts[2] == "keys" && len(parts) == 4 && (parts[3] == "backup.json" || parts[3] == "migration.json"))
			if ids[parts[2]] {
				covered[parts[2]] = true
			}
		}
		if !valid {
			return ErrNotebookArchiveInvalid
		}
	}
	for id := range ids {
		if !covered[id] {
			return ErrNotebookArchiveInvalid
		}
	}
	return nil
}
