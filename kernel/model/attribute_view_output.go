// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import "github.com/siyuan-note/siyuan/kernel/av"

// AttributeViewMetadata 描述面向命令行和工具调用方的数据库元数据。
type AttributeViewMetadata struct {
	ID    string         `json:"id"`
	Name  string         `json:"name"`
	Keys  []*av.Key      `json:"keys"`
	Views []*av.ViewData `json:"views"`
}

// NewAttributeViewMetadata 构造不包含数据库条目值的元数据。
func NewAttributeViewMetadata(attrView *av.AttributeView) (ret *AttributeViewMetadata) {
	if nil == attrView {
		return
	}

	ret = &AttributeViewMetadata{
		ID:    attrView.ID,
		Name:  attrView.Name,
		Keys:  []*av.Key{},
		Views: []*av.ViewData{},
	}
	for _, keyValues := range attrView.KeyValues {
		if nil != keyValues && nil != keyValues.Key {
			ret.Keys = append(ret.Keys, keyValues.Key)
		}
	}
	for _, view := range attrView.Views {
		if nil == view {
			continue
		}
		ret.Views = append(ret.Views, &av.ViewData{
			ID:               view.ID,
			Icon:             view.Icon,
			Name:             view.Name,
			Desc:             view.Desc,
			HideAttrViewName: view.HideAttrViewName,
			Type:             view.LayoutType,
			PageSize:         view.PageSize,
		})
	}
	return
}

// AttributeViewKeys 描述数据库字段及其类型专属配置。
type AttributeViewKeys struct {
	ID   string    `json:"id"`
	Name string    `json:"name"`
	Keys []*av.Key `json:"keys"`
}

// NewAttributeViewKeys 构造数据库字段结果。
func NewAttributeViewKeys(attrView *av.AttributeView) (ret *AttributeViewKeys) {
	metadata := NewAttributeViewMetadata(attrView)
	if nil == metadata {
		return
	}
	ret = &AttributeViewKeys{ID: metadata.ID, Name: metadata.Name, Keys: metadata.Keys}
	return
}

// AttributeViewRenderData 描述经过指定视图筛选、排序、分组和分页后的数据库结果。
type AttributeViewRenderData struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	ViewID   string        `json:"viewID"`
	ViewType av.LayoutType `json:"viewType"`
	Query    string        `json:"query,omitempty"`
	Page     int           `json:"page"`
	PageSize int           `json:"pageSize"`
	View     av.Viewable   `json:"view"`
}

// NewAttributeViewRenderData 构造数据库渲染结果。
func NewAttributeViewRenderData(attrView *av.AttributeView, view av.Viewable, query string, page, pageSize int) (ret *AttributeViewRenderData) {
	if nil == attrView || nil == view {
		return
	}
	ret = &AttributeViewRenderData{
		ID:       attrView.ID,
		Name:     attrView.Name,
		ViewID:   view.GetID(),
		ViewType: view.GetType(),
		Query:    query,
		Page:     page,
		PageSize: pageSize,
		View:     view,
	}
	return
}
