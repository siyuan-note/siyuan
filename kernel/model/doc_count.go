package model

import (
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 统计可见的直接子文档，属性读取沿用调用方的笔记本访问规则。
func visibleDocCount(boxID, parentPath string, readIAL func(string) map[string]string, include func(string) bool) (int, error) {
	entries, err := os.ReadDir(filepath.Join(util.DataDir, boxID, parentPath))
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	count := 0
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".sy")
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sy") || !ast.IsNodeIDPattern(id) || id == boxID {
			continue
		}
		p := path.Join(parentPath, entry.Name())
		if include != nil && !include(p) {
			continue
		}
		if readIAL(p)[DocHiddenAttr] != "true" {
			count++
		}
	}
	return count, nil
}
