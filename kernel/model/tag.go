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
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/facette/natsort"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RemoveTag(label string) (err error) {
	if "" == label {
		return
	}

	util.PushEndlessProgress(Conf.Language(116))
	util.RandomSleep(1000, 2000)

	tags := sql.QueryTagSpansByLabel(label)
	treeBlocks := map[string][]string{}
	for _, tag := range tags {
		if blocks, ok := treeBlocks[tag.RootID]; !ok {
			treeBlocks[tag.RootID] = []string{tag.BlockID}
		} else {
			treeBlocks[tag.RootID] = append(blocks, tag.BlockID)
		}
	}

	for treeID, blocks := range treeBlocks {
		util.PushEndlessProgress("[" + treeID + "]")
		tree, e := loadTreeByBlockID(treeID)
		if nil != e {
			util.ClearPushProgress(100)
			return e
		}

		var unlinks []*ast.Node
		for _, blockID := range blocks {
			node := treenode.GetNodeInTree(tree, blockID)
			if nil == node {
				continue
			}

			if ast.NodeDocument == node.Type {
				if docTagsVal := node.IALAttr("tags"); strings.Contains(docTagsVal, label) {
					docTags := strings.Split(docTagsVal, ",")
					var tmp []string
					for _, docTag := range docTags {
						if docTag != label {
							tmp = append(tmp, docTag)
							continue
						}
					}
					node.SetIALAttr("tags", strings.Join(tmp, ","))
				}
				continue
			}

			nodeTags := node.ChildrenByType(ast.NodeTextMark)
			for _, nodeTag := range nodeTags {
				if nodeTag.IsTextMarkType("tag") {
					if label == nodeTag.TextMarkTextContent {
						unlinks = append(unlinks, nodeTag)
					}
				}
			}
		}
		for _, n := range unlinks {
			n.Unlink()
		}
		util.PushEndlessProgress(fmt.Sprintf(Conf.Language(111), util.EscapeHTML(tree.Root.IALAttr("title"))))
		if err = writeJSONQueue(tree); nil != err {
			util.ClearPushProgress(100)
			return
		}
		util.RandomSleep(50, 150)
	}

	util.ReloadUI()
	return
}

func RenameTag(oldLabel, newLabel string) (err error) {
	if invalidChar := treenode.ContainsMarker(newLabel); "" != invalidChar {
		return errors.New(fmt.Sprintf(Conf.Language(112), invalidChar))
	}

	newLabel = strings.TrimSpace(newLabel)
	newLabel = strings.TrimPrefix(newLabel, "/")
	newLabel = strings.TrimSuffix(newLabel, "/")
	newLabel = strings.TrimSpace(newLabel)

	if "" == newLabel {
		return errors.New(Conf.Language(114))
	}

	if oldLabel == newLabel {
		return
	}

	util.PushEndlessProgress(Conf.Language(110))
	util.RandomSleep(500, 1000)

	tags := sql.QueryTagSpansByLabel(oldLabel)
	treeBlocks := map[string][]string{}
	for _, tag := range tags {
		if blocks, ok := treeBlocks[tag.RootID]; !ok {
			treeBlocks[tag.RootID] = []string{tag.BlockID}
		} else {
			treeBlocks[tag.RootID] = append(blocks, tag.BlockID)
		}
	}

	for treeID, blocks := range treeBlocks {
		util.PushEndlessProgress("[" + treeID + "]")
		tree, e := loadTreeByBlockID(treeID)
		if nil != e {
			util.ClearPushProgress(100)
			return e
		}

		for _, blockID := range blocks {
			node := treenode.GetNodeInTree(tree, blockID)
			if nil == node {
				continue
			}

			if ast.NodeDocument == node.Type {
				if docTagsVal := node.IALAttr("tags"); strings.Contains(docTagsVal, oldLabel) {
					docTags := strings.Split(docTagsVal, ",")
					var tmp []string
					for _, docTag := range docTags {
						if strings.HasPrefix(docTag, oldLabel+"/") || docTag == oldLabel {
							docTag = strings.Replace(docTag, oldLabel, newLabel, 1)
							tmp = append(tmp, docTag)
						} else {
							tmp = append(tmp, docTag)
						}
					}
					node.SetIALAttr("tags", strings.Join(tmp, ","))
				}
				continue
			}

			nodeTags := node.ChildrenByType(ast.NodeTextMark)
			for _, nodeTag := range nodeTags {
				if nodeTag.IsTextMarkType("tag") {
					if strings.HasPrefix(nodeTag.TextMarkTextContent, oldLabel+"/") || nodeTag.TextMarkTextContent == oldLabel {
						nodeTag.TextMarkTextContent = strings.Replace(nodeTag.TextMarkTextContent, oldLabel, newLabel, 1)
					}
				}
			}
		}
		util.PushEndlessProgress(fmt.Sprintf(Conf.Language(111), util.EscapeHTML(tree.Root.IALAttr("title"))))
		if err = writeJSONQueue(tree); nil != err {
			util.ClearPushProgress(100)
			return
		}
		util.RandomSleep(50, 150)
	}

	util.ReloadUI()
	return
}

type TagBlocks []*Block

func (s TagBlocks) Len() int           { return len(s) }
func (s TagBlocks) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }
func (s TagBlocks) Less(i, j int) bool { return s[i].ID < s[j].ID }

