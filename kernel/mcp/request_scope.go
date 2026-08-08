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

package mcp

import (
	"context"
	"errors"
	"net/http"
	"sync"

	"github.com/google/uuid"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/siyuan-note/siyuan/kernel/model"
)

const requestOperationScopeHeader = "X-Siyuan-Mcp-Request-Scope"

var (
	errMCPRequestOperationScopeClosed = errors.New("MCP request operation scope is closed")
	requestOperationScopes            sync.Map // 键为请求 ID，值为 context.Context。
)

// withEncryptedBoxOperationScope 为当前 HTTP 响应注册加密笔记本操作作用域。
func withEncryptedBoxOperationScope(handler http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestContext, release := model.WithEncryptedBoxOperationScope(request.Context())
		requestID := uuid.NewString()
		scopedRequest := request.WithContext(requestContext)
		scopedRequest.Header = request.Header.Clone()
		scopedRequest.Header.Set(requestOperationScopeHeader, requestID)
		requestOperationScopes.Store(requestID, requestContext)
		defer func() {
			requestOperationScopes.Delete(requestID)
			release()
		}()

		handler.ServeHTTP(writer, scopedRequest)
	})
}

// requestOperationContext 返回承载当前 HTTP 响应级租约的上下文。
func requestOperationContext(fallback context.Context, request mcpsdk.Request) (context.Context, error) {
	extra := request.GetExtra()
	if extra == nil || extra.Header == nil {
		return fallback, nil
	}
	requestID := extra.Header.Get(requestOperationScopeHeader)
	if requestID == "" {
		return fallback, nil
	}
	value, ok := requestOperationScopes.Load(requestID)
	if !ok {
		return nil, errMCPRequestOperationScopeClosed
	}
	requestContext, ok := value.(context.Context)
	if !ok {
		return nil, errMCPRequestOperationScopeClosed
	}
	return requestContext, nil
}
