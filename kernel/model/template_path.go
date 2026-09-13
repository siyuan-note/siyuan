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
	if p == "" {
		return nil, "", errors.New("path is required")
	}
	base, err := filepath.Abs(filepath.Join(util.DataDir, "templates"))
	if err != nil {
		return nil, "", err
	}
	abs := p
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(base, p)
	}
	rel, err := filepath.Rel(base, abs)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return nil, "", errors.New("template path is outside templates directory")
	}
	root, err := os.OpenRoot(base)
	return root, rel, err
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
