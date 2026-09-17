package apicontract

import (
	"strings"
	"testing"
)

func TestBacklinkListRequestCompatibility(t *testing.T) {
	for _, raw := range []string{`true`, `false`, `null`, `"false"`} {
		request, err := GetBacklink2.Decode(strings.NewReader(`{"id":"id","k":"","mk":"","includeBacklinks":` + raw + `}`))
		if raw == "true" || raw == "false" {
			if err != nil || request.IncludeBacklinks == nil || *request.IncludeBacklinks != (raw == "true") {
				t.Fatalf("backlink flag: %+v %v", request, err)
			}
		} else if err == nil {
			t.Fatalf("invalid backlink flag accepted: %s", raw)
		}
	}
	for _, body := range []string{`{}`, `{"id":null,"k":false,"sort":false,"containChildren":null}`} {
		request, err := decodeBacklinkListRequest(strings.NewReader(body))
		if err != nil || request.ID != nil {
			t.Fatalf("missing ID no-op changed: %+v, %v", request, err)
		}
	}
	for _, raw := range []string{`null`, `false`, `true`, `"ignored"`, `7`} {
		request, err := decodeBacklinkListRequest(strings.NewReader(`{"id":" id ","k":" ","mk":"","includeMentions":` + raw + `,"notebook":false,"knownRevision":{},"sort":"","mSort":null}`))
		if err != nil || request.ID == nil || *request.ID != " id " || request.K != " " || request.Notebook != "" || request.KnownRevision != "" || request.Sort == nil || *request.Sort != "" || request.MentionSort != nil {
			t.Fatalf("backlink list parameters changed: %+v, %v", request, err)
		}
		if raw == "true" || raw == "false" {
			if request.IncludeMentions == nil || *request.IncludeMentions != (raw == "true") {
				t.Fatalf("explicit mention flag changed: %+v", request)
			}
		} else if request.IncludeMentions != nil {
			t.Fatalf("ignored mention flag changed: %+v", request)
		}
	}
	for _, body := range []string{`{"id":"id"}`, `{"id":"id","k":"","mk":"","containChildren":null}`, `{"id":"id","k":"","mk":"","sort":7}`} {
		if _, err := decodeBacklinkListRequest(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid backlink fields accepted: %s", body)
		}
	}
}
