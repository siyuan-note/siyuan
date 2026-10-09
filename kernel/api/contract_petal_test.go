package api

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAPIContractPetalConversion(t *testing.T) {
	for _, value := range []*model.Petal{nil, {}, {Name: "plugin", Enabled: true, SettingsWindow: true, I18n: map[string]any{"nested": map[string]any{"label": "text"}, "array": []any{true, nil, 1.5}}, Kernel: model.KernelPetal{JS: "code", Existed: true}}} {
		result, err := petalContract(value)
		if err != nil {
			t.Fatal(err)
		}
		before, _ := json.Marshal(value)
		after, err := json.Marshal(result)
		if err != nil || string(before) != string(after) {
			t.Fatalf("plugin payload changed: %s != %s, %v", before, after, err)
		}
	}
}

func TestAPIContractPetalInvalidRequests(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/petal/loadPetals", loadPetals)
	engine.POST("/api/petal/setPetalEnabled", setPetalEnabled)
	engine.POST("/api/petal/setPetalPublishEnabled", setPetalPublishEnabled)
	for _, path := range []string{"/api/petal/loadPetals", "/api/petal/setPetalEnabled", "/api/petal/setPetalPublishEnabled"} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(`{}`)))
		requireAPIContract(t, "POST", path, recorder)
		if !strings.Contains(recorder.Body.String(), `"code":-1`) {
			t.Fatalf("missing required field accepted: %s", recorder.Body.String())
		}
	}
}

func TestAPIContractPetalSettingsWindow(t *testing.T) {
	originalConf, originalDataDir := model.Conf, util.DataDir
	model.Conf = model.NewAppConf()
	model.Conf.Sync = conf.NewSync()
	model.Conf.Bazaar = &conf.Bazaar{Trust: true}
	util.DataDir = t.TempDir()
	t.Cleanup(func() { model.Conf, util.DataDir = originalConf, originalDataDir })
	for _, name := range []string{"opted", "legacy"} {
		dir := filepath.Join(util.DataDir, "plugins", name)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		manifest, _ := json.Marshal(map[string]any{"name": name, "version": "1.0.0", "minAppVersion": "0.0.1", "settingsWindow": name == "opted"})
		if err := os.WriteFile(filepath.Join(dir, "plugin.json"), manifest, 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "index.js"), []byte("module.exports = class {};"), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := model.SetPetalEnabled(name, true); err != nil {
			t.Fatal(err)
		}
	}
	engine := gin.New()
	engine.POST("/api/petal/loadPetals", loadPetals)
	for _, item := range []struct {
		body  string
		count int
	}{
		{`{"frontend":"desktop"}`, 2},
		{`{"frontend":"desktop","settingsWindow":false}`, 2},
		{`{"frontend":"desktop","settingsWindow":true}`, 1},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/petal/loadPetals", strings.NewReader(item.body)))
		requireAPIContract(t, "POST", "/api/petal/loadPetals", recorder)
		var response struct {
			Code int            `json:"code"`
			Data []*model.Petal `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Code != 0 || len(response.Data) != item.count {
			t.Fatalf("unexpected plugin response: %s", recorder.Body.String())
		}
		if item.count == 1 && (response.Data[0].Name != "opted" || !response.Data[0].SettingsWindow) {
			t.Fatal("opt-in proof missing")
		}
	}
}
