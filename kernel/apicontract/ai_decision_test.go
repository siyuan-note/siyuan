package apicontract

import (
	"strings"
	"testing"
)

func TestAIDecisionDraftDecode(t *testing.T) {
	for _, body := range []string{"", "  ", `{}`, `{"text":"ignored-note"}`} {
		request, err := AITestDecisionModel.Decode(strings.NewReader(body))
		if err != nil || request.Provider != "" || request.Profile != nil {
			t.Fatalf("legacy saved-configuration test rejected: %q %v", body, err)
		}
	}
	for _, body := range []string{`{`, `{}garbage`, `{} {"provider":"openai"}`, `{"provider":42}`, `{"provider":"openai","profile":{"endpoint":"https://example.com"}}`} {
		if _, err := AITestDecisionModel.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid draft accepted: %q", body)
		}
	}
	request, err := AITestDecisionModel.Decode(strings.NewReader(`{"provider":"openai","profile":{"endpoint":"https://example.com","apiKey":"key","name":"model","timeout":30}}`))
	if err != nil || request.Profile == nil || request.Profile.APIKey != "key" || request.Provider != "openai" {
		t.Fatalf("complete draft rejected: %+v %v", request, err)
	}
}
