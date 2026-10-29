// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"sort"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func cloneNestedView(view *av.View) (*av.View, error) {
	data, err := json.Marshal(view)
	if err != nil {
		return nil, err
	}
	ret := &av.View{}
	if err = json.Unmarshal(data, ret); err != nil {
		return nil, err
	}
	return ret, nil
}

func cloneNestedPageView(view *av.View) (*av.View, error) {
	copy := *view
	copy.Groups = nil
	copy.ItemIDs = nil
	copy.GroupItemIDs = nil
	return cloneNestedView(&copy)
}

// nestedPlanView 仅求值筛选、排序、分组和统计需要的字段，展示字段在分页后求值。
func nestedPlanView(view *av.View, source *av.AttributeView, query string, context *av.FilterContext) (*av.View, error) {
	ret, err := cloneNestedView(view)
	if err != nil {
		return nil, err
	}
	ret.Groups = nil
	ret.GroupItemIDs = nil
	needed := map[string]bool{}
	if primary := source.GetBlockKeyValues(); primary != nil {
		needed[primary.Key.ID] = true
	}
	var filters func([]*av.ViewFilter)
	filters = func(nodes []*av.ViewFilter) {
		for _, node := range nodes {
			if node != nil {
				needed[node.Column] = true
				filters(node.Filters)
			}
		}
	}
	filters(view.Filters)
	for _, sort := range view.Sorts {
		needed[sort.Column] = true
	}
	if view.Group != nil {
		needed[view.Group.Field] = true
	}
	if view.GroupCalc != nil {
		needed[view.GroupCalc.Field] = true
	}
	if context != nil {
		needed[context.KeyID] = true
	}
	for _, column := range view.GetTableLayout().Columns {
		if column.Calc != nil && column.Calc.Operator != av.CalcOperatorNone {
			needed[column.ID] = true
		}
	}
	all := strings.TrimSpace(query) != ""
	pending := []string{}
	for id := range needed {
		pending = append(pending, id)
	}
	// 静态依赖取传递闭包；动态表达式仍完整求值，避免遗漏运行时字段访问。
	for len(pending) > 0 && !all {
		id := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		key, keyErr := source.GetKey(id)
		if keyErr != nil {
			continue
		}
		dependencies := []*av.Key{}
		if key.Type == av.KeyTypeTemplate || strings.TrimSpace(key.RenderTemplate) != "" {
			var known bool
			dependencies, known = sql.StaticTemplateKeyDependencies(source, key)
			if !known {
				all = true
				break
			}
		}
		if key.Type == av.KeyTypeRollup && key.Rollup != nil {
			if relation, relationErr := source.GetKey(key.Rollup.RelationKeyID); relationErr == nil {
				dependencies = append(dependencies, relation)
			}
		}
		for _, dependency := range dependencies {
			if !needed[dependency.ID] {
				needed[dependency.ID] = true
				pending = append(pending, dependency.ID)
			}
		}
	}
	if !all {
		columns := []*av.ViewTableColumn{}
		for _, column := range ret.GetTableLayout().Columns {
			if needed[column.ID] {
				columns = append(columns, column)
				delete(needed, column.ID)
			}
		}
		// 依赖字段可能未显示在当前视图中，临时规划仍需包含其值。
		for _, values := range source.KeyValues {
			if values != nil && values.Key != nil && needed[values.Key.ID] {
				columns = append(columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: values.Key.ID}})
			}
		}
		ret.GetTableLayout().Columns = columns
	}
	return ret, nil
}

func nestedQueryMatches(row *av.TableRow, query string) bool {
	words := strings.Fields(query)
	if len(words) == 0 {
		return true
	}
	for _, value := range row.GetValues() {
		if value == nil {
			continue
		}
		content := value.String(true)
		matched := true
		for _, word := range words {
			if !util.SearchCaseSensitive.Load() {
				word = strings.ToLower(word)
				content = strings.ToLower(content)
			}
			if !strings.Contains(content, word) {
				matched = false
				break
			}
		}
		if matched {
			return true
		}
	}
	return false
}

