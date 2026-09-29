package model

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestMindmapSearchTypeFilter(t *testing.T) {
	previous := Conf
	Conf = NewAppConf()
	Conf.Search = conf.NewSearch()
	t.Cleanup(func() { Conf = previous })
	for _, tc := range []struct {
		types         map[string]bool
		mindmap, item bool
	}{
		{nil, true, false},
		{map[string]bool{}, false, false},
		{map[string]bool{"paragraph": true, "list": true, "listItem": true}, false, false},
		{map[string]bool{"mindmap": true}, true, false},
		{map[string]bool{"mindmapItem": true}, false, true},
		{map[string]bool{"mindmap": true, "mindmapItem": true}, true, true},
	} {
		filter := buildTypeFilter(tc.types, map[string]bool{"list:t": true, "listItem:o": true}, "b.")
		if strings.Contains(filter, "'mindmap'") != tc.mindmap || strings.Contains(filter, "'mindmap_item'") != tc.item {
			t.Fatalf("unexpected filter for %v: %s", tc.types, filter)
		}
	}
	Conf.Search.Mindmap = new(false)
	Conf.Search.MindmapItem = new(true)
	if filter := buildTypeFilter(nil, nil); strings.Contains(filter, "'mindmap'") || !strings.Contains(filter, "'mindmap_item'") {
		t.Fatalf("global choices ignored: %s", filter)
	}
}

func TestMindmapSearchCriterionCompatibility(t *testing.T) {
	for _, body := range []string{`{}`, `{"mindmap":false,"mindmapItem":true}`, `{"mindmap":true,"mindmapItem":false}`} {
		var types CriterionTypes
		if err := json.Unmarshal([]byte(body), &types); err != nil {
			t.Fatal(err)
		}
		data, err := json.Marshal(types)
		if err != nil {
			t.Fatal(err)
		}
		var before, after map[string]json.RawMessage
		json.Unmarshal([]byte(body), &before)
		json.Unmarshal(data, &after)
		for _, key := range []string{"mindmap", "mindmapItem"} {
			if string(before[key]) != string(after[key]) {
				t.Fatalf("criterion changed: %s", data)
			}
		}
	}
}
