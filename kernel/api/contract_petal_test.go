// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
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
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.Bazaar.Store(&conf.Bazaar{Trust: true})
	util.DataDir = testutil.PublicDataDir(t)
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
		if err := os.WriteFile(filepath.Join(dir, "index.js"), []byte("module.exports = class {};/*"+strings.Repeat("x", 64*1024)+"*/"), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := model.SetPetalEnabled(name, true); err != nil {
			t.Fatal(err)
		}
	}
	engine := gin.New()
	engine.POST("/api/petal/loadPetals", loadPetals)
	var fullBytes, selectedBytes int
	for _, item := range []struct {
		body     string
		names    []string
		settings bool
	}{
		{`{"frontend":"desktop"}`, []string{"legacy", "opted"}, false},
		{`{"frontend":"desktop","settingsWindow":false}`, []string{"legacy", "opted"}, false},
		{`{"frontend":"desktop","settingsWindow":true}`, []string{"opted"}, true},
		{`{"frontend":"desktop","names":null}`, []string{"legacy", "opted"}, false},
		{`{"frontend":"desktop","names":[]}`, nil, false},
		{`{"frontend":"desktop","names":["legacy"]}`, []string{"legacy"}, false},
		{`{"frontend":"desktop","names":["opted","opted","missing"]}`, []string{"opted"}, false},
		{`{"frontend":"desktop","names":["../opted","","Opted"," opted"]}`, nil, false},
		{`{"frontend":"desktop","settingsWindow":true,"names":["legacy"]}`, nil, true},
		{`{"frontend":"desktop","settingsWindow":true,"names":[]}`, nil, true},
		{`{"frontend":"desktop","settingsWindow":true,"names":null}`, []string{"opted"}, true},
		{`{"frontend":"desktop","settingsWindow":true,"names":["opted","legacy"]}`, []string{"opted"}, true},
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
		names := make([]string, 0, len(response.Data))
		for _, petal := range response.Data {
			names = append(names, petal.Name)
			if petal.SettingsWindow != item.settings {
				t.Fatalf("unexpected settings opt-in proof: %s", recorder.Body.String())
			}
		}
		slices.Sort(names)
		if response.Code != 0 || response.Data == nil || !slices.Equal(names, item.names) {
			t.Fatalf("unexpected plugin response for %s: code=%d names=%v", item.body, response.Code, names)
		}
		switch item.body {
		case `{"frontend":"desktop"}`:
			fullBytes = recorder.Body.Len()
		case `{"frontend":"desktop","names":["legacy"]}`:
			selectedBytes = recorder.Body.Len()
		}
	}
	if selectedBytes == 0 || selectedBytes*4 >= fullBytes*3 {
		t.Fatalf("single-plugin payload did not shrink: full=%d selected=%d bytes", fullBytes, selectedBytes)
	}
	t.Logf("synthetic uncompressed HTTP JSON, two 64 KiB plugins: full=%d selected=%d bytes (%.2f%%)",
		fullBytes, selectedBytes, 100*float64(selectedBytes)/float64(fullBytes))
}

func TestAPIContractPetalInvalidNames(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/petal/loadPetals", loadPetals)
	for _, names := range []string{`"opted"`, `true`, `1`, `{}`, `[null]`, `[1]`, `[true]`, `[["opted"]]`, `["opted",{}]`} {
		t.Run(names, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			body := `{"frontend":"desktop","names":` + names + `}`
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/petal/loadPetals", strings.NewReader(body)))
			requireAPIContract(t, "POST", "/api/petal/loadPetals", recorder)
			var response struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Code != -1 {
				t.Fatalf("invalid names accepted: %s", recorder.Body.String())
			}
		})
	}
}
