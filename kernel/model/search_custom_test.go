package model

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestCustomBlockSearchTypeFilter(t *testing.T) {
	previous := Conf
	Conf = NewAppConf()
	Conf.Search = conf.NewSearch()
	t.Cleanup(func() { Conf = previous })
	for _, tc := range []struct {
		types map[string]bool
		want  bool
	}{{nil, true}, {map[string]bool{"customBlock": true}, true}, {map[string]bool{"customBlock": false}, false}, {map[string]bool{"paragraph": true}, false}, {map[string]bool{}, false}} {
		if got := buildTypeFilter(tc.types, nil, "b."); strings.Contains(got, "'custom'") != tc.want {
			t.Fatalf("unexpected filter for %v: %s", tc.types, got)
		}
	}
	Conf.Search.CustomBlock = new(false)
	if strings.Contains(buildTypeFilter(nil, nil), "'custom'") {
		t.Fatal("disabled custom blocks included")
	}
}

func TestCustomBlockSearchCriterionCompatibility(t *testing.T) {
	for _, body := range []string{`{"paragraph":true}`, `{"customBlock":false}`, `{"customBlock":true}`} {
		var types CriterionTypes
		if err := json.Unmarshal([]byte(body), &types); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(types)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(body, "customBlock") != strings.Contains(string(encoded), "customBlock") {
			t.Fatalf("field presence changed: %s", encoded)
		}
		if types.CustomBlock != nil && *types.CustomBlock != strings.Contains(body, "true") {
			t.Fatalf("option changed: %s", encoded)
		}
	}
}
