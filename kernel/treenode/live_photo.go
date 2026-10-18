// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

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
