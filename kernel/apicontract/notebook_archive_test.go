package apicontract

import (
	"strings"
	"testing"
)

func TestNotebookArchiveContract(t *testing.T) {
	for _, body := range []string{`{}`, `{"id":"archive"}`, `{"id":"archive","saved":null}`, `{"id":"archive","saved":"true"}`} {
		if _, err := CommitNotebookArchive.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("accepted invalid confirmation: %s", body)
		}
	}
	request, err := CommitNotebookArchive.Decode(strings.NewReader(`{"id":"archive","saved":false}`))
	if err != nil || request.Saved {
		t.Fatalf("false confirmation changed: %+v %v", request, err)
	}
	for _, body := range []string{`{}`, `{"notebooks":null}`, `{"notebooks":[null]}`, `{"notebooks":"id"}`} {
		if _, err := PrepareNotebookArchive.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("accepted invalid notebook selection: %s", body)
		}
	}
}
