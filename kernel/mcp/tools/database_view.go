// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package tools

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func databaseViewAction(action string, args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	blockID, _ := args["blockID"].(string)
	viewID, _ := args["viewID"].(string)
	if "" == id || "" == blockID {
		return blockToolError("id and blockID are required")
	}
	if action != "view_add" && action != "view_visibility_set" && "" == viewID {
		return blockToolError("viewID is required")
	}
	_, release, err := beginBlockToolScope(args, action != "view_get", blockID)
	if nil != err {
		return blockToolError(err.Error())
	}
	defer release()

	switch action {
	case "view_get":
		model.FlushTxQueue()
		return databaseViewResult(action, id, blockID, viewID)
	case "view_add":
		layout, _ := args["layout"].(string)
		name, _ := args["name"].(string)
		viewID, err = model.AddAttributeViewView(id, blockID, name, av.LayoutType(layout))
	case "view_duplicate":
		name, _ := args["name"].(string)
		viewID, err = model.DuplicateAttributeViewView(id, blockID, viewID, name)
	case "view_remove":
		err = model.RemoveAttributeViewView(id, blockID, viewID)
		if nil == err {
			return databaseSuccess(action, map[string]any{"id": id, "blockID": blockID, "viewID": viewID, "removed": true})
		}
	case "view_update":
		var update model.AttributeViewViewUpdate
		if update, err = databaseViewUpdateConfig(args); nil == err {
			err = model.UpdateAttributeViewView(id, blockID, viewID, update)
		}
	case "view_move":
		previousID, ok := args["previousID"].(string)
		if !ok {
			return blockToolError("previousID is required; use an empty string to move the view to the first position")
		}
		err = model.MoveAttributeViewView(id, blockID, viewID, previousID)
	case "view_visibility_set":
		return databaseViewVisibilitySet(args, id, blockID)
	case "view_filters_set", "view_sorts_set", "view_group_set", "view_layout_set":
		err = databaseViewSet(action, args, id, blockID, viewID)
	}
	if nil != err {
		return blockToolError(action + " failed: " + err.Error())
	}
	return databaseViewResult(action, id, blockID, viewID)
}

func databaseViewResult(action, id, blockID, viewID string) (CallToolResult, error) {
	attrView, view, err := model.GetAttributeViewViewTarget(id, blockID, viewID)
	if nil != err {
		return blockToolError(err.Error())
	}
	filters := view.Filters
	if nil == filters {
		filters = []*av.ViewFilter{}
	}
	sorts := view.Sorts
	if nil == sorts {
		sorts = []*av.ViewSort{}
	}
	visibleViewIDs, err := model.GetDatabaseBlockVisibleViewIDs(attrView, blockID)
	if nil != err {
		return blockToolError(err.Error())
	}
	metadata := model.NewAttributeViewMetadata(attrView)
	return databaseSuccess(action, map[string]any{
		"id":             id,
		"blockID":        blockID,
		"viewID":         view.ID,
		"name":           view.Name,
		"icon":           view.Icon,
		"desc":           view.Desc,
		"layout":         view.LayoutType,
		"filters":        filters,
		"sorts":          sorts,
		"group":          view.Group,
		"revision":       model.AttributeViewViewConfigRevision(view),
		"keys":           metadata.Keys,
		"views":          metadata.Views,
		"visibleViewIDs": visibleViewIDs,
	})
}

func databaseViewUpdateConfig(args map[string]any) (model.AttributeViewViewUpdate, error) {
	update := model.AttributeViewViewUpdate{}
	for name, target := range map[string]**string{"name": &update.Name, "icon": &update.Icon, "desc": &update.Desc} {
		if value, supplied := args[name]; supplied {
			text, ok := value.(string)
			if !ok {
				return update, fmt.Errorf("%s must be a string", name)
			}
			*target = &text
		}
	}
	if nil == update.Name && nil == update.Icon && nil == update.Desc {
		return update, errors.New("at least one of name, icon or desc is required")
	}
	return update, nil
}

