package model

import (
	"encoding/json"
	"slices"
	"sort"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

type listMindmapSummaryContext struct {
	previous map[string][]string
	moved    map[string]bool
}

func validListMindmapSummaries(value any, nested bool) bool {
	summaries, ok := value.([]any)
	if !ok {
		return false
	}
	ids, members := map[string]bool{}, map[string]bool{}
	for _, value := range summaries {
		summary, ok := value.(map[string]any)
		if !ok {
			return false
		}
		id, ok := summary["id"].(string)
		if !ok || id == "" || ids[id] {
			return false
		}
		ids[id] = true
		parent, ok := summary["parentId"].(string)
		if !ok || parent == "" {
			return false
		}
		if _, ok = summary["label"].(string); !ok {
			return false
		}
		if color, exists := summary["color"]; exists {
			if _, ok = color.(string); !ok {
				return false
			}
		}
		nodes, ok := summary["nodeIds"].([]any)
		if !ok || len(nodes) == 0 {
			return false
		}
		local := map[string]bool{}
		for _, value := range nodes {
			id, ok = value.(string)
			if !ok || id == "" || id == parent || local[id] || (!nested && members[id]) {
				return false
			}
			members[id] = true
			local[id] = true
		}
	}
	if nested {
		for i, value := range summaries {
			a := value.(map[string]any)
			for _, value := range summaries[i+1:] {
				b := value.(map[string]any)
				if a["parentId"] == b["parentId"] {
					common := 0
					for _, id := range a["nodeIds"].([]any) {
						if slices.Contains(b["nodeIds"].([]any), id) {
							common++
						}
					}
					if common > 0 && common < len(a["nodeIds"].([]any)) && common < len(b["nodeIds"].([]any)) {
						return false
					}
				}
			}
		}
	}
	return true
}

// 按所属列表项合并直属分支，正文中的列表不参与脑图成员计算。
func listMindmapSiblingIDs(list *ast.Node) map[string][]string {
	ret := map[string][]string{}
	type branch struct {
		list   *ast.Node
		parent string
	}
	pending := []branch{{list, list.ID}}
	for len(pending) > 0 {
		current := pending[0]
		pending = pending[1:]
		for item := current.list.FirstChild; item != nil; item = item.Next {
			if item.Type != ast.NodeListItem && item.Type != ast.NodeMindmapItem {
				continue
			}
			ret[current.parent] = append(ret[current.parent], item.ID)
			for child := item.FirstChild; child != nil; child = child.Next {
				if child.Type == ast.NodeList || child.Type == ast.NodeMindmap {
					pending = append(pending, branch{child, item.ID})
				}
			}
		}
	}
	return ret
}

// 在结构变更前记录成员顺序，用于区分新插入节点与范围外的既有节点。
func (tx *Transaction) captureListMindmapSummarySiblings(tree *parse.Tree) {
	if tx.isReplay || tree == nil {
		return
	}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || (node.Type != ast.NodeList && node.Type != ast.NodeMindmap) {
			return ast.WalkContinue
		}
		value := node.IALAttr(listMindmapMetadataAttr)
		if value == "" {
			return ast.WalkContinue
		}
		var data map[string]any
		if json.Unmarshal([]byte(value), &data) == nil && data["summaries"] != nil && validListMindmapMetadata(data) {
			if tx.mindmapSummarySiblings == nil {
				tx.mindmapSummarySiblings = map[string]map[string][]string{}
			}
			if _, exists := tx.mindmapSummarySiblings[node.ID]; !exists {
				tx.mindmapSummarySiblings[node.ID] = listMindmapSiblingIDs(node)
			}
		}
		return ast.WalkContinue
	})
}

// 仅改写概要成员，未知字段保留原始 JSON 精度，范围消失时随事务删除概要。
func normalizeListMindmapSummaries(raw json.RawMessage, siblings map[string][]string,
	context *listMindmapSummaryContext, nested bool) (json.RawMessage, bool) {
	var summaries []map[string]json.RawMessage
	if json.Unmarshal(raw, &summaries) != nil {
		return raw, false
	}
	previous, moved := siblings, map[string]bool{}
	if context != nil {
		if context.previous != nil {
			previous = context.previous
		}
		moved = context.moved
	}
	kept := make([]map[string]json.RawMessage, 0, len(summaries))
	claimed := map[string]bool{}
	changed := false
	type normalizedRange struct {
		summary  map[string]json.RawMessage
		id       string
		parent   string
		original []string
		members  []string
	}
	var ranges []*normalizedRange
	for _, summary := range summaries {
		var parent string
		var members []string
		_ = json.Unmarshal(summary["parentId"], &parent)
		_ = json.Unmarshal(summary["nodeIds"], &members)
		memberSet, old := map[string]bool{}, map[string]bool{}
		for _, id := range members {
			memberSet[id] = true
		}
		for _, id := range previous[parent] {
			old[id] = true
		}
		var group, best []string
		bestScore := 0
		finish := func() {
			start, end, score := -1, -1, 0
			for i, id := range group {
				if memberSet[id] {
					if start < 0 {
						start = i
					}
					end = i
					if moved[id] {
						score++
					} else {
						score += len(members) + 1
					}
				}
			}
			if score > bestScore {
				bestScore = score
				best = slices.Clone(group[start : end+1])
			}
			group = nil
		}
		for _, id := range siblings[parent] {
			if (nested || !claimed[id]) && (memberSet[id] || !old[id]) {
				group = append(group, id)
			} else {
				finish()
			}
		}
		finish()
		if len(best) == 0 {
			changed = true
			continue
		}
		for _, id := range best {
			claimed[id] = true
		}
		if !slices.Equal(best, members) {
			summary["nodeIds"], _ = json.Marshal(best)
			changed = true
		}
		kept = append(kept, summary)
		var id string
		_ = json.Unmarshal(summary["id"], &id)
		ranges = append(ranges, &normalizedRange{summary: summary, id: id, parent: parent, original: members, members: best})
	}
	if nested {
		sort.Slice(ranges, func(i, j int) bool {
			if len(ranges[i].original) != len(ranges[j].original) {
				return len(ranges[i].original) > len(ranges[j].original)
			}
			return ranges[i].id < ranges[j].id
		})
		// 结构编辑造成交叉时，内层范围保留与原外层的交集，范围完全分离时各自保留。
		for i, outer := range ranges {
			for _, inner := range ranges[i+1:] {
				if outer.parent != inner.parent || slices.ContainsFunc(inner.original, func(id string) bool {
					return !slices.Contains(outer.original, id)
				}) {
					continue
				}
				var common []string
				for _, id := range inner.members {
					if slices.Contains(outer.members, id) {
						common = append(common, id)
					}
				}
				if len(common) > 0 && len(common) < len(inner.members) && len(common) < len(outer.members) {
					inner.members = common
					inner.summary["nodeIds"], _ = json.Marshal(common)
					changed = true
				}
			}
		}
	}
	if !changed {
		return raw, false
	}
	ret, _ := json.Marshal(kept)
	return ret, true
}
