package model

import (
	"errors"
	"reflect"
	"slices"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

// AttributeViewRowSortRequest 描述同一分组内的一次完整拖拽，落点可使用前项或后项定位。
type AttributeViewRowSortRequest struct {
	AvID       string   `json:"avID"`
	BlockID    string   `json:"blockID"`
	ViewID     string   `json:"viewID"`
	GroupID    string   `json:"groupID"`
	ItemIDs    []string `json:"itemIDs"`
	PreviousID string   `json:"previousID"`
	NextID     string   `json:"nextID"`
}

type attributeViewRowOrder struct {
	ItemIDs []string            `json:"itemIDs"`
	Groups  map[string][]string `json:"groups"`
	Sorts   []*av.ViewSort      `json:"sorts"`
}

type attributeViewRowOrderChange struct {
	RowOrder      *attributeViewRowOrder `json:"rowOrder"`
	Expected      *attributeViewRowOrder `json:"expected"`
	ValidateGroup *string                `json:"validateGroup,omitempty"`
}

type AttributeViewRowSortPreview struct {
	Conflict       bool         `json:"conflict"`
	DoOperations   []*Operation `json:"doOperations"`
	UndoOperations []*Operation `json:"undoOperations"`
}

func getAttributeViewRowOrder(view *av.View) *attributeViewRowOrder {
	ret := &attributeViewRowOrder{
		ItemIDs: append([]string{}, view.ItemIDs...),
		Groups:  map[string][]string{},
		Sorts:   append([]*av.ViewSort{}, view.Sorts...),
	}
	for _, group := range view.Groups {
		ret.Groups[group.ID] = append([]string{}, group.GroupItemIDs...)
	}
	return ret
}

// PrepareAttributeViewRowSort 只计算预览和撤销数据，不保存视图或改变字段值。
func PrepareAttributeViewRowSort(request *AttributeViewRowSortRequest) (*AttributeViewRowSortPreview, error) {
	attrView, err := avParseView(request.AvID, request.BlockID)
	if nil != err {
		return nil, err
	}
	attrView, err = cloneAttributeViewRowSort(attrView)
	if nil != err {
		return nil, err
	}
	view := attrView.GetView(request.ViewID)
	if nil == view {
		return nil, av.ErrViewNotFound
	}
	return prepareAttributeViewRowSort(attrView, view, request)
}

func prepareAttributeViewRowSort(attrView *av.AttributeView, view *av.View,
	request *AttributeViewRowSortRequest) (*AttributeViewRowSortPreview, error) {
	before := getAttributeViewRowOrder(view)
	collections, err := renderAttributeViewRowSortCollections(attrView, view, true)
	if nil != err {
		return nil, err
	}
	target := collections[request.GroupID]
	if nil == target || (view.IsGroupView() && "" == request.GroupID) {
		return nil, av.ErrViewNotFound
	}
	ordered := attributeViewRowSortIDs(target.GetItems())
	moved, err := moveAttributeViewSortedRows(ordered, request.ItemIDs, request.PreviousID, request.NextID)
	if nil != err {
		return nil, err
	}
	ret := &AttributeViewRowSortPreview{DoOperations: []*Operation{}, UndoOperations: []*Operation{}}
	if slices.Equal(ordered, moved) {
		return ret, nil
	}
	items := map[string]av.Item{}
	for _, item := range target.GetItems() {
		items[item.GetID()] = item
	}
	candidate := make([]av.Item, 0, len(moved))
	for _, id := range moved {
		candidate = append(candidate, items[id])
	}
	target.SetItems(candidate)
	av.Sort(target.(av.Viewable), attrView)
	ret.Conflict = !slices.Equal(moved, attributeViewRowSortIDs(target.GetItems()))
	after := getAttributeViewRowOrder(view)
	if ret.Conflict {
		// 移除规则前保存全部分组的完整排序，包含筛选隐藏项和未加载的分页。
		after.ItemIDs = mergeAttributeViewRowOrder(before.ItemIDs, attributeViewRowSortIDs(collections[""].GetItems()))
		for groupID, ids := range before.Groups {
			after.Groups[groupID] = mergeAttributeViewRowOrder(ids, attributeViewRowSortIDs(collections[groupID].GetItems()))
		}
		after.Sorts = []*av.ViewSort{}
	}
	if "" == request.GroupID {
		after.ItemIDs = mergeAttributeViewRowOrder(before.ItemIDs, moved)
	} else {
		after.Groups[request.GroupID] = mergeAttributeViewRowOrder(before.Groups[request.GroupID], moved)
	}
	ret.DoOperations = []*Operation{{
		Action: "sortAttrViewRow", AvID: request.AvID, BlockID: request.BlockID, ViewID: view.ID,
		Data: &attributeViewRowOrderChange{RowOrder: after, Expected: before},
	}}
	if !ret.Conflict {
		ret.DoOperations[0].Data.(*attributeViewRowOrderChange).ValidateGroup = &request.GroupID
	}
	ret.UndoOperations = []*Operation{{
		Action: "sortAttrViewRow", AvID: request.AvID, BlockID: request.BlockID, ViewID: view.ID,
		Data: &attributeViewRowOrderChange{RowOrder: before, Expected: after},
	}}
	return ret, nil
}

// renderAttributeViewRowSortCollections 复用实际字段渲染及比较器，计算未筛选、未分页的完整顺序。
func renderAttributeViewRowSortCollections(attrView *av.AttributeView, view *av.View, sorted bool) (map[string]av.Collection, error) {
	context := sql.NewAttributeViewRenderContext()
	context.ReadOnly = true
	root := sql.RenderViewWithContext(attrView, view, "", false, context)
	collection, ok := root.(av.Collection)
	if !ok {
		return nil, av.ErrViewNotFound
	}
	source := sql.NewGroupViewRenderSource(root, "")
	if sorted {
		av.Sort(root, attrView)
	}
	ret := map[string]av.Collection{"": collection}
	for _, group := range view.Groups {
		viewable := sql.RenderGroupViewWithSourceContext(attrView, view, group, "", source, false, context)
		groupCollection, ok := viewable.(av.Collection)
		if !ok {
			return nil, av.ErrViewNotFound
		}
		if sorted {
			av.Sort(viewable, attrView)
		}
		ret[group.ID] = groupCollection
	}
	return ret, nil
}

func attributeViewRowSortIDs(items []av.Item) []string {
	ret := make([]string, 0, len(items))
	for _, item := range items {
		ret = append(ret, item.GetID())
	}
	return ret
}

func moveAttributeViewSortedRows(ordered, selected []string, previousID, nextID string) ([]string, error) {
	selectedIDs := map[string]bool{}
	for _, id := range selected {
		selectedIDs[id] = true
	}
	if 0 == len(selectedIDs) {
		return nil, errors.New("no attribute view rows selected")
	}
	var moved, remaining []string
	for _, id := range ordered {
		if selectedIDs[id] {
			moved = append(moved, id)
		} else {
			remaining = append(remaining, id)
		}
	}
	if len(moved) != len(selectedIDs) {
		return nil, errors.New("attribute view rows changed; retry the drag")
	}
	if selectedIDs[nextID] || ("" == nextID && selectedIDs[previousID]) {
		return slices.Clone(ordered), nil
	}
	index := 0
	if "" != nextID {
		index = slices.Index(remaining, nextID)
	} else if "" != previousID {
		index = slices.Index(remaining, previousID)
		if index >= 0 {
			index++
		}
	}
	if index < 0 {
		return nil, errors.New("attribute view drop target changed; retry the drag")
	}
	ret := append([]string{}, remaining[:index]...)
	ret = append(ret, moved...)
	return append(ret, remaining[index:]...), nil
}

// mergeAttributeViewRowOrder 保留当前尚未参与渲染的项目 ID，避免用页面数据覆盖完整列表。
func mergeAttributeViewRowOrder(original, ordered []string) []string {
	ret := append([]string{}, ordered...)
	seen := map[string]bool{}
	for _, id := range ordered {
		seen[id] = true
	}
	for _, id := range original {
		if !seen[id] {
			ret = append(ret, id)
			seen[id] = true
		}
	}
	return ret
}

func applyAttributeViewRowOrder(attrView *av.AttributeView, view *av.View, data any) error {
	encoded, err := gulu.JSON.MarshalJSON(data)
	if nil != err {
		return err
	}
	var change attributeViewRowOrderChange
	if err = gulu.JSON.UnmarshalJSON(encoded, &change); nil != err {
		return err
	}
	if nil == change.RowOrder || nil == change.Expected ||
		!reflect.DeepEqual(getAttributeViewRowOrder(view), change.Expected) {
		return errors.New("attribute view order changed; retry the drag")
	}
	if len(change.RowOrder.Groups) != len(view.Groups) {
		return errors.New("attribute view groups changed; retry the drag")
	}
	for _, group := range view.Groups {
		if _, ok := change.RowOrder.Groups[group.ID]; !ok {
			return errors.New("attribute view group not found")
		}
	}
	if nil != change.ValidateGroup && len(change.RowOrder.Sorts) > 0 {
		// 预览之后字段值可能变化，提交时再次校验，不能悄悄接受冲突的落点。
		copyView, copyErr := cloneAttributeViewRowSort(attrView)
		if nil != copyErr {
			return copyErr
		}
		candidate := copyView.GetView(view.ID)
		setAttributeViewRowOrder(candidate, change.RowOrder)
		collections, renderErr := renderAttributeViewRowSortCollections(copyView, candidate, false)
		if nil != renderErr {
			return renderErr
		}
		collection := collections[*change.ValidateGroup]
		if nil == collection {
			return av.ErrViewNotFound
		}
		ordered := attributeViewRowSortIDs(collection.GetItems())
		av.Sort(collection.(av.Viewable), copyView)
		if !slices.Equal(ordered, attributeViewRowSortIDs(collection.GetItems())) {
			return errors.New("attribute view sort values changed; retry the drag")
		}
	}
	setAttributeViewRowOrder(view, change.RowOrder)
	return nil
}

func isAttributeViewRowOrderOperation(data any) bool {
	switch value := data.(type) {
	case *attributeViewRowOrderChange:
		return nil != value
	case map[string]any:
		_, ok := value["rowOrder"]
		return ok
	}
	return false
}

func setAttributeViewRowOrder(view *av.View, order *attributeViewRowOrder) {
	view.ItemIDs = order.ItemIDs
	view.Sorts = order.Sorts
	for _, group := range view.Groups {
		group.GroupItemIDs = order.Groups[group.ID]
		group.Sorts = view.Sorts
	}
}

// cloneAttributeViewRowSort 保留所有 ID，隔离渲染时的临时字段回填和分组元数据。
func cloneAttributeViewRowSort(attrView *av.AttributeView) (*av.AttributeView, error) {
	data, err := gulu.JSON.MarshalJSON(attrView)
	if nil != err {
		return nil, err
	}
	ret := &av.AttributeView{}
	if err = gulu.JSON.UnmarshalJSON(data, ret); nil != err {
		return nil, err
	}
	ret.RenderedViewables = map[string]av.Viewable{}
	return ret, nil
}
