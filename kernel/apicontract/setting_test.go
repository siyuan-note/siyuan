package apicontract

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestSettingThemeCompatibility(t *testing.T) {
	for _, entry := range []struct {
		body    string
		modes   []float64
		message string
	}{
		{`{}`, []float64{}, ""},
		{`{"theme":" t ","modes":[0.9,1.9,false,0],"appearanceMode":" dark "}`, []float64{0.9, 1.9}, ""},
		{`{"theme":"t","modes":[-0.9,0,0,1,2,0]}`, []float64{-0.9, 0, 0, 1}, ""},
		{`{"modes":[false,{},null]}`, []float64{}, ""},
		{`{"modes":false,"appearanceMode":false}`, nil, "Field [modes] should be of type [Array]"},
		{`{"theme":"t","modes":[false],"appearanceMode":false}`, nil, "Field [appearanceMode] should be of type [String]"},
	} {
		request, err := SetTheme.Decode(strings.NewReader(entry.body))
		if entry.message != "" {
			if err == nil || err.Error() != entry.message {
				t.Fatalf("theme error: %v", err)
			}
			continue
		}
		if err != nil || !reflect.DeepEqual(request.Modes, entry.modes) {
			t.Fatalf("theme modes: %+v %v", request, err)
		}
	}
}

func TestSettingKeymapOpaqueValues(t *testing.T) {
	request, err := SetKeymap.Decode(strings.NewReader(`{"data":{"custom":{"key":[null,false,1.5,"",{}]},"empty":null}}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(request.Data)
	if err != nil || string(encoded) != `{"custom":{"key":[null,false,1.5,"",{}]},"empty":null}` {
		t.Fatalf("keymap payload: %s %v", encoded, err)
	}
	for _, body := range []string{`{}`, `{"data":null}`} {
		request, err = SetKeymap.Decode(strings.NewReader(body))
		if err != nil || request.Data != nil {
			t.Fatalf("keymap omission: %+v %v", request, err)
		}
	}
}

func TestSettingCloudLoginSerialization(t *testing.T) {
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, payload := range []string{
		`{"code":0,"msg":"ok","data":{"code":0,"msg":"ok","token":"secret","extra":{"list":[null,false,1]}}}`,
		`{"code":1,"msg":"retry","data":{"code":-1,"msg":"retry","token":false,"wait":12}}`,
		`{"code":-8,"msg":"other","data":{"code":-8,"msg":"other","token":{"detail":"x"}}}`,
		`{"code":0,"msg":"fraction","data":{"code":0.5,"msg":"fraction"}}`,
		`{"code":-1,"msg":"network","data":null}`,
	} {
		var envelope Login2faEnvelope
		if err := json.Unmarshal([]byte(payload), &envelope); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(SuccessDirectJSON(envelope))
		if err != nil {
			t.Fatal(err)
		}
		var before, after map[string]JSONValue
		if err = json.Unmarshal([]byte(payload), &before); err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(encoded, &after); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("cloud result changed: %s", encoded)
		}
		if err = bundle.ValidateHTTPResponse("POST", Login2faCloudUser.Definition().Path, 200, "application/json", encoded); err != nil {
			t.Fatal(err)
		}
	}
	for _, payload := range []string{`{}`, `{"code":null,"msg":""}`, `{"code":0,"msg":null,"token":"x"}`, `{"code":0,"msg":""}`, `{"code":0,"msg":"","token":false}`, `{"code":0,"msg":"","token":""}`} {
		var data CloudLogin2faData
		if json.Unmarshal([]byte(payload), &data) == nil {
			t.Fatalf("invalid cloud success accepted: %s", payload)
		}
	}
}
