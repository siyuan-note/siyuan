// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

func TestAPIContractSyncSourceDecision(t *testing.T) {
	syncTestConfiguration(t)
	engine := gin.New()
	engine.POST("/api/sync/performSync", performSync)
	for _, body := range []string{
		`{"source":"changed","localID":"local","cloudID":"cloud"}`,
		`{"source":"changed","upload":true}`,
		`{"source":"changed","localID":"local","cloudID":"cloud","upload":null}`,
		`{"source":"changed","localID":3,"cloudID":"cloud","upload":true}`,
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/sync/performSync", strings.NewReader(body)))
		requireAPIContract(t, "POST", "/api/sync/performSync", recorder)
		var response struct{ Code int }
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 {
			t.Fatalf("invalid decision accepted: %s %v", recorder.Body.String(), err)
		}
	}
	// A new endpoint's response is validated through the actual HTTP adapter.
	engine.POST("/api/sync/getSyncSourceState", contractHandler(apicontract.GetSyncSourceState,
		func(_ *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[apicontract.SyncSourceState] {
			return apicontract.Success(apicontract.SyncSourceState{Pending: true, Source: "source", LocalID: "local", CloudID: "cloud", LocalFiles: 12, CloudFiles: 10, CloudCreated: 123, CloudDevice: "device", UploadFiles: 3, OverwriteFiles: 1, RemoveFiles: 2})
		}))
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/sync/getSyncSourceState", strings.NewReader("ignored")))
	requireAPIContract(t, "POST", "/api/sync/getSyncSourceState", recorder)
}
