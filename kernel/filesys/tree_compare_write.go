// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"path/filepath"

	"github.com/88250/lute"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// WriteTreeIfUnchanged 仅在文档仍与扫描源的原始文件字节一致时原子替换，防止覆盖并发修改。
// 加密源必须先通过认证，落盘沿用现有密文格式，缓存仅在条件写成功后更新。
func WriteTreeIfUnchanged(tree *parse.Tree, original []byte) (uint64, error) {
	dek, encrypted, release, err := acquireCryptoLease(tree.Box)
	if err != nil {
		return 0, err
	}
	defer release()
	if encrypted {
		if _, err = decryptDataWithDEK(tree.Box, tree.Path, original, dek); err != nil {
			return 0, err
		}
	}
	data, filePath, err := prepareWriteTree(tree)
	if err != nil {
		return 0, err
	}
	diskData, err := encryptDataWithDEK(tree.Box, tree.Path, data, dek)
	if err != nil {
		return 0, err
	}
	if err = util.WriteFileIfUnchanged(filePath, original, diskData); err != nil {
		return 0, err
	}
	cache.SetTreeDataInBox(tree.ID, tree.Box, data)
	afterWriteTree(tree)
	return uint64(len(data)), nil
}

// LoadTreeSnapshot 从同一次磁盘读取返回文档及条件写基线，认证和格式兼容处理不写回源文件。
func LoadTreeSnapshot(boxID, p string, luteEngine *lute.Lute) (tree *parse.Tree, original []byte, err error) {
	if err = validateTreePath(boxID, p); err != nil {
		return
	}
	dek, encrypted, release, err := acquireCryptoLease(boxID)
	if err != nil {
		return nil, nil, err
	}
	defer release()
	original, err = filelock.ReadFile(filepath.Join(util.DataDir, boxID, p))
	if err != nil {
		return
	}
	data, err := decryptDataWithDEK(boxID, p, original, dek)
	if err != nil {
		return nil, nil, err
	}
	data, _, err = fixTreeJSONData(boxID, p, data, luteEngine, dek, encrypted, false)
	if err != nil {
		return nil, nil, err
	}
	tree, err = LoadTreeByData(data, boxID, p, luteEngine)
	return
}
