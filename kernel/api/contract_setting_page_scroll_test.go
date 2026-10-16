package api

import (
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingPageScrollButtons(t *testing.T) {
	compareSettingConfig(t, apicontract.SetEditor, conf.NewEditor, []string{
		`{}`, `{"pageScrollButtons":true}`, `{"pageScrollButtons":false}`,
		`{"pageScrollButtons":null}`, `{"PageScrollButtons":true}`, `{"pageScrollButtons":"bad"}`,
	})
	previousConf, previousReadOnly, previousMarkdown := model.Conf, util.ReadOnly, util.MarkdownSettings.Load()
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	util.ReadOnly = true
	t.Cleanup(func() {
		model.Conf = previousConf
		util.ReadOnly = previousReadOnly
		util.MarkdownSettings.Store(previousMarkdown)
	})
	if model.Conf.Editor.Load().PageScrollButtons {
		t.Fatal("page scroll buttons must default to disabled")
	}
	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{"pageScrollButtons":true}`, true}, {`{}`, true}, {`{"pageScrollButtons":false}`, false},
		{`{"PageScrollButtons":true}`, true}, {`{"pageScrollButtons":null}`, false},
	} {
		code, message, data := settingContractRequest(t, "setEditor", setEditor, entry.body)
		var response apicontract.SettingEditor
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		if code != 0 || model.Conf.Editor.Load().PageScrollButtons != entry.want || response.PageScrollButtons != entry.want {
			t.Fatalf("page scroll buttons update %s: code=%d message=%s data=%s", entry.body, code, message, data)
		}
	}
}
