package configcompat

import (
	"encoding/json"
	"testing"
)

func TestBlockGutterModeJSON(t *testing.T) {
	for _, entry := range []struct {
		raw  string
		want bool
	}{
		{`true`, true}, {`false`, false}, {`null`, false},
		{`1`, true}, {`0`, false}, {`-1`, false}, {`2`, false}, {`99`, false},
	} {
		t.Run(entry.raw, func(t *testing.T) {
			mode := BlockGutterMode(true)
			if err := json.Unmarshal([]byte(entry.raw), &mode); err != nil || bool(mode) != entry.want {
				t.Fatalf("input %s: %v, %v", entry.raw, mode, err)
			}
			encoded, err := json.Marshal(mode)
			var enabled bool
			if err != nil || json.Unmarshal(encoded, &enabled) != nil || enabled != entry.want {
				t.Fatalf("non-boolean output %s: %v", encoded, err)
			}
		})
	}
	for _, raw := range []string{`1.5`, `1.0`, `1e0`, `"true"`, `"1"`, `[]`, `{}`, `9223372036854775808`} {
		t.Run(raw, func(t *testing.T) {
			mode := BlockGutterMode(true)
			if err := json.Unmarshal([]byte(raw), &mode); err == nil || !mode {
				t.Fatalf("invalid input changed the existing value: %s, %v", raw, err)
			}
		})
	}
}
