// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestSpinBlockDOMAuthorization(t *testing.T) {
	gin.SetMode(gin.TestMode)

	previousConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(&conf.Editor{})
	model.Conf.Export.Store(&conf.Export{})
	t.Cleanup(func() {
		model.Conf = previousConf
	})

	body, err := json.Marshal(map[string]string{"dom": `<div data-node-id="20240101000000-abcdefg"><p>test</p></div>`})
	if err != nil {
		t.Fatal(err)
	}

	roles := []struct {
		name       string
		role       model.Role
		statusCode int
	}{
		{name: "administrator", role: model.RoleAdministrator, statusCode: http.StatusOK},
		{name: "editor", role: model.RoleEditor, statusCode: http.StatusForbidden},
		{name: "reader", role: model.RoleReader, statusCode: http.StatusForbidden},
	}
	for _, role := range roles {
		t.Run(role.name, func(t *testing.T) {
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				c.Set(model.RoleContextKey, role.role)
				c.Next()
			})
			ServeAPI(engine)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/lute/spinBlockDOM", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			if recorder.Code != role.statusCode {
				t.Fatalf("unexpected status code: got %d, want %d", recorder.Code, role.statusCode)
			}
			if role.role != model.RoleAdministrator {
				return
			}

			response := &struct {
				Code int `json:"code"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatal(err)
			}
			if response.Code != 0 {
				t.Fatalf("unexpected response code: got %d, want 0", response.Code)
			}
		})
	}
}

func TestSpinBlockDOMInputSizeLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)

	previousConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(&conf.Editor{})
	model.Conf.Export.Store(&conf.Export{})
	t.Cleanup(func() {
		model.Conf = previousConf
	})

	body, err := json.Marshal(map[string]string{"dom": strings.Repeat("<div>", maxSpinBlockDOMBytes/6+1) + strings.Repeat("</div>", maxSpinBlockDOMBytes/6+1)})
	if err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	ServeAPI(engine)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/lute/spinBlockDOM", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status code: got %d, want %d", recorder.Code, http.StatusOK)
	}

	response := &struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("unexpected response code: got %d, want %d", response.Code, http.StatusRequestEntityTooLarge)
	}
	const expectedMessage = "dom input exceeds the maximum permitted size"
	if response.Msg != expectedMessage {
		t.Fatalf("unexpected response message: got %q, want %q", response.Msg, expectedMessage)
	}
}
