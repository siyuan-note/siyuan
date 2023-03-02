// SiYuan - Build Your Eternal Digital Garden
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
	"database/sql"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// AttributeView 描述了属性视图的结构。
type AttributeView struct {
	ID      string     `json:"id"`      // 属性视图 ID
	Columns []Column   `json:"columns"` // 表格列名
	Rows    [][]string `json:"rows"`    // 表格行记录

	Type        AttributeViewType      `json:"type"`        // 属性视图类型
	Projections []string               `json:"projections"` // 显示的列名，SELECT *
	Filters     []*AttributeViewFilter `json:"filters"`     // 过滤规则，WHERE ...
	Sorts       []*AttributeViewSort   `json:"sorts"`       // 排序规则，ORDER BY ...
}

// AttributeViewType 描述了属性视图的类型。
type AttributeViewType string

const (
	AttributeViewTypeTable AttributeViewType = "table" // 属性视图类型 - 表格
)

func (av *AttributeView) GetColumnNames() (ret []string) {
	ret = []string{}
	for _, column := range av.Columns {
		ret = append(ret, column.Name())
	}
	return
}

type AttributeViewFilter struct {
	Column   string `json:"column"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

type AttributeViewSort struct {
	Column string `json:"column"`
	Order  string `json:"order"`
}

// SyncAttributeViewTableFromJSON 从 JSON 文件同步属性视图表，用于数据同步后将属性视图 JSON 文件同步到数据库。
func SyncAttributeViewTableFromJSON(tableID string) (err error) {
	avJSONPath := getAttributeViewJSONPath(tableID)
	data, err := filelock.ReadFile(avJSONPath)
	if nil != err {
		logging.LogErrorf("read attribute view table failed: %s", err)
		return
	}

	var attributeView AttributeView
	if err = gulu.JSON.UnmarshalJSON(data, &attributeView); nil != err {
		logging.LogErrorf("unmarshal attribute view table failed: %s", err)
		return
	}

	return
}

// SyncAttributeViewTableToJSON 同步属性视图表到 JSON 文件，用于将数据库中的属性视图持久化到 JSON 文件中。
func SyncAttributeViewTableToJSON(av *AttributeView) (err error) {
	data, err := gulu.JSON.MarshalJSON(av)
	if nil != err {
		logging.LogErrorf("marshal attribute view table [%s] failed: %s", av.ID, err)
		return
	}

	avJSONPath := getAttributeViewJSONPath(av.ID)
	if err = filelock.WriteFile(avJSONPath, data); nil != err {
		logging.LogErrorf("save attribute view table [%s] failed: %s", av.ID, err)
		return
	}
	return
}

func getAttributeViewJSONPath(tableID string) string {
	return filepath.Join(util.DataDir, "storage", "av", tableID+".json")
}

func dropAttributeViewTableColumn(db *sql.DB, tableID string, column string) (err error) {
	_, err = db.Exec("ALTER TABLE `av_" + tableID + "` DROP COLUMN `" + column + "`")
	if nil != err {
		logging.LogErrorf("drop column [%s] failed: %s", column, err)
		return
	}
	return
}

func addAttributeViewTableColumn(db *sql.DB, tableID string, column string) (err error) {
	_, err = db.Exec("ALTER TABLE `av_" + tableID + "` ADD COLUMN `" + column + "`")
	if nil != err {
		logging.LogErrorf("add column [%s] failed: %s", column, err)
		return
	}
	return
}

func dropAttributeViewTable(db *sql.DB, tableID string) (err error) {
	_, err = db.Exec("DROP TABLE IF EXISTS `av_" + tableID + "`")
	if nil != err {
		logging.LogErrorf("drop table [%s] failed: %s", tableID, err)
		return
	}
	return
}

func createAttributeViewTable(db *sql.DB, tableID string, column []string) (err error) {
	_, err = db.Exec("CREATE TABLE IF NOT EXISTS `av_" + tableID + "` (id, " + strings.Join(column, ", ") + ")")
	if nil != err {
		logging.LogErrorf("create table [%s] failed: %s", tableID, err)
		return
	}
	return
}
