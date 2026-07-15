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

import "testing"

func TestValueRollupCalcUniqueValues(t *testing.T) {
	t.Run("Text", func(t *testing.T) {
		rollup := &ValueRollup{Contents: []*Value{
			{Type: KeyTypeText, Text: &ValueText{Content: "11"}},
			{Type: KeyTypeText, Text: &ValueText{Content: "Carry Bag"}},
			{Type: KeyTypeText, Text: &ValueText{Content: "Carry Bag"}},
		}}

		rollup.calcContents(&RollupCalc{Operator: CalcOperatorUniqueValues}, &Key{Type: KeyTypeText})

		if 2 != len(rollup.Contents) {
			t.Fatalf("expected 2 unique values, got %d", len(rollup.Contents))
		}
		if "11" != rollup.Contents[0].String(true) || "Carry Bag" != rollup.Contents[1].String(true) {
			t.Fatalf("unexpected unique values: %q, %q", rollup.Contents[0].String(true), rollup.Contents[1].String(true))
		}
	})

	t.Run("Multiple Select", func(t *testing.T) {
		rollup := &ValueRollup{Contents: []*Value{
			{Type: KeyTypeMSelect, MSelect: []*ValueSelect{{Content: "A"}, {Content: "B"}}},
			{Type: KeyTypeMSelect, MSelect: []*ValueSelect{{Content: "B"}, {Content: "C"}}},
			{Type: KeyTypeMSelect, MSelect: []*ValueSelect{{Content: "A"}}},
		}}

		rollup.calcContents(&RollupCalc{Operator: CalcOperatorUniqueValues}, &Key{Type: KeyTypeMSelect})

		if 2 != len(rollup.Contents) {
			t.Fatalf("expected 2 non-empty values, got %d", len(rollup.Contents))
		}
		if "A B" != rollup.Contents[0].String(true) || "C" != rollup.Contents[1].String(true) {
			t.Fatalf("unexpected unique values: %q, %q", rollup.Contents[0].String(true), rollup.Contents[1].String(true))
		}
	})
}
