// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var templateFileLock sync.Mutex

const maxTemplateSourceSize = 8 * 1024 * 1024

type TemplateFileRequest struct {
	Action   string `json:"action"`
	Path     string `json:"path"`
	Target   string `json:"target"`
	Content  string `json:"content"`
	Revision string `json:"revision"`
}

type TemplateFileEntry struct {
	Path      string `json:"path"`
	IsDir     bool   `json:"isDir"`
	IsPackage bool   `json:"isPackage,omitempty"`
}

// 访问已有模板只校验目录边界，不对文件名进行清理或改写。
func validateTemplateRelativePath(p string, allowRoot bool) error {
	if p == "" && allowRoot {
		return nil
	}
	if p == "" || !fs.ValidPath(p) || strings.ContainsAny(p, "\\:\x00") {
		return errors.New("invalid template path")
	}
	for _, part := range strings.Split(p, "/") {
		if strings.HasPrefix(part, ".") {
			return errors.New("hidden template paths are reserved")
		}
	}
	return nil
}

// 新名称保持跨平台可用，已有父目录沿用原名。
func validateNewTemplateName(p string) error {
	part := path.Base(p)
	device := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
	if device == "CON" || device == "PRN" || device == "AUX" || device == "NUL" || (len(device) == 4 && (strings.HasPrefix(device, "COM") || strings.HasPrefix(device, "LPT")) && device[3] >= '1' && device[3] <= '9') {
		return errors.New("reserved template file name")
	}
	if strings.HasPrefix(part, ".") || strings.TrimSpace(part) != part || strings.HasSuffix(part, ".") || strings.ContainsAny(part, "\\:<>\"|?*") || strings.ContainsFunc(part, unicode.IsControl) {
		return errors.New("invalid template path component")
	}
	return nil
}

// 清单与目录共同标识模板包，保留目录身份以维持搜索和集市更新。
func isManagedTemplatePackage(root *os.Root, p string) bool {
	_, err := root.Lstat(path.Join(p, "template.json"))
	return err == nil
}

func openTemplateRoot() (*os.Root, error) {
	if err := os.MkdirAll(filepath.Join(util.DataDir, "templates"), 0755); err != nil {
		return nil, err
	}
	return os.OpenRoot(filepath.Join(util.DataDir, "templates"))
}