// 无谓词与计算规则时直接使用认证源中的条目身份，主字段在可见页内才渲染。
func nestedIdentityPlan(source *av.AttributeView, view *av.View, query string, context *av.FilterContext, historical bool) av.Viewable {
	if strings.TrimSpace(query) != "" || context != nil || len(view.Filters) > 0 || len(view.Sorts) > 0 || view.IsGroupView() || view.GroupCalc != nil {
		return nil
	}
	for _, column := range view.GetTableLayout().Columns {
		if column.Calc != nil && column.Calc.Operator != av.CalcOperatorNone {
			return nil
		}
	}
	return nestedIdentityRows(source, view, historical)
}

// 身份集合也用于元数据目标鉴权，不执行视图谓词或展示模板。
func nestedIdentityRows(source *av.AttributeView, view *av.View, historical bool) av.Viewable {
	primary := source.GetBlockKeyValues()
	if primary == nil {
		return nil
	}
	boundIDs := []string{}
	for _, value := range primary.Values {
		if !historical && value != nil && value.Block != nil && !value.IsDetached && value.Block.ID != "" {
			boundIDs = append(boundIDs, value.Block.ID)
		}
	}
	existing := treenode.ExistBlockTrees(boundIDs)
	rows := map[string]*av.TableRow{}
	for _, value := range primary.Values {
		if value == nil || value.Block == nil || (!historical && !value.IsDetached && (value.Block.ID == "" || !existing[value.Block.ID])) {
			continue
		}
		rows[value.BlockID] = &av.TableRow{ID: value.BlockID, Cells: []*av.TableCell{{BaseValue: &av.BaseValue{ID: value.ID, Value: value, ValueType: av.KeyTypeBlock}}}}
	}
	result := &av.Table{BaseInstance: av.NewViewBaseInstance(view), Columns: []*av.TableColumn{}, Rows: []*av.TableRow{}}
	appendID := func(id string) {
		if row := rows[id]; row != nil {
			result.Rows = append(result.Rows, row)
			delete(rows, id)
		}
	}
	for _, id := range view.ItemIDs {
		appendID(id)
	}
	for _, value := range primary.Values {
		if value != nil {
			appendID(value.BlockID)
		}
	}
	return result
}

func nestedPage(page, size, defaultSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = defaultSize
	}
	if size < 1 {
		size = 50
	}
	if size > 200 {
		size = 200
	}
	return page, size
}

// 先限制乘数，避免不可信页码导致索引整数溢出。
func nestedPageEnd(page, size, count int) int {
	if page > count/size {
		return count
	}
	return min(page*size, count)
}

type nestedProjection struct {
	parents       map[string]string
	children      map[string][]string
	roots         []string
	rootOf        map[string]string
	keep          map[string]bool
	matched       map[string]bool
	rows          map[string]*av.TableRow
	matchedByRoot map[string][]*av.TableRow
	rowRank       map[string]int
}

