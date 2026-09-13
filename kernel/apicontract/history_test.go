package apicontract

import (
	"strings"
	"testing"
)

func TestHistoryItemsRequestCompatibility(t *testing.T) {
	request, err := GetHistoryItems.Decode(strings.NewReader(`{"created":" time ","query":" query ","notebook":null,"op":" op ","type":1.9}`))
	if err != nil || request.Created != "time" || request.Query != " query " || request.Notebook != "" || request.Op != " op " || request.Type == nil || *request.Type != 1.9 {
		t.Fatalf("history input changed: %+v, %v", request, err)
	}
	request, err = GetHistoryItems.Decode(strings.NewReader(`{"created":"time","type":null}`))
	if err != nil || request.Type != nil {
		t.Fatalf("default history type changed: %+v, %v", request, err)
	}
	for _, body := range []string{`{}`, `{"created":" "}`, `{"created":"time","type":"1"}`, `{"created":"time","query":false}`} {
		if _, err := GetHistoryItems.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid history input accepted: %s", body)
		}
	}
}

func TestDocHistoryContentRequestCompatibility(t *testing.T) {
	for _, field := range []string{"", `,"highlight":null`, `,"highlight":false`, `,"highlight":true`} {
		request, err := GetDocHistoryContent.Decode(strings.NewReader(`{"historyPath":" path ","k":" keyword "` + field + `}`))
		if err != nil || request.HistoryPath != "path" || request.K != " keyword " {
			t.Fatalf("history content input changed: %+v, %v", request, err)
		}
		if field == "" || strings.Contains(field, "null") {
			if request.Highlight != nil {
				t.Fatal("missing or null highlight must retain the handler default")
			}
		} else if request.Highlight == nil || *request.Highlight != strings.Contains(field, "true") {
			t.Fatalf("explicit highlight changed: %+v", request)
		}
	}
	if _, err := GetDocHistoryContent.Decode(strings.NewReader(`{"historyPath":"path","highlight":"true"}`)); err == nil {
		t.Fatal("invalid highlight accepted")
	}
}

func TestCreateHistoryRequestTrimming(t *testing.T) {
	doc, err := CreateDocHistory.Decode(strings.NewReader(`{"id":" id "}`))
	if err != nil || doc.ID != "id" {
		t.Fatalf("document ID trimming changed: %+v, %v", doc, err)
	}
	asset, err := CreateAssetHistory.Decode(strings.NewReader(`{"path":" assets/file "}`))
	if err != nil || asset.Path != "assets/file" {
		t.Fatalf("asset path trimming changed: %+v, %v", asset, err)
	}
}

func TestRollbackHistoryRequestCompatibility(t *testing.T) {
	for _, endpoint := range []Endpoint[HistoryPathRequest, Null]{RollbackDocHistory, RollbackAssetsHistory, RollbackNotebookHistory, RollbackAttributeViewHistory} {
		request, err := endpoint.Decode(strings.NewReader(`{"historyPath":" history/path "}`))
		if err != nil || request.HistoryPath != "history/path" {
			t.Fatalf("history path trimming changed: %+v, %v", request, err)
		}
		for _, body := range []string{`{}`, `{"historyPath":null}`, `{"historyPath":" "}`, `{"historyPath":false}`} {
			if _, err := endpoint.Decode(strings.NewReader(body)); err == nil {
				t.Fatalf("invalid rollback request accepted: %s", body)
			}
		}
	}
}

func TestDocVersionDecodeCompatibility(t *testing.T) {
	for _, entry := range []struct{ body, message string }{
		{`{}`, "left document version is required"},
		{`{"left":{},"right":null}`, "right document version is required"},
		{`{"left":{},"right":{}}`, "Field [type] is required"},
		{`{"left":{"type":" "},"right":{"type":"current"}}`, "Field [type] must not be empty"},
	} {
		if _, err := DiffDocVersions.Decode(strings.NewReader(entry.body)); err == nil || err.Error() != entry.message {
			t.Fatalf("version validation order changed: %s, %v", entry.body, err)
		}
	}
	request, err := DiffDocVersions.Decode(strings.NewReader(`{"left":{"type":" history ","id":" id ","path":" path ","snapshot":null},"right":{"type":"current"}}`))
	if err != nil || request.Left.Type != "history" || request.Left.ID != " id " || request.Left.Path != " path " || request.Left.Snapshot != "" {
		t.Fatalf("version input changed: %+v, %v", request, err)
	}
}
