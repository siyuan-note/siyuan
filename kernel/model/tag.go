// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RemoveTag(label string) (err error) {
	return removeTag(label, nil)
}

func removeTag(label string, beforeCommit func()) (err error) {
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

	var reloadTreeIDs []string
	updateNodes := map[string]*ast.Node{}
	historyDir, err := getHistoryDir(HistoryOpReplace)
	if nil != err {
		return
	}

	for treeID, blocks := range treeBlocks {
		util.PushEndlessProgress("[" + treeID + "]")
		tree, original, e := loadBatchMutationTree(treeID)
		if nil != e {
			util.ClearPushProgress(100)
			return e
		}

		generateTreeHistory(tree, historyDir)

		finishRich, richErr := treenode.MaterializeTableCellRich(tree.Root)
		if richErr != nil {
			return richErr
		}
		finishTitles := treenode.MaterializeInlineTitles(tree.Root)
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

			updateNodes[node.ID] = node
		}
		for _, n := range unlinks {
			n.Unlink()
		}
		finishTitles()
		if err = finishRich(); err != nil {
			return err
		}
		util.PushEndlessProgress(fmt.Sprintf(Conf.Language(111), util.EscapeHTML(treenode.ReadDocumentTitle(tree.Root).Text)))
		if beforeCommit != nil {
			beforeCommit()
		}
		if err = writeReplacementTree(tree, original, "", false, nil); err != nil {
			util.ClearPushProgress(100)
			return
		}
		util.RandomSleep(50, 150)
		reloadTreeIDs = append(reloadTreeIDs, tree.ID)
	}

	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
	sql.FlushQueue()

	reloadTreeIDs = gulu.Str.RemoveDuplicatedElem(reloadTreeIDs)
	for _, id := range reloadTreeIDs {
		ReloadProtyle(id)
	}

	updateAttributeViewBlockText(updateNodes)

	sql.FlushQueue()
	if sortErr := removeTagSort([]string{label}); sortErr != nil {
		logging.LogErrorf("remove tag order failed: %s", sortErr)
	}
	util.PushClearProgress()
	return
}

type TagBlocks []*Block

type Tag struct {
	Name     string `json:"name"`
	Label    string `json:"label"`
	Children Tags   `json:"children"`
	Type     string `json:"type"` // "tag"
	Depth    int    `json:"depth"`
	Count    int    `json:"count"`
	created  int64
}

type Tags []*Tag

func BuildTags(ignoreMaxListHintArg bool, appID string, sortVal int, visible func(string, string) bool) *Tags {
	FlushTxQueue()
	sql.FlushQueue()

	withDates := sortVal == util.SortModeTagCreatedDESC
	var labels map[string]int
	var created tagDates
	var err error
	if visible != nil || withDates {
		labels, created, err = labelTagAssociations(visible, withDates)
	} else {
		labels, err = labelTagCounts()
	}
	if err != nil {
		logging.LogErrorf("query tags failed: %s", err)
		return &Tags{}
	}
	var order tagSortGroups
	if sortVal == util.SortModeCustom {
		if order, err = readTagSort(); err != nil {
			logging.LogErrorf("read tag order failed: %s", err)
		}
	}
	tags := buildTagTree(labels, sortVal, order, created)
	return limitTagTree(tags, ignoreMaxListHintArg, appID)
}

func limitTagTree(tags Tags, ignoreLimit bool, appID string) *Tags {
	if ignoreLimit {
		return &tags
	}

	limit := Conf.LoadFileTree().MaxListCount
	var total int
	for i, tag := range tags {
		countTag(tag, &total)
		if limit < total {
			if nil == util.NotificationsCfg.Load() || util.NotificationsCfg.Load().TagMaxList {
				util.PushMsgWithApp(appID, fmt.Sprintf(Conf.Language(243), limit), 7000)
			}
			tags = tags[:i+1]
			return &tags
		}
	}
	return &tags
}

func countTag(tag *Tag, total *int) {
	*total += 1
	for _, child := range tag.Children {
		countTag(child, total)
	}
}