// 除根目录外不接受符号链接，避免管理操作影响另一个模板包。
func checkTemplateFilePath(root *os.Root, p string) error {
	if err := validateTemplateRelativePath(p, false); err != nil {
		return err
	}
	parts := strings.Split(p, "/")
	for i := range parts {
		info, err := root.Lstat(strings.Join(parts[:i+1], "/"))
		if errors.Is(err, os.ErrNotExist) && i == len(parts)-1 {
			return nil
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || (!info.IsDir() && !info.Mode().IsRegular()) {
			return errors.New("template path is not a regular file or directory")
		}
	}
	return nil
}

func templateFileRevision(root *os.Root, p string) (string, error) {
	info, err := root.Stat(p)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	if info.IsDir() {
		err = fs.WalkDir(root.FS(), p, func(name string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			stat, statErr := entry.Info()
			if statErr != nil {
				return statErr
			}
			if stat.Mode()&os.ModeSymlink != 0 {
				return errors.New("template directory contains a symbolic link")
			}
			fmt.Fprintf(h, "%s\x00%d\x00%d\x00%d\n", name, stat.Size(), stat.ModTime().UnixNano(), stat.Mode())
			return nil
		})
	} else {
		if info.Size() > maxTemplateSourceSize {
			return "", errors.New("template source is too large")
		}
		var content []byte
		content, err = root.ReadFile(p)
		h.Write(content)
	}
	return fmt.Sprintf("%x", h.Sum(nil)), err
}

func readTemplateSource(root *os.Root, p string) (string, error) {
	info, err := root.Stat(p)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() > maxTemplateSourceSize {
		return "", errors.New("invalid template source file")
	}
	content, err := root.ReadFile(p)
	if err != nil {
		return "", err
	}
	if !utf8.Valid(content) {
		return "", errors.New("template source is not UTF-8")
	}
	return string(content), nil
}

// 同目录临时文件写入完成后替换，写入失败时保留原模板。
func writeTemplateSource(root *os.Root, p, content string, create bool) error {
	if !utf8.ValidString(content) {
		return errors.New("invalid template source")
	}
	if create {
		file, err := root.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
		if err != nil {
			return err
		}
		_, err = file.WriteString(content)
		if err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err != nil {
			root.Remove(p)
			return err
		}
		return closeErr
	}
	tmp := path.Join(path.Dir(p), ".template-"+ast.NewNodeID())
	file, err := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	defer root.Remove(tmp)
	_, err = file.WriteString(content)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return root.Rename(tmp, p)
}

func ManageTemplateFiles(request TemplateFileRequest) (ret any, err error) {
	templateFileLock.Lock()
	defer templateFileLock.Unlock()
	root, err := openTemplateRoot()
	if err != nil {
		return nil, err
	}
	defer root.Close()
	if request.Action == "list" {
		entries := []TemplateFileEntry{}
		err = fs.WalkDir(root.FS(), ".", func(p string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if p == "." {
				return nil
			}
			if strings.HasPrefix(entry.Name(), ".") || entry.Type()&os.ModeSymlink != 0 {
				if entry.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if entry.IsDir() || strings.EqualFold(path.Ext(p), ".md") {
				entries = append(entries, TemplateFileEntry{Path: p, IsDir: entry.IsDir(), IsPackage: entry.IsDir() && isManagedTemplatePackage(root, p)})
			}
			return nil
		})
		return entries, err
	}
	if err = checkTemplateFilePath(root, request.Path); err != nil {
		return nil, err
	}
	abs := filepath.Join(root.Name(), filepath.FromSlash(request.Path))
	filelock.Lock(abs)
	defer filelock.Unlock(abs)
	info, statErr := root.Stat(request.Path)
	if request.Action == "mkdir" {
		if err = validateNewTemplateName(request.Path); err != nil {
			return nil, err
		}
		return nil, root.Mkdir(request.Path, 0755)
	}
	if statErr != nil && !(request.Action == "write" && request.Revision == "" && errors.Is(statErr, os.ErrNotExist)) {
		return nil, statErr
	}
	if info == nil || !info.IsDir() {
		if !strings.EqualFold(path.Ext(request.Path), ".md") {
			return nil, errors.New("template source must use the .md extension")
		}
	}
	if request.Action == "read" {
		if info.IsDir() {
			revision, readErr := templateFileRevision(root, request.Path)
			return map[string]string{"content": "", "revision": revision}, readErr
		}
		content, readErr := readTemplateSource(root, request.Path)
		return map[string]string{"content": content, "revision": fmt.Sprintf("%x", sha256.Sum256([]byte(content))), "path": filepath.Join(util.DataDir, "templates", filepath.FromSlash(request.Path))}, readErr
	}
	if info != nil {
		revision, revisionErr := templateFileRevision(root, request.Path)
		if revisionErr != nil {
			return nil, revisionErr
		}
		if request.Revision == "" || request.Revision != revision {
			return nil, errors.New("template changed; reload it before saving, moving or deleting")
		}
	}
	switch request.Action {
	case "write":
		if info == nil {
			if err = validateNewTemplateName(request.Path); err != nil {
				return nil, err
			}
		}
		if len(request.Content) > maxTemplateSourceSize {
			return nil, errors.New("template source is too large")
		}
		if info != nil && info.IsDir() {
			return nil, errors.New("cannot write a template directory")
		}
		err = writeTemplateSource(root, request.Path, request.Content, info == nil)
		return map[string]string{"revision": fmt.Sprintf("%x", sha256.Sum256([]byte(request.Content)))}, err
	case "move":
		if info.IsDir() && isManagedTemplatePackage(root, request.Path) {
			return nil, errors.New("template packages cannot be renamed or moved")
		}
		if err = checkTemplateFilePath(root, request.Target); err != nil {
			return nil, err
		}
		if err = validateNewTemplateName(request.Target); err != nil {
			return nil, err
		}
		if !info.IsDir() && !strings.EqualFold(path.Ext(request.Target), ".md") {
			return nil, errors.New("template source must use the .md extension")
		}
		if _, err = root.Stat(request.Target); !errors.Is(err, os.ErrNotExist) {
			return nil, errors.New("template destination already exists or is inaccessible")
		}
		return nil, root.Rename(request.Path, request.Target)
	case "remove":
		// 将整个目录连同包资源移入隐藏恢复目录，保留误删后的恢复材料。
		trash := ".trash/" + ast.NewNodeID()
		if err = root.MkdirAll(trash, 0700); err != nil {
			return nil, err
		}
		target := path.Join(trash, path.Base(request.Path))
		if err = root.Rename(request.Path, target); err != nil {
			return nil, err
		}
		return map[string]string{"recoveryPath": target}, nil
	default:
		return nil, errors.New("unsupported template operation")
	}
}
