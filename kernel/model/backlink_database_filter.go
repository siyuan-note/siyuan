// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

type BacklinkDatabase struct {
	ID   string
	Name string
	Keys []*av.Key
}

func backlinkDatabaseBindings(view *av.AttributeView) map[string]string {
	ret := map[string]string{}
	if view == nil || view.GetBlockKeyValues() == nil {
		return ret
	}
	for _, value := range view.GetBlockKeyValues().Values {
		if value != nil && !value.IsDetached && value.Block != nil && value.Block.ID != "" {
			ret[value.Block.ID] = value.BlockID
		}
	}
	return ret
}

// 来源自身优先；仅复用反链既有的列表项、标题和文档提升关系，不继承任意祖先的数据库字段。
func backlinkDatabaseSources(blocks []*Block, boxID string) map[string][]*Block {
	ret := map[string][]*Block{}
	for _, block := range blocks {
		ret[block.ID] = []*Block{block}
	}
	for _, mapping := range buildBacklinkParentMappings(blocks, boxID) {
		for id := range mapping.coveredRefIDs {
			if mapping.parent.ID != id {
				ret[id] = append(ret[id], mapping.parent)
			}
		}
	}
	return ret
}

func filterBacklinkDatabaseRefs(refs []*sql.Ref, boxID string, filters ...*BacklinkSourceFilter) []*sql.Ref {
	if len(filters) == 0 || filters[0] == nil || filters[0].Database == nil {
		return refs
	}
	var ids []string
	for _, ref := range refs {
		ids = append(ids, ref.BlockID)
	}
	rows := sql.GetBlocksInBox(uniqueBacklinkStrings(ids), boxID)
	blocks := fromSQLBlocks(&rows, "", 0)
	matched := map[string]bool{}
	for _, block := range filterBacklinkDatabaseBlocks(blocks, boxID, filters[0]) {
		matched[block.ID] = true
	}
	ret := make([]*sql.Ref, 0, len(refs))
	for _, ref := range refs {
		if matched[ref.BlockID] {
			ret = append(ret, ref)
		}
	}
	return ret
}

func filterBacklinkDatabaseBlocks(blocks []*Block, boxID string, filter *BacklinkSourceFilter) []*Block {
	if filter == nil || filter.Database == nil || len(blocks) == 0 {
		return blocks
	}
	database := filter.Database
	view, err := av.ParseAttributeViewInBox(database.AvID, boxID)
	if err != nil || view == nil {
		logging.LogWarnf("read backlink database [%s] failed: %s", database.AvID, err)
		return nil
	}
	matched, err := backlinkDatabaseMatchedItems(view, database.Filters)
	if err != nil {
		logging.LogWarnf("evaluate backlink database [%s] failed: %s", database.AvID, err)
		return nil
	}
	ret := make([]*Block, 0, len(blocks))
	bindings := backlinkDatabaseBindings(view)
	owners := backlinkDatabaseSources(blocks, boxID)
	for _, block := range blocks {
		for _, owner := range owners[block.ID] {
			itemID, bound := bindings[owner.ID]
			if !bound {
				continue
			}
			if matched[itemID] {
				ret = append(ret, block)
			}
			break
		}
	}
	return ret
}

// 使用独立临时视图求值，包含隐藏字段，不套用数据库原视图的筛选、分组或分页。
func backlinkDatabaseMatchedItems(attrView *av.AttributeView, filters []*av.ViewFilter) (map[string]bool, error) {
	if err := validateBacklinkDatabaseFilters(attrView, filters); err != nil {
		return nil, err
	}
	view := &av.View{ID: ast.NewNodeID(), LayoutType: av.LayoutTypeTable,
		Filters: av.CloneFilters(filters), Table: av.NewLayoutTable()}
	for _, kv := range attrView.KeyValues {
		if kv != nil && kv.Key != nil {
			view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: kv.Key.ID}})
		}
	}
	table := sql.RenderView(attrView, view, "", false)
	if table == nil {
		return nil, fmt.Errorf("render backlink database failed")
	}
	cache := map[string]*av.AttributeView{attrView.ID: attrView}
	av.Filter(table, attrView, sql.GetFurtherCollections(attrView, cache), cache)
	ret := map[string]bool{}
	for _, item := range table.(av.Collection).GetItems() {
		ret[item.GetID()] = true
	}
	return ret, nil
}

func ValidateBacklinkDatabaseFilter(filter *BacklinkSourceFilter, boxID string) error {
	if filter == nil || filter.Database == nil {
		return nil
	}
	view, err := av.ParseAttributeViewInBox(filter.Database.AvID, boxID)
	if err != nil {
		return err
	}
	if view == nil {
		return fmt.Errorf("backlink database is unavailable")
	}
	return validateBacklinkDatabaseFilters(view, filter.Database.Filters)
}

