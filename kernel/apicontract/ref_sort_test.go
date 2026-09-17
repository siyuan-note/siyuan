package apicontract

import (
	"strconv"
	"strings"
	"testing"
)

func TestBacklinkDocumentBlockSort(t *testing.T) {
	const base = `"defID":" def ","refTreeID":"ref","keyword":" "`
	request, err := GetBacklinkDoc.Decode(strings.NewReader(`{` + base + `}`))
	if err != nil || request.BlockSort != 0 || request.DefID != " def " || request.Keyword != " " {
		t.Fatalf("default request changed: %+v, %v", request, err)
	}
	for _, mode := range []int{0, 1, 2, -1, 99} {
		request, err = GetBacklinkDoc.Decode(strings.NewReader(`{` + base + `,"blockSort":` + strconv.Itoa(mode) + `}`))
		if err != nil || request.BlockSort != mode {
			t.Fatalf("sort mode lost: %+v, %v", request, err)
		}
	}
	for _, raw := range []string{`null`, `true`, `"1"`, `1.5`, `{}`, `[]`} {
		if _, err = GetBacklinkDoc.Decode(strings.NewReader(`{` + base + `,"blockSort":` + raw + `}`)); err == nil {
			t.Fatalf("invalid sort accepted: %s", raw)
		}
	}
}