func projectNestedRows(index *av.SubItemsIndex, rows []*av.TableRow, matched map[string]bool) *nestedProjection {
	ret := &nestedProjection{parents: map[string]string{}, children: map[string][]string{}, rootOf: map[string]string{}, keep: map[string]bool{}, matched: matched, rows: map[string]*av.TableRow{}, matchedByRoot: map[string][]*av.TableRow{}, rowRank: map[string]int{}}
	for rank, row := range rows {
		ret.rows[row.ID] = row
		ret.rowRank[row.ID] = rank
	}
	for _, row := range rows {
		parent := index.Parents[row.ID]
		if ret.rows[parent] == nil {
			parent = ""
		}
		ret.parents[row.ID] = parent
	}
	for _, row := range rows {
		path := []string{}
		id := row.ID
		for id != "" && ret.rootOf[id] == "" {
			path = append(path, id)
			id = ret.parents[id]
		}
		root := ret.rootOf[id]
		if root == "" && len(path) > 0 {
			root = path[len(path)-1]
		}
		for _, member := range path {
			ret.rootOf[member] = root
		}
	}
	for id := range matched {
		for id != "" && ret.rows[id] != nil && !ret.keep[id] {
			ret.keep[id] = true
			id = ret.parents[id]
		}
	}
	for _, row := range rows {
		if matched[row.ID] {
			ret.matchedByRoot[ret.rootOf[row.ID]] = append(ret.matchedByRoot[ret.rootOf[row.ID]], row)
		}
		if !ret.keep[row.ID] {
			continue
		}
		parent := ret.parents[row.ID]
		if parent == "" {
			ret.roots = append(ret.roots, row.ID)
		} else {
			ret.children[parent] = append(ret.children[parent], row.ID)
		}
	}
	return ret
}

func copyNestedCalculations(dest, source *av.Table) {
	for _, col := range dest.Columns {
		if other := source.GetColumn(col.ID); other != nil && other.Calc != nil {
			value := *other.Calc
			col.Calc = &value
		}
	}
	dest.GroupCalc = source.GroupCalc
}

func nestedCalculation(source *av.Table, rows []*av.TableRow, attrView *av.AttributeView) *av.Table {
	ret := *source
	base := *source.BaseInstance
	ret.BaseInstance = &base
	if base.GroupCalc != nil {
		group := *base.GroupCalc
		if group.FieldCalc != nil {
			calc := *group.FieldCalc
			group.FieldCalc = &calc
		}
		ret.GroupCalc = &group
	}
	ret.Columns = make([]*av.TableColumn, len(source.Columns))
	for i, column := range source.Columns {
		col := *column
		field := *column.BaseInstanceField
		col.BaseInstanceField = &field
		if column.Calc != nil {
			calc := *column.Calc
			col.Calc = &calc
		}
		ret.Columns[i] = &col
	}
	ret.Rows = rows
	av.Calc(&ret, attrView)
	return &ret
}

