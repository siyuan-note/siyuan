// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func checkAttrView(attrView *av.AttributeView, view *av.View) {
	// 字段删除以后需要删除设置的过滤和排序
	tmpFilters := []*av.ViewFilter{}
	for _, f := range view.Filters {
		if k, _ := attrView.GetKey(f.Column); nil != k {
			tmpFilters = append(tmpFilters, f)
		}
	}
	changed := len(tmpFilters) != len(view.Filters)
	view.Filters = tmpFilters

	tmpSorts := []*av.ViewSort{}
	for _, s := range view.Sorts {
		if k, _ := attrView.GetKey(s.Column); nil != k {
			tmpSorts = append(tmpSorts, s)
		}
	}
	if !changed {
		changed = len(tmpSorts) != len(view.Sorts)
	}
	view.Sorts = tmpSorts

	// 视图类型不匹配时需要订正
	for i, v := range attrView.Views {
		if av.LayoutTypeGallery == v.LayoutType && nil == v.Gallery {
			// 切换为画廊视图时可能没有初始化画廊实例 https://github.com/siyuan-note/siyuan/issues/15122
			if nil != v.Table {
				v.LayoutType = av.LayoutTypeTable
				changed = true
			} else {
				attrView.Views = append(attrView.Views[:i], attrView.Views[i+1:]...)
				changed = true
			}
		}
	}

	if changed {
		av.SaveAttributeView(attrView)
	}
}

func upgradeAttributeViewSpec(attrView *av.AttributeView) {
	currentSpec := attrView.Spec

	upgradeAttributeViewSpec1(attrView)
	av.UpgradeSpec(attrView)

	newSpec := attrView.Spec
	if currentSpec != newSpec {
		av.SaveAttributeView(attrView)
	}
}

func upgradeAttributeViewSpec1(attrView *av.AttributeView) {
	if 1 <= attrView.Spec {
		return
	}

	var blockIDs []string
	idBlocks := map[string]*av.Value{}
	for _, kv := range attrView.KeyValues {
		switch kv.Key.Type {
		case av.KeyTypeBlock:
			for _, v := range kv.Values {
				if !v.IsDetached {
					blockIDs = append(blockIDs, v.BlockID)
					idBlocks[v.BlockID] = v
				}
			}
		}
	}
	blockIDs = gulu.Str.RemoveDuplicatedElem(blockIDs)

	trees := filesys.LoadTrees(blockIDs)
	for _, id := range blockIDs {
		tree := trees[id]
		if nil == tree {
			continue
		}

		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			continue
		}

		if block := idBlocks[id].Block; nil != block {
			block.Icon = node.IALAttr("icon")
		}
	}
}
