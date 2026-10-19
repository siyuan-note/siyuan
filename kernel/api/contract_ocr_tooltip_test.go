package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractOCRTooltipPreferences(t *testing.T) {
	setupAssetContractWorkspace(t)
	previousConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = previousConfDir })
	engine := gin.New()
	engine.POST("/api/asset/getOCRConfig", getOCRConfig)
	engine.POST("/api/asset/setOCRConfig", setOCRConfig)
	engine.POST("/api/setting/patch", patchSetting)
	var initial apicontract.OCRConfigData
	if requestOCRProvider(t, engine, "/api/asset/getOCRConfig", `{}`, &initial) != 0 ||
		initial.Config.ShowText == nil || !*initial.Config.ShowText ||
		initial.Config.ShowEmpty || initial.Config.ShowError {
		t.Fatalf("tooltip defaults: %+v", initial.Config)
	}
	const path = "assets/tooltip-preferences.png"
	util.SetAssetText(path, "preserved text")
	t.Cleanup(func() { util.RemoveAssetText(path) })
	for _, test := range []struct {
		body                           string
		showText, showEmpty, showError bool
	}{
		{`{"provider":"tesseract","model":"tiny","auto":false,"showText":false,"showEmpty":true,"showError":true}`, false, true, true},
		// 省略的悬浮提示设置保持当前值
		{`{"provider":"tesseract","model":"tiny","auto":true}`, false, true, true},
		// null 表示回到默认值
		{`{"provider":"tesseract","model":"tiny","auto":false,"showText":null,"showEmpty":null,"showError":null}`, true, false, false},
	} {
		var response apicontract.SettingOCR
		if requestOCRProvider(t, engine, "/api/asset/setOCRConfig", test.body, &response) != 0 ||
			response.ShowText == nil || *response.ShowText != test.showText ||
			response.ShowEmpty != test.showEmpty || response.ShowError != test.showError {
			t.Fatalf("tooltip setting compatibility: %s: %+v", test.body, response)
		}
		if util.GetAssetText(path) != "preserved text" {
			t.Fatal("tooltip settings changed saved text")
		}
		data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
		var saved struct{ OCR conf.OCR }
		if err != nil || json.Unmarshal(data, &saved) != nil || saved.OCR.ShowText == nil ||
			*saved.OCR.ShowText != test.showText || saved.OCR.ShowEmpty != test.showEmpty || saved.OCR.ShowError != test.showError {
			t.Fatalf("tooltip preferences were not persisted: %+v, %v", saved.OCR, err)
		}
	}
	if requestOCRProvider(t, engine, "/api/setting/patch", `{"ocr":{"showText":true,"showEmpty":false}}`, nil) != 0 {
		t.Fatal("tooltip preferences could not be patched")
	}
	value := model.Conf.GetOCR()
	if value.ShowText == nil || !*value.ShowText || value.ShowEmpty || value.ShowError || value.Auto {
		t.Fatalf("partial patch changed independent fields: %+v", value)
	}
}
