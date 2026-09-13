package apicontract

import (
	"encoding/json"
	"testing"
)

func TestBlockOperationResult(t *testing.T) {
	for _, text := range []string{`null`, `""`, `"text"`, `[]`, `["a","b"]`} {
		var result BlockOperationResult
		if err := json.Unmarshal([]byte(text), &result); err != nil {
			t.Fatal(err)
		}
		data, err := json.Marshal(result)
		if err != nil || string(data) != text {
			t.Fatalf("block operation result changed: %s != %s, %v", text, data, err)
		}
	}
	for _, text := range []string{`1`, `true`, `{}`, `[null]`, `[1]`, `[["a"]]`} {
		var result BlockOperationResult
		if err := json.Unmarshal([]byte(text), &result); err == nil {
			t.Fatalf("invalid block operation result accepted: %s", text)
		}
	}
}

func TestBlockOperationData(t *testing.T) {
	for _, text := range []string{`null`, `""`, `"text"`, `{"createEmptyParagraph":false}`, `{"createEmptyParagraph":true}`} {
		var value BlockOperationData
		if err := json.Unmarshal([]byte(text), &value); err != nil {
			t.Fatal(err)
		}
		data, err := json.Marshal(value)
		if err != nil || string(data) != text {
			t.Fatalf("operation data changed: %s != %s, %v", text, data, err)
		}
	}
	for _, text := range []string{`[]`, `1`, `true`, `{}`, `{"createEmptyParagraph":null}`, `{"createEmptyParagraph":false,"other":true}`} {
		var value BlockOperationData
		if err := json.Unmarshal([]byte(text), &value); err == nil {
			t.Fatalf("invalid operation data accepted: %s", text)
		}
	}
}
