package apicontract

import (
	"strings"
	"testing"
)

func TestCheckBlocksExistInputCompatibility(t *testing.T) {
	for _, body := range []string{"", "null", "{}", `{"ids":null}`, `{"ids":"invalid"}`} {
		if _, err := CheckBlocksExist.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid batch accepted: %q", body)
		}
	}
	for _, notebook := range []string{"null", "42", "true", `""`} {
		request, err := CheckBlocksExist.Decode(strings.NewReader(`{"ids":[],"notebook":` + notebook + `,"id":false}`))
		if err != nil || request.IDs == nil || request.Notebook != "" || request.ID != "" {
			t.Fatalf("ignored optional values changed: %+v, %v", request, err)
		}
	}
	request, err := CheckBlocksExist.Decode(strings.NewReader(`{"ids":["20261007000000-abcdefg",null,42,true,"invalid"],"notebook":"20261007000001-abcdefg"}`))
	if err != nil || len(request.IDs) != 5 || request.Notebook != "20261007000001-abcdefg" {
		t.Fatalf("mixed batch compatibility changed: %+v, %v", request, err)
	}
	if id, ok := request.IDs[0].StringValue(); !ok || id != "20261007000000-abcdefg" {
		t.Fatalf("block ID changed: %q, %v", id, ok)
	}
}
