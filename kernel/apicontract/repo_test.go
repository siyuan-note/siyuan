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

func TestRepoRemainingResponseContracts(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		path string
		body string
	}{
		{"getRepoSnapshots", `{"code":0,"msg":"","data":{"snapshots":[],"pageCount":0,"totalCount":0}}`},
		{"getRepoTagSnapshots", `{"code":0,"msg":"","data":{"snapshots":null}}`},
		{"getCloudRepoSnapshots", `{"code":0,"msg":"","data":{"snapshots":[null],"pageCount":1,"totalCount":1}}`},
		{"diffRepoSnapshots", `{"code":0,"msg":"","data":{"addsLeft":[],"updatesLeft":null,"updatesRight":[],"removesRight":[],"left":{"id":"left","created":1},"right":{"id":"right","created":2}}}`},
		{"initRepoKey", `{"code":0,"msg":"","data":{"key":"AAECAw=="}}`},
		{"importRepoKey", `{"code":-1,"msg":"invalid key","data":{"closeTimeout":5000}}`},
		{"purgeRepo", `{"code":-1,"msg":"failed","data":{"closeTimeout":5000}}`},
		{"tagSnapshot", `{"code":-1,"msg":"failed","data":{"closeTimeout":5000}}`},
	} {
		if err := bundle.ValidateResponse("POST", "/api/repo/"+test.path, []byte(test.body)); err != nil {
			t.Errorf("%s: %v", test.path, err)
		}
	}
	if err := bundle.ValidateErrorResponse("POST", "/api/repo/getRepoFile", []byte(`{"code":-1,"msg":"locked","data":null}`)); err != nil {
		t.Fatal(err)
	}
	if err := bundle.ValidateErrorResponse("POST", "/api/repo/getRepoFile", []byte(`{"code":-1,"msg":"locked","data":{"unexpected":1}}`)); err == nil {
		t.Fatal("undeclared repository error payload accepted")
	}
}
