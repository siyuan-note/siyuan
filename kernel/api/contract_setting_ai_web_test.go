package api

import (
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingAIWeb(t *testing.T) {
	previous, readonly, confDir := model.Conf, util.ReadOnly, util.ConfDir
	t.Cleanup(func() { model.Conf, util.ReadOnly, util.ConfDir = previous, readonly, confDir })
	util.ReadOnly, util.ConfDir = true, t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.AI.Store(conf.NewAI())
	code, message, data := settingContractRequest(t, "setAI", setAI,
		`{"web":{"searchProvider":"deepseek","fetchProvider":"direct","apiKey":"test-key","timeout":900}}`)
	if code != 0 {
		t.Fatal(message)
	}
	var result apicontract.SettingAI
	if err := json.Unmarshal(data, &result); err != nil || result.Web == nil || result.Web.Timeout != 600 ||
		result.Web.SearchProvider != "deepseek" || result.Web.FetchProvider != "direct" || result.Web.APIKey != "test-key" {
		t.Fatalf("web settings response did not retain independent providers: %s %v", data, err)
	}
	before := model.Conf.AI.Load().Web
	code, message, _ = settingContractRequest(t, "setAI", setAI, `{"agent":{"maxRetries":2}}`)
	web := model.Conf.AI.Load().Web
	if code != 0 || *web != *before || web == before {
		t.Fatalf("merge lost or aliased web settings: %s", message)
	}
	code, message, _ = settingContractRequest(t, "patch", patchSetting, `{"ai":{"web":{"fetchProvider":"deepseek"}}}`)
	web = model.Conf.AI.Load().Web
	if code != 0 || web.FetchProvider != "deepseek" || web.SearchProvider != "deepseek" || web.APIKey != "test-key" || web.Timeout != 600 {
		t.Fatalf("partial web setting save lost another field: %s", message)
	}
	code, message, _ = settingContractRequest(t, "patch", patchSetting, `{"ai":{"web":{"apiKey":"","searchProvider":"exa"}}}`)
	web = model.Conf.AI.Load().Web
	if code != 0 || web.APIKey != "" || web.SearchProvider != "exa" || web.FetchProvider != "deepseek" {
		t.Fatalf("explicit key clearing or independent provider switch failed: %s", message)
	}
}
