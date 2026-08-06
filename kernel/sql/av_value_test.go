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

package sql

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestFillAttributeViewKeyValuesSkipsMissingKey(t *testing.T) {
	const existingKeyID = "20260806000000-existing"
	attrView := &av.AttributeView{
		ID: "20260806000001-avtest1",
		KeyValues: []*av.KeyValues{{
			Key: &av.Key{ID: existingKeyID, Type: av.KeyTypeText},
		}},
	}
	table := &av.Table{Rows: []*av.TableRow{{
		ID: "20260806000002-item001",
		Cells: []*av.TableCell{{BaseValue: &av.BaseValue{Value: &av.Value{
			ID:      "20260806000003-value01",
			KeyID:   "20260806000004-missing",
			BlockID: "20260806000002-item001",
			Type:    av.KeyTypeText,
			Text:    &av.ValueText{Content: "source"},
		}}}},
	}}}

	fillAttributeViewKeyValues(attrView, table)
	if 0 != len(attrView.KeyValues[0].Values) {
		t.Fatalf("value for a missing key was added to the existing key: %+v", attrView.KeyValues[0].Values)
	}
}
