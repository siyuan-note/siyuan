package conf

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCustomBlockSearchCompatibility(t *testing.T) {
	for _, tc := range []struct {
		body string
		want bool
	}{{`{}`, true}, {`{"customBlock":null}`, true}, {`{"customBlock":true}`, true}, {`{"customBlock":false}`, false}} {
		var search Search
		if err := json.Unmarshal([]byte(tc.body), &search); err != nil {
			t.Fatal(err)
		}
		if search.CustomBlockEnabled() != tc.want || strings.Contains(search.TypeFilter(), "'custom'") != tc.want {
			t.Fatalf("unexpected filter for %s: %s", tc.body, search.TypeFilter())
		}
	}
	if !NewSearch().CustomBlockEnabled() {
		t.Fatal("custom blocks must be enabled by default")
	}
}
