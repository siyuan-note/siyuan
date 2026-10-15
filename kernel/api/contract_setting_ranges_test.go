package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingValueRanges(t *testing.T) {
	previous, readonly, lang := model.Conf, util.ReadOnly, util.Lang
	markdown, singleLine, largeFile := util.MarkdownSettings.Load(), util.UseSingleLineSave.Load(), util.LargeFileWarningSize.Load()
	statusBar, notifications := util.StatusBarCfg.Load(), util.NotificationsCfg.Load()
	t.Cleanup(func() {
		model.Conf, util.ReadOnly, util.Lang = previous, readonly, lang
		util.MarkdownSettings.Store(markdown)
		util.UseSingleLineSave.Store(singleLine)
		util.LargeFileWarningSize.Store(largeFile)
		util.StatusBarCfg.Store(statusBar)
		util.NotificationsCfg.Store(notifications)
		if previous != nil && previous.Search.Load() != nil {
			model.ApplySearchRuntime()
		}
	})
	util.ReadOnly = true
	for _, entry := range []struct {
		namespace, route string
		handler          gin.HandlerFunc
		payload          string
		want             map[string]float64
	}{
		{"editor", "setEditor", setEditor,
			`{"backlinkGlobalSort":7,"backlinkBlockSort":-9,"floatWindowMode":42,"headingEmbedMode":-3,"databaseAttrClickMode":99,"databaseAttrViewMode":-1,"codeTabSpaces":5,"fontSize":18}`,
			map[string]float64{"backlinkGlobalSort": 0, "backlinkBlockSort": 0, "floatWindowMode": 0, "headingEmbedMode": 0,
				"databaseAttrClickMode": 0, "databaseAttrViewMode": 0, "codeTabSpaces": 0, "fontSize": 18}},
		{"export", "setExport", setExport, `{"blockEmbedMode":9,"fileAnnotationRefMode":-5,"blockRefMode":3}`,
			map[string]float64{"blockEmbedMode": 1, "fileAnnotationRefMode": 0, "blockRefMode": 3}},
		{"fileTree", "setFiletree", setFiletree, `{"maxListCount":1000000,"largeFileWarningSize":1000000}`,
			map[string]float64{"maxListCount": 10240, "largeFileWarningSize": 10240}},
		{"search", "setSearch", setSearch, `{"limit":1000000}`, map[string]float64{"limit": 10240}},
		{"flashcard", "setFlashcard", setFlashcard, `{"reviewMode":7}`, map[string]float64{"reviewMode": 0}},
		{"ai", "setAI", setAI, `{"agent":{"maxToolCallRounds":-7,"confirmTimeout":-9,"temperature":-3,"maxCompletionTokens":-2}}`,
			map[string]float64{"agent.maxToolCallRounds": 0, "agent.confirmTimeout": 600, "agent.temperature": 1, "agent.maxCompletionTokens": 0}},
		{"system", "", nil, `{"autoLaunch2":9,"lockScreenMode":3}`, map[string]float64{"autoLaunch2": 0, "lockScreenMode": 0}},
		{"repo", "", nil, `{"indexRetentionDays":100000}`, map[string]float64{"indexRetentionDays": 100000}},
	} {
		for _, patch := range []bool{false, true} {
			route, handler, body := entry.route, entry.handler, entry.payload
			if patch {
				route, handler = "patch", patchSetting
				body = `{"` + entry.namespace + `":` + body + `}`
			} else if handler == nil {
				continue
			}
			t.Run(entry.namespace+"/"+route, func(t *testing.T) {
				model.Conf = model.NewAppConf()
				model.NormalizeAppConf(model.Conf)
				code, message, _ := settingContractRequest(t, route, handler, body)
				if code != 0 {
					t.Fatalf("setting failed: %d %s", code, message)
				}
				data, err := json.Marshal(model.Conf)
				if err != nil {
					t.Fatal(err)
				}
				var actual map[string]any
				if err = json.Unmarshal(data, &actual); err != nil {
					t.Fatal(err)
				}
				for field, want := range entry.want {
					value := actual[entry.namespace]
					for _, key := range strings.Split(field, ".") {
						value = value.(map[string]any)[key]
					}
					if value != want {
						t.Errorf("%s.%s: got %v, want %v", entry.namespace, field, value, want)
					}
				}
			})
		}
	}
}

func TestAPIContractSettingPatchRejectsInvalidAssetDownloadMode(t *testing.T) {
	previous, readonly := model.Conf, util.ReadOnly
	t.Cleanup(func() { model.Conf, util.ReadOnly = previous, readonly })
	model.Conf = model.NewAppConf()
	model.NormalizeAppConf(model.Conf)
	util.ReadOnly = true
	before := model.Conf.Sync.Load()
	revision := model.ConfNamespaceRevision("sync")
	code, message, _ := settingContractRequest(t, "patch", patchSetting, `{"sync":{"assetDownloadMode":7}}`)
	if code == 0 || message != "invalid asset download mode" || model.Conf.Sync.Load() != before ||
		model.ConfNamespaceRevision("sync") != revision {
		t.Fatalf("invalid mode was accepted or modified configuration: %d %s", code, message)
	}
}
