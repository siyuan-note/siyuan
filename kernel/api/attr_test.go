// SiYuan - Refactor your thinking
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
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockAttrsRespectPublishAccess(t *testing.T) {
	const (
		boxID       = "20260724000000-boxid01"
		publicID    = "20260724000001-public1"
		protectedID = "20260724000002-secret1"
		publicValue = "public value"
		secret      = "sensitive value"
	)

	previousConf := model.Conf
	previousBlockTreeDBPath := util.BlockTreeDBPath
	previousDataDir := util.DataDir
	previousLangs := util.Langs
	model.Conf = model.NewAppConf()
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	util.Langs = map[string]map[int]string{
		"en": {15: "Block [%s] not found"},
	}
	treenode.InitBlockTree(true)
	previousPublishAccess := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{{ID: protectedID, Disable: true}}); err != nil {
		t.Fatalf("set publish access failed: %v", err)
	}
	t.Cleanup(func() {
		cache.RemoveBlockIAL(publicID)
		cache.RemoveBlockIAL(protectedID)
		_ = model.SetPublishAccess(previousPublishAccess)
		treenode.CloseDatabase()
		model.Conf = previousConf
		util.BlockTreeDBPath = previousBlockTreeDBPath
		util.DataDir = previousDataDir
		util.Langs = previousLangs
	})

	gin.SetMode(gin.TestMode)
	for _, id := range []string{publicID, protectedID} {
		treenode.IndexBlockTree(&parse.Tree{
			ID:   id,
			Box:  boxID,
			Path: "/" + id + ".sy",
			Root: &ast.Node{ID: id, Type: ast.NodeDocument},
		})
	}
	cache.PutBlockIAL(publicID, map[string]string{"custom-value": publicValue})
	cache.PutBlockIAL(protectedID, map[string]string{"custom-secret": secret})
	deadline := time.Now().Add(time.Second)
	for (cache.GetBlockIAL(publicID) == nil || cache.GetBlockIAL(protectedID) == nil) && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if cache.GetBlockIAL(publicID) == nil || cache.GetBlockIAL(protectedID) == nil {
		t.Fatal("block IAL cache was not populated")
	}

	protectedBody := `{"id":"` + protectedID + `"}`
	singleReader := postBlockAttrs(t, model.RoleReader, "/api/attr/getBlockAttrs", protectedBody, getBlockAttrs)
	if singleReader.Code != -1 || strings.Contains(string(singleReader.Data), secret) {
		t.Fatalf("reader received inaccessible block attributes: %+v", singleReader)
	}

	publicBody := `{"id":"` + publicID + `"}`
	publicReader := postBlockAttrs(t, model.RoleReader, "/api/attr/getBlockAttrs", publicBody, getBlockAttrs)
	var publicReaderAttrs map[string]string
	if err := json.Unmarshal(publicReader.Data, &publicReaderAttrs); err != nil {
		t.Fatalf("unmarshal public reader response failed: %v", err)
	}
	if publicReaderAttrs["custom-value"] != publicValue {
		t.Fatalf("reader did not receive public block attributes: %+v", publicReaderAttrs)
	}

	batchBody := `{"ids":["` + protectedID + `","` + publicID + `"]}`
	batchReader := postBlockAttrs(t, model.RoleReader, "/api/attr/batchGetBlockAttrs", batchBody, batchGetBlockAttrs)
	var readerAttrs map[string]map[string]string
	if err := json.Unmarshal(batchReader.Data, &readerAttrs); err != nil {
		t.Fatalf("unmarshal reader batch response failed: %v", err)
	}
	if _, ok := readerAttrs[protectedID]; ok {
		t.Fatalf("reader received inaccessible batch attributes: %+v", readerAttrs)
	}
	if readerAttrs[publicID]["custom-value"] != publicValue {
		t.Fatalf("reader did not receive public batch attributes: %+v", readerAttrs)
	}

	singleAdmin := postBlockAttrs(t, model.RoleAdministrator, "/api/attr/getBlockAttrs", protectedBody, getBlockAttrs)
	var adminAttrs map[string]string
	if err := json.Unmarshal(singleAdmin.Data, &adminAttrs); err != nil {
		t.Fatalf("unmarshal administrator response failed: %v", err)
	}
	if adminAttrs["custom-secret"] != secret {
		t.Fatalf("administrator did not receive block attributes: %+v", adminAttrs)
	}

	batchAdmin := postBlockAttrs(t, model.RoleAdministrator, "/api/attr/batchGetBlockAttrs", batchBody, batchGetBlockAttrs)
	var adminBatchAttrs map[string]map[string]string
	if err := json.Unmarshal(batchAdmin.Data, &adminBatchAttrs); err != nil {
		t.Fatalf("unmarshal administrator batch response failed: %v", err)
	}
	if adminBatchAttrs[protectedID]["custom-secret"] != secret ||
		adminBatchAttrs[publicID]["custom-value"] != publicValue {
		t.Fatalf("administrator did not receive batch block attributes: %+v", adminBatchAttrs)
	}
}

type blockAttrsResponse struct {
	Code int             `json:"code"`
	Data json.RawMessage `json:"data"`
}

func postBlockAttrs(t *testing.T, role model.Role, path, body string, handler gin.HandlerFunc) *blockAttrsResponse {
	t.Helper()

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, role)
		c.Next()
	})
	engine.POST(path, handler)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &blockAttrsResponse{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	return response
}
