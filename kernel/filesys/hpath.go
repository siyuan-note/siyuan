package filesys

import (
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// ReadDocumentMetadataTree 认证并检查源文件，仅构建根属性，恢复过程不补建或修复正文。
func ReadDocumentMetadataTree(boxID, p string) (*parse.Tree, error) {
	p, err := ValidateBoxRelativePath(boxID, p)
	if err != nil {
		return nil, err
	}
	header, err := readDocumentHeader(filepath.Join(util.DataDir, boxID, p), true)
	if err != nil {
		return nil, err
	}
	root := &ast.Node{Type: ast.NodeDocument, ID: header.ID, Spec: header.Spec}
	for key, value := range header.Properties {
		root.SetIALAttr(key, value)
	}
	return &parse.Tree{ID: root.ID, Box: boxID, Path: "/" + strings.TrimPrefix(filepath.ToSlash(p), "/"), Root: root}, nil
}

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
		title := treenode.DocumentTitleFromProperties(properties).Text
		if title == "" && i < len(parts)-1 {
			title = "Untitled"
		}
		hpath += "/" + title
	}
	return
}
