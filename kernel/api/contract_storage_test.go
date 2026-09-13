package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractReadonlyRecentDocsIgnoreBody(t *testing.T) {
	for _, kernelReadonly := range []bool{false, true} {
		name := "reader role"
		if kernelReadonly {
			name = "readonly kernel"
		}
		t.Run(name, func(t *testing.T) {
			previousReadonly := util.ReadOnly
			util.ReadOnly = kernelReadonly
			t.Cleanup(func() { util.ReadOnly = previousReadonly })
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				role := model.RoleReader
				if kernelReadonly {
					role = model.RoleAdministrator
				}
				c.Set(model.RoleContextKey, role)
			})
			engine.POST("/api/storage/updateRecentDocOpenTime", updateRecentDocOpenTime)
			engine.POST("/api/storage/updateRecentDocViewTime", updateRecentDocViewTime)
			engine.POST("/api/storage/updateRecentDocCloseTime", updateRecentDocCloseTime)
			engine.POST("/api/storage/batchUpdateRecentDocCloseTime", batchUpdateRecentDocCloseTime)
			for _, path := range []string{"/api/storage/updateRecentDocOpenTime", "/api/storage/updateRecentDocViewTime", "/api/storage/updateRecentDocCloseTime", "/api/storage/batchUpdateRecentDocCloseTime"} {
				for _, body := range []string{"", "{", "null", `{"rootID":42,"rootIDs":42}`} {
					recorder := httptest.NewRecorder()
					engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
					requireAPIContract(t, "POST", path, recorder)
					if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), `"code":0`) {
						t.Fatalf("readonly mutation should ignore body: %s %s: %s", path, body, recorder.Body.String())
					}
				}
			}
		})
	}
}
