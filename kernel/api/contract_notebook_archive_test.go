package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractNotebookArchiveAdmission(t *testing.T) {
	oldConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	t.Cleanup(func() { model.Conf = oldConf })
	engine := gin.New()
	engine.POST("/api/notebook/commitNotebookArchive", commitNotebookArchive)
	engine.POST("/api/notebook/importNotebookArchive", importNotebookArchive)
	for _, item := range []struct{ path, body string }{
		{"/api/notebook/commitNotebookArchive", `{"id":"../../outside","saved":false}`},
		{"/api/notebook/commitNotebookArchive", `{"id":"../../outside","saved":true}`},
		{"/api/notebook/commitNotebookArchive", `{"id":"id","saved":"true"}`},
		{"/api/notebook/importNotebookArchive", `{}`},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, item.path, strings.NewReader(item.body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, http.MethodPost, item.path, recorder)
		if !strings.Contains(recorder.Body.String(), `"code":-1`) {
			t.Fatalf("invalid request admitted: %s", recorder.Body.String())
		}
	}
}
