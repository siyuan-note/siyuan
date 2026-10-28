// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 记录只保存身份和摘要，不把加密笔记本标题或速记正文写入明文恢复文件。
type localShorthandCreation struct {
	Version  int               `json:"version"`
	Notebook string            `json:"notebook"`
	ID       string            `json:"id"`
	Path     string            `json:"path"`
	Blocks   []string          `json:"blocks"`
	Sources  map[string]string `json:"sources"`
}

func localShorthandCreationPath() string {
	return filepath.Join(util.ShortcutsPath, "shorthands", ".document-creation.json")
}

func beginLocalShorthandCreation(boxID, id, docPath string, blocks []string, sources map[string][]byte) error {
	if len(blocks) == 0 || len(sources) == 0 {
		return errors.New("shorthand creation requires source and block identities")
	}
	if _, err := os.Stat(localShorthandCreationPath()); !os.IsNotExist(err) {
		if err != nil {
			return err
		}
		return errors.New("a shorthand document creation is awaiting recovery")
	}
	record := localShorthandCreation{Version: 1, Notebook: boxID, ID: id, Path: docPath, Blocks: blocks, Sources: map[string]string{}}
	for filename, data := range sources {
		current, err := os.ReadFile(filename)
		if err != nil || !bytes.Equal(data, current) {
			return errors.New("shorthand source changed before document creation")
		}
		digest := sha256.Sum256(data)
		record.Sources[filepath.Base(filename)] = hex.EncodeToString(digest[:])
	}
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return atomicWriteFile(localShorthandCreationPath(), data)
}

// recoverLocalShorthandCreation 核对实际源中的完整块身份后才清理输入；缺失、认证失败和未知结果均不重放。
func recoverLocalShorthandCreation(boxID string) (string, error) {
	data, err := filelock.ReadFile(localShorthandCreationPath())
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var record localShorthandCreation
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&record); err != nil || record.Version != 1 || record.Notebook != boxID ||
		!ast.IsNodeIDPattern(record.ID) || len(record.Blocks) == 0 || len(record.Sources) == 0 {
		return "", errors.New("invalid or mismatched shorthand creation recovery record")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return "", errors.New("invalid shorthand creation recovery record suffix")
	}
	if !strings.HasPrefix(record.Path, "/") || record.Path != path.Clean(record.Path) || path.Ext(record.Path) != ".sy" || util.GetTreeID(record.Path) != record.ID {
		return "", errors.New("invalid shorthand creation recovery path")
	}
	for _, segment := range bytes.Split([]byte(record.Path[1:len(record.Path)-3]), []byte("/")) {
		if !ast.IsNodeIDPattern(string(segment)) {
			return "", errors.New("invalid shorthand creation recovery identity")
		}
	}
	if current := treenode.GetBlockTreeInExactBox(record.ID, boxID); current != nil {
		record.Path = current.Path
	}
	tree, _, err := filesys.ReadTreeSnapshot(boxID, record.Path)
	if err != nil {
		return "", fmt.Errorf("review shorthand document siyuan://blocks/%s before retrying: %w", record.ID, err)
	}
	for _, id := range record.Blocks {
		if !ast.IsNodeIDPattern(id) || treenode.GetNodeInTree(tree, id) == nil {
			return "", fmt.Errorf("review incomplete shorthand document siyuan://blocks/%s before retrying", record.ID)
		}
	}
	for filename, expected := range record.Sources {
		if filepath.Base(filename) != filename || filepath.Ext(filename) != ".md" || len(expected) != 64 {
			return "", errors.New("invalid shorthand source recovery identity")
		}
		filename = filepath.Join(util.ShortcutsPath, "shorthands", filename)
		current, err := os.ReadFile(filename)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		digest := sha256.Sum256(current)
		if hex.EncodeToString(digest[:]) != expected {
			return "", errors.New("shorthand source changed after document creation; keep it for review")
		}
		if err = os.Remove(filename); err != nil {
			return "", err
		}
	}
	return record.ID, filelock.Remove(localShorthandCreationPath())
}
