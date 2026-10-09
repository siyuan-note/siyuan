package util

import (
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

type PluginProjectExcludedFile struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

func validatePluginProjectPrefixes(names []string) error {
	seen := map[string]string{}
	files := map[string]bool{}
	for _, name := range names {
		if err := ValidatePluginProjectFile(name); err != nil {
			return err
		}
		key := strings.ToLower(name)
		if files[key] {
			return errors.New("invalid_path: duplicate or case-colliding approved file")
		}
		files[key] = true
		for prefix := name; prefix != "."; prefix = path.Dir(prefix) {
			key := strings.ToLower(prefix)
			if old, ok := seen[key]; ok && old != prefix {
				return errors.New("invalid_path: case-colliding source path prefix")
			}
			seen[key] = prefix
		}
	}
	for name := range files {
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			if files[parent] {
				return errors.New("invalid_path: source file/directory collision")
			}
		}
	}
	return nil
}

// 只读取冻结允许清单的现有文件；允许将未来新建文件列入方案，但绝不追随链接。
func snapshotSelectedPluginSource(root *os.Root, selected []string, authorize func(string) error) (map[string][]byte, error) {
	if len(selected) == 0 || len(selected) > PluginProjectMaxFiles {
		return nil, errors.New("invalid_path: sourceFiles must be a bounded nonempty file list")
	}
	if err := validatePluginProjectPrefixes(selected); err != nil {
		return nil, err
	}
	files := map[string][]byte{}
	var total int64
	for _, name := range selected {
		if authorize != nil {
			if err := authorize(filepath.Join(root.Name(), filepath.FromSlash(name))); err != nil {
				return nil, err
			}
		}
		data, err := readPluginProjectFile(root, name)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		total += int64(len(data))
		if total > PluginProjectMaxBytes {
			return nil, errors.New("too_large: selected source exceeds 64 MiB")
		}
		files[name] = data
	}
	return files, nil
}

// 候选发现不读取被排除目录的内容。真正导入前须用 sourceFiles 再次绑定所选文件版本。
func inspectPluginProjectCandidate(root *os.Root, authorize func(string) error) (*PluginProjectStatus, error) {
	files := map[string][]byte{}
	excluded := []PluginProjectExcludedFile{}
	var total int64
	paths := 0
	err := fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if name == "." {
			return nil
		}
		paths++
		if paths > PluginProjectMaxFiles*2 {
			return errors.New("too_large: source inventory exceeds bounded inspection")
		}
		exclude := func(reason string) error {
			excluded = append(excluded, PluginProjectExcludedFile{name, reason})
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if authorize != nil {
			if err := authorize(filepath.Join(root.Name(), filepath.FromSlash(name))); err != nil {
				return exclude("protected workspace path")
			}
		}
		if err := ValidatePluginProjectFile(name); err != nil {
			return exclude("private, runtime, dependency, archive or host-control material")
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return exclude("symbolic link")
		}
		if entry.IsDir() {
			return nil
		}
		if len(files) >= PluginProjectMaxFiles {
			return errors.New("too_large: source inventory contains too many files")
		}
		data, err := readPluginProjectFile(root, name)
		if err != nil {
			return exclude("unreadable, linked, special or oversized file")
		}
		total += int64(len(data))
		if total > PluginProjectMaxBytes {
			return errors.New("too_large: source inventory exceeds 64 MiB")
		}
		files[name] = data
		return nil
	})
	if err != nil {
		return nil, err
	}
	names := []string{}
	for name := range files {
		names = append(names, name)
	}
	if err = validatePluginProjectPrefixes(names); err != nil {
		return nil, err
	}
	ret := projectStatus(files)
	ret.Excluded = excluded
	return ret, nil
}
