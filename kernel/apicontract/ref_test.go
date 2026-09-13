package apicontract

import (
	"strings"
	"testing"
)

func TestRefreshBacklinkRequestCompatibility(t *testing.T) {
	request, err := RefreshBacklink.Decode(strings.NewReader(`{"id":" 20240101000000-abcdefg "}`))
	if err != nil || request.ID != "20240101000000-abcdefg" {
		t.Fatalf("backlink ID trimming changed: %+v, %v", request, err)
	}
	for _, body := range []string{`{`, `{}`, `{"id":null}`, `{"id":false}`, `{"id":" "}`} {
		if _, err := RefreshBacklink.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid backlink ID accepted: %s", body)
		}
	}
}

func TestBackmentionDocumentRequestCompatibility(t *testing.T) {
	request, err := GetBackmentionDoc.Decode(strings.NewReader(`{"defID":" def ","refTreeID":" ref ","keyword":" ","knownRevision":false,"highlight":false}`))
	if err != nil || request.DefID != " def " || request.RefTreeID != " ref " || request.Keyword != " " || request.KnownRevision != "" || request.ContainChildren != nil || request.Highlight == nil || *request.Highlight {
		t.Fatalf("backmention request compatibility changed: %+v, %v", request, err)
	}
	request, err = GetBackmentionDoc.Decode(strings.NewReader(`{"defID":"","refTreeID":"","keyword":""}`))
	if err != nil || request.Highlight != nil {
		t.Fatalf("empty query or highlight default changed: %+v, %v", request, err)
	}
}

func TestBacklinkSourceFilterCompatibility(t *testing.T) {
	request, err := GetBacklinkDoc.Decode(strings.NewReader(`{"defID":"","refTreeID":"","keyword":"","sourceFilter":{"dailyNote":false,"excludeSelf":"ignored","excludedRefDefIDs":[null,7,"",false,"id"],"excludedNotebookIDs":false}}`))
	if err != nil || request.SourceFilter == nil {
		t.Fatalf("filter decode failed: %+v, %v", request, err)
	}
	filter := request.SourceFilter
	if filter.DailyNote != "" || filter.ExcludeSelf || len(filter.ExcludedRefDefIDs) != 2 || filter.ExcludedRefDefIDs[0] != "" || filter.ExcludedRefDefIDs[1] != "id" || filter.ExcludedNotebookIDs != nil {
		t.Fatalf("source filter compatibility changed: %+v", filter)
	}
	for _, raw := range []string{`null`, `false`, `[]`, `"ignored"`} {
		request, err := GetBacklinkDoc.Decode(strings.NewReader(`{"defID":"","refTreeID":"","keyword":"","sourceFilter":` + raw + `}`))
		if err != nil || request.SourceFilter != nil {
			t.Fatalf("ignored source filter changed: %+v, %v", request, err)
		}
	}
}
