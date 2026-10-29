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

func TestAPIContractSyncCheckoutPreparationAndSnapshot(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/sync/getSyncCheckout", getSyncCheckout)
	engine.POST("/api/sync/confirmSyncCheckout", confirmSyncCheckout)
	for _, tc := range []struct {
		path, body string
		code       int
	}{
		{"/api/sync/getSyncCheckout", `{}`, 0},
		{"/api/sync/getSyncCheckout", `{"appID":"desktop","clientID":"window"}`, 0},
		{"/api/sync/getSyncCheckout", `{"clientID":1}`, -1},
		{"/api/sync/confirmSyncCheckout", `{"taskID":"stale","token":"window","saved":false}`, 0},
		{"/api/sync/confirmSyncCheckout", `{"taskID":"stale","token":"window"}`, -1},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", tc.path, strings.NewReader(tc.body)))
		requireAPIContract(t, "POST", tc.path, recorder)
		var response struct{ Code int }
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != tc.code {
			t.Fatalf("unexpected preparation response: %s (%v)", recorder.Body.String(), err)
		}
	}
}
