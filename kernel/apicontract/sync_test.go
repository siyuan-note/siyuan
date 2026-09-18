package apicontract

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSyncConditionalDirection(t *testing.T) {
	for _, body := range []string{`{}`, `null`, `{"upload":null}`, `{"upload":"wrong"}`, `{"upload":[]}`} {
		request, err := PerformSync.Decode(strings.NewReader(body))
		if err != nil {
			t.Fatalf("direction validated before mode selection: %s: %v", body, err)
		}
		if _, err = request.UploadDirection(); err == nil {
			t.Fatalf("manual direction accepted: %s", body)
		}
	}
	for _, upload := range []bool{false, true} {
		body, _ := json.Marshal(struct {
			Upload bool `json:"upload"`
		}{upload})
		request, err := PerformSync.Decode(strings.NewReader(string(body)))
		if err != nil {
			t.Fatal(err)
		}
		value, err := request.UploadDirection()
		if err != nil || value != upload {
			t.Fatalf("direction changed: %v %v", value, err)
		}
	}
	for _, body := range []string{`{"mobileSwitch":"wrong","upload":true}`, `{"mobileSwitch":0}`} {
		if _, err := PerformSync.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid mobile switch accepted: %s", body)
		}
	}
}

func TestSyncProviderDecodeCompatibility(t *testing.T) {
	request, err := SetSyncProviderS3.Decode(strings.NewReader(`{"s3":{"ENDPOINT":" endpoint ","timeout":1.0,"concurrentReqs":9007199254740993,"pathStyle":null,"unknown":1}}`))
	if err != nil || request.ConfigError() != nil {
		t.Fatalf("config decode failed: %v %v", err, request.ConfigError())
	}
	if request.S3.Endpoint != " endpoint " || request.S3.Timeout != 1 || request.S3.ConcurrentReqs != 9007199254740992 || request.S3.PathStyle {
		t.Fatalf("configuration binding changed: %+v", request.S3)
	}
	for _, body := range []string{`{"s3":{"timeout":1.5}}`, `{"s3":{"endpoint":false}}`} {
		request, err := SetSyncProviderS3.Decode(strings.NewReader(body))
		if err != nil || request.ConfigError() == nil || !strings.Contains(request.ConfigError().Error(), "S3.") {
			t.Fatalf("nested error lost deferred timeout behavior: %v %v", err, request.ConfigError())
		}
	}
	for _, body := range []string{`{}`, `{"s3":null}`, `{"s3":[]}`} {
		if _, err := SetSyncProviderS3.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("missing or invalid object accepted: %s", body)
		}
	}
}

func TestSyncNameAndNumericCompatibility(t *testing.T) {
	request, err := SetCloudSyncDir.Decode(strings.NewReader(`{"name":"  cloud  "}`))
	if err != nil || request.Name != "cloud" {
		t.Fatalf("name trimming changed: %+v %v", request, err)
	}
	for _, body := range []string{`{}`, `{"name":null}`, `{"name":" \t"}`, `{"name":1}`} {
		if _, err := SetCloudSyncDir.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid name accepted: %s", body)
		}
	}
	interval, err := SetSyncInterval.Decode(strings.NewReader(`{"interval":31.9}`))
	if err != nil || int(interval.Interval) != 31 {
		t.Fatalf("fractional interval changed: %+v %v", interval, err)
	}
	lan, err := SetSyncLAN.Decode(strings.NewReader(`{"enabled":false,"maxConcurrentReqs":null}`))
	if err != nil || lan.MaxConcurrentReqs != 0 {
		t.Fatalf("optional concurrency changed: %+v %v", lan, err)
	}
	if _, err := SetSyncMode.Decode(strings.NewReader(`{"mode":1,"unused":1e1000}`)); err == nil {
		t.Fatal("overflow in body was ignored")
	}
}

func TestSyncProviderCompletionContract(t *testing.T) {
	for _, entry := range []struct {
		body     string
		complete bool
	}{
		{`{"provider":2.9}`, false},
		{`{"provider":2.9,"completeAssets":null}`, false},
		{`{"provider":2.9,"completeAssets":false}`, false},
		{`{"provider":2.9,"completeAssets":true}`, true},
	} {
		request, err := SetSyncProvider.Decode(strings.NewReader(entry.body))
		if err != nil || request.Provider != 2.9 || request.CompleteAssets != entry.complete {
			t.Fatalf("unexpected provider request: %+v %v", request, err)
		}
	}
	for _, body := range []string{`{"completeAssets":true}`, `{"provider":2,"completeAssets":1}`, `{"provider":2,"completeAssets":"true"}`} {
		if _, err := SetSyncProvider.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid completion request accepted: %s", body)
		}
	}
}
