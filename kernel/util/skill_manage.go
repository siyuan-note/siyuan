// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package util

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
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
)

const maxManagedSkillSourceSize = 8 * 1024 * 1024

var skillManagementLock sync.Mutex

var (
	ErrSkillBinary   = errors.New("binary files cannot be edited as text")
	ErrSkillEncoding = errors.New("only UTF-8 text files can be edited")
	ErrSkillTooLarge = errors.New("text files must be at most 8 MiB")
)

type SkillFileRequest struct {
	Action   string
	Path     string
	Target   string
	Content  string
	Revision string
}

type SkillFileEntry struct {
	Path     string
	IsDir    bool
	Editable bool
}

type SkillFileData struct {
	Entries        []SkillFileEntry
	Content        *string
	Revision       string
	ReadOnlyReason string
}

// 管理操作使用真实的相对路径，不使用技能正文中的名称作为文件标识。
func validateManagedSkillPath(p string) error {
	if p == "" || !fs.ValidPath(p) || strings.ContainsAny(p, "\\:") {
		return errors.New("invalid skill path")
	}
	for _, part := range strings.Split(p, "/") {
		if strings.TrimSpace(part) != part || strings.HasSuffix(part, ".") ||
			strings.ContainsAny(part, "<>\"|?*~") || strings.ContainsFunc(part, unicode.IsControl) {
			return errors.New("invalid skill path component")
		}
		device := strings.ToUpper(strings.TrimRight(strings.SplitN(part, ".", 2)[0], " ."))
		if device == "CON" || device == "PRN" || device == "AUX" || device == "NUL" || device == "CONIN$" || device == "CONOUT$" {
			return errors.New("reserved skill file name")
		}
		if strings.HasPrefix(device, "COM") || strings.HasPrefix(device, "LPT") {
			number := strings.TrimPrefix(strings.TrimPrefix(device, "COM"), "LPT")
			if len([]rune(number)) == 1 && strings.ContainsAny(number, "0123456789¹²³") {
				return errors.New("reserved skill file name")
			}
		}
	}
	return nil
}

// 从工作空间目录逐层打开根目录，拒绝把管理操作重定向到链接目标。
func openManagedSkillsRoot() (*os.Root, error) {
	workspace, err := os.OpenRoot(DataDir)
	if err != nil {
		return nil, err
	}
	defer workspace.Close()
	for _, p := range []string{"storage", "storage/ai", "storage/ai/agent", "storage/ai/agent/skills"} {
		if err = workspace.Mkdir(p, 0755); err != nil && !errors.Is(err, os.ErrExist) {
			return nil, err
		}
		info, statErr := workspace.Lstat(p)
		if statErr != nil {
			return nil, statErr
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("skill storage is not a regular directory")
		}
	}
	return workspace.OpenRoot("storage/ai/agent/skills")
}

func checkManagedSkillPath(root *os.Root, p string) error {
	if err := validateManagedSkillPath(p); err != nil {
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
			return errors.New("skill path is not a regular file or directory")
		}
	}
	return nil
}

func isManagedSkillManifest(p string) bool {
	return strings.Count(p, "/") == 1 && strings.EqualFold(path.Base(p), "SKILL.md")
}

// 目录版本包含每个资源的内容哈希，保持大小和修改时间不变的外部编辑也会产生冲突。
func managedSkillRevision(root *os.Root, p string) (string, error) {
	h := sha256.New()
	err := fs.WalkDir(root.FS(), p, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || (!info.IsDir() && !info.Mode().IsRegular()) {
			return errors.New("skill directory contains a link or special file")
		}
		if info.IsDir() {
			fmt.Fprintf(h, "directory\x00%s\x00", name)
			return nil
		}
		file, err := root.Open(name)
		if err != nil {
			return err
		}
		hash := sha256.New()
		_, copyErr := io.Copy(hash, file)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if name == p {
			h = hash
		} else {
			fmt.Fprintf(h, "file\x00%s\x00%x\x00", name, hash.Sum(nil))
		}
		return nil
	})
	return fmt.Sprintf("%x", h.Sum(nil)), err
}