func sortTags(tags Tags, sortVal int) {
	switch sortVal {
	case util.SortModeNameASC:
		sort.Slice(tags, func(i, j int) bool {
			return util.PinYinCompare(tags[i].Name, tags[j].Name)
		})
	case util.SortModeNameDESC:
		sort.Slice(tags, func(j, i int) bool {
			return util.PinYinCompare(tags[i].Name, tags[j].Name)
		})
	case util.SortModeAlphanumASC:
		sort.Slice(tags, func(i, j int) bool {
			return util.NaturalCompare((tags)[i].Name, (tags)[j].Name)
		})
	case util.SortModeAlphanumDESC:
		sort.Slice(tags, func(i, j int) bool {
			return util.NaturalCompare((tags)[j].Name, (tags)[i].Name)
		})
	case util.SortModeRefCountASC:
		sort.Slice(tags, func(i, j int) bool { return (tags)[i].Count < (tags)[j].Count })
	case util.SortModeRefCountDESC:
		sort.Slice(tags, func(i, j int) bool { return (tags)[i].Count > (tags)[j].Count })
	case util.SortModeTagCreatedDESC:
		sort.Slice(tags, func(i, j int) bool {
			if tags[i].created == tags[j].created {
				return naturalTagLess(tags[i].Name, tags[j].Name)
			}
			return tags[i].created > tags[j].created
		})
	default:
		sort.Slice(tags, func(i, j int) bool { return naturalTagLess(tags[i].Name, tags[j].Name) })
	}
}

func naturalTagLess(left, right string) bool {
	if util.NaturalCompare(left, right) {
		return true
	}
	return !util.NaturalCompare(right, left) && left < right
}

func SearchTags(keyword string) (ret []string) {
	ret = []string{}

	sql.FlushQueue()

	labels := labelBlocksByKeyword(keyword)
	keyword = strings.Join(strings.Split(keyword, " "), search.TermSep)
	for label := range labels {
		if "" == keyword {
			ret = append(ret, util.EscapeHTML(label))
			continue
		}

		_, t := search.MarkText(label, keyword, 1024, Conf.Search.Load().CaseSensitive)
		ret = append(ret, t)
	}
	sort.Strings(ret)
	return
}

func labelBlocksByKeyword(keyword string) (ret map[string]TagBlocks) {
	ret = map[string]TagBlocks{}

	tags := sql.QueryTagSpansByKeyword(keyword, Conf.Search.Load().Limit)
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
		if nil == block {
			continue
		}

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

func labelTagCounts() (map[string]int, error) {
	indexed, err := sql.QueryTagCounts()
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int, len(indexed))
	for label, count := range indexed {
		counts[util.UnescapeHTML(label)] += count
	}
	return counts, nil
}

func labelTagAssociations(visible func(string, string) bool, withDates bool) (map[string]int, tagDates, error) {
	counts := map[string]int{}
	created := tagDates{}
	var previousAttrs string
	var dates tagDates
	err := sql.ReadTagAssociations(withDates, func(label, attrs, box, path string, count int) {
		if visible != nil && !visible(box, path) {
			return
		}
		label = util.UnescapeHTML(label)
		counts[label] += count
		if withDates {
			if attrs != previousAttrs {
				dates = readTagDates(attrs)
				previousAttrs = attrs
			}
			created[label] = max(created[label], dates[label])
		}
	})
	return counts, created, err
}

func buildTagTree(labels map[string]int, sortVal int, order tagSortGroups, created tagDates) Tags {
	tags := Tags{}
	nodes := make(map[string]*Tag, len(labels))
	for label, count := range labels {
		path := ""
		children := &tags
		for depth, name := range strings.Split(label, "/") {
			path += name
			node := nodes[path]
			if node == nil {
				node = &Tag{Name: util.EscapeHTML(name), Label: util.EscapeHTML(path), Type: "tag", Depth: depth}
				nodes[path] = node
				*children = append(*children, node)
			}
			node.created = max(node.created, created[label])
			children = &node.Children
			path += "/"
		}
		nodes[label].Count = count
	}
	sortTagGroups(tags, "", sortVal, order)
	return tags
}

func sortTagGroups(tags Tags, group string, sortVal int, order tagSortGroups) {
	if sortVal == util.SortModeCustom && len(order[group]) > 0 {
		ranks := make(map[string]int, len(order[group]))
		for i, label := range order[group] {
			ranks[util.EscapeHTML(label)] = i + 1
		}
		sort.Slice(tags, func(i, j int) bool {
			left, right := ranks[tags[i].Label], ranks[tags[j].Label]
			if left == right {
				return naturalTagLess(tags[i].Name, tags[j].Name)
			}
			return left > 0 && (right == 0 || left < right)
		})
	} else {
		sortTags(tags, sortVal)
	}
	for _, tag := range tags {
		if len(tag.Children) > 0 {
			sortTagGroups(tag.Children, util.UnescapeHTML(tag.Label)+"/", sortVal, order)
		}
	}
}
