// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"errors"
	"fmt"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func loadExistingToolBlock(id string) (*parse.Tree, error) {
	tree, err := model.LoadTreeByBlockID(id)
	if errors.Is(err, model.ErrTreeNotFound) {
		return nil, fmt.Errorf("block not found: %s", id)
	}
	if err != nil {
		return nil, fmt.Errorf("load block %s failed: %w", id, err)
	}
	if tree == nil || treenode.GetNodeInTree(tree, id) == nil {
		return nil, fmt.Errorf("block not found: %s", id)
	}
	return tree, nil
}
