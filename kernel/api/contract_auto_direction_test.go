package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestAPIContractSettingAutoDirection(t *testing.T) {
	compareSettingConfig(t, apicontract.SetEditor, conf.NewEditor, []string{
		`{}`, `{"autoDirection":true}`, `{"autoDirection":false}`, `{"autoDirection":null}`,
		`{"autoDirection":"true"}`, `{"autoDirection":1}`, `{"rtl":true,"autoDirection":true}`,
	})
	for _, enabled := range []bool{false, true} {
		editor := conf.NewEditor()
		if editor.AutoDirection {
			t.Fatal("automatic direction must default to disabled")
		}
		editor.AutoDirection = enabled
		editor.RTL = true
		encoded, err := json.Marshal(editor)
		if err != nil {
			t.Fatal(err)
		}
		restored := conf.NewEditor()
		if err = json.Unmarshal(encoded, restored); err != nil {
			t.Fatal(err)
		}
		payload := settingEditorPayload(restored)
		if payload.AutoDirection != enabled || !payload.RTL {
			t.Fatalf("direction preferences were not preserved: %+v", payload)
		}
		request, err := apicontract.SetEditor.Decode(strings.NewReader(string(encoded)))
		if err != nil || request.ConfigError() != nil || request.AutoDirection != enabled {
			t.Fatalf("direction input changed: %+v, %v", request, err)
		}
	}
}
