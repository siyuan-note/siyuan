package apicontract

import (
	"encoding/json"
	"reflect"
	"testing"

	goccyJSON "github.com/goccy/go-json"
)

func TestResponseAlternateJSONEncoder(t *testing.T) {
	type data struct {
		Text    string   `json:"text"`
		Count   int64    `json:"count"`
		Entries []string `json:"entries"`
	}
	for _, response := range []Response[data]{
		Success(data{Text: "<value>", Count: 9007199254740993}),
		FailureWithTimeout[data](1, "message", 7000),
	} {
		standard, err := json.Marshal(response)
		if err != nil {
			t.Fatal(err)
		}
		called := false
		fast, err := response.MarshalWith(func(value any) ([]byte, error) {
			called = true
			return goccyJSON.Marshal(value)
		})
		if err != nil || !called {
			t.Fatalf("encoder not used: %v", err)
		}
		var left, right map[string]json.RawMessage
		if err := json.Unmarshal(standard, &left); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(fast, &right); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(left, right) {
			t.Fatalf("JSON changed: %s / %s", standard, fast)
		}
	}
}
