package apicontract

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestAIInputCompatibility(t *testing.T) {
	request, err := AITestModel.Decode(strings.NewReader(`{"model":" example ","providerConfig":{"requestTimeout":1.5}}`))
	if err != nil || request.Model != "example" || request.ProviderError() == nil {
		t.Fatalf("provider validation was not deferred: %+v %v", request, err)
	}
	_, err = AITestModel.Decode(strings.NewReader(`{"model":"  ","providerConfig":false}`))
	if err == nil || !strings.Contains(err.Error(), "model") {
		t.Fatalf("model validation order changed: %v", err)
	}
	provider, err := AIListModels.Decode(strings.NewReader(`{"provider":false,"providerConfig":{"BASEURL":"x","requestTimeout":1.0}}`))
	if err != nil || provider.Provider != "" || provider.ProviderConfig.BaseURL != "x" || provider.ProviderConfig.RequestTimeout != 1 {
		t.Fatalf("draft binding changed: %+v %v", provider, err)
	}
	chat, err := AIAgentChat.Decode(strings.NewReader(`{"SESSIONID":"session","contentRevision":null,"references":[null,{}],"frontendCapabilities":[{"inputSchema":{"type":"object","x-custom":[true,null]}}]}`))
	if err != nil || chat.SessionID != "session" || len(chat.References) != 2 || chat.References[0].ID != "" {
		t.Fatalf("Go struct request compatibility changed: %+v %v", chat, err)
	}
	for _, body := range []string{``, `{`, `{"page":1.5}`, `{"page":1.0}`} {
		if _, err = AIListSessions.Decode(strings.NewReader(body)); err == nil || !strings.HasPrefix(err.Error(), "invalid request: ") {
			t.Fatalf("struct parser error changed for %s: %v", body, err)
		}
	}
}

func TestAISessionRawCompatibility(t *testing.T) {
	for _, body := range []string{`{"id":"session","future":9007199254740993,"entries":[{"type":"user","future":true}]}`, `{`, ``} {
		request, err := AISaveSession.Decode(strings.NewReader(body))
		if err != nil || !bytes.Equal(request.Bytes(), []byte(body)) {
			t.Fatalf("raw session changed: %s %v", request.Bytes(), err)
		}
	}
	var session AISession
	body := []byte(`{"id":"session","future":9007199254740993}`)
	if err := json.Unmarshal(body, &session); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(session)
	if err != nil || !bytes.Equal(body, encoded) {
		t.Fatalf("session response changed: %s %v", encoded, err)
	}
}
