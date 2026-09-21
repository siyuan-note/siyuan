package api

import (
	"errors"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func avGroupPaging(values map[string]*apicontract.AVGroupPaging) map[string]any {
	ret := map[string]any{}
	for id, value := range values {
		if value == nil {
			ret[id] = nil
			continue
		}
		paging := map[string]any{}
		if value.Page != nil {
			paging["page"] = *value.Page
		}
		if value.PageSize != nil {
			paging["pageSize"] = *value.PageSize
		}
		ret[id] = paging
	}
	return ret
}

func avArchiveRenderData(attrView *av.AttributeView, view av.Viewable) apicontract.AVArchiveRenderData {
	var views []*apicontract.AVViewData
	for _, v := range attrView.Views {
		views = append(views, &apicontract.AVViewData{ID: v.ID, Icon: v.Icon, Name: v.Name, Desc: v.Desc, HideAttrViewName: v.HideAttrViewName, Type: string(v.LayoutType), PageSize: v.PageSize})
	}
	return apicontract.AVArchiveRenderData{Name: attrView.Name, ID: attrView.ID, CustomColors: avContractSlice(attrView.Palette(), toContractAVAttributeViewCustomColor), ColorOrder: attrView.PaletteOrder(), UsedCustomColorIndexes: attrView.UsedCustomColorIndexes(), ViewType: string(view.GetType()), ViewID: view.GetID(), Views: views, View: avContractView(view), IsMirror: av.IsMirror(attrView.ID), NewItemTemplates: avContractSlice(attrView.NewItemTemplates, toContractAVNewItemTemplate), DefaultTemplateID: attrView.DefaultTemplateID}
}

func renderAttrView(blockID, avID, viewID, query string, page, pageSize int, groupPaging map[string]any, initialLayout av.LayoutType, createIfNotExist, ignoreRows bool, targetItemID, targetGroupID string, filter func(av.Viewable) av.Viewable, hideContext bool, calendarRanges ...*av.CalendarRange) apicontract.Response[apicontract.AVRenderResult] {
	render := model.RenderAttributeViewWithTarget
	if filter != nil {
		render = model.RenderAttributeViewWithTargetReadOnly
	}
	view, attrView, target, err := render(blockID, avID, viewID, query, page, pageSize, groupPaging, initialLayout, createIfNotExist, ignoreRows, targetItemID, targetGroupID, calendarRanges...)
	if err != nil {
		message := err.Error()
		if errors.Is(err, av.ErrSpecTooNew) {
			message = model.Conf.Language(215)
		}
		if errors.Is(err, av.ErrViewNotFound) {
			return apicontract.RenderAttributeView.FailureWithData(-1, message, apicontract.NewAVRenderResultError(apicontract.AVViewNotFound{Error: "viewNotFound"}))
		}
		return apicontract.Failure[apicontract.AVRenderResult](-1, message)
	}
	contextFilter, err := model.GetAttributeViewContextFilter(attrView, blockID)
	if err != nil {
		return apicontract.Failure[apicontract.AVRenderResult](-1, err.Error())
	}
	data := apicontract.AVRenderData{AVArchiveRenderData: avArchiveRenderData(attrView, view), ContextFilter: toContractAVAttributeViewContextFilter(contextFilter), ContextFilterFields: avContractSlice(attrView.ContextFilterFields(), toContractAVAttributeViewContextFilterField), Target: toContractAVAttributeViewRenderTarget(target)}
	if filter != nil {
		view = filter(view)
		if calendar, ok := view.(*av.Calendar); ok {
			// 发布过滤后重新计算定位，避免返回不可访问条目的日期和行位置。
			visibleTargetID := ""
			if target != nil {
				for index, row := range calendar.Rows {
					if row.ID == target.ItemID {
						visibleTargetID = row.ID
						target.Index = index
						target.Offset = 0
						break
					}
				}
				if visibleTargetID == "" {
					target = &model.AttributeViewRenderTarget{Status: "itemNotFound", ItemID: target.ItemID}
				}
			}
			av.FilterCalendarRows(calendar, calendar.CalendarRange, visibleTargetID)
			data.Target = toContractAVAttributeViewRenderTarget(target)
		}
		data.View = avContractView(view)
	}
	if hideContext {
		data.ContextFilter = nil
		data.ContextFilterFields = []*apicontract.AVAttributeViewContextFilterField{}
	}
	return apicontract.Success(apicontract.NewAVRenderResult(data))
}

func createAVItemResponse(result *model.CreateAttributeViewItemResult, err error, app, session string) apicontract.Response[apicontract.AVCreateItemResult] {
	if err != nil {
		if errors.Is(err, model.ErrBoxNotFound) {
			return apicontract.CreateAttributeViewItem.FailureWithData(1, "", apicontract.NewAVCreateItemResultError(apicontract.AVUnavailableNotebook{UnavailableNotebook: true}))
		}
		return apicontract.Failure[apicontract.AVCreateItemResult](-1, err.Error())
	}
	if result.Transaction != nil {
		for _, operation := range result.Transaction.DoOperations {
			if operation.Action == "insertAttrViewBlock" {
				operation.Context = map[string]any{"filteredTipScope": "target", "filteredTipToken": result.ItemID, "filteredTipAppID": app, "protyleID": session, "openFilteredItem": "true"}
				break
			}
		}
		pushTransactions(app, session, []*model.Transaction{result.Transaction})
	}
	return apicontract.Success(apicontract.NewAVCreateItemResult(*toContractAVCreateAttributeViewItemResult(result)))
}
