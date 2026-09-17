package apicontract

import (
	"strings"
	"testing"
)

func TestGlobalBacklinkContract(t *testing.T) {
	const base = `"id":"20260917165208-18eulw4","sort":1,"containChildren":false`
	request, err := GetGlobalBacklinks.Decode(strings.NewReader(`{` + base + `}`))
	if err != nil || request.Offset != 0 || request.Snapshot != "" {
		t.Fatalf("defaults: %+v %v", request, err)
	}
	for _, body := range []string{`{}`, `{` + base + `,"offset":"50"}`, `{` + base + `,"snapshot":null}`} {
		if _, err = GetGlobalBacklinks.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid request accepted: %s", body)
		}
	}
	if _, err = GetGlobalBacklinkContexts.Decode(strings.NewReader(`{` + base + `,"snapshot":"token","ids":["block"]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err = GetGlobalBacklinkContexts.Decode(strings.NewReader(`{` + base + `,"snapshot":"token","ids":[null]}`)); err == nil {
		t.Fatal("null ID accepted")
	}
}
