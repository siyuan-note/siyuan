package apicontract

import (
	"reflect"
	"strings"
	"testing"
)

func TestBlockRefConditionalInputs(t *testing.T) {
	for _, entry := range []struct{ body, message string }{
		{`{"ids":[]}`, "Field [ids] must not be empty"},
		{`{"ids":null}`, "Field [ids] is required"},
		{`{"ids":[null]}`, "Field [ids] should contain non-empty strings"},
		{`{"ids":["x"],"exactIDs":null}`, "Field [exactIDs] is required"},
		{`{"ids":["x"],"deletedIDs":[12]}`, "Field [deletedIDs] should contain non-empty strings"},
		{`{"scope":null}`, "Field [scope] should be of type [String]"},
		{`{"scope":" blocks "}`, "invalid block ref check scope"},
		{`{"scope":"documents","paths":[]}`, "Field [paths] must not be empty"},
		{`{"scope":"notebook","notebook":" "}`, "Field [notebook] must not be empty"},
	} {
		if _, err := CheckBlockRef.Decode(strings.NewReader(entry.body)); err == nil || err.Error() != entry.message {
			t.Fatalf("%s: expected %q, got %v", entry.body, entry.message, err)
		}
	}
	request, err := CheckBlockRef.Decode(strings.NewReader(`{"scope":" ","ids":[" a "," a "],"exactIDs":[],"deletedIDs":[],"paths":42,"notebook":null}`))
	if err != nil || request.Scope != "blocks" || !reflect.DeepEqual(request.IDs, []string{" a "}) {
		t.Fatalf("block inputs changed: %+v, %v", request, err)
	}
	request, err = CheckBlockRef.Decode(strings.NewReader(`{"scope":"documents","paths":["p","p"],"notebook":42,"ids":false}`))
	if err != nil || !reflect.DeepEqual(request.Paths, []string{"p"}) {
		t.Fatalf("document inputs changed: %+v, %v", request, err)
	}
	request, err = CheckBlockRef.Decode(strings.NewReader(`{"scope":"notebook","notebook":" box ","ids":[null,42,"id"],"id":42}`))
	if err != nil || request.Notebook != "box" || !reflect.DeepEqual(request.IDs, []string{"id"}) {
		t.Fatalf("notebook inputs changed: %+v, %v", request, err)
	}
}

func TestHeadingLevelInputCompatibility(t *testing.T) {
	for _, body := range []string{`{"id":"id","ids":null,"level":2.9}`, `{"id":"id","ids":42,"level":2.9}`} {
		request, err := GetHeadingLevelTransaction.Decode(strings.NewReader(body))
		if err != nil || request.ID != "id" || request.IDs != nil || int(request.Level) != 2 {
			t.Fatalf("single heading changed: %+v, %v", request, err)
		}
	}
	for _, body := range []string{`{"ids":[],"id":false,"level":2}`, `{"ids":["a","a"],"id":false,"level":2}`} {
		request, err := GetHeadingLevelTransaction.Decode(strings.NewReader(body))
		if err != nil || request.IDs == nil || len(request.IDs) > 1 {
			t.Fatalf("batch heading changed: %+v, %v", request, err)
		}
	}
	request, err := GetDocHeadingLevelTransaction.Decode(strings.NewReader(`{"ID":"doc","SOURCE":2,"target":3,"withSubheadings":null}`))
	if err != nil || request.ID != "doc" || request.Source != 2 || request.Target != 3 {
		t.Fatalf("struct binding changed: %+v, %v", request, err)
	}
	for _, body := range []string{"", "{", `{"source":2.5}`, `{"id":42}`} {
		if _, err := GetDocHeadingLevelTransaction.Decode(strings.NewReader(body)); err == nil || err.Error() != "invalid heading conversion parameters" {
			t.Fatalf("binding error changed: %v", err)
		}
	}
}