type Tag struct {
	Name     string `json:"name"`
	Label    string `json:"label"`
	Children Tags   `json:"children"`
	Type     string `json:"type"` // "tag"
	Depth    int    `json:"depth"`
	Count    int    `json:"count"`

	tags Tags
}

type Tags []*Tag

func BuildTags() (ret *Tags) {
	WaitForWritingFiles()
	if !sql.IsEmptyQueue() {
		sql.WaitForWritingDatabase()
	}

	ret = &Tags{}
	labels := labelTags()
	tags := Tags{}
	for label, _ := range labels {
		tags = buildTags(tags, strings.Split(label, "/"), 0)
	}
	appendTagChildren(&tags, labels)
	sortTags(tags)
	ret = &tags
	return
}

func sortTags(tags Tags) {
	switch Conf.Tag.Sort {
	case util.SortModeNameASC:
		sort.Slice(tags, func(i, j int) bool {
			return util.PinYinCompare(util.RemoveEmoji(tags[i].Name), util.RemoveEmoji(tags[j].Name))
		})
	case util.SortModeNameDESC:
		sort.Slice(tags, func(j, i int) bool {
			return util.PinYinCompare(util.RemoveEmoji(tags[i].Name), util.RemoveEmoji(tags[j].Name))
		})
	case util.SortModeAlphanumASC:
		sort.Slice(tags, func(i, j int) bool {
			return natsort.Compare(util.RemoveEmoji((tags)[i].Name), util.RemoveEmoji((tags)[j].Name))
		})
	case util.SortModeAlphanumDESC:
		sort.Slice(tags, func(i, j int) bool {
			return natsort.Compare(util.RemoveEmoji((tags)[j].Name), util.RemoveEmoji((tags)[i].Name))
		})
	case util.SortModeRefCountASC:
		sort.Slice(tags, func(i, j int) bool { return (tags)[i].Count < (tags)[j].Count })
	case util.SortModeRefCountDESC:
		sort.Slice(tags, func(i, j int) bool { return (tags)[i].Count > (tags)[j].Count })
	default:
		sort.Slice(tags, func(i, j int) bool {
			return natsort.Compare(util.RemoveEmoji((tags)[i].Name), util.RemoveEmoji((tags)[j].Name))
		})
	}
}

func SearchTags(keyword string) (ret []string) {
	ret = []string{}
	defer logging.Recover() // 定位 无法添加题头图标签 https://github.com/siyuan-note/siyuan/issues/6756

	labels := labelBlocksByKeyword(keyword)
	for label, _ := range labels {
		_, t := search.MarkText(label, keyword, 1024, Conf.Search.CaseSensitive)
		ret = append(ret, t)
	}
	sort.Strings(ret)
	return
}

func labelBlocksByKeyword(keyword string) (ret map[string]TagBlocks) {
	ret = map[string]TagBlocks{}

	tags := sql.QueryTagSpansByKeyword(keyword, Conf.Search.Limit)
	set := hashset.New()
	for _, tag := range tags {
		set.Add(tag.BlockID)
	}
	var blockIDs []string
	for _, v := range set.Values() {
		blockIDs = append(blockIDs, v.(string))
	}
	sort.SliceStable(blockIDs, func(i, j int) bool {
		return blockIDs[i] > blockIDs[j]
	})

	sqlBlocks := sql.GetBlocks(blockIDs)
	blockMap := map[string]*sql.Block{}
	for _, block := range sqlBlocks {
		blockMap[block.ID] = block
	}

	for _, tag := range tags {
		label := tag.Content

		parentSQLBlock := blockMap[tag.BlockID]
		block := fromSQLBlock(parentSQLBlock, "", 0)
		if blocks, ok := ret[label]; ok {
			blocks = append(blocks, block)
			ret[label] = blocks
		} else {
			ret[label] = []*Block{block}
		}
	}
	return
}

func labelTags() (ret map[string]Tags) {
	ret = map[string]Tags{}

	tagSpans := sql.QueryTagSpans("")
	for _, tagSpan := range tagSpans {
		label := tagSpan.Content
		if _, ok := ret[label]; ok {
			ret[label] = append(ret[label], &Tag{})
		} else {
			ret[label] = Tags{}
		}
	}
	return
}

func appendTagChildren(tags *Tags, labels map[string]Tags) {
	for _, tag := range *tags {
		tag.Label = tag.Name
		if _, ok := labels[tag.Label]; ok {
			tag.Count = len(labels[tag.Label]) + 1
		}
		appendChildren0(tag, labels)
		sortTags(tag.Children)
	}
}

func appendChildren0(tag *Tag, labels map[string]Tags) {
	sortTags(tag.tags)
	for _, t := range tag.tags {
		t.Label = tag.Label + "/" + t.Name
		if _, ok := labels[t.Label]; ok {
			t.Count = len(labels[t.Label]) + 1
		}
		tag.Children = append(tag.Children, t)
	}
	for _, child := range tag.tags {
		appendChildren0(child, labels)
	}
}

func buildTags(root Tags, labels []string, depth int) Tags {
	if 1 > len(labels) {
		return root
	}

	i := 0
	for ; i < len(root); i++ {
		if (root)[i].Name == labels[0] {
			break
		}
	}
	if i == len(root) {
		root = append(root, &Tag{Name: util.EscapeHTML(labels[0]), Type: "tag", Depth: depth})
	}
	depth++
	root[i].tags = buildTags(root[i].tags, labels[1:], depth)
	return root
}
