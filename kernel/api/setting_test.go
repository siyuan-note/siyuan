// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSetAIRejectsInvalidProviderHeaders(t *testing.T) {
	previousConf := model.Conf
	model.Conf = &model.AppConf{AI: model.NewConfSection(&conf.AI{})}
	t.Cleanup(func() { model.Conf = previousConf })
	initialAI := model.Conf.AI.Load()
	for _, headers := range []string{
		`{"Bad Name":"private-value"}`, `{"X-Key":"private-value\r\ninjected: yes"}`, `{"X-Key":"a","x-key":"b"}`,
	} {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPost, "/api/setting/setAI",
			strings.NewReader(`{"providers":[{"baseURL":"https://example.com","headers":`+headers+`}]}`))
		context.Request.Header.Set("Content-Type", "application/json")
		setAI(context)
		var result struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Code != -1 || model.Conf.AI.Load() != initialAI || strings.Contains(recorder.Body.String(), "private-value") {
			t.Fatal("invalid provider headers must be rejected without changing configuration or exposing values")
		}
	}
}

func TestSetEditorNullRestoresDefault(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf, previousReadOnly, previousMarkdown := model.Conf, util.ReadOnly, util.MarkdownSettings.Load()
	util.ReadOnly = true
	t.Cleanup(func() {
		model.Conf, util.ReadOnly = previousConf, previousReadOnly
		util.MarkdownSettings.Store(previousMarkdown)
	})
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Editor.Load().DisplayBookmarkIcon = false
	model.Conf.Editor.Load().Emoji = []string{"1f600"}

	code, message, _ := settingContractRequest(t, "setEditor", setEditor, `{"displayBookmarkIcon":null,"emoji":null}`)
	if code != 0 {
		t.Fatalf("save failed: %s", message)
	}
	editor := model.Conf.Editor.Load()
	if !editor.DisplayBookmarkIcon || !reflect.DeepEqual(editor.Emoji, conf.NewEditor().Emoji) {
		t.Fatalf("null did not restore editor defaults: %+v", editor)
	}
}

func TestAPIContractSettingEditorLegacyFont(t *testing.T) {
	for _, route := range []struct {
		name    string
		handler gin.HandlerFunc
	}{{"setEditor", setEditor}, {"patch", patchSetting}} {
		for _, test := range []struct {
			name    string
			body    string
			family  string
			weight  int
			count   int
			display string
		}{
			{"change font", `{"fontFamily":"Verdana","fontWeight":600}`, "Verdana", 600, 1, ""},
			{"change weight", `{"fontWeight":600}`, "Arial", 600, 1, ""},
			{"case-insensitive fields", `{"FontFamily":"Verdana","FontWeight":600}`, "Verdana", 600, 1, ""},
			{"unchanged primary keeps fallbacks", `{"fontFamily":"Arial","fontWeight":400}`, "Arial", 400, 2, "Arial Regular"},
			{"unrelated field keeps fallbacks", `{"fontSize":18}`, "Arial", 400, 2, "Arial Regular"},
			{"explicit list wins", `{"fontFamily":"Verdana","fontWeight":600,"fontFamilies":[{"family":"Georgia","weight":500}]}`, "Georgia", 500, 1, ""},
			{"case-insensitive list wins", `{"fontFamily":"Verdana","FontFamilies":[{"family":"Georgia","weight":500}]}`, "Georgia", 500, 1, ""},
			{"null legacy font resets", `{"fontFamily":null}`, "", 400, 0, ""},
			{"null font list rebuilds", `{"fontFamily":"Verdana","fontFamilies":null}`, "Verdana", 400, 1, ""},
			{"explicit legacy display", `{"fontFamily":"Verdana","fontFamilyDisplay":"Verdana Regular"}`, "Verdana", 400, 1, "Verdana Regular"},
		} {
			t.Run(route.name+"/"+test.name, func(t *testing.T) {
				previousConf, previousReadOnly, previousMarkdown := model.Conf, util.ReadOnly, util.MarkdownSettings.Load()
				util.ReadOnly = true
				t.Cleanup(func() {
					model.Conf, util.ReadOnly = previousConf, previousReadOnly
					util.MarkdownSettings.Store(previousMarkdown)
				})
				model.Conf = model.NewAppConf()
				editor := conf.NewEditor()
				editor.FontFamilies = []*conf.EditorFont{{Family: "Arial", Weight: 400, DisplayName: "Arial Regular"}, {Family: "serif", Weight: 400}}
				editor.CodeFontFamilies = []*conf.EditorFont{{Family: "monospace", Weight: 400}}
				editor.NormalizeFontFamilies()
				model.Conf.Editor.Store(editor)
				body := test.body
				if test.name == "change weight" && route.name == "setEditor" {
					body = `{"fontWeight":600.0}`
				}
				if route.name == "patch" {
					body = `{"editor":` + body + `}`
				}
				code, message, _ := settingContractRequest(t, route.name, route.handler, body)
				editor = model.Conf.Editor.Load()
				if code != 0 || editor.FontFamily != test.family || editor.FontWeight != test.weight || len(editor.FontFamilies) != test.count {
					t.Fatalf("font write failed: %s (%+v)", message, editor)
				}
				if editor.FontFamilyDisplay != test.display {
					t.Fatalf("font display name did not follow the font: %q", editor.FontFamilyDisplay)
				}
				if len(editor.CodeFontFamilies) != 1 || editor.CodeFontFamilies[0].Family != "monospace" {
					t.Fatal("legacy font write changed the code font list")
				}
			})
		}
	}
}

