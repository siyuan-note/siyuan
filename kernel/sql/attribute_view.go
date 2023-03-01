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

package sql

import (
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type AttributeView struct {
	Attributes []string // 属性列表，即表格的列名
	Blocks     []string // 存储的块 ID 列表，即表格的行记录
}

// syncAttributeViewTableFromJSON 从 JSON 文件同步属性视图表，用于数据同步后将属性视图 JSON 文件同步到数据库。
func syncAttributeViewTableFromJSON(tableID string) (err error) {
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

	oldColumns, err := getAttributeViewTableColumns(tableID)
	if nil != err {
		return
	}

	// 删除多余的列
	for _, column := range oldColumns {
		if !gulu.Str.Contains(column, attributeView.Attributes) {
			if err = dropAttributeViewTableColumn(tableID, column); nil != err {
				return
			}
		}
	}

	// 添加缺失的列
	for _, column := range attributeView.Attributes {
		if !gulu.Str.Contains(column, oldColumns) {
			if err = addAttributeViewTableColumn(tableID, column); nil != err {
				return
			}
		}
	}

	// 删除多余的记录
	oldIDs, err := getAttributeViewRecordIDs(tableID)
	if nil != err {
		return
	}
	for _, id := range oldIDs {
		if !gulu.Str.Contains(id, attributeView.Blocks) {
			if err = deleteAttributeViewTableBlock(tableID, id); nil != err {
				return
			}
		}
	}

	// 添加缺失的记录
	for _, id := range attributeView.Blocks {
		if !gulu.Str.Contains(id, oldIDs) {
			if err = addAttributeViewTableBlock(tableID, id); nil != err {
				return
			}
		}
	}

	return
}

// syncAttributeViewTableToJSON 同步属性视图表到 JSON 文件，用于将数据库中的属性视图持久化到 JSON 文件中。
func syncAttributeViewTableToJSON(tableID string) (err error) {
	columns, err := getAttributeViewTableColumns(tableID)
	if nil != err {
		return
	}

	ids, err := getAttributeViewRecordIDs(tableID)
	if nil != err {
		return
	}

	attributeView := &AttributeView{Attributes: columns, Blocks: ids}
	data, err := gulu.JSON.MarshalJSON(attributeView)
	if nil != err {
		logging.LogErrorf("marshal attribute view table failed: %s", err)
		return
	}

	avJSONPath := getAttributeViewJSONPath(tableID)
	if err = filelock.WriteFile(avJSONPath, data); nil != err {
		logging.LogErrorf("save attribute view table failed: %s", err)
		return
	}
	return
}

func getAttributeViewJSONPath(tableID string) string {
	return filepath.Join(util.DataDir, "storage", "av", tableID+".json")
}

func addAttributeViewTableBlock(tableID string, id string) (err error) {
	_, err = db.Exec("INSERT INTO `av_"+tableID+"` (id) VALUES (?)", id)
	if nil != err {
		logging.LogErrorf("add av table block [%s] failed: %s", id, err)
		return
	}
	return
}

func deleteAttributeViewTableBlock(tableID string, id string) (err error) {
	_, err = db.Exec("DELETE FROM `av_"+tableID+"` WHERE id = ?", id)
	if nil != err {
		logging.LogErrorf("delete av table block [%s] failed: %s", id, err)
		return
	}
	return
}

func getAttributeViewRecordIDs(tableID string) (ret []string, err error) {
	rows, err := db.Query("SELECT id FROM `av_" + tableID + "`")
	if nil != err {
		logging.LogErrorf("get record ids failed: %s", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		err = rows.Scan(&id)
		if nil != err {
			logging.LogErrorf("get record ids failed: %s", err)
			return
		}
		ret = append(ret, id)
	}
	return
}

func getAttributeViewTableColumns(tableID string) (ret []string, err error) {
	rows, err := db.Query("SHOW COLUMNS FROM `av_" + tableID + "`")
	if nil != err {
		logging.LogErrorf("get columns failed: %s", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var column string
		err = rows.Scan(&column)
		if nil != err {
			logging.LogErrorf("get columns failed: %s", err)
			return
		}
		ret = append(ret, column)
	}
	return
}

func dropAttributeViewTableColumn(tableID string, column string) (err error) {
	_, err = db.Exec("ALTER TABLE `av_" + tableID + "` DROP COLUMN `" + column + "`")
	if nil != err {
		logging.LogErrorf("drop column [%s] failed: %s", column, err)
		return
	}
	return
}

func addAttributeViewTableColumn(tableID string, column string) (err error) {
	_, err = db.Exec("ALTER TABLE `av_" + tableID + "` ADD COLUMN `" + column + "`")
	if nil != err {
		logging.LogErrorf("add column [%s] failed: %s", column, err)
		return
	}
	return
}

func dropAttributeViewTable(tableID string) (err error) {
	_, err = db.Exec("DROP TABLE IF EXISTS `av_" + tableID + "`")
	if nil != err {
		logging.LogErrorf("drop table [%s] failed: %s", tableID, err)
		return
	}
	return
}

func createAttributeViewTable(tableID string, column []string) (err error) {
	_, err = db.Exec("CREATE TABLE IF NOT EXISTS `av_" + tableID + "` (id, " + strings.Join(column, ", ") + ")")
	if nil != err {
		logging.LogErrorf("create table [%s] failed: %s", tableID, err)
		return
	}
	return
}
