package model

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// openTemplatePath 将绝对或相对路径限制在模板根目录内，文件操作通过根目录句柄防止符号链接越界。
func openTemplatePath(p string) (*os.Root, string, error) {
	base, rel, err := resolveTemplatePath(p)
	if err != nil {
		return nil, "", err
	}
	root, err := os.OpenRoot(base)
	return root, rel, err
}

// ResolveTemplatePath 返回模板根目录内的绝对路径，接受绝对路径或相对模板根目录的路径。
// 此函数只校验路径边界，文件读写通过根目录句柄另行限制符号链接。
func ResolveTemplatePath(p string) (string, error) {
	base, rel, err := resolveTemplatePath(p)
	if err != nil {
		return "", err
	}
	return filepath.Join(base, rel), nil
}

func resolveTemplatePath(p string) (base, rel string, err error) {
	if p == "" {
		return "", "", errors.New("path is required")
	}
	base, err = filepath.Abs(filepath.Join(util.DataDir, "templates"))
	if err != nil {
		return "", "", err
	}
	abs := p
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(base, p)
	}
	rel, err = filepath.Rel(base, abs)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", "", errors.New("template path is outside templates directory")
	}
	return base, rel, nil
}

// ReadTemplateFile 在模板根目录内读取普通文件，禁止通过符号链接读取目录外的数据。
func ReadTemplateFile(p string) ([]byte, error) {
	root, rel, err := openTemplatePath(p)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	file, err := root.Open(rel)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("template path is not a regular file")
	}
	return io.ReadAll(file)
}
