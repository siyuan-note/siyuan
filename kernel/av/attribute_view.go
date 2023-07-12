// SiYuan - Refactor your thinking
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

// Package av 包含了属性视图（Attribute View）相关的实现。
package av

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// AttributeView 描述了属性视图的结构。
type AttributeView struct {
	Spec    int       `json:"spec"`    // 格式版本
	ID      string    `json:"id"`      // 属性视图 ID
	Name    string    `json:"name"`    // 属性视图名称
	Columns []*Column `json:"columns"` // 列
	Rows    []*Row    `json:"rows"`    // 行

	CurrentViewID string  `json:"currentViewID"` // 当前视图 ID
	Views         []*View `json:"views"`         // 视图
}

// View 描述了视图的结构。
type View struct {
	ID   string `json:"id"`   // 视图 ID
	Name string `json:"name"` // 视图名称

	CurrentLayoutID   string       `json:"CurrentLayoutID"` // 当前布局 ID
	CurrentLayoutType LayoutType   `json:"type"`            // 当前布局类型
	Table             *LayoutTable `json:"table,omitempty"` // 表格布局
}

// LayoutType 描述了视图布局的类型。
type LayoutType string

const (
	LayoutTypeTable LayoutType = "table" // 属性视图类型 - 表格
)

func NewView() *View {
	name := "Table"
	layoutID := ast.NewNodeID()
	return &View{
		ID:                ast.NewNodeID(),
		Name:              name,
		CurrentLayoutID:   layoutID,
		CurrentLayoutType: LayoutTypeTable,
		Table: &LayoutTable{
			Spec:    0,
			ID:      layoutID,
			Filters: []*ViewFilter{},
			Sorts:   []*ViewSort{},
		},
	}
}

// Viewable 描述了视图的接口。
type Viewable interface {
	Filterable
	Sortable
	Calculable

	GetType() LayoutType
	GetID() string
}

func NewAttributeView(id string) *AttributeView {
	view := NewView()

	return &AttributeView{
		Spec:          0,
		ID:            id,
		Columns:       []*Column{{ID: ast.NewNodeID(), Name: "Block", Type: ColumnTypeBlock}},
		Rows:          []*Row{},
		CurrentViewID: view.ID,
		Views:         []*View{view},
	}
}

func ParseAttributeView(avID string) (ret *AttributeView, err error) {
	avJSONPath := getAttributeViewDataPath(avID)
	if !gulu.File.IsExist(avJSONPath) {
		ret = NewAttributeView(avID)
		return
	}

	data, err := filelock.ReadFile(avJSONPath)
	if nil != err {
		logging.LogErrorf("read attribute view [%s] failed: %s", avID, err)
		return
	}

	ret = &AttributeView{}
	if err = gulu.JSON.UnmarshalJSON(data, ret); nil != err {
		logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
		return
	}

	if 1 > len(ret.Views) {
		view := NewView()
		ret.CurrentViewID = view.ID
		ret.Views = []*View{view}
	}
	return
}

func ParseAttributeViewMap(avID string) (ret map[string]interface{}, err error) {
	ret = map[string]interface{}{}
	avJSONPath := getAttributeViewDataPath(avID)
	if !gulu.File.IsExist(avJSONPath) {
		av := NewAttributeView(avID)
		var data []byte
		data, err = gulu.JSON.MarshalJSON(av)
		if nil == err {
			return
		}

		err = gulu.JSON.UnmarshalJSON(data, &ret)
		return
	}

	data, err := filelock.ReadFile(avJSONPath)
	if nil != err {
		logging.LogErrorf("read attribute view [%s] failed: %s", avID, err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
		return
	}
	return
}

func SaveAttributeView(av *AttributeView) (err error) {
	data, err := gulu.JSON.MarshalIndentJSON(av, "", "\t")
	if nil != err {
		logging.LogErrorf("marshal attribute view [%s] failed: %s", av.ID, err)
		return
	}

	avJSONPath := getAttributeViewDataPath(av.ID)
	if err = filelock.WriteFile(avJSONPath, data); nil != err {
		logging.LogErrorf("save attribute view [%s] failed: %s", av.ID, err)
		return
	}
	return
}

func (av *AttributeView) GetView(viewID string) (ret *View, err error) {
	for _, v := range av.Views {
		if v.ID == viewID {
			ret = v
			return
		}
	}
	err = ErrViewNotFound
	return
}

func getAttributeViewDataPath(avID string) (ret string) {
	av := filepath.Join(util.DataDir, "storage", "av")
	ret = filepath.Join(av, avID+".json")
	if !gulu.File.IsDir(av) {
		if err := os.MkdirAll(av, 0755); nil != err {
			logging.LogErrorf("create attribute view dir failed: %s", err)
			return
		}
	}
	return
}

var (
	ErrViewNotFound = errors.New("view not found")
)
