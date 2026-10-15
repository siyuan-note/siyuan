package apicontract

import (
	"strings"
	"testing"
)

func TestSettingPatchInput(t *testing.T) {
	for _, body := range []string{`{"editor":{"fontSize":20}}`, `{"appearance":{"notifications":{"selectAllTip":false}}}`,
		`{"ai":{"agent":{"maxRetries":2}}}`, `{"keymap":{"plugin":{"example.name":{"command":{"custom":""}}}}}`} {
		request, err := PatchSetting.Decode(strings.NewReader(body))
		if err != nil || request.Namespace() == "" || len(request.PatchJSON()) == 0 {
			t.Fatalf("valid patch rejected: %s %v", body, err)
		}
	}
	for _, body := range []string{`{}`, `null`, `[]`, `{"editor":{}}`, `{"editor":null}`, `{"editor":[]}`,
		`{"unknown":{"value":1}}`, `{"editor":{"fontSize":"bad"}}`, `{"editor":{"fontSize":20},"search":{"limit":8}}`} {
		if _, err := PatchSetting.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("invalid patch accepted: %s", body)
		}
	}
}
