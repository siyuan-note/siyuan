package model

import (
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

type BacklinkRefDef struct {
	ID   string `json:"id"`
	Text string `json:"text"`
	Path string `json:"path"`
}

func normalizeBacklinkRefDefIDs(ids []string) (ret []string) {
	ret = []string{}
	for _, id := range uniqueBacklinkStrings(ids) {
		if ast.IsNodeIDPattern(id) {
			ret = append(ret, id)
		}
	}
	sort.Strings(ret)
	return
}

// backlinkEntryBlockIDs 使用完整渲染范围，折叠状态不改变筛选语义。
func backlinkEntryBlockIDs(node *ast.Node) (ret []string) {
	if nil == node {
		return
	}
	nodes, _ := getBacklinkRenderNodes(node, nil)
	for _, root := range nodes {
		ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && n.IsBlock() && "" != n.ID {
				ret = append(ret, n.ID)
			}
			return ast.WalkContinue
		})
	}
	return uniqueBacklinkStrings(ret)
}

func backlinkEntryRefDefs(entries []*Block, boxID string) (ret map[string]map[string]bool, err error) {
	ret = map[string]map[string]bool{}
	trees := map[string]*parse.Tree{}
	entryBlocks := map[string][]string{}
	var blockIDs []string
	for _, entry := range entries {
		tree, loaded := trees[entry.RootID]
		if !loaded {
			tree, err = loadTreeByBlockIDInBox(entry.RootID, boxID)
			if nil != err {
				return nil, err
			}
			trees[entry.RootID] = tree
		}
		if nil == tree {
			continue
		}
		ids := backlinkEntryBlockIDs(treenode.GetNodeInTree(tree, entry.ID))
		entryBlocks[entry.ID] = ids
		blockIDs = append(blockIDs, ids...)
	}
	refs, err := sql.QueryBacklinkRefDefsInBox(uniqueBacklinkStrings(blockIDs), boxID)
	if nil != err {
		return nil, err
	}
	for entryID, ids := range entryBlocks {
		ret[entryID] = map[string]bool{}
		for _, id := range ids {
			for _, defID := range refs[id] {
				ret[entryID][defID] = true
			}
		}
	}
	return
}

func filterBacklinkRefDefs(entries []*Block, boxID string, excludedIDs []string) []*Block {
	refs, err := backlinkEntryRefDefs(entries, boxID)
	if nil != err {
		logging.LogErrorf("load backlink entry references failed: %s", err)
		return entries
	}
	return excludeBacklinkEntries(entries, refs, excludedIDs)
}

func excludeBacklinkEntries(entries []*Block, refs map[string]map[string]bool, excludedIDs []string) (ret []*Block) {
	for _, entry := range entries {
		excluded := false
		for _, id := range excludedIDs {
			if refs[entry.ID][id] {
				excluded = true
				break
			}
		}
		if !excluded {
			ret = append(ret, entry)
		}
	}
	return
}

// GetBacklinkRefDefs 返回应用引用排除前的候选，已选目标即使不再出现也保留。
func GetBacklinkRefDefs(id, keyword string, containChildren bool, boxID string, filter *BacklinkSourceFilter) (ret []*BacklinkRefDef, err error) {
	ret = []*BacklinkRefDef{}
	block := sql.GetBlockInBox(id, boxID)
	if nil == block {
		return
	}
	var selected []string
	if nil != filter {
		copyFilter := *filter
		selected = copyFilter.ExcludedRefDefIDs
		copyFilter.ExcludedRefDefIDs = nil
		filter = &copyFilter
	}
	refs := removeDuplicatedRefs(sql.QueryRefsByDefIDInBox(id, containChildren, boxID))
	var keywords []string
	if keyword = strings.TrimSpace(keyword); "" != keyword {
		keywords = strings.Split(keyword, " ")
	}
	entries, _, _, _ := buildLinkRefsInBox(block.RootID, refs, keywords, boxID)
	entries = filterBacklinkSourcesInBox(entries, block.RootID, boxID, filter)
	entryRefs, err := backlinkEntryRefDefs(entries, boxID)
	if nil != err {
		return nil, err
	}
	ids := append([]string{}, selected...)
	for _, defs := range entryRefs {
		for defID := range defs {
			ids = append(ids, defID)
		}
	}
	for _, def := range sql.GetBlocksInBox(normalizeBacklinkRefDefIDs(ids), boxID) {
		if nil != def {
			ret = append(ret, &BacklinkRefDef{ID: def.ID, Text: def.Content, Path: def.HPath})
		}
	}
	sort.Slice(ret, func(i, j int) bool {
		if ret[i].Text == ret[j].Text {
			return ret[i].ID < ret[j].ID
		}
		return ret[i].Text < ret[j].Text
	})
	return
}