func validateBacklinkDatabaseFilters(attrView *av.AttributeView, filters []*av.ViewFilter) error {
	if err := av.ValidateFilterDepth(filters); err != nil {
		return err
	}
	count := 0
	var validate func([]*av.ViewFilter) error
	validate = func(nodes []*av.ViewFilter) error {
		for _, filter := range nodes {
			count++
			if filter == nil || count > 1000 {
				return fmt.Errorf("invalid backlink database filter")
			}
			if filter.IsGroup() {
				if filter.Combination != av.FilterCombinationAnd && filter.Combination != av.FilterCombinationOr {
					return fmt.Errorf("invalid backlink database filter combination")
				}
				if err := validate(filter.Filters); err != nil {
					return err
				}
				continue
			}
			key, err := attrView.GetKey(filter.Column)
			if err != nil || key == nil {
				return fmt.Errorf("invalid backlink database field or operator")
			}
			typ := key.Type
			if filter.ValueSource == av.ValueSourceRendered {
				typ = av.KeyTypeText
			} else if filter.ValueSource != "" && filter.ValueSource != av.ValueSourceStored {
				return fmt.Errorf("invalid backlink database value source")
			}
			if !av.IsFilterOperatorAllowed(typ, filter.Operator) ||
				filter.Value != nil && filter.Value.Type != typ || filter.Value == nil && filter.RelativeDate == nil {
				return fmt.Errorf("invalid backlink database field or value type")
			}
		}
		return nil
	}
	if err := validate(filters); err != nil {
		return err
	}
	return nil
}

// 候选忽略当前数据库条件，保留其他来源限制，只返回确实绑定引用来源的数据库元数据。
func GetBacklinkDatabases(id, keyword, boxID string, containChildren bool, filter *BacklinkSourceFilter) ([]*BacklinkDatabase, error) {
	ret := []*BacklinkDatabase{}
	definition := sql.GetBlockInBox(id, boxID)
	if definition == nil {
		return ret, nil
	}
	refs := sql.QueryRefsByDefIDInBox(id, containChildren, boxID)
	var ids []string
	for _, ref := range refs {
		ids = append(ids, ref.BlockID)
	}
	rows := sql.GetBlocksInBox(uniqueBacklinkStrings(ids), boxID)
	blocks := fromSQLBlocks(&rows, "", 0)
	if filter != nil {
		copyFilter := *filter
		copyFilter.Database = nil
		blocks = filterBacklinkSourcesInBox(blocks, definition.RootID, boxID, &copyFilter)
	}
	owners := backlinkDatabaseSources(blocks, boxID)
	views := map[string]*av.AttributeView{}
	bindings := map[string]map[string]string{}
	added := map[string]bool{}
	keywords := strings.Fields(keyword)
	for _, block := range blocks {
		for _, owner := range owners[block.ID] {
			if !matchBacklinkKeyword(block, keywords) && !matchBacklinkKeyword(owner, keywords) {
				continue
			}
			for _, avID := range strings.Split(owner.IAL[av.NodeAttrNameAvs], ",") {
				if !ast.IsNodeIDPattern(avID) {
					continue
				}
				view, loaded := views[avID]
				if !loaded {
					var err error
					view, err = av.ParseAttributeViewInBox(avID, boxID)
					if err != nil {
						return nil, err
					}
					if view == nil {
						return nil, fmt.Errorf("backlink database is unavailable")
					}
					views[avID] = view
					bindings[avID] = backlinkDatabaseBindings(view)
				}
				if _, bound := bindings[avID][owner.ID]; !bound {
					continue
				}
				if !added[avID] {
					added[avID] = true
					candidate := &BacklinkDatabase{ID: avID, Name: getAttrViewName(view), Keys: []*av.Key{}}
					for _, kv := range view.KeyValues {
						if kv != nil && kv.Key != nil {
							candidate.Keys = append(candidate.Keys, kv.Key)
						}
					}
					ret = append(ret, candidate)
				}
			}
		}
	}
	// 已选数据库即使暂时没有命中也能继续编辑条件；不存在或不可读时仅由客户端保留失效标识。
	if filter != nil && filter.Database != nil {
		if !added[filter.Database.AvID] {
			if view, err := av.ParseAttributeViewInBox(filter.Database.AvID, boxID); err == nil && view != nil {
				candidate := &BacklinkDatabase{ID: view.ID, Name: getAttrViewName(view), Keys: []*av.Key{}}
				for _, kv := range view.KeyValues {
					if kv != nil && kv.Key != nil {
						candidate.Keys = append(candidate.Keys, kv.Key)
					}
				}
				ret = append(ret, candidate)
			}
		}
	}
	sort.Slice(ret, func(i, j int) bool {
		if ret[i].Name == ret[j].Name {
			return ret[i].ID < ret[j].ID
		}
		return ret[i].Name < ret[j].Name
	})
	return ret, nil
}
