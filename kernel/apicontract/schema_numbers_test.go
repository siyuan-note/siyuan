package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSchemaNumberPrecision(t *testing.T) {
	bundle := &Bundle{}
	for _, text := range []string{"1", "1.0", "1e3", "-0.0", strings.Repeat("9", 620)} {
		var value any
		if err := decodeSchemaJSON([]byte(text), &value); err != nil {
			t.Fatal(err)
		}
		if err := bundle.validate(&Schema{Type: "integer"}, value, "$"); err != nil {
			t.Fatalf("integer %s: %v", text, err)
		}
	}
	for _, text := range []string{"1.1", "1e-3"} {
		if err := bundle.validate(&Schema{Type: "integer"}, json.Number(text), "$"); err == nil {
			t.Fatalf("fraction accepted as integer: %s", text)
		}
	}
	for _, text := range []string{"1", "1.0", "1e0"} {
		if err := bundle.validate(&Schema{Type: "integer", Enum: []any{1}}, json.Number(text), "$"); err != nil {
			t.Fatalf("equivalent enum number rejected: %s: %v", text, err)
		}
	}
	for _, text := range []string{"1 2", "1 trailing", ""} {
		var value any
		if err := decodeSchemaJSON([]byte(text), &value); err == nil {
			t.Fatalf("invalid JSON accepted: %s", text)
		}
	}
}