func databaseViewVisibilitySet(args map[string]any, id, blockID string) (CallToolResult, error) {
	values, ok := args["viewIDs"].([]any)
	if !ok || 0 == len(values) {
		return blockToolError("viewIDs must be a non-empty array of view IDs")
	}
	viewIDs := make([]string, 0, len(values))
	for _, value := range values {
		viewID, valid := value.(string)
		if !valid || "" == viewID {
			return blockToolError("viewIDs must contain non-empty strings")
		}
		viewIDs = append(viewIDs, viewID)
	}
	if err := model.SetAttributeViewBlockVisibleViews(id, blockID, viewIDs); nil != err {
		return blockToolError("view_visibility_set failed: " + err.Error())
	}
	attrView, _, err := model.GetAttributeViewViewTarget(id, blockID, viewIDs[0])
	if nil != err {
		return blockToolError(err.Error())
	}
	visibleViewIDs, err := model.GetDatabaseBlockVisibleViewIDs(attrView, blockID)
	if nil != err {
		return blockToolError(err.Error())
	}
	return databaseSuccess("view_visibility_set", map[string]any{
		"id": id, "blockID": blockID, "views": model.NewAttributeViewMetadata(attrView).Views,
		"visibleViewIDs": visibleViewIDs,
	})
}

func databaseViewSet(action string, args map[string]any, id, blockID, viewID string) error {
	revision, _ := args["revision"].(string)
	if "" == revision {
		return errors.New("revision is required; call view_get first")
	}
	model.FlushTxQueue()
	attrView, view, err := model.GetAttributeViewViewTarget(id, blockID, viewID)
	if nil != err {
		return err
	}
	switch action {
	case "view_filters_set":
		value, ok := args["filters"].([]any)
		if !ok {
			return errors.New("filters must be an array")
		}
		var filters []*av.ViewFilter
		if err = databaseViewDecode(value, &filters); nil != err {
			return fmt.Errorf("invalid filters: %w", err)
		}
		if err = databaseValidateViewFilters(attrView, filters); nil != err {
			return err
		}
		return model.SetAttributeViewViewFilters(id, blockID, viewID, revision, filters)
	case "view_sorts_set":
		value, ok := args["sorts"].([]any)
		if !ok {
			return errors.New("sorts must be an array")
		}
		var sorts []*av.ViewSort
		if err = databaseViewDecode(value, &sorts); nil != err {
			return fmt.Errorf("invalid sorts: %w", err)
		}
		if err = databaseValidateViewSorts(attrView, sorts); nil != err {
			return err
		}
		return model.SetAttributeViewViewSorts(id, blockID, viewID, revision, sorts)
	case "view_group_set":
		value, ok := args["group"].(map[string]any)
		if !ok {
			return errors.New("group must be an object; use {} to clear grouping")
		}
		group := &av.ViewGroup{}
		if err = databaseViewDecode(value, group); nil != err {
			return fmt.Errorf("invalid group: %w", err)
		}
		if err = databaseValidateViewGroup(attrView, view, group); nil != err {
			return err
		}
		return model.SetAttributeViewViewGroup(id, blockID, viewID, revision, group)
	case "view_layout_set":
		layout, _ := args["layout"].(string)
		if "" == strings.TrimSpace(layout) {
			return errors.New("layout is required")
		}
		return model.ChangeAttrViewLayoutForView(blockID, id, viewID, revision, av.LayoutType(layout))
	}
	return errors.New("unknown view setting action")
}

func databaseViewDecode(value any, target any) error {
	data, err := json.Marshal(value)
	if nil != err {
		return err
	}
	return json.Unmarshal(data, target)
}

func databaseValidateViewFilters(attrView *av.AttributeView, filters []*av.ViewFilter) error {
	if err := av.ValidateFilterDepth(filters); nil != err {
		return err
	}
	for _, filter := range filters {
		if err := databaseValidateViewFilterNode(attrView, filter); nil != err {
			return err
		}
	}
	return nil
}

