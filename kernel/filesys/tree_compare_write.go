// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"errors"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// WriteTreeIfUnchanged 仅在普通文档仍与扫描源一致时原子替换，防止批量操作覆盖并发修改。
func WriteTreeIfUnchanged(tree *parse.Tree, original []byte) (uint64, error) {
	_, encrypted, release, err := acquireCryptoLease(tree.Box)
	if err != nil {
		return 0, err
	}
	defer release()
	if encrypted {
		return 0, errors.New("conditional replacement of encrypted documents is not supported")
	}
	data, filePath, err := prepareWriteTree(tree)
	if err != nil {
		return 0, err
	}
	if err = util.WriteFileIfUnchanged(filePath, original, data); err != nil {
		return 0, err
	}
	cache.SetTreeDataInBox(tree.ID, tree.Box, data)
	afterWriteTree(tree)
	return uint64(len(data)), nil
}
