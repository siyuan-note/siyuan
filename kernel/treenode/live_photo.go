// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

const (
	LivePhotoVersionAttr = "custom-sy-live-photo"
	LivePhotoVideoAttr   = "custom-sy-live-photo-video"
	LivePhotoVersion     = "1"
)

// ImageLivePhotoVideo 返回图片关联的视频资源；未知版本也保留资源引用，避免清理时丢失原文件。
func ImageLivePhotoVideo(node *ast.Node) string {
	if node == nil || node.Type != ast.NodeImage {
		return ""
	}
	return node.IALAttr(LivePhotoVideoAttr)
}

// SetImageLivePhotoVideo 同步图片属性和相邻行级属性源，保留富文本表格的投影一致性。
func SetImageLivePhotoVideo(node *ast.Node, video string) {
	if node == nil || node.Type != ast.NodeImage {
		return
	}
	node.SetIALAttr(LivePhotoVideoAttr, video)
	if next := node.Next; next != nil && next.Type == ast.NodeKramdownSpanIAL {
		next.Tokens = parse.IAL2Tokens(node.KramdownIAL)
	}
}
