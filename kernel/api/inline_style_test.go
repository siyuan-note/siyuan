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
	"reflect"
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
	engine.POST("/api/storage/setWorkspaceAVPalette", setWorkspaceAVPalette)

	getRecorder := performInlineStylesRequest(engine, "/api/storage/getInlineStyles", "")
	getResponse := &struct {
		Code int                 `json:"code"`
		Data *model.InlineStyles `json:"data"`
	}{}
	if err := json.Unmarshal(getRecorder.Body.Bytes(), getResponse); err != nil {
		t.Fatal(err)
	}
	if getResponse.Code != 0 || getResponse.Data == nil || getResponse.Data.Version != model.InlineStylesVersion ||
		getResponse.Data.Styles == nil || len(getResponse.Data.Styles) != 0 || getResponse.Data.Builtin == nil ||
		getResponse.Data.Builtin.Hidden == nil {
		t.Fatalf("unexpected initial inline styles response: %s", getRecorder.Body.String())
	}

	setRecorder := performInlineStylesRequest(engine, "/api/storage/setInlineStyles", `{
		"version":2,
		"app":"test-app",
		"styles":[{
			"name":" Accent ",
			"light":{"color":"#AABBCC"},
			"dark":{"color":"#112233"}
		}],
		"builtin":{
			"colors":[{
				"index":2,
				"light":{"backgroundColor":"#DDEEFF"},
				"dark":{"backgroundColor":"#445566"}
			}],
			"styles":[{
				"id":"error",
				"light":{"color":"#AABBCC","backgroundColor":"#DDEEFF"},
				"dark":{"color":"#112233","backgroundColor":"#445566"}
			}],
			"hidden":{"color":[3],"backgroundColor":[4],"style1":["error"],"av":[5]}
		}
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
		setResponse.Data.Styles[0].Light.Color != "#aabbcc" || len(setResponse.Data.Builtin.Colors) != 1 ||
		setResponse.Data.Builtin.Colors[0].Index != 2 || len(setResponse.Data.Builtin.Styles) != 1 ||
		len(setResponse.Data.Builtin.Hidden.AV) != 1 {
		t.Fatalf("unexpected set inline styles response: %s", setRecorder.Body.String())
	}

	legacyRecorder := performInlineStylesRequest(engine, "/api/storage/setInlineStyles", `{
		"version":1,
		"styles":[{
			"name":"Legacy client",
			"light":{"color":"#abcdef"},
			"dark":{"color":"#123456"}
		}],
		"builtin":{}
	}`)
	legacyResponse := &struct {
		Code int                 `json:"code"`
		Data *model.InlineStyles `json:"data"`
	}{}
	if err := json.Unmarshal(legacyRecorder.Body.Bytes(), legacyResponse); err != nil {
		t.Fatal(err)
	}
	if legacyResponse.Code != 0 || legacyResponse.Data == nil || legacyResponse.Data.Version != model.InlineStylesVersion ||
		len(legacyResponse.Data.Styles) != 1 || legacyResponse.Data.Styles[0].Name != "Legacy client" ||
		len(legacyResponse.Data.Builtin.Colors) != 1 || len(legacyResponse.Data.Builtin.Styles) != 1 ||
		len(legacyResponse.Data.Builtin.Hidden.AV) != 1 {
		t.Fatalf("version 1 update did not preserve builtin colors: %s", legacyRecorder.Body.String())
	}

	futureRecorder := performInlineStylesRequest(engine, "/api/storage/setInlineStyles", `{"version":3,"styles":[]}`)
	if responseCode(t, futureRecorder) != -1 || !strings.Contains(futureRecorder.Body.String(), "unsupported") {
		t.Fatalf("future inline styles version was accepted: %s", futureRecorder.Body.String())
	}
	styles, err := model.GetInlineStyles()
	if err != nil {
		t.Fatal(err)
	}
	if len(styles.Styles) != 1 || styles.Styles[0].ID != legacyResponse.Data.Styles[0].ID ||
		len(styles.Builtin.Colors) != 1 {
		t.Fatalf("future request overwrote inline styles: %#v", styles)
	}

	invalidBuiltinRecorder := performInlineStylesRequest(engine, "/api/storage/setInlineStyles",
		`{"version":2,"styles":[],"builtin":{"hidden":{"av":[15]}}}`)
	if responseCode(t, invalidBuiltinRecorder) != -1 {
		t.Fatalf("invalid builtin inline styles were accepted: %s", invalidBuiltinRecorder.Body.String())
	}

	missingVersionRecorder := performInlineStylesRequest(engine, "/api/storage/setInlineStyles", `{"styles":[]}`)
	if responseCode(t, missingVersionRecorder) != -1 || !strings.Contains(missingVersionRecorder.Body.String(), "version") {
		t.Fatalf("missing inline styles version was accepted: %s", missingVersionRecorder.Body.String())
	}

	paletteRecorder := performInlineStylesRequest(engine, "/api/storage/setWorkspaceAVPalette", `{
		"colors":[{
			"index":15,
			"light":{"color":"#010203","backgroundColor":"#040506"},
			"dark":{"color":"#070809","backgroundColor":"#0A0B0C"}
		}],
		"order":["15","1"],
		"builtinColors":[{
			"index":3,
			"customized":true,
			"light":{"backgroundColor":"#ABCDEF"},
			"dark":{"backgroundColor":"#123456"},
			"hidden":true
		}]
	}`)
	paletteResponse := &struct {
		Code int                 `json:"code"`
		Data *model.InlineStyles `json:"data"`
	}{}
	if err := json.Unmarshal(paletteRecorder.Body.Bytes(), paletteResponse); err != nil {
		t.Fatal(err)
	}
	if paletteResponse.Code != 0 || paletteResponse.Data == nil || len(paletteResponse.Data.Styles) != 1 ||
		len(paletteResponse.Data.AV.Colors) != 1 || paletteResponse.Data.AV.Order[0] != "15" ||
		len(paletteResponse.Data.Builtin.Colors) != 2 ||
		!reflect.DeepEqual(paletteResponse.Data.Builtin.Hidden.AV, []int{3, 5}) {
		t.Fatalf("unexpected workspace palette response: %s", paletteRecorder.Body.String())
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
	paletteRecorder := performInlineStylesRequest(engine, "/api/storage/setWorkspaceAVPalette", `{"colors":[],"order":[]}`)
	if paletteRecorder.Code != http.StatusForbidden {
		t.Fatalf("reader changed workspace palette: status=%d, body=%s", paletteRecorder.Code,
			paletteRecorder.Body.String())
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
