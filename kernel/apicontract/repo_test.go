package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSnapshotContracts(t *testing.T) {
	for _, body := range []string{`{}`, `{"memo":""}`, `{"memo":"note"}`} {
		if _, err := CreateSnapshot.Decode(strings.NewReader(body)); err != nil {
			t.Fatalf("optional memo rejected: %s %v", body, err)
		}
	}
	for _, body := range []string{`{"memo":null}`, `{"memo":1}`, `[]`} {
		if _, err := CreateSnapshot.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid memo accepted: %s", body)
		}
	}
	for _, body := range []string{`{}`, `{"id":"id"}`, `{"id":1,"memo":"note"}`} {
		if _, err := SetSnapshotMemo.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid edit accepted: %s", body)
		}
	}
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, created := range []bool{false, true} {
		data, _ := json.Marshal(Success(CreateSnapshotData{ID: "snapshot-id", Created: created}))
		if err = bundle.ValidateResponse("POST", "/api/repo/createSnapshot", data); err != nil {
			t.Fatal(err)
		}
	}
}
