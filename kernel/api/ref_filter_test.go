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

package api

import (
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestParseBacklinkSourceFilter(t *testing.T) {
	if nil != parseBacklinkSourceFilter(map[string]any{}) {
		t.Fatal("missing filter should remain nil")
	}
	if nil != parseBacklinkSourceFilter(map[string]any{"sourceFilter": map[string]any{}}) {
		t.Fatal("default filter should normalize to nil")
	}

	filter := parseBacklinkSourceFilter(map[string]any{
		"sourceFilter": map[string]any{
			"dailyNote":           model.BacklinkDailyNoteExclude,
			"excludedNotebookIDs": []any{"box-b", "box-a", "box-b"},
			"excludeSelf":         true,
		},
	})
	if nil == filter || model.BacklinkDailyNoteExclude != filter.DailyNote || !filter.ExcludeSelf {
		t.Fatalf("unexpected parsed filter: %+v", filter)
	}
	if !reflect.DeepEqual([]string{"box-a", "box-b"}, filter.ExcludedNotebookIDs) {
		t.Fatalf("unexpected notebook IDs: %v", filter.ExcludedNotebookIDs)
	}
}
