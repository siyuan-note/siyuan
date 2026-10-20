package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

func TestBazaarContractInstallRequestCancellation(t *testing.T) {
	document, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for name, handler := range map[string]gin.HandlerFunc{
		"installBazaarPlugin":   installBazaarPlugin,
		"installBazaarTheme":    installBazaarTheme,
		"installBazaarIcon":     installBazaarIcon,
		"installBazaarTemplate": installBazaarTemplate,
		"installBazaarWidget":   installBazaarWidget,
	} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			path := "/api/bazaar/" + name
			engine := gin.New()
			engine.POST(path, handler)
			request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"repoURL":"https://github.com/owner/repo","repoHash":"hash","packageName":"sample","frontend":"desktop"}`)).WithContext(ctx)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			var response struct {
				Code int
				Msg  string
				Data json.RawMessage
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Code != 1 || response.Msg != context.Canceled.Error() || string(response.Data) != "null" {
				t.Fatal(recorder.Body.String())
			}
			if err := document.ValidateHTTPResponse(http.MethodPost, path, recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
				t.Fatal(err)
			}
		})
	}
}
