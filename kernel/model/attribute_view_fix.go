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
	"strings"
	"time"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
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

	// 字段删除以后需要删除设置的分组
	if nil != view.Group {
		if k, _ := attrView.GetKey(view.Group.Field); nil == k {
			view.Group = nil
		}
	}

	// 订正视图类型
	for i, v := range attrView.Views {
		if av.LayoutTypeGallery == v.LayoutType && nil == v.Gallery {
			// 切换为卡片视图时可能没有初始化卡片实例 https://github.com/siyuan-note/siyuan/issues/15122
			if nil != v.Table {
				v.LayoutType = av.LayoutTypeTable
				changed = true
			} else {
				attrView.Views = append(attrView.Views[:i], attrView.Views[i+1:]...)
				changed = true
			}
		}
	}

	now := util.CurrentTimeMillis()

	// 订正字段类型
	for _, kv := range attrView.KeyValues {
		for _, v := range kv.Values {
			if v.Type != kv.Key.Type {
				v.Type = kv.Key.Type
				if av.KeyTypeBlock == v.Type && nil == v.Block {
					v.Block = &av.ValueBlock{}
					if nil != v.Text {
						v.Block.Content = v.Text.Content
					}
					if "" == v.BlockID {
						v.BlockID = ast.NewNodeID()
					}
					createdStr := v.BlockID[:len("20060102150405")]
					created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
					if nil == parseErr {
						v.Block.Created = created.UnixMilli()
					} else {
						v.Block.Created = now
					}
					v.Block.Updated = v.Block.Created
				}
				changed = true
			}
		}
	}

	attrView.Name = strings.ReplaceAll(attrView.Name, "\n", " ")
	// 截断超长的数据库标题 Limit the database title to 512 characters https://github.com/siyuan-note/siyuan/issues/15459
	if 512 < utf8.RuneCountInString(attrView.Name) {
		attrView.Name = gulu.Str.SubStr(attrView.Name, 512)
		changed = true
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