func renderNestedAttributeView(attrView *av.AttributeView, view *av.View, query string, page, pageSize int, groupPaging map[string]any, ignoreRows, writable bool, target *AttributeViewRenderTarget, targetGroupID string, filterContext *av.FilterContext, options AttributeViewRenderOptions) (av.Viewable, error) {
	// 分页和权限投影只在本次读取内缓存，不污染后续平铺或其他范围的读取。
	previousRendered := attrView.RenderedViewables
	attrView.RenderedViewables = map[string]av.Viewable{}
	defer func() { attrView.RenderedViewables = previousRendered }()
	index, err := attrView.BuildSubItemsIndex()
	if err != nil {
		return nil, err
	}
	context := sql.NewAttributeViewRenderContext()
	context.ReadOnly = true
	if options.historicalSource {
		context.HistoricalAttributeViewID = attrView.ID
	}
	defer context.PushTemplateErrors()
	delete(attrView.RenderedViewables, view.ID)
	metaView, err := cloneNestedPageView(view)
	if err != nil {
		return nil, err
	}
	meta := sql.RenderViewWithContext(attrView, metaView, "", true, context)
	table := av.TableFromViewable(meta)
	table.Nested = &av.NestedResult{ChildPaging: map[string]*av.NestedChildPage{}}
	if ignoreRows {
		if target != nil && options.ScopeFilter != nil {
			target.Status = "itemNotFound"
			target.AncestorIDs = nil
			identities := nestedIdentityRows(attrView, view, options.historicalSource)
			if identities != nil {
				identities = options.ScopeFilter(identities)
				for _, row := range av.TableFromViewable(identities).Rows {
					if row.ID == target.ItemID {
						target.Status = "filtered"
						break
					}
				}
			}
		}
		return meta, nil
	}
	planView, err := nestedPlanView(view, attrView, query, filterContext)
	if err != nil {
		return nil, err
	}
	delete(attrView.RenderedViewables, view.ID)
	plan := nestedIdentityPlan(attrView, planView, query, filterContext, options.historicalSource)
	if plan == nil {
		plan = sql.RenderViewWithContext(attrView, planView, "", false, context)
	}
	if view.IsGroupView() {
		// 可写实时读取维护原有平铺分组，树形投影不写回分组成员。
		before, marshalErr := json.Marshal(view.Groups)
		if marshalErr != nil {
			return nil, marshalErr
		}
		flatView, cloneErr := cloneNestedView(view)
		if cloneErr != nil {
			return nil, cloneErr
		}
		genAttrViewGroupsWithItems(flatView, attrView, plan.(av.Collection).GetItems())
		existingGroups := map[string]bool{}
		for _, group := range view.Groups {
			existingGroups[group.ID] = true
		}
		for _, group := range flatView.Groups {
			if !existingGroups[group.ID] && (!writable || options.ScopeFilter != nil) {
				// 未持久化分组使用稳定身份，历史及只读读取也可保存会话内展开状态。
				digest := sha256.Sum256([]byte(view.ID + "\x00" + group.GetGroupValue()))
				group.ID = "nested-" + hex.EncodeToString(digest[:])
			}
		}
		after, marshalErr := json.Marshal(flatView.Groups)
		if marshalErr != nil {
			return nil, marshalErr
		}
		if string(before) != string(after) {
			view.Groups = flatView.Groups
			view.GroupCreated = flatView.GroupCreated
			if writable && options.ScopeFilter == nil {
				if err := av.SaveAttributeView(attrView); err != nil {
					return nil, err
				}
			}
		}
	}
	if options.ScopeFilter != nil {
		plan = options.ScopeFilter(plan)
	}
	planTable := av.TableFromViewable(plan)
	all := append([]*av.TableRow(nil), planTable.Rows...)
	if len(view.Filters) > 0 || filterContext != nil {
		cached := map[string]*av.AttributeView{}
		further := sql.GetFurtherCollectionsWithContext(attrView, cached, context)
		av.FilterWithContext(plan, attrView, further, cached, filterContext)
	}
	matched := map[string]bool{}
	matchedRows := []*av.TableRow{}
	for _, row := range planTable.Rows {
		if nestedQueryMatches(row, query) {
			matched[row.ID] = true
			matchedRows = append(matchedRows, row)
		}
	}
	planTable.Rows = all
	av.Sort(plan, attrView)
	matchedRows = nil
	for _, row := range planTable.Rows {
		if matched[row.ID] {
			matchedRows = append(matchedRows, row)
		}
	}
	globalCalc := nestedCalculation(planTable, matchedRows, attrView)
	projection := projectNestedRows(index, planTable.Rows, matched)
	statusIDsByRoot := map[string][]string{}
	for id := range options.ItemStatuses {
		if projection.rows[id] != nil {
			options.ItemStatuses[id] = "filtered"
		}
		if projection.keep[id] && !view.IsGroupView() {
			options.ItemStatuses[id] = "visible"
		}
		if projection.keep[id] {
			root := projection.rootOf[id]
			statusIDsByRoot[root] = append(statusIDsByRoot[root], id)
		}
	}
	if target != nil && projection.rows[target.ItemID] == nil {
		target.Status = "itemNotFound"
		target.AncestorIDs = nil
	}
	copyNestedCalculations(table, globalCalc)
	table.RowCount = len(matched)
	table.Nested.MatchedCount = len(matched)
	table.Nested.RootCount = len(projection.roots)
	if view.IsGroupView() {
		groupView, err := cloneNestedView(view)
		if err != nil {
			return nil, err
		}
		rootItems := []av.Item{}
		// 所有可访问根参与分组，使筛选不改变分组身份或顺序。
		for _, row := range planTable.Rows {
			if projection.parents[row.ID] == "" {
				rootItems = append(rootItems, row)
			}
		}
		genAttrViewGroupsWithItems(groupView, attrView, rootItems)
		setAttributeViewGroupNames(attrView, groupView)
		sortGroupViews(attrView, groupView)
		groups := []av.Viewable{}
		sourceGroups := map[string]*av.View{}
		for _, group := range view.Groups {
			sourceGroups[group.ID] = group
		}
		for _, group := range groupView.Groups {
			roots := []string{}
			for _, id := range group.GroupItemIDs {
				if projection.keep[id] {
					roots = append(roots, id)
				}
			}
			if options.ItemStatuses != nil {
				for _, root := range roots {
					for _, id := range statusIDsByRoot[root] {
						if options.ItemStatuses[id] == "visible" {
							continue
						}
						if group.GroupHidden == 2 {
							options.ItemStatuses[id] = "groupHidden"
						} else {
							options.ItemStatuses[id] = "visible"
						}
					}
				}
				continue
			}
			groupProjection := *projection
			if len(view.Sorts) > 0 {
				sort.SliceStable(roots, func(i, j int) bool { return projection.rowRank[roots[i]] < projection.rowRank[roots[j]] })
			} else if sourceGroup := sourceGroups[group.ID]; sourceGroup != nil {
				// 分组内手动顺序按同父项解释，未在旧分组中的子项沿用视图顺序。
				rank := map[string]int{}
				order := sourceGroup.SubItemsItemIDs
				if len(order) == 0 {
					order = sourceGroup.GroupItemIDs
				}
				for i, id := range order {
					rank[id] = i
				}
				groupProjection.children = map[string][]string{}
				pending := slices.Clone(roots)
				for len(pending) > 0 {
					parent := pending[len(pending)-1]
					pending = pending[:len(pending)-1]
					children := projection.children[parent]
					pending = append(pending, children...)
					if len(children) == 0 {
						continue
					}
					ordered := slices.Clone(children)
					sort.SliceStable(ordered, func(i, j int) bool {
						left, leftOK := rank[ordered[i]]
						right, rightOK := rank[ordered[j]]
						if leftOK && rightOK {
							return left < right
						}
						return leftOK && !rightOK
					})
					groupProjection.children[parent] = ordered
				}
			}
			groupPage, groupSize := page, pageSize
			if paging, ok := groupPaging[group.ID].(map[string]any); ok {
				if value, ok := paging["page"].(float64); ok {
					groupPage = int(value)
				}
				if value, ok := paging["pageSize"].(float64); ok {
					groupSize = int(value)
				}
			}
			var groupTarget *AttributeViewRenderTarget
			if target != nil && ((targetGroupID != "" && group.ID == targetGroupID) || (targetGroupID == "" && target.Status != "visible")) {
				groupTarget = target
			}
			instance, err := renderNestedPage(attrView, view, group, &groupProjection, roots, groupPage, groupSize, query, groupTarget, options, planTable, context, true)
			if err != nil {
				return nil, err
			}
			hideEmptyGroupViews(view, instance)
			if groupTarget != nil && groupTarget.Status == "visible" && instance.GetGroupHidden() != 0 {
				groupTarget.Status = "groupHidden"
			}
			table.Nested.RootLoaded += av.TableFromViewable(instance).Nested.RootLoaded
			groups = append(groups, instance)
		}
		table.Rows = []*av.TableRow{}
		table.Groups = groups
		if options.ItemStatuses == nil {
			if err := materializeNestedGroups(attrView, view, groups, options, context); err != nil {
				return nil, err
			}
		}
		return meta, nil
	}
	if options.ItemStatuses != nil {
		return meta, nil
	}
	return renderNestedPage(attrView, view, nil, projection, projection.roots, page, pageSize, query, target, options, planTable, context, false)
}

