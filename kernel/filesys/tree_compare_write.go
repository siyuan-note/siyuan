// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"path/filepath"

	"github.com/88250/lute"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// WriteTreeIfUnchanged 仅在文档仍与扫描源的原始文件字节一致时原子替换，防止覆盖并发修改。
// 加密源必须先通过认证，落盘沿用现有密文格式，缓存仅在条件写成功后更新。
func WriteTreeIfUnchanged(tree *parse.Tree, original []byte) (size uint64, err error) {
	unlock := lockDocumentSource()
	defer unlock()
	if err = validateTreePath(tree.Box, tree.Path); err != nil {
		return 0, err
	}
	dek, _, release, err := acquireCryptoLease(tree.Box)
	if err != nil {
		return 0, err
	}
	defer release()
	plain, err := decryptDataWithDEK(tree.Box, tree.Path, original, dek)
	if err != nil {
		return 0, err
	}
	if err = CheckDocumentSpecJSON(tree.Box, plain); err != nil {
		return 0, err
	}
	data, filePath, err := prepareWriteTree(tree)
	if err != nil {
		return 0, err
	}
	diskData, err := encryptDataWithDEK(tree.Box, tree.Path, data, dek)
	if err != nil {
		return 0, err
	}
	if recorder := treeRecorder(tree); recorder != nil {
		if err = recorder.record(diskData); err != nil {
			return 0, err
		}
	}
	pending, err := treenode.BeginDocumentMetadataWrite(tree)
	if err != nil {
		return 0, err
	}
	defer finishDocumentMetadataWrite(tree, pending, &err)
	if err = util.WriteFileIfUnchanged(filePath, original, diskData); err != nil {
		return 0, err
	}
	cache.SetTreeDataInBox(tree.ID, tree.Box, data)
	afterWriteTree(tree)
	return uint64(len(data)), nil
}

// LoadTreeSnapshot 从同一次磁盘读取返回文档及条件写基线，认证和格式兼容处理不写回源文件。
func LoadTreeSnapshot(boxID, p string, luteEngine *lute.Lute) (tree *parse.Tree, original []byte, err error) {
	tree, original, _, err = LoadTreeSnapshotWithFix(boxID, p, luteEngine)
	return
}

// LoadTreeSnapshotWithFix also reports compatibility repairs that need a conditional write-back.
func LoadTreeSnapshotWithFix(boxID, p string, luteEngine *lute.Lute) (tree *parse.Tree, original []byte, needFix bool, err error) {
	mode, err := validateTreePathMode(boxID, p)
	if err != nil {
		return
	}
	dek, encrypted, release, err := acquireCryptoLease(boxID)
	if err != nil {
		return nil, nil, false, err
	}
	defer release()
	original, err = filelock.ReadFile(filepath.Join(util.DataDir, boxID, p))
	if err != nil {
		return
	}
	data, err := decryptDataWithDEK(boxID, p, original, dek)
	if err != nil {
		return nil, nil, false, err
	}
	data, needFix, err = fixTreeJSONDataInMode(boxID, p, data, luteEngine, dek, encrypted, false, mode)
	if err != nil {
		return nil, nil, false, err
	}
	tree, err = loadTreeByDataInMode(data, boxID, p, luteEngine, mode)
	return
}
