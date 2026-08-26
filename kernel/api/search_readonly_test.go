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
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// SQL 搜索模式在只读模式下必须被拦截，与 /api/query/sql 保持一致
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-4qwm-3p58-vh67
func TestFullTextSearchBlockSQLModeReadonly(t *testing.T) {
	gin.SetMode(gin.TestMode)

	previousReadOnly := util.ReadOnly
	previousConf := model.Conf
	util.ReadOnly = true
	model.Conf = &model.AppConf{Lang: "en"}
	defer func() {
		util.ReadOnly = previousReadOnly
		model.Conf = previousConf
	}()

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	payload := `{"query":"SELECT * FROM blocks LIMIT 1","method":2,"types":{},"subTypes":{},"paths":[],"groupBy":0,"orderBy":0,"page":1,"pageSize":1}`
	c.Request = httptest.NewRequest(http.MethodPost, "/api/search/fullTextSearchBlock", strings.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(model.RoleContextKey, model.RoleAdministrator)
	fullTextSearchBlock(c)

	response := &struct {
		Code int `json:"code"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	if response.Code != -1 {
		t.Fatalf("SQL search in readonly mode returned code %d: %s", response.Code, recorder.Body.String())
	}
}
