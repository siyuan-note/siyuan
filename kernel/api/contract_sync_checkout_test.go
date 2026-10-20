package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

func TestAPIContractSyncCheckoutCancellation(t *testing.T) {
	engine := gin.New()
	const path = "/api/sync/cancelSyncCheckout"
	engine.POST(path, cancelSyncCheckout)
	for _, tc := range []struct {
		body string
		code int
	}{{`{"taskID":"stale"}`, 0}, {`{"taskID":123}`, -1}, {`{}`, -1}} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(tc.body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int
			Data apicontract.CancelSyncCheckoutData
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != tc.code || response.Data.Requested {
			t.Fatalf("unexpected cancellation response: %s (%v)", recorder.Body.String(), err)
		}
	}
}
