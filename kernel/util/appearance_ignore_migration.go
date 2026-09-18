package util

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
)

// MigrateAppearanceSyncIgnore 移除旧版生成的隔离块，保留用户规则、换行和编码标记；没有隔离块时不写文件。
func MigrateAppearanceSyncIgnore() error {
	rulePath := filepath.Join(DataDir, ".siyuan", "syncignore")
	filelock.Lock(rulePath)
	defer filelock.Unlock(rulePath)
	info, err := os.Lstat(rulePath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("appearance migration requires a regular syncignore file")
	}
	original, err := os.ReadFile(rulePath)
	if err != nil {
		return err
	}
	updated, err := removeAppearanceIsolationBlock(original)
	if err != nil || bytes.Equal(original, updated) {
		return err
	}
	return gulu.File.WriteFileSafer(rulePath, updated, info.Mode().Perm())
}

func removeAppearanceIsolationBlock(original []byte) ([]byte, error) {
	const marker = "# siyuan-appearance-isolation:"
	block := []string{marker + "v1:begin", "/themes/", "/icons/", "/storage/bazaar/themes/", "/storage/bazaar/icons/", marker + "v1:end"}
	bom := []byte("\xef\xbb\xbf")
	data := bytes.TrimPrefix(original, bom)
	lines := bytes.SplitAfter(data, []byte("\n"))
	var ret []byte
	if bytes.HasPrefix(original, bom) {
		ret = append(ret, bom...)
	}
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSuffix(strings.TrimSuffix(string(lines[i]), "\n"), "\r")
		if !strings.HasPrefix(line, marker) {
			ret = append(ret, lines[i]...)
			continue
		}
		if len(lines)-i < len(block) {
			return nil, errors.New("incomplete appearance sync isolation block")
		}
		for j, expected := range block {
			if strings.TrimSuffix(strings.TrimSuffix(string(lines[i+j]), "\n"), "\r") != expected {
				return nil, errors.New("unknown or modified appearance sync isolation block")
			}
		}
		i += len(block) - 1
	}
	return ret, nil
}
