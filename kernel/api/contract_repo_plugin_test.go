// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAPIContractPluginSnapshotValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/repo/getPluginSnapshots", getPluginSnapshots)
	engine.POST("/api/repo/restorePluginSnapshot", restorePluginSnapshot)
	for path, body := range map[string]string{
		"/api/repo/getPluginSnapshots":    `{"name":"../outside","page":1}`,
		"/api/repo/restorePluginSnapshot": `{"name":"example","id":"../outside"}`,
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest("POST", path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(response, request)
		requireAPIContract(t, "POST", path, response)
		if strings.Contains(response.Body.String(), `"code":0`) {
			t.Fatal(response.Body.String())
		}
	}
}
