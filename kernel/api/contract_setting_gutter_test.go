package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingBlockGutterMode(t *testing.T) {
	compareSettingConfig(t, apicontract.SetEditor, conf.NewEditor, []string{
		`{}`, `{"blockGutterMode":0}`, `{"blockGutterMode":1}`, `{"blockGutterMode":null}`,
		`{"BlockGutterMode":1}`, `{"blockGutterMode":-1}`, `{"blockGutterMode":2}`,
		`{"blockGutterMode":"bad"}`, `{"blockGutterMode":true}`, `{"blockGutterMode":false}`, `{"blockGutterMode":1.5}`,
	})
	previousConf, previousReadOnly, previousMarkdown := model.Conf, util.ReadOnly, util.MarkdownSettings.Load()
	previousConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	util.ReadOnly = true
	t.Cleanup(func() {
		model.Conf = previousConf
		util.ReadOnly = previousReadOnly
		util.MarkdownSettings.Store(previousMarkdown)
		util.ConfDir = previousConfDir
	})
	if model.Conf.Editor.Load().BlockGutterMode {
		t.Fatal("block gutter mode must default to compact")
	}
	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{"blockGutterMode":true}`, true}, {`{}`, true}, {`{"blockGutterMode":false}`, false},
		{`{"BlockGutterMode":true}`, true}, {`{"blockGutterMode":null}`, false},
	} {
		code, message, data := settingContractRequest(t, "setEditor", setEditor, entry.body)
		var response apicontract.SettingEditor
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		if code != 0 || model.Conf.Editor.Load().BlockGutterMode != entry.want || response.BlockGutterMode != entry.want {
			t.Fatalf("block gutter mode update %s: code=%d message=%s data=%s", entry.body, code, message, data)
		}
		var output struct {
			BlockGutterMode bool `json:"blockGutterMode"`
		}
		if err := json.Unmarshal(data, &output); err != nil || output.BlockGutterMode != entry.want {
			t.Fatalf("response did not use a boolean: %s, %v", data, err)
		}
	}
	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{"editor":{"blockGutterMode":true}}`, true}, {`{"editor":{"fontSize":18}}`, true},
		{`{"editor":{"blockGutterMode":false}}`, false},
		{`{"editor":{"blockGutterMode":true}}`, true}, {`{"editor":{"blockGutterMode":null}}`, false},
	} {
		code, message, data := settingContractRequest(t, "patch", patchSetting, entry.body)
		if code != 0 || model.Conf.Editor.Load().BlockGutterMode != entry.want {
			t.Fatalf("block gutter mode patch %s: code=%d message=%s data=%s", entry.body, code, message, data)
		}
	}
	code, message, _ := settingContractRequest(t, "setEditor", setEditor, `{"blockGutterMode":true}`)
	if code != 0 {
		t.Fatalf("full mode could not be saved: %d %s", code, message)
	}
	for _, raw := range []string{`0`, `1`, `-1`, `2`, `99`, `"true"`, `1.5`, `[]`, `{}`} {
		code, _, _ = settingContractRequest(t, "setEditor", setEditor, `{"blockGutterMode":`+raw+`}`)
		if code == 0 || !model.Conf.Editor.Load().BlockGutterMode {
			t.Fatalf("invalid setting write changed the enabled preference: %s", raw)
		}
		code, _, _ = settingContractRequest(t, "patch", patchSetting, `{"editor":{"blockGutterMode":`+raw+`}}`)
		if code == 0 || !model.Conf.Editor.Load().BlockGutterMode {
			t.Fatalf("invalid patch changed the enabled preference: %s", raw)
		}
	}
	util.ReadOnly = false
	model.Conf.Save()
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	var stored struct {
		Editor conf.Editor `json:"editor"`
	}
	if err = json.Unmarshal(data, &stored); err != nil || !conf.NormalizeEditor(&stored.Editor).BlockGutterMode {
		t.Fatalf("full block gutter mode was not preserved in saved configuration: %v", err)
	}
	var saved struct {
		Editor struct {
			BlockGutterMode bool `json:"blockGutterMode"`
		} `json:"editor"`
	}
	if err = json.Unmarshal(data, &saved); err != nil || !saved.Editor.BlockGutterMode {
		t.Fatalf("saved configuration did not use a boolean: %v", err)
	}
}
