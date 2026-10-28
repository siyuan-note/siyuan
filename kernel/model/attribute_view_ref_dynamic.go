// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

type attributeViewRefSource struct {
	avID  string
	boxID string
}

func refreshAttributeViewDynamicRefTexts(updatedDefNodes map[string]*ast.Node, refs []*sql.Ref) {
	for _, source := range attributeViewRefSources(refs) {
		attrView, err := av.ParseAttributeViewInBox(source.avID, source.boxID)
		if nil != err || nil == attrView || !updateAttributeViewDynamicRefTexts(attrView, updatedDefNodes) {
			continue
		}
		if err = av.SaveAttributeView(attrView); nil != err {
			logging.LogErrorf("save attribute view [%s] dynamic reference text failed: %s", source.avID, err)
			continue
		}
		ReloadAttrView(source.avID)
		refreshRelatedSrcAvs(source.avID, nil)
	}
}

func attributeViewRefSources(refs []*sql.Ref) (ret []attributeViewRefSource) {
	seen := map[string]bool{}
	for _, ref := range refs {
		if nil == ref || sql.AttributeViewRefType != ref.Type || "" == ref.BlockID {
			continue
		}
		boxID := ""
		if IsEncryptedBox(ref.Box) {
			boxID = ref.Box
		}
		tree, err := LoadTreeByBlockIDInExactBox(ref.BlockID, boxID)
		if nil != err || nil == tree || tree.Box != ref.Box || tree.Path != ref.Path {
			continue
		}
		databaseNode := treenode.GetNodeInTree(tree, ref.BlockID)
		if nil == databaseNode || ast.NodeAttributeView != databaseNode.Type || "" == databaseNode.AttributeViewID {
			continue
		}
		key := boxID + "\x00" + databaseNode.AttributeViewID
		if seen[key] {
			continue
		}
		seen[key] = true
		ret = append(ret, attributeViewRefSource{avID: databaseNode.AttributeViewID, boxID: boxID})
	}
	return
}

func updateAttributeViewDynamicRefTexts(attrView *av.AttributeView, updatedDefNodes map[string]*ast.Node) (changed bool) {
	if nil == attrView || 0 == len(updatedDefNodes) {
		return
	}
	for _, keyValues := range attrView.KeyValues {
		if nil == keyValues || nil == keyValues.Key || av.KeyTypeText != keyValues.Key.Type {
			continue
		}
		for _, value := range keyValues.Values {
			if nil == value || nil == value.Text || !value.Text.IsRich() {
				continue
			}
			fragmentTree, err := av.ParseValueTextRich(value.Text.Rich)
			if nil != err || nil == fragmentTree {
				continue
			}
			valueChanged, _ := updateRefText(fragmentTree.Root, updatedDefNodes)
			if !valueChanged {
				continue
			}
			richContent, renderErr := av.RenderValueTextRich(fragmentTree)
			if nil != renderErr {
				logging.LogWarnf("render attribute view [%s] dynamic reference text failed: %s", attrView.ID, renderErr)
				continue
			}
			value.Text.Rich.Content = richContent
			changed = true
		}
	}
	return
}
