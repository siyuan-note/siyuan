// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestBacklinkDatabaseFilterContractMapping(t *testing.T) {
	request, err := apicontract.GetBacklinkDoc.Decode(strings.NewReader(`{"defID":"","refTreeID":"","keyword":"","sourceFilter":{"database":{"avID":"20261022130000-databas","filters":[{"combination":"or","filters":[{"column":"status","operator":"=","value":{"type":"text","text":{"content":"open"}}}]}]}}}`))
	if err != nil {
		t.Fatal(err)
	}
	filter := backlinkSourceFilterModel(request.SourceFilter)
	if filter == nil || filter.Database == nil || filter.Database.AvID != "20261022130000-databas" ||
		filter.Database.Filters[0].Filters[0].Value.Text.Content != "open" {
		t.Fatalf("database condition mapping failed: %+v", filter)
	}
}

func TestBacklinkDatabasePublishReaderContract(t *testing.T) {
	oldConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	t.Cleanup(func() { model.Conf = oldConf })
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader); c.Next() })
	engine.POST("/api/ref/getBacklinkDatabases", getBacklinkDatabases)
	engine.POST("/api/ref/getBacklink2", getBacklink2)
	for _, route := range []string{"getBacklinkDatabases", "getBacklink2"} {
		t.Run(route, func(t *testing.T) {
			path := "/api/ref/" + route
			recorder := httptest.NewRecorder()
			body := `{"id":"20261022130000-topic00","k":"","mk":"","sourceFilter":{"database":{"avID":"20261022130001-private","filters":[]}}}`
			request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)
			requireAPIContract(t, "POST", path, recorder)
			var response struct {
				Code int             `json:"code"`
				Data json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if route == "getBacklinkDatabases" {
				if response.Code != 0 || string(response.Data) != "[]" {
					t.Fatalf("database metadata exposed: %s", recorder.Body.String())
				}
			} else if response.Code == 0 {
				t.Fatal("private database fields were available for published-reader filtering")
			}
		})
	}
}
