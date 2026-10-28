// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"crypto/sha256"
	"fmt"
	"path/filepath"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// ReadTreeSnapshot 认证磁盘内容并构造独立快照，不使用内容缓存，也不修复或写回源文件。
func ReadTreeSnapshot(boxID, p string) (*parse.Tree, [sha256.Size]byte, error) {
	var fingerprint [sha256.Size]byte
	mode, err := validateTreePathMode(boxID, p)
	if err != nil {
		return nil, fingerprint, err
	}
	dek, _, release, err := acquireCryptoLease(boxID)
	if err != nil {
		return nil, fingerprint, err
	}
	defer release()
	tree, fingerprint, err := readTreeSnapshotSource(boxID, p, mode, dek, util.NewLute())
	if err != nil {
		return nil, fingerprint, err
	}
	tree.HPath, _, err = ReadDocHPath(boxID, p)
	return tree, fingerprint, err
}

// WalkTreeSnapshots 在一次源只读遍历中复用模式、祖先标题和解析器，逐篇认证完整来源。
// 回调不得写入源；用于预检时，调用方须在实际源变更的提交范围内再次检查。
func WalkTreeSnapshots(boxID string, paths []string, visit func(*parse.Tree) error) error {
	if len(paths) == 0 {
		return nil
	}
	for _, p := range paths {
		if _, err := ValidateBoxRelativePath(boxID, p); err != nil {
			return err
		}
	}
	reader := newDocumentMetadataReader()
	mode, err := reader.mode(boxID)
	if err != nil {
		return err
	}
	dek, _, release, err := acquireCryptoLease(boxID)
	if err != nil {
		return err
	}
	defer release()
	luteEngine := util.NewLute()
	for _, p := range paths {
		tree, _, readErr := readTreeSnapshotSource(boxID, p, mode, dek, luteEngine)
		if readErr != nil {
			return readErr
		}
		if tree.HPath, err = reader.hpath(tree); err != nil {
			return err
		}
		if err = visit(tree); err != nil {
			return err
		}
	}
	return nil
}

func readTreeSnapshotSource(boxID, p string, mode int, dek []byte, luteEngine *lute.Lute) (*parse.Tree, [sha256.Size]byte, error) {
	var fingerprint [sha256.Size]byte
	data, err := filelock.ReadFile(filepath.Join(util.DataDir, boxID, p))
	if err != nil {
		return nil, fingerprint, err
	}
	fingerprint = sha256.Sum256(data)
	data, err = decryptDataWithDEK(boxID, p, data, dek)
	if err != nil {
		return nil, fingerprint, err
	}
	tree, err := parseJSON2TreeInMode(boxID, p, data, luteEngine, mode)
	if err != nil {
		return nil, fingerprint, err
	}
	if tree.Root == nil || tree.Root.Type != ast.NodeDocument || tree.Root.ID != util.GetTreeID(p) {
		return nil, fingerprint, fmt.Errorf("invalid document root or mismatched ID [%s]", p)
	}
	if err = normalizeValidatedTreeForRead(tree); err != nil {
		return nil, fingerprint, err
	}
	return tree, fingerprint, nil
}
