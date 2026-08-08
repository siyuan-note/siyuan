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
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPublishReaderSearchAndBacklinkEncryptedNotebook(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const boxID = "20260726000003-encrypt"
	oldConf, oldDataDir := model.Conf, util.DataDir
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.Editor = conf.NewEditor()
	t.Cleanup(func() {
		model.Conf, util.DataDir = oldConf, oldDataDir
	})

	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleReader)
		c.Next()
	})
	engine.POST("/api/search/fullTextSearchBlock", fullTextSearchBlock)
	engine.POST("/api/ref/getBacklink2", getBacklink2)

	t.Run("search", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(
			http.MethodPost,
			"/api/search/fullTextSearchBlock",
			strings.NewReader(`{"query":"secret","notebook":"`+boxID+`"}`),
		)
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)

		response := &struct {
			Code int `json:"code"`
			Data struct {
				Blocks            []any `json:"blocks"`
				MatchedBlockCount int   `json:"matchedBlockCount"`
				MatchedRootCount  int   `json:"matchedRootCount"`
				PageCount         int   `json:"pageCount"`
				DocMode           bool  `json:"docMode"`
			} `json:"data"`
		}{}
		if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
			t.Fatalf("unmarshal search response failed: %v", err)
		}
		if response.Code != 0 || len(response.Data.Blocks) != 0 || response.Data.MatchedBlockCount != 0 ||
			response.Data.MatchedRootCount != 0 || response.Data.PageCount != 0 || response.Data.DocMode {
			t.Fatalf("publish search exposed encrypted notebook metadata: %s", recorder.Body.String())
		}
	})

	t.Run("backlink", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(
			http.MethodPost,
			"/api/ref/getBacklink2",
			strings.NewReader(`{"id":"20260726000004-encrypt","k":"","mk":"","notebook":"`+boxID+`"}`),
		)
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)

		response := &struct {
			Code int `json:"code"`
			Data struct {
				Backlinks     []any  `json:"backlinks"`
				LinkRefsCount int    `json:"linkRefsCount"`
				Backmentions  []any  `json:"backmentions"`
				MentionsCount int    `json:"mentionsCount"`
				Box           string `json:"box"`
			} `json:"data"`
		}{}
		if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
			t.Fatalf("unmarshal backlink response failed: %v", err)
		}
		if response.Code != 0 || len(response.Data.Backlinks) != 0 || response.Data.LinkRefsCount != 0 ||
			len(response.Data.Backmentions) != 0 || response.Data.MentionsCount != 0 || response.Data.Box != "" {
			t.Fatalf("publish backlinks exposed encrypted notebook metadata: %s", recorder.Body.String())
		}
	})
}
