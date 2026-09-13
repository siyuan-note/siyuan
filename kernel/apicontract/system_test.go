package apicontract

import (
	"encoding/json"
	"mime/multipart"
	"reflect"
	"strings"
	"testing"
)

func TestAPIContractSystemRequestCompatibility(t *testing.T) {
	for _, body := range []string{`{}`, `null`, `{"force":null}`, `{"force":true}`, `{"force":true} {}`, `{"unknown":1e1000}`, ``} {
		var legacy map[string]interface{}
		legacyErr := json.NewDecoder(strings.NewReader(body)).Decode(&legacy)
		request, err := SystemGetChangelog.Decode(strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		want := legacyErr == nil && legacy["force"] == true
		if request.Force != want {
			t.Fatalf("optional changelog parsing changed for %s", body)
		}
	}
	for _, body := range []string{`{"force":"true"}`, `{"force":1}`, `{"force":[]}`} {
		if _, err := SystemGetChangelog.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid changelog force accepted: %s", body)
		}
	}
	request, err := SystemLoginAuth.Decode(strings.NewReader(`{"authCode":{},"captcha":{},"rememberMe":{}}`))
	if err != nil || request.AuthCodeError() == nil || request.CaptchaError() == nil || request.RememberMe {
		t.Fatalf("conditional login validation moved into decoding: %#v %v", request, err)
	}
	path, err := SystemCheckWorkspaceDir.Decode(strings.NewReader(`{"path":"  folder  "}`))
	if err != nil || path.Path != "  folder  " {
		t.Fatalf("workspace path was trimmed: %#v %v", path, err)
	}
	for _, body := range []string{`{}`, `{"id":null}`, `{"id":{}}`, `{"id":1}`} {
		font, err := SystemRemoveCustomFont.Decode(strings.NewReader(body))
		if err != nil || font.ID != "" {
			t.Fatalf("ignored font ID type changed: %#v %v", font, err)
		}
	}
}

func TestAPIContractSystemUploadSelection(t *testing.T) {
	first, second := &multipart.FileHeader{Filename: "one"}, &multipart.FileHeader{Filename: "two"}
	form := &multipart.Form{Value: map[string][]string{"url": {"first", "second"}, "name": {"first", "second"}}, File: map[string][]*multipart.FileHeader{"file": {first, second}}}
	emoji, err := SystemAddCustomEmoji.DecodeMultipart(form)
	if err != nil || emoji.File != first || emoji.URL != "first" || emoji.Name != "first" {
		t.Fatalf("emoji first-file and first-field selection changed: %#v %v", emoji, err)
	}
	imported, err := SystemImportConf.DecodeMultipart(form)
	if err != nil || !reflect.DeepEqual(imported.File, []*multipart.FileHeader{first, second}) {
		t.Fatalf("configuration upload lost exact-file-count validation: %#v %v", imported, err)
	}
	font, err := SystemImportCustomFont.DecodeMultipart(&multipart.Form{})
	if err != nil || font.File != nil {
		t.Fatalf("missing font should reach the existing handler error: %#v %v", font, err)
	}
}

func TestAPIContractSystemOIDCResponseVariants(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		route string
		data  string
		valid bool
	}{
		{"poll", `{"status":"pending"}`, true},
		{"poll", `{"status":"completed","to":"/"}`, true},
		{"poll", `{"status":"completed"}`, false},
		{"validatePoll", `{"status":"completed"}`, true},
		{"mobileCallback", `{"validation":true}`, true},
		{"mobileCallback", `{"to":"/"}`, true},
		{"mobileCallback", `{}`, false},
		{"mobileCallback", `{"validation":false}`, false},
	} {
		err := bundle.ValidateResponse("POST", "/api/system/oidc/"+test.route, []byte(`{"code":0,"msg":"","data":`+test.data+`}`))
		if (err == nil) != test.valid {
			t.Fatalf("OIDC %s variant %s: %v", test.route, test.data, err)
		}
	}
}