// 编码标记不参与二进制判断；其余正文不允许文本空白以外的控制字符。
func validateManagedSkillSource(content string) error {
	if len(content) > maxManagedSkillSourceSize {
		return ErrSkillTooLarge
	}
	if strings.HasPrefix(content, "\xff\xfe") || strings.HasPrefix(content, "\xfe\xff") ||
		strings.HasPrefix(content, "\x00\x00\xfe\xff") {
		return ErrSkillEncoding
	}
	if strings.ContainsRune(content, 0) {
		return ErrSkillBinary
	}
	if !utf8.ValidString(content) {
		return ErrSkillEncoding
	}
	for _, r := range content {
		if unicode.IsControl(r) && r != '\t' && r != '\n' && r != '\r' && r != '\f' {
			return ErrSkillBinary
		}
	}
	return nil
}

func skillSourceReadOnlyReason(err error) string {
	switch {
	case errors.Is(err, ErrSkillBinary):
		return "binary"
	case errors.Is(err, ErrSkillEncoding):
		return "encoding"
	case errors.Is(err, ErrSkillTooLarge):
		return "tooLarge"
	}
	return ""
}

func readManagedSkillSource(root *os.Root, p string) (string, error) {
	file, err := root.Open(p)
	if err != nil {
		return "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("skill source is not a regular file")
	}
	if info.Size() > maxManagedSkillSourceSize {
		return "", ErrSkillTooLarge
	}
	content, err := io.ReadAll(io.LimitReader(file, maxManagedSkillSourceSize+1))
	if err != nil {
		return "", err
	}
	// UTF-8 BOM 随正文保留；二进制内容不会返回给文本编辑器。
	if err = validateManagedSkillSource(string(content)); err != nil {
		return "", err
	}
	return string(content), nil
}

// 写入临时文件并同步后替换，发生写入错误时保留原文及其换行和元数据。
func writeManagedSkillSource(root *os.Root, p, content string, create bool, revision string) error {
	if err := validateManagedSkillSource(content); err != nil {
		return err
	}
	target := p
	mode := os.FileMode(0644)
	if !create {
		info, err := root.Stat(p)
		if err != nil {
			return err
		}
		mode = info.Mode().Perm()
		target = path.Join(path.Dir(p), ".skill-"+ast.NewNodeID())
	}
	file, err := root.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	complete := false
	defer func() {
		if !complete || !create {
			root.Remove(target)
		}
	}()
	// 替换脚本文件时保留执行权限，不受当前进程 umask 影响。
	if !create {
		err = file.Chmod(mode)
	}
	if err == nil {
		_, err = file.WriteString(content)
	}
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
	if !create {
		// 临时文件落盘后重新校验，避免覆盖此期间由外部编辑器保存的内容。
		if err = checkManagedSkillPath(root, p); err != nil {
			return err
		}
		currentRevision, revisionErr := managedSkillRevision(root, p)
		if revisionErr != nil {
			return revisionErr
		}
		if revision == "" || revision != currentRevision {
			return errors.New("skill changed; reload it before saving, renaming or deleting")
		}
		if err = root.Rename(target, p); err != nil {
			return err
		}
	}
	complete = true
	return nil
}