func TestSetBazaarPetalDisabledSerializesTransitions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf := model.Conf
	previousReadOnly := util.ReadOnly
	previousDataDir := util.DataDir
	previousStart := model.OnKernelPluginsStart
	previousStop := model.OnKernelPluginsStop
	util.ReadOnly = true
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.Bazaar.Store(&conf.Bazaar{Trust: true})
	bazaarPetalStateMu.Lock()
	model.BazaarPetalStateRevision.Store(0)
	bazaarPetalStateMu.Unlock()
	t.Cleanup(func() {
		bazaarPetalStateMu.Lock()
		model.BazaarPetalStateRevision.Store(0)
		bazaarPetalStateMu.Unlock()
		model.Conf = previousConf
		util.ReadOnly = previousReadOnly
		util.DataDir = previousDataDir
		model.OnKernelPluginsStart = previousStart
		model.OnKernelPluginsStop = previousStop
	})

	stopEntered := make(chan struct{})
	releaseStop := make(chan struct{})
	startCalled := make(chan struct{})
	var transitionMu sync.Mutex
	transitions := []string{}
	model.OnKernelPluginsStop = func() {
		transitionMu.Lock()
		transitions = append(transitions, "stop")
		transitionMu.Unlock()
		close(stopEntered)
		<-releaseStop
	}
	model.OnKernelPluginsStart = func() {
		transitionMu.Lock()
		transitions = append(transitions, "start")
		transitionMu.Unlock()
		close(startCalled)
	}

	engine := gin.New()
	engine.POST("/api/setting/setBazaarPetalDisabled", setBazaarPetalDisabled)
	type response struct {
		Code int `json:"code"`
		Data struct {
			Enabled       bool   `json:"globalPetalEnabled"`
			PetalDisabled bool   `json:"globalPetalDisabled"`
			Revision      uint64 `json:"globalPetalRevision"`
			Changed       bool   `json:"globalPetalChanged"`
		} `json:"data"`
	}
	request := func(body string) (*httptest.ResponseRecorder, response) {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/setting/setBazaarPetalDisabled", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, req)
		result := response{}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Errorf("unmarshal setBazaarPetalDisabled response failed: %v", err)
		}
		return recorder, result
	}

	disableResult := make(chan response, 1)
	go func() {
		_, result := request(`{"petalDisabled":true}`)
		disableResult <- result
	}()
	<-stopEntered

	enableResult := make(chan response, 1)
	go func() {
		_, result := request(`{"petalDisabled":false}`)
		enableResult <- result
	}()
	select {
	case <-startCalled:
		t.Fatal("enable transition started before the preceding disable transition completed")
	case <-time.After(20 * time.Millisecond):
	}
	close(releaseStop)

	disabled := <-disableResult
	enabled := <-enableResult
	if disabled.Code != 0 || !disabled.Data.Changed || !disabled.Data.PetalDisabled || disabled.Data.Enabled ||
		disabled.Data.Revision != 1 {
		t.Fatalf("unexpected disabled response: %#v", disabled)
	}
	if enabled.Code != 0 || !enabled.Data.Changed || enabled.Data.PetalDisabled || !enabled.Data.Enabled ||
		enabled.Data.Revision != 2 {
		t.Fatalf("unexpected enabled response: %#v", enabled)
	}
	if model.Conf.Bazaar.Load().PetalDisabled {
		t.Fatal("final bazaar plugin state is disabled")
	}
	_, unchanged := request(`{"petalDisabled":false}`)
	if unchanged.Code != 0 || unchanged.Data.Changed || unchanged.Data.PetalDisabled || !unchanged.Data.Enabled ||
		unchanged.Data.Revision != 2 {
		t.Fatalf("unexpected unchanged response: %#v", unchanged)
	}
	transitionMu.Lock()
	defer transitionMu.Unlock()
	if len(transitions) != 2 || transitions[0] != "stop" || transitions[1] != "start" {
		t.Fatalf("unexpected transition order: %v", transitions)
	}
}

