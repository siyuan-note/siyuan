// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package mcp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestRequestOperationScopeBridge(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	request.Header.Set(requestOperationScopeHeader, "forged")
	var capturedHeader http.Header

	handler := withEncryptedBoxOperationScope(http.HandlerFunc(func(writer http.ResponseWriter, scopedRequest *http.Request) {
		capturedHeader = scopedRequest.Header.Clone()
		if requestID := scopedRequest.Header.Get(requestOperationScopeHeader); requestID == "" || requestID == "forged" {
			t.Fatalf("request operation scope ID was not replaced: %q", requestID)
		}
		toolRequest := &mcpsdk.CallToolRequest{Extra: &mcpsdk.RequestExtra{Header: scopedRequest.Header}}
		operationContext, err := requestOperationContext(context.Background(), toolRequest)
		if err != nil {
			t.Fatal(err)
		}
		if operationContext != scopedRequest.Context() {
			t.Fatal("tool request did not resolve the current HTTP operation context")
		}
		writer.WriteHeader(http.StatusNoContent)
	}))

	handler.ServeHTTP(httptest.NewRecorder(), request)
	if request.Header.Get(requestOperationScopeHeader) != "forged" {
		t.Fatal("request operation scope wrapper mutated the original header")
	}
	toolRequest := &mcpsdk.CallToolRequest{Extra: &mcpsdk.RequestExtra{Header: capturedHeader}}
	if _, err := requestOperationContext(context.Background(), toolRequest); !errors.Is(err, errMCPRequestOperationScopeClosed) {
		t.Fatalf("released request operation scope returned unexpected error: %v", err)
	}
}
