package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractWorkspaceStorage(t *testing.T) {
	previousWorkspace, previousReadonly := util.WorkspaceDir, util.ReadOnly
	util.WorkspaceDir, util.ReadOnly = t.TempDir(), true
	t.Cleanup(func() { util.WorkspaceDir, util.ReadOnly = previousWorkspace, previousReadonly })
	if err := os.MkdirAll(filepath.Join(util.WorkspaceDir, "data", "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(util.WorkspaceDir, "data", "assets", "local.bin")
	if err := os.WriteFile(file, []byte{0, 1, 2}, 0600); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{"", "{}"} {
		recorder := systemContractRequest(t, "POST", "getWorkspaceStorage", getWorkspaceStorage, strings.NewReader(body))
		var result struct {
			Code int                              `json:"code"`
			Data apicontract.WorkspaceStorageData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Code != 0 || result.Data.TotalSize != 3 || result.Data.AssetsSize != 3 || len(result.Data.Directories) != 6 {
			t.Fatalf("unexpected storage response: %s", recorder.Body.String())
		}
		for index, name := range []string{"data", "repo", "history", "temp", "conf", "other"} {
			if result.Data.Directories[index].Name != name {
				t.Fatalf("unstable directory order: %+v", result.Data.Directories)
			}
		}
		if strings.Contains(recorder.Body.String(), filepath.ToSlash(util.WorkspaceDir)) || strings.Contains(recorder.Body.String(), "local.bin") {
			t.Fatal("storage response exposes file paths")
		}
	}
	util.WorkspaceDir = filepath.Join(util.WorkspaceDir, "missing")
	recorder := systemContractRequest(t, "POST", "getWorkspaceStorage", getWorkspaceStorage, nil)
	if !strings.Contains(recorder.Body.String(), `"code":-1`) || !strings.Contains(recorder.Body.String(), `"data":null`) {
		t.Fatalf("scan failure must return an error: %s", recorder.Body.String())
	}
}

func TestAPIContractWorkspaceStorageAuthorization(t *testing.T) {
	previousWorkspace, previousReadonly := util.WorkspaceDir, util.ReadOnly
	util.WorkspaceDir, util.ReadOnly = t.TempDir(), true
	t.Cleanup(func() { util.WorkspaceDir, util.ReadOnly = previousWorkspace, previousReadonly })
	gin.SetMode(gin.TestMode)
	for _, role := range []model.Role{model.RoleReader, model.RoleEditor, model.RoleAdministrator} {
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		ServeAPI(engine)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/system/getWorkspaceStorage", nil))
		if role != model.RoleAdministrator {
			if recorder.Code != http.StatusForbidden {
				t.Fatalf("role %v received %d: %s", role, recorder.Code, recorder.Body.String())
			}
		} else {
			if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"code":0`) {
				t.Fatalf("read-only administrator request failed: %s", recorder.Body.String())
			}
			requireAPIContract(t, http.MethodPost, "/api/system/getWorkspaceStorage", recorder)
		}
	}
}
