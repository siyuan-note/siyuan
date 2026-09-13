package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBatchRequestConstraints(t *testing.T) {
	for _, body := range []string{`{}`, `{"ids":null}`, `{"ids":[null]}`, `{"ids":[1]}`} {
		if _, err := BatchGetBlockAttrs.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid IDs accepted: %s", body)
		}
	}
	for _, body := range []string{`{"blockAttrs":[null]}`, `{"blockAttrs":[{}]}`, `{"blockAttrs":[{"ID":"id","attrs":{}}]}`, `{"blockAttrs":[{"id":"id"}]}`, `{"blockAttrs":[{"id":"id","attrs":null}]}`, `{"blockAttrs":[{"id":"id","attrs":{"x":1}}]}`} {
		if _, err := BatchSetBlockAttrs.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid nested attributes accepted: %s", body)
		}
	}
	request, err := BatchSetBlockAttrs.Decode(strings.NewReader(`{"blockAttrs":[{"id":"id","attrs":{"remove":null,"name":"value"}}]}`))
	if err != nil || len(request.BlockAttrs) != 1 || request.BlockAttrs[0].Attrs["remove"] != nil || *request.BlockAttrs[0].Attrs["name"] != "value" {
		t.Fatalf("nullable attribute values changed: %+v, %v", request, err)
	}
	for _, body := range []string{`{}`, `{"app":null,"sort":null,"ignoreMaxListHint":null}`} {
		request, err := GetTag.Decode(strings.NewReader(body))
		if err != nil || request.App != "" || request.Sort != 0 || request.IgnoreMaxListHint {
			t.Fatalf("optional tag defaults changed: %+v, %v", request, err)
		}
	}
	requestTag, err := RenameTag.Decode(strings.NewReader(`{"oldLabel":" old ","newLabel":" new "}`))
	if err != nil || requestTag.OldLabel != " old " || requestTag.NewLabel != "new" {
		t.Fatalf("label trimming changed: %+v, %v", requestTag, err)
	}
	requestLaunch, err := SetAutoLaunch.Decode(strings.NewReader(`{"autoLaunch":1.9}`))
	if err != nil || requestLaunch.AutoLaunch != 1.9 {
		t.Fatalf("numeric input was truncated during decoding: %+v, %v", requestLaunch, err)
	}
}

func TestTimeoutResponseContract(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	response, err := json.Marshal(FailureWithTimeout[Null](-1, "failed", 5000))
	if err != nil || string(response) != `{"code":-1,"msg":"failed","data":{"closeTimeout":5000}}` {
		t.Fatalf("timeout envelope changed: %s, %v", response, err)
	}
	if err := bundle.ValidateResponse("POST", "/api/tag/renameTag", response); err != nil {
		t.Fatal(err)
	}
}
