package apicontract

import (
	"strings"
	"testing"
)

func TestSettingCloudUserContractCached(t *testing.T) {
	for _, body := range []string{`{}`, `{"token":null}`, `{"token":"token"}`, `{"cached":false}`} {
		request, err := GetCloudUser.Decode(strings.NewReader(body))
		if err != nil || request.Cached {
			t.Fatalf("default refresh behavior changed for %s: %v", body, err)
		}
	}
	request, err := GetCloudUser.Decode(strings.NewReader(`{"cached":true,"token":"token"}`))
	if err != nil || !request.Cached || request.Token != "token" {
		t.Fatalf("cached query decode failed: %v", err)
	}
	for _, body := range []string{`{"cached":null}`, `{"cached":"true"}`, `{"cached":1}`} {
		if _, err = GetCloudUser.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid cached flag accepted: %s", body)
		}
	}
}
