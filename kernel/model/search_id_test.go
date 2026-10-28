// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "testing"

func TestSearchByIDFilters(t *testing.T) {
	setSearchCaseSensitive(t, true)
	database := newSearchHPathTestDB(t)
	const id = "20261026000000-para001"
	insertSearchHPathTestBlock(t, database, id, "20261026000000-root001", "/Document", "text", "p")
	for _, tc := range []struct {
		name                                                  string
		boxes, paths, excludedBoxes, excludedDocs, hiddenDocs []string
		types, subTypes                                       map[string]bool
		ignore                                                string
		want                                                  int
	}{
		{name: "unrestricted", types: map[string]bool{"paragraph": true}, want: 1},
		{name: "matching notebook", boxes: []string{"20260729120000-box000"}, types: map[string]bool{"paragraph": true}, want: 1},
		{name: "other notebook", boxes: []string{"20260729120000-other00"}, types: map[string]bool{"paragraph": true}},
		{name: "matching path", paths: []string{"/20261026000000-root001.sy"}, types: map[string]bool{"paragraph": true}, want: 1},
		{name: "other path", paths: []string{"/20261026000000-other00.sy"}, types: map[string]bool{"paragraph": true}},
		{name: "wrong type", types: map[string]bool{"heading": true}},
		{name: "no selected type", types: map[string]bool{}},
		{name: "ignore expression", types: map[string]bool{"paragraph": true}, ignore: " AND content != 'text'"},
		{name: "excluded notebook", types: map[string]bool{"paragraph": true}, excludedBoxes: []string{"20260729120000-box000"}},
		{name: "excluded ancestor", types: map[string]bool{"paragraph": true}, excludedDocs: []string{"20261026000000-root001"}},
		{name: "hidden notebook document", types: map[string]bool{"paragraph": true}, hiddenDocs: []string{"20261026000000-root001"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			boxFilter, boxArgs := buildBoxesFilter(tc.boxes)
			hiddenFilter, hiddenArgs := buildRootIDExclusionFilter(tc.hiddenDocs)
			excludedFilter, excludedArgs := buildPublishAccessExclusionFilter(tc.excludedBoxes, tc.excludedDocs)
			boxFilter += hiddenFilter + excludedFilter
			boxArgs = append(boxArgs, hiddenArgs...)
			boxArgs = append(boxArgs, excludedArgs...)
			pathFilter, pathArgs := buildPathsFilter(tc.paths)
			statement, args := buildSearchByIDStatement(id, boxFilter, pathFilter, buildTypeFilter(tc.types, tc.subTypes), tc.ignore, boxArgs, pathArgs)
			if rows := documentSearchRows(t, database, statement, args); len(rows) != tc.want {
				t.Fatalf("got %d results, want %d", len(rows), tc.want)
			}
		})
	}
	if _, err := database.Exec("UPDATE blocks SET type = 'h', subtype = 'h2'"); err != nil {
		t.Fatal(err)
	}
	for _, subtype := range []string{"h1", "h2"} {
		statement, args := buildSearchByIDStatement(id, "", "", buildTypeFilter(map[string]bool{"heading": true}, map[string]bool{subtype: true}), "", nil, nil)
		want := 0
		if subtype == "h2" {
			want = 1
		}
		if rows := documentSearchRows(t, database, statement, args); len(rows) != want {
			t.Fatalf("subtype %s: got %d, want %d", subtype, len(rows), want)
		}
	}
}
