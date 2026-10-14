package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRepoSnapshotTimeRangeContract(t *testing.T) {
	for _, body := range []string{`{"page":1}`, `{"page":1.75,"startTime":0,"endTime":0}`,
		`{"page":1,"startTime":1790000000000}`, `{"page":1,"endTime":1790000000000}`,
		`{"page":1,"startTime":1790000000000,"endTime":1790086400000}`} {
		local, err := GetRepoSnapshots.Decode(strings.NewReader(body))
		if err != nil {
			t.Fatalf("local range: %s %v", body, err)
		}
		cloud, err := GetCloudRepoSnapshots.Decode(strings.NewReader(body))
		if err != nil || local.RepoSnapshotTimeRange != cloud.RepoSnapshotTimeRange || local.Page != cloud.Page {
			t.Fatalf("cloud range: %s %v", body, err)
		}
	}
	for _, body := range []string{`{"page":1,"startTime":null}`, `{"page":1,"endTime":"1"}`,
		`{"page":1,"startTime":-1}`, `{"page":1,"endTime":1.5}`, `{"page":1,"startTime":true}`,
		`{"page":1,"startTime":2,"endTime":1}`, `{"page":1,"startTime":1,"endTime":1}`} {
		if _, err := GetRepoSnapshots.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("local range accepted: %s", body)
		}
		if _, err := GetCloudRepoSnapshots.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("cloud range accepted: %s", body)
		}
	}
}

func TestRepoSnapshotIDContract(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		body, _ := json.Marshal(map[string]interface{}{"page": 1, "includeFiles": enabled})
		request, err := GetRepoSnapshots.Decode(strings.NewReader(string(body)))
		if err != nil || request.IncludeFiles != enabled {
			t.Fatalf("includeFiles: %+v %v", request, err)
		}
	}
	for _, value := range []string{"null", `"true"`, "1", "[]"} {
		if _, err := GetRepoSnapshots.Decode(strings.NewReader(`{"page":1,"includeFiles":` + value + `}`)); err == nil {
			t.Fatalf("invalid includeFiles accepted: %s", value)
		}
	}
	for _, body := range []string{`{"page":1}`, `{"page":1,"id":""}`, `{"page":1,"id":null}`} {
		request, err := GetRepoSnapshots.Decode(strings.NewReader(body))
		if err != nil || request.ID != "" {
			t.Fatalf("optional ID: %s %v", body, err)
		}
	}
	request, err := GetRepoSnapshots.Decode(strings.NewReader(`{"page":2.75,"id":" abc "}`))
	if err != nil || request.ID != "abc" || request.Page != 2.75 {
		t.Fatalf("ID trimming and page compatibility: %+v %v", request, err)
	}
	for _, body := range []string{`{"page":1,"id":123}`, `{"page":1,"id":[]}`, `{"id":"abc"}`} {
		if _, err := GetRepoSnapshots.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid request accepted: %s", body)
		}
	}
}

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
