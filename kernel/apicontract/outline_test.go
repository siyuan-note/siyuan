package apicontract

import (
	"strings"
	"testing"
)

func TestOutlineRequestCompatibility(t *testing.T) {
	for _, body := range []string{`{}`, `{"id":null}`, `{"id":42}`, `{"id":{}}`, `{"id":[]}`} {
		request, err := GetDocHeadingNumbers.Decode(strings.NewReader(body))
		if err != nil || request.ID != nil {
			t.Fatalf("heading numbers must ignore non-string ID: %s: %#v, %v", body, request, err)
		}
	}
	request, err := GetDocOutline.Decode(strings.NewReader(`{"id":"  id  ","preview":null,"notebook":42}`))
	if err != nil || request.ID == nil || *request.ID != "  id  " || request.Preview || request.Notebook != "" {
		t.Fatalf("outline request changed: %#v, %v", request, err)
	}
	if _, err = GetDocOutline.Decode(strings.NewReader(`{"id":"id","preview":42}`)); err == nil {
		t.Fatal("outline accepted invalid preview")
	}
}