func renderNestedPage(attrView *av.AttributeView, view, group *av.View, projection *nestedProjection, roots []string, page, pageSize int, query string, target *AttributeViewRenderTarget, options AttributeViewRenderOptions, plan *av.Table, context *sql.AttributeViewRenderContext, prepareOnly bool) (av.Viewable, error) {
	page, pageSize = nestedPage(page, pageSize, view.PageSize)
	groupID := ""
	pageView, err := cloneNestedPageView(view)
	if err != nil {
		return nil, err
	}
	if group != nil {
		groupID = group.ID
		columns := pageView.GetTableLayout().Columns
		pageView, err = cloneNestedView(group)
		if err != nil {
			return nil, err
		}
		pageView.GetTableLayout().Columns = columns
	}
	pageView.Groups = nil
	expanded := map[string]bool{}
	expandedIDs := options.Nested.ExpandedIDs
	if value, ok := options.Nested.GroupExpandedIDs[groupID]; ok {
		expandedIDs = value
	}
	for _, id := range expandedIDs {
		if projection.rows[id] != nil {
			expanded[id] = true
		}
	}
	if strings.TrimSpace(query) != "" {
		// 每组只遍历自己的匹配项，避免分组数乘以全库匹配数的重复扫描。
		for _, root := range roots {
			for _, row := range projection.matchedByRoot[root] {
				for parent := projection.parents[row.ID]; parent != "" && !expanded[parent]; parent = projection.parents[parent] {
					expanded[parent] = true
				}
			}
		}
	}
	targetPath := map[string]string{}
	if target != nil && projection.keep[target.ItemID] && slices.Contains(roots, projection.rootOf[target.ItemID]) {
		ancestors := []string{}
		for id := target.ItemID; projection.parents[id] != ""; id = projection.parents[id] {
			parent := projection.parents[id]
			expanded[parent] = true
			targetPath[parent] = id
			ancestors = append(ancestors, parent)
		}
		slices.Reverse(ancestors)
		target.AncestorIDs = ancestors
		page = slices.Index(roots, projection.rootOf[target.ItemID])/pageSize + 1
	}
	page = min(page, max(1, (len(roots)+pageSize-1)/pageSize))
	start := nestedPageEnd(page-1, pageSize, len(roots))
	end := nestedPageEnd(page, pageSize, len(roots))
	result := &av.NestedResult{Page: page, PageSize: pageSize, RootCount: len(roots), RootLoaded: end - start, ChildPaging: map[string]*av.NestedChildPage{}}
	matchedRows := []*av.TableRow{}
	for _, id := range roots {
		matchedRows = append(matchedRows, projection.matchedByRoot[id]...)
	}
	sort.SliceStable(matchedRows, func(i, j int) bool {
		return projection.rowRank[matchedRows[i].ID] < projection.rowRank[matchedRows[j].ID]
	})
	result.MatchedCount = len(matchedRows)
	calc := nestedCalculation(plan, matchedRows, attrView)
	type pending struct {
		id    string
		depth int
	}
	stack := []pending{}
	for i := end - 1; i >= start; i-- {
		stack = append(stack, pending{roots[i], 0})
	}
	ids := []string{}
	hierarchy := map[string]*av.ItemHierarchy{}
	for len(stack) > 0 {
		node := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		ids = append(ids, node.id)
		children := projection.children[node.id]
		hierarchy[node.id] = &av.ItemHierarchy{ParentID: projection.parents[node.id], Depth: node.depth, ChildCount: len(children), Context: !projection.matched[node.id], Expanded: expanded[node.id]}
		if !expanded[node.id] || len(children) == 0 {
			continue
		}
		key := node.id
		if groupID != "" {
			key = groupID + "/" + node.id
		}
		childPage, childSize := 1, 50
		if requested := options.Nested.ChildPaging[key]; requested != nil {
			childPage, childSize = requested.Page, requested.PageSize
		}
		childPage, childSize = nestedPage(childPage, childSize, 50)
		childSize = min(childSize, 200)
		if child := targetPath[node.id]; child != "" {
			childPage = slices.Index(children, child)/childSize + 1
		}
		childPage = min(childPage, max(1, (len(children)+childSize-1)/childSize))
		childStart := nestedPageEnd(childPage-1, childSize, len(children))
		childEnd := nestedPageEnd(childPage, childSize, len(children))
		result.ChildPaging[node.id] = &av.NestedChildPage{Page: childPage, PageSize: childSize, Total: len(children), Loaded: childEnd - childStart}
		for i := childEnd - 1; i >= childStart; i-- {
			stack = append(stack, pending{children[i], node.depth + 1})
		}
	}
	pageView.GroupItemIDs = ids
	pageView.ItemIDs = ids
	delete(attrView.RenderedViewables, pageView.ID)
	instance := sql.RenderViewWithContext(attrView, pageView, "", prepareOnly, context)
	if options.ScopeFilter != nil && !prepareOnly {
		instance = options.ScopeFilter(instance)
	}
	table := av.TableFromViewable(instance)
	table.Nested = result
	table.PageSize = pageSize
	table.RowCount = result.MatchedCount
	copyNestedCalculations(table, calc)
	byID := map[string]*av.TableRow{}
	for _, row := range table.Rows {
		byID[row.ID] = row
	}
	if prepareOnly {
		for _, id := range ids {
			byID[id] = &av.TableRow{ID: id}
		}
	}
	table.Rows = []*av.TableRow{}
	for _, id := range ids {
		if row := byID[id]; row != nil {
			row.Hierarchy = hierarchy[id]
			table.Rows = append(table.Rows, row)
		}
	}
	if len(view.ConditionalColors) > 0 && !prepareOnly {
		cached := map[string]*av.AttributeView{}
		av.RenderConditionalColors(instance, view, attrView, sql.GetFurtherCollectionsWithContext(attrView, cached, context), cached)
	}
	if target != nil {
		for i, row := range table.Rows {
			if row.ID == target.ItemID {
				target.Status = "visible"
				target.GroupID = groupID
				target.Index = i
				target.Offset = 0
				target.PageSize = pageSize
				break
			}
		}
	}
	return instance, nil
}

