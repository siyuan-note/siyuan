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

import (
	"reflect"
	"testing"
)

func TestNormalizeBacklinkSourceFilter(t *testing.T) {
	if nil != NormalizeBacklinkSourceFilter(nil) {
		t.Fatal("nil filter should remain nil")
	}
	if nil != NormalizeBacklinkSourceFilter(&BacklinkSourceFilter{DailyNote: "invalid"}) {
		t.Fatal("default filter should normalize to nil")
	}

	filter := NormalizeBacklinkSourceFilter(&BacklinkSourceFilter{
		DailyNote:           BacklinkDailyNoteOnly,
		ExcludedNotebookIDs: []string{"box-b", "", "box-a", "box-b"},
		ExcludeSelf:         true,
	})
	if nil == filter {
		t.Fatal("active filter should not normalize to nil")
	}
	if BacklinkDailyNoteOnly != filter.DailyNote || !filter.ExcludeSelf {
		t.Fatalf("unexpected normalized filter: %+v", filter)
	}
	if !reflect.DeepEqual([]string{"box-a", "box-b"}, filter.ExcludedNotebookIDs) {
		t.Fatalf("unexpected notebook IDs: %v", filter.ExcludedNotebookIDs)
	}
}

func TestFilterBacklinkSources(t *testing.T) {
	linkRefs := []*Block{
		{ID: "daily", RootID: "daily-root", Box: "box-a"},
		{ID: "regular", RootID: "regular-root", Box: "box-a"},
		{ID: "excluded-box", RootID: "other-root", Box: "box-b"},
		{ID: "self", RootID: "target-root", Box: "box-a"},
	}
	dailyNoteRootIDs := map[string]bool{"daily-root": true}

	onlyDaily := filterBacklinkSources(linkRefs, "target-root", &BacklinkSourceFilter{
		DailyNote: BacklinkDailyNoteOnly,
	}, dailyNoteRootIDs)
	assertBacklinkSourceIDs(t, onlyDaily, []string{"daily"})

	excludeDaily := filterBacklinkSources(linkRefs, "target-root", &BacklinkSourceFilter{
		DailyNote: BacklinkDailyNoteExclude,
	}, dailyNoteRootIDs)
	assertBacklinkSourceIDs(t, excludeDaily, []string{"regular", "excluded-box", "self"})

	combined := filterBacklinkSources(linkRefs, "target-root", &BacklinkSourceFilter{
		DailyNote:           BacklinkDailyNoteExclude,
		ExcludedNotebookIDs: []string{"box-b"},
		ExcludeSelf:         true,
	}, dailyNoteRootIDs)
	assertBacklinkSourceIDs(t, combined, []string{"regular"})
}

func TestIsDailyNoteBlock(t *testing.T) {
	if isDailyNoteBlock(nil) || isDailyNoteBlock(&Block{IAL: map[string]string{"custom-test": "value"}}) {
		t.Fatal("regular block should not be recognized as a daily note")
	}
	if !isDailyNoteBlock(&Block{IAL: map[string]string{"custom-dailynote-20260819": "20260819"}}) {
		t.Fatal("daily note attribute should be recognized")
	}
}

func assertBacklinkSourceIDs(t *testing.T, blocks []*Block, expected []string) {
	t.Helper()
	actual := make([]string, 0, len(blocks))
	for _, block := range blocks {
		actual = append(actual, block.ID)
	}
	if !reflect.DeepEqual(expected, actual) {
		t.Fatalf("expected IDs %v, got %v", expected, actual)
	}
}
