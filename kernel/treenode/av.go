// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"github.com/siyuan-note/siyuan/kernel/av"
)

// GetMirrorAttrViewBlockIDs 返回引用了该 AV 的所有块 ID（仅含块树仍存在的）。
// 通过 av.GetBlockRels 获取镜像索引，已合并全局 + 所有已打开加密笔记本的镜像数据（加密感知）。
func GetMirrorAttrViewBlockIDs(avID string) (ret []string) {
	ret = []string{}
	avBlocks := av.GetBlockRels()
	blockIDs := avBlocks[avID]
	bts := GetBlockTrees(blockIDs)
	for blockID := range bts {
		ret = append(ret, blockID)
	}
	return
}
