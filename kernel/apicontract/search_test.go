package apicontract

import (
	"reflect"
	"strings"
	"testing"
)

func TestSearchQueryCompatibility(t *testing.T) {
	for _, body := range []string{`{}`, `null`, `{"page":null,"pageSize":null}`, `{"page":0.9,"pageSize":-2}`} {
		request, err := SemanticSearchBlock.Decode(strings.NewReader(body))
		page, size := request.Pagination()
		if err != nil || page != 1 || size != 32 || request.Types != nil || request.SubTypes.Selected() != nil {
			t.Fatalf("search defaults changed: %s: %+v, %v", body, request, err)
		}
	}
	request, err := FullTextSearchBlock.Decode(strings.NewReader(`{"page":2.9,"pageSize":5.8,"query":" query ","types":{},"paths":[],"method":3.9,"orderBy":2.1,"groupBy":1.8,"notebook":false,"searchHPath":false}`))
	page, size := request.Pagination()
	if err != nil || page != 2 || size != 5 || request.Query != " query " || request.Types == nil || request.Paths == nil || int(request.Method) != 3 || request.Notebook != "" || request.SearchHPath == nil || *request.SearchHPath {
		t.Fatalf("search input changed: %+v, %v", request, err)
	}
	for _, body := range []string{`{"searchHPath":"false"}`, `{"searchHPath":{}}`, `{"searchHPath":null}`} {
		request, err := FullTextSearchBlock.Decode(strings.NewReader(body))
		if err != nil || request.SearchHPath != nil {
			t.Fatalf("ignored path flag changed: %s, %v", body, err)
		}
	}
	for _, body := range []string{`{"page":"1"}`, `{"types":{"p":null}}`, `{"types":{"p":1}}`, `{"paths":[null]}`, `{"query":false}`} {
		if _, err := SemanticSearchBlock.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid search input accepted: %s", body)
		}
	}
}

func TestSearchSubtypeCompatibility(t *testing.T) {
	for _, entry := range []struct {
		raw  string
		want map[string]bool
	}{
		{`null`, nil}, {`false`, nil}, {`[]`, nil}, {`"heading"`, nil},
		{`{}`, map[string]bool{}},
		{`{"h1":true,"unknown":{"x":true}}`, map[string]bool{}},
		{`{"heading":false,"list":[true],"listItem":"t"}`, map[string]bool{}},
		{`{"heading":{"h1":true,"h2":"true","h3":null,"h4":false,"h5":[]},"list":{"t":true,"o":1},"listItem":{"u":true}}`, map[string]bool{"h1": true, "list:t": true, "listItem:u": true}},
	} {
		request, err := SemanticSearchBlock.Decode(strings.NewReader(`{"subTypes":` + entry.raw + `}`))
		if err != nil || !reflect.DeepEqual(request.SubTypes.Selected(), entry.want) {
			t.Fatalf("subtype compatibility changed: %s: %+v, %v", entry.raw, request.SubTypes.Selected(), err)
		}
	}
}

func TestSearchEmbedCompatibility(t *testing.T) {
	request, err := SearchEmbedBlock.Decode(strings.NewReader(`{"embedBlockID":" id ","stmt":" sql ","excludeIDs":[null," block "],"headingMode":2.9,"breadcrumb":null,"notebook":123}`))
	if err != nil || request.EmbedBlockID != " id " || request.Stmt != " sql " || int(request.HeadingMode) != 2 || request.Breadcrumb || request.Notebook != "" || len(request.ExcludeIDs) != 2 || request.ExcludeIDs[0] != nil || *request.ExcludeIDs[1] != " block " {
		t.Fatalf("embed input changed: %+v, %v", request, err)
	}
	for _, body := range []string{`{"embedBlockID":"id"}`, `{"embedBlockID":"id","includeIDs":null}`, `{"embedBlockID":"id","includeIDs":[null]}`} {
		if _, err := GetEmbedBlock.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid embed IDs accepted: %s", body)
		}
	}
	if _, err := SearchEmbedBlock.Decode(strings.NewReader(`{"embedBlockID":"id","stmt":"sql","excludeIDs":[1]}`)); err == nil {
		t.Fatal("non-string exclusion accepted")
	}
}

func TestSearchRefDeferredParameters(t *testing.T) {
	for _, body := range []string{`{"reqId":[1],"rootID":false}`, `{"id":null,"k":false}`} {
		request, err := SearchRefBlock.Decode(strings.NewReader(body))
		if err != nil || request.ID != nil {
			t.Fatalf("correlation-only request changed: %+v, %v", request, err)
		}
	}
	request, err := SearchRefBlock.Decode(strings.NewReader(`{"id":false,"notebook":" locked ","k":" keyword "}`))
	if err != nil || request.ID == nil || request.Notebook != " locked " {
		t.Fatalf("deferred validation changed: %+v, %v", request, err)
	}
	if keyword, err := request.Keyword(); err != nil || keyword != " keyword " {
		t.Fatalf("keyword changed: %q, %v", keyword, err)
	}
	if _, err := request.Parameters(); err == nil {
		t.Fatal("invalid deferred parameters accepted")
	}
	request, err = SearchRefBlock.Decode(strings.NewReader(`{"id":" id ","rootID":" root ","k":" k ","beforeLen":4.9,"isDatabase":null}`))
	params, decodeErr := request.Parameters()
	if err != nil || decodeErr != nil || params.ID != " id " || params.RootID != " root " || int(params.BeforeLen) != 4 || params.IsDatabase {
		t.Fatalf("ref input changed: %+v, %v, %v", params, err, decodeErr)
	}
}
