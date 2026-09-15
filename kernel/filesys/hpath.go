package filesys

import (
	"path/filepath"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// ReadDocHPath 只读文档属性并认证加密源文件，不解析块树、不修复或补建任何文件。
func ReadDocHPath(boxID, p string) (hpath string, properties map[string]string, err error) {
	if p, err = ValidateBoxRelativePath(boxID, p); err != nil {
		return
	}
	parts := strings.Split(strings.TrimPrefix(filepath.ToSlash(p), "/"), "/")
	for i := range parts {
		docPath := strings.Join(parts[:i+1], "/")
		if i < len(parts)-1 {
			docPath += ".sy"
		}
		properties, err = readDocIAL(filepath.Join(util.DataDir, boxID, docPath), true)
		if err != nil {
			return "", nil, err
		}
		title := properties["title"]
		if title == "" && i < len(parts)-1 {
			title = "Untitled"
		}
		hpath += "/" + title
	}
	return
}
