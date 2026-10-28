// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// Keep the authenticated tree and exact on-disk bytes from the same read.
// writeReplacementTree compares this snapshot before publishing any changes.
func loadBatchMutationTree(rootID string) (*parse.Tree, []byte, error) {
	bt := treenode.GetBlockTree(rootID)
	if bt == nil {
		return nil, nil, ErrBlockNotFound
	}
	return filesys.LoadTreeSnapshot(bt.BoxID, bt.Path, util.NewLute())
}
