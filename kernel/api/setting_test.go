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
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
	model.Conf.Bazaar = &conf.Bazaar{Trust: true}
	bazaarPetalStateMu.Lock()
	bazaarPetalStateRevision = 0
	bazaarPetalStateMu.Unlock()
	t.Cleanup(func() {
		bazaarPetalStateMu.Lock()
		bazaarPetalStateRevision = 0
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
	if model.Conf.Bazaar.PetalDisabled {
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

func TestSetFiletreePreservesUseSVGDefaultIconWhenMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf := model.Conf
	previousReadOnly := util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() {
		model.Conf = previousConf
		util.ReadOnly = previousReadOnly
	})

	engine := gin.New()
	engine.POST("/api/setting/setFiletree", setFiletree)
	for _, test := range []struct {
		name    string
		enabled bool
	}{
		{name: "enabled", enabled: true},
		{name: "disabled"},
	} {
		t.Run(test.name, func(t *testing.T) {
			model.Conf = model.NewAppConf()
			model.Conf.FileTree = conf.NewFileTree()
			model.Conf.FileTree.UseSVGDefaultIcon = new(test.enabled)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/setting/setFiletree", strings.NewReader(`{}`))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int `json:"code"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal setFiletree response failed: %v", err)
			}
			if 0 != response.Code {
				t.Fatalf("setFiletree failed: %s", recorder.Body.String())
			}
			if nil == model.Conf.FileTree.UseSVGDefaultIcon ||
				test.enabled != *model.Conf.FileTree.UseSVGDefaultIcon {
				t.Fatalf("missing setting changed the current value: %#v", model.Conf.FileTree.UseSVGDefaultIcon)
			}
		})
	}
}
