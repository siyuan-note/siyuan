// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
