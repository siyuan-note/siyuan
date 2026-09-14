package apicontract

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestFixedArrayOutput(t *testing.T) {
	builder := &schemaBuilder{definitions: map[string]*Schema{}, owners: map[string]reflect.Type{}}
	schema, err := builder.schema(reflect.TypeFor[[5]int64](), false)
	if err != nil {
		t.Fatal(err)
	}
	bundle := &Bundle{Definitions: builder.definitions}
	if actual := bundle.typeScript(schema); actual != "[number, number, number, number, number]" {
		t.Fatal(actual)
	}
	for _, entry := range []struct {
		body  string
		valid bool
	}{
		{`[0,1,2,3,4]`, true}, {`[0,1,2,3]`, false}, {`[0,1,2,3,4,5]`, false}, {`null`, false}, {`[0,1,2,3,"4"]`, false},
	} {
		var value any
		if err := json.Unmarshal([]byte(entry.body), &value); err != nil {
			t.Fatal(err)
		}
		if err := bundle.validate(schema, value, "$"); (err == nil) != entry.valid {
			t.Fatalf("fixed array mismatch: %+v, %v", entry, err)
		}
	}
}
