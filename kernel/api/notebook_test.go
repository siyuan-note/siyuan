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
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestListNotebooksSortsBySubDocCount(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldConf, oldDataDir := model.Conf, util.DataDir
	oldPublishAccess := model.GetPublishAccess()
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.FileTree = conf.NewFileTree()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	*model.Conf.FileTree.BoxDocEnabled = true
	t.Cleanup(func() {
		if err := model.SetPublishAccess(oldPublishAccess); err != nil {
			t.Errorf("restore publish access failed: %v", err)
		}
		model.Conf, util.DataDir = oldConf, oldDataDir
	})
	if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
		t.Fatal(err)
	}

	boxIDs := []string{
		"20260812000000-box0001",
		"20260812000001-box0002",
		"20260812000002-box0003",
		"20260812000003-box0004",
		"20260812000004-box0005",
	}
	childCounts := []int{4, 3, 1, 0, 1}
	childIDs := map[string][]string{}
	for i, boxID := range boxIDs {
		childIDs[boxID] = writeNotebookSortFixture(t, boxID, childCounts[i], i)
	}

	tests := []struct {
		name     string
		sortMode int
		expected []string
	}{
		{
			name:     "ascending",
			sortMode: util.SortModeSubDocCountASC,
			expected: []string{boxIDs[3], boxIDs[2], boxIDs[4], boxIDs[1], boxIDs[0]},
		},
		{
			name:     "descending",
			sortMode: util.SortModeSubDocCountDESC,
			expected: []string{boxIDs[0], boxIDs[1], boxIDs[2], boxIDs[4], boxIDs[3]},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			model.Conf.FileTree.Sort = test.sortMode
			notebooks := requestNotebookList(t, model.RoleAdministrator)
			if actual := notebookIDs(notebooks); !slices.Equal(actual, test.expected) {
				t.Fatalf("unexpected notebook order: %v", actual)
			}
		})
	}

	publishAccess := model.PublishAccess{}
	for _, childID := range childIDs[boxIDs[0]] {
		publishAccess = append(publishAccess, &model.PublishAccessItem{ID: childID, Visible: false})
	}
	if err := model.SetPublishAccess(publishAccess); err != nil {
		t.Fatal(err)
	}
	model.Conf.FileTree.Sort = util.SortModeSubDocCountDESC
	notebooks := requestNotebookList(t, model.RoleReader)
	expected := []string{boxIDs[1], boxIDs[2], boxIDs[4], boxIDs[0], boxIDs[3]}
	if actual := notebookIDs(notebooks); !slices.Equal(actual, expected) {
		t.Fatalf("notebooks were not sorted by published sub-document count: %v", actual)
	}
	if notebooks[3].SubFileCount != 0 {
		t.Fatalf("invisible sub-documents were included in the published count: %d", notebooks[3].SubFileCount)
	}
}

func writeNotebookSortFixture(t *testing.T, boxID string, childCount, boxIndex int) []string {
	t.Helper()

	boxConf := conf.NewBoxConf()
	boxConf.Name = boxID
	boxConf.Closed = false
	boxConfPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(boxConfPath), 0755); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(boxConfPath, data, 0644); err != nil {
		t.Fatal(err)
	}

	writeNotebookSortDoc(t, boxID, boxID)
	childIDs := make([]string, 0, childCount)
	for i := 0; i < childCount; i++ {
		childID := fmt.Sprintf("2026081201%02d%02d-doc%04d", boxIndex, i, boxIndex*100+i)
		writeNotebookSortDoc(t, boxID, childID)
		childIDs = append(childIDs, childID)
	}
	return childIDs
}

func writeNotebookSortDoc(t *testing.T, boxID, docID string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(util.DataDir, boxID, docID+".sy"), []byte(`{"Properties":{}}`), 0644); err != nil {
		t.Fatal(err)
	}
}

func requestNotebookList(t *testing.T, role model.Role) []*model.Box {
	t.Helper()

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, role)
		c.Next()
	})
	engine.POST("/api/notebook/lsNotebooks", lsNotebooks)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/notebook/lsNotebooks", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &struct {
		Code int `json:"code"`
		Data struct {
			Notebooks []*model.Box `json:"notebooks"`
		} `json:"data"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	if response.Code != 0 {
		t.Fatalf("list notebooks failed: %s", recorder.Body.String())
	}
	return response.Data.Notebooks
}

func notebookIDs(notebooks []*model.Box) []string {
	ret := make([]string, 0, len(notebooks))
	for _, notebook := range notebooks {
		ret = append(ret, notebook.ID)
	}
	return ret
}
