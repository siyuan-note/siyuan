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
		`{"blockGutterMode":"bad"}`, `{"blockGutterMode":true}`, `{"blockGutterMode":1.5}`,
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
	if model.Conf.Editor.Load().BlockGutterMode != 0 {
		t.Fatal("block gutter mode must default to compact")
	}
	for _, entry := range []struct {
		body string
		want int
	}{
		{`{"blockGutterMode":1}`, 1}, {`{}`, 1}, {`{"blockGutterMode":0}`, 0},
		{`{"BlockGutterMode":1}`, 1}, {`{"blockGutterMode":null}`, 0},
		{`{"blockGutterMode":-1}`, 0}, {`{"blockGutterMode":2}`, 0},
	} {
		code, message, data := settingContractRequest(t, "setEditor", setEditor, entry.body)
		var response apicontract.SettingEditor
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		if code != 0 || model.Conf.Editor.Load().BlockGutterMode != entry.want || response.BlockGutterMode != entry.want {
			t.Fatalf("block gutter mode update %s: code=%d message=%s data=%s", entry.body, code, message, data)
		}
	}
	for _, entry := range []struct {
		body string
		want int
	}{
		{`{"editor":{"blockGutterMode":1}}`, 1}, {`{"editor":{"fontSize":18}}`, 1},
		{`{"editor":{"blockGutterMode":0}}`, 0}, {`{"editor":{"blockGutterMode":99}}`, 0},
	} {
		code, message, data := settingContractRequest(t, "patch", patchSetting, entry.body)
		if code != 0 || model.Conf.Editor.Load().BlockGutterMode != entry.want {
			t.Fatalf("block gutter mode patch %s: code=%d message=%s data=%s", entry.body, code, message, data)
		}
	}
	code, message, _ := settingContractRequest(t, "setEditor", setEditor, `{"blockGutterMode":1}`)
	if code != 0 {
		t.Fatalf("full mode could not be saved: %d %s", code, message)
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
	if err = json.Unmarshal(data, &stored); err != nil || conf.NormalizeEditor(&stored.Editor).BlockGutterMode != 1 {
		t.Fatalf("full block gutter mode was not preserved in saved configuration: %v", err)
	}
}
