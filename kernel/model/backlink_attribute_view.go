package model

import (
	"sort"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

type BacklinkAttributeViewTarget struct {
	BlockID string                        `json:"blockID"`
	Matches []*BacklinkAttributeViewMatch `json:"matches"`
}

type BacklinkAttributeViewMatch struct {
	ItemID  string   `json:"itemID"`
	KeyID   string   `json:"keyID"`
	ValueID string   `json:"valueID"`
	Title   string   `json:"title"`
	KeyName string   `json:"keyName"`
	DefIDs  []string `json:"defIDs"`
}

// 读取当前来源数据解析引用位置，索引仍按数据库块聚合，不改变引用计数和存储格式。
func backlinkAttributeViewTargets(tree *parse.Tree, refs []*sql.Ref) map[string]*BacklinkAttributeViewTarget {
	ret := map[string]*BacklinkAttributeViewTarget{}
	if nil == tree || nil == tree.Root {
		return ret
	}
	definitions := map[string]map[string]bool{}
	for _, ref := range refs {
		if nil == ref || sql.AttributeViewRefType != ref.Type || ref.RootID != tree.ID ||
			ref.Box != tree.Box || ref.Path != tree.Path {
			continue
		}
		if nil == definitions[ref.BlockID] {
			definitions[ref.BlockID] = map[string]bool{}
		}
		definitions[ref.BlockID][ref.DefBlockID] = true
	}
	boxID := attributeViewRefQueryBoxID(tree.Box)
	views := map[string]*av.AttributeView{}
	for blockID, defIDs := range definitions {
		node := treenode.GetNodeInTree(tree, blockID)
		if nil == node || ast.NodeAttributeView != node.Type || "" == node.AttributeViewID {
			continue
		}
		attrView, loaded := views[node.AttributeViewID]
		if !loaded {
			var err error
			attrView, err = av.ParseAttributeViewInBox(node.AttributeViewID, boxID)
			if nil != err {
				logging.LogWarnf("read backlink attribute view [%s] failed: %s", node.AttributeViewID, err)
				attrView = nil
			}
			views[node.AttributeViewID] = attrView
		}
		if matches := backlinkAttributeViewMatches(attrView, defIDs); 0 < len(matches) {
			ret[blockID] = &BacklinkAttributeViewTarget{BlockID: blockID, Matches: matches}
		}
	}
	return ret
}

func backlinkAttributeViewMatches(attrView *av.AttributeView, defIDs map[string]bool) (ret []*BacklinkAttributeViewMatch) {
	if nil == attrView || 0 == len(defIDs) {
		return
	}
	items := getAttributeViewBacklinkBlockValues(attrView)
	for _, kv := range attrView.KeyValues {
		if nil == kv || nil == kv.Key || av.KeyTypeText != kv.Key.Type {
			continue
		}
		for _, value := range kv.Values {
			if nil == value || nil == value.Text || !value.Text.IsRich() {
				continue
			}
			item := items[value.BlockID]
			if nil == item || nil == item.Block {
				continue
			}
			fragment, err := av.ParseValueTextRich(value.Text.Rich)
			if nil != err || nil == fragment || nil == fragment.Root {
				continue
			}
			matched := map[string]bool{}
			for _, defID := range getRefDefIDs(fragment.Root) {
				if defIDs[defID] {
					matched[defID] = true
				}
			}
			if 0 == len(matched) {
				continue
			}
			match := &BacklinkAttributeViewMatch{
				ItemID: value.BlockID, KeyID: kv.Key.ID, ValueID: value.ID,
				Title: item.Block.Content, KeyName: kv.Key.Name,
			}
			for defID := range matched {
				match.DefIDs = append(match.DefIDs, defID)
			}
			sort.Strings(match.DefIDs)
			ret = append(ret, match)
		}
	}
	return
}

func appendBacklinkAttributeViewTargets(backlink *Backlink, nodes []*ast.Node, targets map[string]*BacklinkAttributeViewTarget) {
	seen := map[string]bool{}
	for _, node := range nodes {
		ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeAttributeView == n.Type && !seen[n.ID] {
				if target := targets[n.ID]; nil != target {
					backlink.AttributeViewTargets = append(backlink.AttributeViewTargets, target)
					seen[n.ID] = true
				}
			}
			return ast.WalkContinue
		})
	}
}
