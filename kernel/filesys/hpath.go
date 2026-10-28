// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	if _, err := ValidateBoxRelativePath(boxID, p); err != nil {
		return nil, err
	}
	mode, err := DocumentAddressingMode(boxID)
	if err != nil {
		return nil, err
	}
	return readDocumentMetadataTreeInMode(boxID, p, mode)
}

func readDocumentMetadataTreeInMode(boxID, p string, mode int) (*parse.Tree, error) {
	p, err := ValidateBoxRelativePath(boxID, p)
	if err != nil {
		return nil, err
	}
	header, err := readDocumentHeaderInMode(filepath.Join(util.DataDir, boxID, p), true, mode)
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

// documentMetadataReader 只在一次预检或持锁恢复中复用模式及已认证的祖先路径，不跨操作保存。
// 正在恢复的文档始终重新认证，祖先缓存有固定上限且不包含正文或密钥。
type documentMetadataReader struct {
	modes    map[string]int
	prefixes map[string]string
}

const documentMetadataPrefixLimit = 512

func newDocumentMetadataReader() *documentMetadataReader {
	return &documentMetadataReader{modes: map[string]int{}, prefixes: map[string]string{}}
}

func (reader *documentMetadataReader) mode(boxID string) (int, error) {
	if mode, ok := reader.modes[boxID]; ok {
		return mode, nil
	}
	mode, err := DocumentAddressingMode(boxID)
	if err == nil {
		reader.modes[boxID] = mode
	}
	return mode, err
}

func (reader *documentMetadataReader) tree(boxID, p string) (*parse.Tree, error) {
	if _, err := ValidateBoxRelativePath(boxID, p); err != nil {
		return nil, err
	}
	mode, err := reader.mode(boxID)
	if err != nil {
		return nil, err
	}
	return readDocumentMetadataTreeInMode(boxID, p, mode)
}

func (reader *documentMetadataReader) hpath(tree *parse.Tree) (string, error) {
	mode, err := reader.mode(tree.Box)
	if err != nil {
		return "", err
	}
	parts := strings.Split(strings.TrimPrefix(filepath.ToSlash(tree.Path), "/"), "/")
	hpath := ""
	for i := 0; i < len(parts)-1; i++ {
		parentPath := strings.Join(parts[:i+1], "/") + ".sy"
		key := tree.Box + "/" + parentPath
		if prefix, ok := reader.prefixes[key]; ok {
			hpath = prefix
			continue
		}
		header, readErr := readDocumentHeaderInMode(filepath.Join(util.DataDir, tree.Box, parentPath), true, mode)
		if readErr != nil {
			return "", readErr
		}
		title := treenode.DocumentTitleFromProperties(header.Properties).Text
		if title == "" {
			title = "Untitled"
		}
		hpath += "/" + title
		if len(reader.prefixes) == documentMetadataPrefixLimit {
			clear(reader.prefixes)
		}
		reader.prefixes[key] = hpath
	}
	return hpath + "/" + treenode.ReadDocumentTitle(tree.Root).Text, nil
}
