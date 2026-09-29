package conf

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMindmapSearchCompatibility(t *testing.T) {
	for _, tc := range []struct {
		body          string
		mindmap, item bool
	}{
		{`{}`, true, false},
		{`{"mindmap":null,"mindmapItem":null}`, true, false},
		{`{"mindmap":false,"mindmapItem":true}`, false, true},
		{`{"mindmap":true,"mindmapItem":false}`, true, false},
	} {
		var s Search
		if err := json.Unmarshal([]byte(tc.body), &s); err != nil {
			t.Fatal(err)
		}
		if s.MindmapEnabled() != tc.mindmap || s.MindmapItemEnabled() != tc.item ||
			strings.Contains(s.TypeFilter(), "'mindmap'") != tc.mindmap ||
			strings.Contains(s.TypeFilter(), "'mindmap_item'") != tc.item {
			t.Fatalf("unexpected filter for %s: %s", tc.body, s.TypeFilter())
		}
	}
	if !NewSearch().MindmapEnabled() || NewSearch().MindmapItemEnabled() {
		t.Fatal("unexpected mind map defaults")
	}
}