func databaseValidateViewFilterNode(attrView *av.AttributeView, filter *av.ViewFilter) error {
	if nil == filter {
		return errors.New("filter nodes cannot be null")
	}
	if filter.IsGroup() {
		if filter.Combination != av.FilterCombinationAnd && filter.Combination != av.FilterCombinationOr {
			return errors.New("filter group combination must be and or or")
		}
		if filter.Column != "" || filter.Operator != "" || nil != filter.Value || filter.ValueSource != "" ||
			filter.Qualifier != "" || nil != filter.RelativeDate || nil != filter.RelativeDate2 || filter.DateEndpoint != "" {
			return errors.New("filter groups cannot contain leaf settings")
		}
		for _, child := range filter.Filters {
			if err := databaseValidateViewFilterNode(attrView, child); nil != err {
				return err
			}
		}
		return nil
	}
	key, err := attrView.GetKey(filter.Column)
	if nil != err || nil == key || key.Type == av.KeyTypeLineNumber {
		return fmt.Errorf("filter column is not available: %s", filter.Column)
	}
	if filter.ValueSource != "" && filter.ValueSource != av.ValueSourceStored && filter.ValueSource != av.ValueSourceRendered {
		return fmt.Errorf("invalid value source for field %s", filter.Column)
	}
	if filter.Qualifier != av.FilterQuantifierUndefined && filter.Qualifier != av.FilterQuantifierAny &&
		filter.Qualifier != av.FilterQuantifierAll && filter.Qualifier != av.FilterQuantifierNone {
		return fmt.Errorf("invalid filter quantifier for field %s", filter.Column)
	}
	filterType := key.Type
	if filter.ValueSource == av.ValueSourceRendered {
		if "" == strings.TrimSpace(key.RenderTemplate) {
			return fmt.Errorf("rendered filtering requires a display template: %s", filter.Column)
		}
		filterType = av.KeyTypeTemplate
	}
	if !av.IsFilterOperatorAllowed(filterType, filter.Operator) {
		return fmt.Errorf("operator %q is not supported for field %s", filter.Operator, filter.Column)
	}
	if filter.Operator != av.FilterOperatorIsEmpty && filter.Operator != av.FilterOperatorIsNotEmpty &&
		filter.Operator != av.FilterOperatorIsTrue && filter.Operator != av.FilterOperatorIsFalse && nil == filter.Value {
		return fmt.Errorf("filter value is required for field %s", filter.Column)
	}
	if nil != filter.Value && filter.Value.Type != "" && filter.Value.Type != key.Type &&
		!(filter.ValueSource == av.ValueSourceRendered &&
			(filter.Value.Type == av.KeyTypeTemplate || filter.Value.Type == av.KeyTypeText)) {
		return fmt.Errorf("filter value type does not match field %s", filter.Column)
	}
	dateType := key.Type
	if dateType == av.KeyTypeRollup && nil != filter.Value && nil != filter.Value.Rollup &&
		0 < len(filter.Value.Rollup.Contents) && nil != filter.Value.Rollup.Contents[0] {
		dateType = filter.Value.Rollup.Contents[0].Type
	}
	if (nil != filter.RelativeDate || nil != filter.RelativeDate2 || filter.DateEndpoint != "") &&
		!av.IsDateKeyType(dateType) {
		return fmt.Errorf("date options require a date field: %s", filter.Column)
	}
	if filter.DateEndpoint != "" && filter.DateEndpoint != av.DateEndpointStart && filter.DateEndpoint != av.DateEndpointEnd {
		return fmt.Errorf("invalid date endpoint for field %s", filter.Column)
	}
	if !databaseValidRelativeDate(filter.RelativeDate) || !databaseValidRelativeDate(filter.RelativeDate2) {
		return fmt.Errorf("invalid relative date for field %s", filter.Column)
	}
	if nil != filter.RelativeDate2 && filter.Operator != av.FilterOperatorIsBetween {
		return fmt.Errorf("second relative date requires Is between for field %s", filter.Column)
	}
	return nil
}

func databaseValidRelativeDate(value *av.RelativeDate) bool {
	if nil == value {
		return true
	}
	return value.Count >= 0 && value.Unit >= av.RelativeDateUnitDay && value.Unit <= av.RelativeDateUnitYear &&
		value.Direction >= av.RelativeDateDirectionBefore && value.Direction <= av.RelativeDateDirectionAfter
}

