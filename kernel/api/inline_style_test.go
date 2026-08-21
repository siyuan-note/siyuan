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
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestInlineStylesAPI(t *testing.T) {
	setupInlineStylesAPITest(t)
	gin.SetMode(gin.TestMode)

	engine := gin.New()
	engine.POST("/api/storage/getInlineStyles", getInlineStyles)
	engine.POST("/api/storage/setInlineStyles", setInlineStyles)

	getRecorder := performInlineStylesRequest(engine, "/api/storage/getInlineStyles", "")
	getResponse := &struct {
		Code int                 `json:"code"`
		Data *model.InlineStyles `json:"data"`
	}{}
	if err := json.Unmarshal(getRecorder.Body.Bytes(), getResponse); err != nil {
		t.Fatal(err)
	}
	if getResponse.Code != 0 || getResponse.Data == nil || getResponse.Data.Version != model.InlineStylesVersion ||
		getResponse.Data.Styles == nil || len(getResponse.Data.Styles) != 0 {
		t.Fatalf("unexpected initial inline styles response: %s", getRecorder.Body.String())
	}

	setRecorder := performInlineStylesRequest(engine, "/api/storage/setInlineStyles", `{
		"version":1,
		"styles":[{
			"name":" Accent ",
			"light":{"color":"#AABBCC"},
			"dark":{"color":"#112233"}
		}]
	}`)
	setResponse := &struct {
		Code int                 `json:"code"`
		Data *model.InlineStyles `json:"data"`
	}{}
	if err := json.Unmarshal(setRecorder.Body.Bytes(), setResponse); err != nil {
		t.Fatal(err)
	}
	if setResponse.Code != 0 || setResponse.Data == nil || len(setResponse.Data.Styles) != 1 ||
		setResponse.Data.Styles[0].ID == "" || setResponse.Data.Styles[0].Name != "Accent" ||
		setResponse.Data.Styles[0].Light.Color != "#aabbcc" {
		t.Fatalf("unexpected set inline styles response: %s", setRecorder.Body.String())
	}

	futureRecorder := performInlineStylesRequest(engine, "/api/storage/setInlineStyles", `{"version":2,"styles":[]}`)
	if responseCode(t, futureRecorder) != -1 || !strings.Contains(futureRecorder.Body.String(), "unsupported") {
		t.Fatalf("future inline styles version was accepted: %s", futureRecorder.Body.String())
	}
	styles, err := model.GetInlineStyles()
	if err != nil {
		t.Fatal(err)
	}
	if len(styles.Styles) != 1 || styles.Styles[0].ID != setResponse.Data.Styles[0].ID {
		t.Fatalf("future request overwrote inline styles: %#v", styles)
	}

	missingVersionRecorder := performInlineStylesRequest(engine, "/api/storage/setInlineStyles", `{"styles":[]}`)
	if responseCode(t, missingVersionRecorder) != -1 || !strings.Contains(missingVersionRecorder.Body.String(), "version") {
		t.Fatalf("missing inline styles version was accepted: %s", missingVersionRecorder.Body.String())
	}
}

func TestInlineStylesAPIPermissions(t *testing.T) {
	setupInlineStylesAPITest(t)
	gin.SetMode(gin.TestMode)

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleReader)
		c.Next()
	})
	ServeAPI(engine)

	getRecorder := performInlineStylesRequest(engine, "/api/storage/getInlineStyles", "")
	if getRecorder.Code != http.StatusOK || responseCode(t, getRecorder) != 0 {
		t.Fatalf("reader cannot get inline styles: %s", getRecorder.Body.String())
	}
	setRecorder := performInlineStylesRequest(engine, "/api/storage/setInlineStyles", `{"version":1,"styles":[]}`)
	if setRecorder.Code != http.StatusForbidden {
		t.Fatalf("reader changed inline styles: status=%d, body=%s", setRecorder.Code, setRecorder.Body.String())
	}
}

func performInlineStylesRequest(engine *gin.Engine, path, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	engine.ServeHTTP(recorder, request)
	return recorder
}

func setupInlineStylesAPITest(t *testing.T) {
	t.Helper()
	oldDataDir, oldConf, oldReadOnly := util.DataDir, model.Conf, util.ReadOnly
	util.DataDir, model.Conf, util.ReadOnly = t.TempDir(), model.NewAppConf(), false
	model.Conf.Sync = conf.NewSync()
	t.Cleanup(func() {
		util.DataDir, model.Conf, util.ReadOnly = oldDataDir, oldConf, oldReadOnly
	})
	if err := os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}
}
