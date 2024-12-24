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

package av

import (
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"time"
)

func UpgradeSpec(av *AttributeView) {
	upgradeSpec1(av)
}

func upgradeSpec1(av *AttributeView) {
	if 1 <= av.Spec {
		return
	}

	now := util.CurrentTimeMillis()
	for _, kv := range av.KeyValues {
		switch kv.Key.Type {
		case KeyTypeBlock:
			// 补全 block 的创建时间和更新时间
			for _, v := range kv.Values {
				if 0 == v.Block.Created {
					logging.LogWarnf("block [%s] created time is empty", v.BlockID)
					if "" == v.Block.ID {
						v.Block.ID = v.BlockID
						if "" == v.Block.ID {
							v.Block.ID = ast.NewNodeID()
							v.BlockID = v.Block.ID
						}
					}

					createdStr := v.Block.ID[:len("20060102150405")]
					created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
					if nil == parseErr {
						v.Block.Created = created.UnixMilli()
					} else {
						v.Block.Created = now
					}
				}
				if 0 == v.Block.Updated {
					logging.LogWarnf("block [%s] updated time is empty", v.BlockID)
					v.Block.Updated = v.Block.Created
				}
			}
		case KeyTypeNumber:
			for _, v := range kv.Values {
				if nil != v.Number && 0 != v.Number.Content && !v.Number.IsNotEmpty {
					v.Number.IsNotEmpty = true
				}
			}
		}

		for _, v := range kv.Values {
			if "" == kv.Key.ID {
				kv.Key.ID = ast.NewNodeID()
				for _, val := range kv.Values {
					val.KeyID = kv.Key.ID
				}
				if "" == v.KeyID {
					logging.LogWarnf("value [%s] key id is empty", v.ID)
					v.KeyID = kv.Key.ID
				}

				// 校验日期 IsNotEmpty
				if KeyTypeDate == kv.Key.Type {
					if nil != v.Date && 0 != v.Date.Content && !v.Date.IsNotEmpty {
						v.Date.IsNotEmpty = true
					}
				}

				// 校验数字 IsNotEmpty
				if KeyTypeNumber == kv.Key.Type {
					if nil != v.Number && 0 != v.Number.Content && !v.Number.IsNotEmpty {
						v.Number.IsNotEmpty = true
					}
				}

				// 清空关联实际值
				if KeyTypeRelation == kv.Key.Type {
					v.Relation.Contents = nil
				}

				// 清空汇总实际值
				if KeyTypeRollup == kv.Key.Type {
					v.Rollup.Contents = nil
				}

				for _, view := range av.Views {
					switch view.LayoutType {
					case LayoutTypeTable:
						for _, column := range view.Table.Columns {
							if "" == column.ID {
								column.ID = kv.Key.ID
								break
							}
						}
					}
				}
			}

			// 补全值的创建时间和更新时间
			if "" == v.ID {
				logging.LogWarnf("value id is empty")
				v.ID = ast.NewNodeID()
			}

			if 0 == v.CreatedAt {
				logging.LogWarnf("value [%s] created time is empty", v.ID)
				createdStr := v.ID[:len("20060102150405")]
				created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
				if nil == parseErr {
					v.CreatedAt = created.UnixMilli()
				} else {
					v.CreatedAt = now
				}
			}

			if 0 == v.UpdatedAt {
				logging.LogWarnf("value [%s] updated time is empty", v.ID)
				v.UpdatedAt = v.CreatedAt
			}
		}
	}

	// 补全过滤器 Value
	for _, view := range av.Views {
		if nil != view.Table {
			for _, f := range view.Table.Filters {
				if nil != f.Value {
					continue
				}

				if k, _ := av.GetKey(f.Column); nil != k {
					f.Value = &Value{Type: k.Type}
				}
			}
		}
	}

	av.Spec = 1
}