func ManageSkillFiles(request SkillFileRequest) (SkillFileData, error) {
	skillManagementLock.Lock()
	defer skillManagementLock.Unlock()
	ret := SkillFileData{}
	switch request.Action {
	case "list", "read", "write", "create", "mkdir", "move", "remove":
	default:
		return ret, errors.New("unsupported skill operation")
	}
	root, err := openManagedSkillsRoot()
	if err != nil {
		return ret, err
	}
	defer root.Close()
	if request.Action == "list" {
		ret.Entries = []SkillFileEntry{}
		err = fs.WalkDir(root.FS(), ".", func(p string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil || p == "." {
				return walkErr
			}
			// 未解析或被同名技能遮蔽的目录也保留在列表中，链接只展示而不跟随。
			editable := false
			if entry.Type().IsRegular() && strings.Contains(p, "/") && validateManagedSkillPath(p) == nil {
				if err := checkManagedSkillPath(root, p); err == nil {
					_, err = readManagedSkillSource(root, p)
					editable = err == nil
				}
			}
			ret.Entries = append(ret.Entries, SkillFileEntry{Path: p, IsDir: entry.IsDir(), Editable: editable})
			return nil
		})
		return ret, err
	}
	if err = checkManagedSkillPath(root, request.Path); err != nil {
		return ret, err
	}
	abs := filepath.Join(root.Name(), filepath.FromSlash(request.Path))
	filelock.Lock(abs)
	defer filelock.Unlock(abs)
	info, statErr := root.Lstat(request.Path)
	if request.Action == "create" {
		if strings.Contains(request.Path, "/") || !errors.Is(statErr, os.ErrNotExist) {
			return ret, errors.New("skill directory already exists or is invalid")
		}
		content := request.Content
		if content == "" {
			content = "---\nname: " + request.Path + "\ndescription: \n---\n\n"
		}
		tmp := ".skill-" + ast.NewNodeID()
		if err = root.Mkdir(tmp, 0755); err != nil {
			return ret, err
		}
		defer root.RemoveAll(tmp)
		if err = writeManagedSkillSource(root, path.Join(tmp, "SKILL.md"), content, true, ""); err != nil {
			return ret, err
		}
		if err = root.Rename(tmp, request.Path); err != nil {
			return ret, err
		}
		ret.Content = &content
		ret.Revision = fmt.Sprintf("%x", sha256.Sum256([]byte(content)))
		return ret, nil
	}
	if request.Action == "mkdir" {
		if !strings.Contains(request.Path, "/") {
			return ret, errors.New("create a skill before creating its subdirectories")
		}
		return ret, root.Mkdir(request.Path, 0755)
	}
	if statErr != nil && !(request.Action == "write" && request.Revision == "" && errors.Is(statErr, os.ErrNotExist)) {
		return ret, statErr
	}
	if request.Action == "read" {
		if !info.IsDir() && strings.Contains(request.Path, "/") {
			content, readErr := readManagedSkillSource(root, request.Path)
			if readErr == nil {
				ret.Content = &content
				ret.Revision = fmt.Sprintf("%x", sha256.Sum256([]byte(content)))
				return ret, nil
			}
			ret.ReadOnlyReason = skillSourceReadOnlyReason(readErr)
			if ret.ReadOnlyReason == "" {
				return ret, readErr
			}
		}
		ret.Revision, err = managedSkillRevision(root, request.Path)
		return ret, err
	}
	if info == nil || !info.IsDir() {
		if !strings.Contains(request.Path, "/") {
			return ret, errors.New("only text files inside a skill can be edited")
		}
		if info != nil {
			if _, err = readManagedSkillSource(root, request.Path); err != nil {
				return ret, err
			}
		}
	}
	if (request.Action == "move" || request.Action == "remove") && isManagedSkillManifest(request.Path) {
		return ret, errors.New("rename or delete the skill directory instead of SKILL.md")
	}
	if info != nil {
		revision, revisionErr := managedSkillRevision(root, request.Path)
		if revisionErr != nil {
			return ret, revisionErr
		}
		if request.Revision == "" || request.Revision != revision {
			return ret, errors.New("skill changed; reload it before saving, renaming or deleting")
		}
	}
	switch request.Action {
	case "write":
		if info != nil && info.IsDir() {
			return ret, errors.New("cannot write a skill directory")
		}
		if err = writeManagedSkillSource(root, request.Path, request.Content, info == nil, request.Revision); err != nil {
			return ret, err
		}
		ret.Revision = fmt.Sprintf("%x", sha256.Sum256([]byte(request.Content)))
		return ret, nil
	case "move":
		if err = checkManagedSkillPath(root, request.Target); err != nil {
			return ret, err
		}
		if path.Dir(request.Path) != path.Dir(request.Target) {
			return ret, errors.New("skills and text files can only be renamed in the same directory")
		}
		if _, err = root.Lstat(request.Target); !errors.Is(err, os.ErrNotExist) {
			return ret, errors.New("skill destination already exists or is inaccessible")
		}
		return ret, root.Rename(request.Path, request.Target)
	case "remove":
		if info.IsDir() {
			return ret, root.RemoveAll(request.Path)
		}
		return ret, root.Remove(request.Path)
	}
	return ret, errors.New("unsupported skill operation")
}
