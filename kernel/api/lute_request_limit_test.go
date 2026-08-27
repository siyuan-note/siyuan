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
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestLimitHTML2BlockDOMRequestBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodPost, "/api/lute/html2BlockDOM", strings.NewReader("12345"))
	limitHTML2BlockDOMRequestBody(context, 4)

	_, err := io.ReadAll(context.Request.Body)
	var limitError *http.MaxBytesError
	if !errors.As(err, &limitError) || limitError.Limit != 4 {
		t.Fatalf("unexpected request body limit error: %v", err)
	}
}

func TestHTML2BlockDOMPreflightOmitsConvertedDOM(t *testing.T) {
	originalConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.System = &conf.System{}
	t.Cleanup(func() { model.Conf = originalConf })

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/lute/html2BlockDOM",
		strings.NewReader(`{"dom":"<p>kept</p>","preflight":true}`))
	context.Request.Header.Set("Content-Type", "application/json")

	html2BlockDOM(context)

	response := struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != 0 || response.Data["converted"] != true || response.Data["useHTML"] != true {
		t.Fatalf("unexpected preflight response: %s", recorder.Body.String())
	}
	if response.Data["normalizedHTML"] != "<p>kept</p>" {
		t.Fatalf("unexpected normalized HTML: %v", response.Data["normalizedHTML"])
	}
	if _, ok := response.Data["dom"]; ok {
		t.Fatalf("preflight response contains converted DOM: %s", recorder.Body.String())
	}
}
