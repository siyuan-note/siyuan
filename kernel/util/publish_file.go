package util

import (
	"io/fs"
	"os"
	"strings"
)

// IsPublishRelativePath 限定发布资源使用无歧义的相对路径，各平台采用相同的分段规则。
func IsPublishRelativePath(name string) bool {
	if name == "" || strings.ContainsAny(name, "\\:%\x00") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." || strings.TrimSpace(part) != part || strings.HasSuffix(part, ".") {
			return false
		}
	}
	return true
}

// OpenPublishFile 在已打开的目录句柄内逐级读取，拒绝链接和非普通文件，并校验打开前后的文件身份。
// 即使路径在检查后被替换，读取也不会转向链接目标或授权目录之外。
func OpenPublishFile(rootPath, name string) (*os.File, error) {
	if !IsPublishRelativePath(name) {
		return nil, fs.ErrPermission
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return nil, err
	}
	defer func() { root.Close() }()
	parts := strings.Split(name, "/")
	for _, part := range parts[:len(parts)-1] {
		info, statErr := root.Lstat(part)
		if statErr != nil {
			return nil, statErr
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, fs.ErrPermission
		}
		next, openErr := root.OpenRoot(part)
		if openErr != nil {
			return nil, openErr
		}
		actual, actualErr := next.Stat(".")
		if actualErr != nil || !os.SameFile(info, actual) {
			next.Close()
			return nil, fs.ErrPermission
		}
		root.Close()
		root = next
	}
	leaf := parts[len(parts)-1]
	info, err := root.Lstat(leaf)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fs.ErrPermission
	}
	file, err := root.Open(leaf)
	if err != nil {
		return nil, err
	}
	actual, err := file.Stat()
	if err != nil || !actual.Mode().IsRegular() || !os.SameFile(info, actual) {
		file.Close()
		return nil, fs.ErrPermission
	}
	return file, nil
}