// 所有分组可见项合并去重后只物化一次，避免每组重复扫描全库和求值模板。
func materializeNestedGroups(source *av.AttributeView, view *av.View, groups []av.Viewable, options AttributeViewRenderOptions, context *sql.AttributeViewRenderContext) error {
	ids := []string{}
	seen := map[string]bool{}
	for _, group := range groups {
		for _, row := range av.TableFromViewable(group).Rows {
			if !seen[row.ID] {
				seen[row.ID] = true
				ids = append(ids, row.ID)
			}
		}
	}
	pageView, err := cloneNestedPageView(view)
	if err != nil {
		return err
	}
	pageView.GroupItemIDs, pageView.ItemIDs = ids, ids
	delete(source.RenderedViewables, pageView.ID)
	instance := sql.RenderViewWithContext(source, pageView, "", false, context)
	if options.ScopeFilter != nil {
		instance = options.ScopeFilter(instance)
	}
	if len(view.ConditionalColors) > 0 {
		cached := map[string]*av.AttributeView{}
		av.RenderConditionalColors(instance, view, source, sql.GetFurtherCollectionsWithContext(source, cached, context), cached)
	}
	byID := map[string]*av.TableRow{}
	for _, row := range av.TableFromViewable(instance).Rows {
		byID[row.ID] = row
	}
	for _, group := range groups {
		table := av.TableFromViewable(group)
		rows := []*av.TableRow{}
		for _, stub := range table.Rows {
			if value := byID[stub.ID]; value != nil {
				row := *value
				row.Hierarchy = stub.Hierarchy
				rows = append(rows, &row)
			}
		}
		table.Rows = rows
	}
	return nil
}