func databaseValidateViewSorts(attrView *av.AttributeView, sorts []*av.ViewSort) error {
	for _, sort := range sorts {
		if nil == sort {
			return errors.New("sort rules cannot be null")
		}
		key, err := attrView.GetKey(sort.Column)
		if nil != err || nil == key || key.Type == av.KeyTypeLineNumber {
			return fmt.Errorf("sort column is not available: %s", sort.Column)
		}
		if sort.Order != av.SortOrderAsc && sort.Order != av.SortOrderDesc {
			return fmt.Errorf("sort order must be ASC or DESC for field %s", sort.Column)
		}
		if sort.ValueSource != "" && sort.ValueSource != av.ValueSourceStored && sort.ValueSource != av.ValueSourceRendered {
			return fmt.Errorf("invalid value source for field %s", sort.Column)
		}
		if sort.ValueSource == av.ValueSourceRendered && "" == strings.TrimSpace(key.RenderTemplate) {
			return fmt.Errorf("rendered sorting requires a display template: %s", sort.Column)
		}
		if sort.DateEndpoint != "" && !av.IsDateKeyType(key.Type) {
			return fmt.Errorf("date endpoint requires a date field: %s", sort.Column)
		}
		if sort.DateEndpoint != "" && sort.DateEndpoint != av.DateEndpointStart && sort.DateEndpoint != av.DateEndpointEnd {
			return fmt.Errorf("invalid date endpoint for field %s", sort.Column)
		}
	}
	return nil
}

func databaseValidateViewGroup(attrView *av.AttributeView, view *av.View, group *av.ViewGroup) error {
	if "" == group.Field {
		if view.LayoutType == av.LayoutTypeKanban {
			return errors.New("kanban views require a group field")
		}
		return nil
	}
	if view.LayoutType == av.LayoutTypeCalendar {
		return errors.New("calendar views do not support grouping")
	}
	key, err := attrView.GetKey(group.Field)
	if nil != err || nil == key || key.Type == av.KeyTypeLineNumber || key.Type == av.KeyTypeRollup ||
		(key.Type == av.KeyTypeMAsset && "" == strings.TrimSpace(key.RenderTemplate)) {
		return fmt.Errorf("group field is not available: %s", group.Field)
	}
	if group.Order < av.GroupOrderAsc || group.Order > av.GroupOrderSelectOption {
		return errors.New("invalid group order")
	}
	if group.Order == av.GroupOrderSelectOption && key.Type != av.KeyTypeSelect && key.Type != av.KeyTypeMSelect {
		return errors.New("select option order requires a select field")
	}
	if group.ValueSource != "" && group.ValueSource != av.ValueSourceStored && group.ValueSource != av.ValueSourceRendered {
		return errors.New("invalid group value source")
	}
	if group.ValueSource == av.ValueSourceRendered {
		if "" == strings.TrimSpace(key.RenderTemplate) || group.Method != av.GroupMethodValue {
			return errors.New("rendered grouping requires a display template and value method")
		}
		return nil
	}
	groupType := key.Type
	if av.IsDateKeyType(groupType) {
		groupType = av.KeyTypeDate
	}
	switch groupType {
	case av.KeyTypeNumber:
		if group.Method != av.GroupMethodValue && group.Method != av.GroupMethodRangeNum {
			return errors.New("number group method must be value or number range")
		}
		if group.Method == av.GroupMethodRangeNum && (nil == group.Range || group.Range.NumStep <= 0 || group.Range.NumEnd < group.Range.NumStart) {
			return errors.New("number range requires a positive step and ordered bounds")
		}
	case av.KeyTypeDate:
		if group.Method < av.GroupMethodValue || group.Method > av.GroupMethodDateYear {
			return errors.New("invalid date group method")
		}
	default:
		if group.Method != av.GroupMethodValue {
			return errors.New("this field supports value grouping only")
		}
	}
	return nil
}
