package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSQLResponseScalarsAndMetadata(t *testing.T) {
	var rows SQLRows
	if err := json.Unmarshal([]byte(`[{"integer":9223372036854775807,"binary":"AP8=","null":null,"boolean":true,"real":1.25}]`), &rows); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(SuccessSQL(rows, 2, false))
	if err != nil || !strings.Contains(string(data), `9223372036854775807`) || !strings.Contains(string(data), `"truncated":false`) {
		t.Fatalf("SQL scalar precision or metadata changed: %s, %v", data, err)
	}
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	if err = bundle.ValidateResponse("POST", "/api/query/sql", data); err != nil {
		t.Fatal(err)
	}
	if err = bundle.ValidateResponse("POST", "/api/query/sql", []byte(`{"code":0,"msg":"","data":[]}`)); err == nil {
		t.Fatal("query success requires limit metadata")
	}
	for _, invalid := range []string{`[{"value":[]}]`, `[{"value":{}}]`} {
		if err := json.Unmarshal([]byte(invalid), &rows); err == nil {
			t.Fatal("SQL scalar accepted a composite value")
		}
	}
}
