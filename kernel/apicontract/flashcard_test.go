package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestQuickFlashcardSourcesContract(t *testing.T) {
	for _, body := range []string{
		`{"operationID":"op","blockIDs":["block"],"createdAt":1,"toggle":true}`,
		`{"OperationID":"op","BlockIDs":["block"],"CreatedAt":1,"Toggle":true,"unknown":1}`,
	} {
		request, err := CreateQuickFlashcardSources.Decode(strings.NewReader(body))
		if err != nil || request.OperationID != "op" || len(request.BlockIDs) != 1 || !request.Toggle {
			t.Fatalf("struct binding changed: %+v, %v", request, err)
		}
	}
	for _, body := range []string{`null`, `{}`, `{"blockIDs":null,"toggle":null}`} {
		if _, err := CreateQuickFlashcardSources.Decode(strings.NewReader(body)); err != nil {
			t.Fatalf("business validation must remain in the model: %v", err)
		}
	}
	for _, body := range []string{``, `{`, `{"createdAt":1.5}`, `{"blockIDs":[1]}`} {
		_, err := CreateQuickFlashcardSources.Decode(strings.NewReader(body))
		if err == nil {
			t.Fatalf("invalid request accepted: %s", body)
		}
		payload, _ := json.Marshal(CreateQuickFlashcardSources.DecodeFailure(err))
		if !strings.Contains(string(payload), "invalid flashcard request: ") {
			t.Fatalf("decode error prefix changed: %s", payload)
		}
	}
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, data := range []QuickFlashcardSourcesData{
		{SourceIDs: []string{}, CardIDs: []string{}, Action: "created"},
		{SourceIDs: []string{"source"}, CardIDs: []string{"card"}, Action: "removed"},
	} {
		payload, _ := json.Marshal(Success(data))
		if err = bundle.ValidateResponse("POST", "/api/flashcard/createQuickSources", payload); err != nil {
			t.Fatal(err)
		}
	}
}