func TestSetFiletreeMergeAndNull(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf, previousReadOnly := model.Conf, util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() { model.Conf, util.ReadOnly = previousConf, previousReadOnly })

	engine := gin.New()
	engine.POST("/api/setting/setFiletree", setFiletree)
	engine.POST("/api/setting/patch", patchSetting)
	for _, test := range []struct {
		name string
		path string
		body string
		want conf.FileTree
	}{
		// 未提交的字段保持当前配置
		{
			name: "omitted keeps current",
			path: "/api/setting/setFiletree",
			body: `{}`,
			want: conf.FileTree{BoxDocEnabled: true, UseSVGDefaultIcon: false, UseSingleLineSave: false, Sort: 3},
		},
		{
			name: "explicit values",
			path: "/api/setting/setFiletree",
			body: `{"boxDocEnabled":false,"useSVGDefaultIcon":true}`,
			want: conf.FileTree{UseSVGDefaultIcon: true, UseSingleLineSave: false, Sort: 3},
		},
		// null 还原构造函数默认值，而不是零值
		{
			name: "null restores defaults",
			path: "/api/setting/setFiletree",
			body: `{"useSingleLineSave":null,"sort":null}`,
			want: conf.FileTree{BoxDocEnabled: true, UseSVGDefaultIcon: false,
				UseSingleLineSave: util.DefaultUseSingleLineSave, Sort: util.SortModeCustom},
		},
		{
			name: "patch null restores defaults",
			path: "/api/setting/patch",
			body: `{"fileTree":{"useSingleLineSave":null,"sort":null}}`,
			want: conf.FileTree{BoxDocEnabled: true, UseSVGDefaultIcon: false,
				UseSingleLineSave: util.DefaultUseSingleLineSave, Sort: util.SortModeCustom},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			model.Conf = model.NewAppConf()
			model.Conf.FileTree.Store(conf.NewFileTree())
			model.Conf.FileTree.Load().BoxDocEnabled = true
			model.Conf.FileTree.Load().UseSVGDefaultIcon = false
			model.Conf.FileTree.Load().UseSingleLineSave = false
			model.Conf.FileTree.Load().Sort = 3

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)
			var response struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
				t.Fatalf("setting failed: %s (%v)", recorder.Body.String(), err)
			}
			got := model.Conf.FileTree.Load()
			if got.BoxDocEnabled != test.want.BoxDocEnabled || got.UseSVGDefaultIcon != test.want.UseSVGDefaultIcon ||
				got.UseSingleLineSave != test.want.UseSingleLineSave || got.Sort != test.want.Sort {
				t.Fatalf("unexpected file tree settings: %+v", got)
			}
		})
	}
}
