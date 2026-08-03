// SiYuan - Refactor your thinking
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
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const protocolVersion20260728 = "2026-07-28"

var (
	httpHandlerOnce sync.Once
	httpHandler     http.Handler
)

func Serve(ginServer *gin.Engine) {
	handler := getHTTPHandler()

	// MCP 工具暴露任意工作区文件读写删、SQL、插件分发等管理级原语，必须要求管理员角色，
	// 否则 Publish 匿名模式注入的 RoleReader JWT 可经此链路越权调用全部工具。
	ginServer.POST("/mcp", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, serveHTTP(handler))
	ginServer.GET("/mcp", model.CheckAuth, model.CheckAdminRole, serveHTTP(handler))
	ginServer.DELETE("/mcp", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, serveHTTP(handler))
}

func getHTTPHandler() http.Handler {
	httpHandlerOnce.Do(func() {
		server := newServer()
		tools.ObserveRegistry(func(name string, tool *tools.Tool) {
			syncTool(server, name, tool)
		})
		httpHandler = newHTTPHandler(server)
	})
	return httpHandler
}

func newServer() *mcpsdk.Server {
	server := mcpsdk.NewServer(&mcpsdk.Implementation{
		Name:    "SiYuan",
		Version: util.Ver,
	}, &mcpsdk.ServerOptions{
		Capabilities: &mcpsdk.ServerCapabilities{},
	})
	server.AddReceivingMiddleware(privateCacheMiddleware())
	return server
}

func privateCacheMiddleware() mcpsdk.Middleware {
	return func(next mcpsdk.MethodHandler) mcpsdk.MethodHandler {
		return func(ctx context.Context, method string, request mcpsdk.Request) (mcpsdk.Result, error) {
			result, err := next(ctx, method, request)
			switch cacheable := result.(type) {
			case *mcpsdk.DiscoverResult:
				cacheable.CacheScope = "private"
			case *mcpsdk.ListToolsResult:
				cacheable.CacheScope = "private"
			case *mcpsdk.ListPromptsResult:
				cacheable.CacheScope = "private"
			case *mcpsdk.ListResourcesResult:
				cacheable.CacheScope = "private"
			case *mcpsdk.ListResourceTemplatesResult:
				cacheable.CacheScope = "private"
			case *mcpsdk.ReadResourceResult:
				cacheable.CacheScope = "private"
			}
			return result, err
		}
	}
}

func newHTTPHandler(server *mcpsdk.Server) http.Handler {
	getServer := func(*http.Request) *mcpsdk.Server {
		return server
	}
	modern := mcpsdk.NewStreamableHTTPHandler(getServer, &mcpsdk.StreamableHTTPOptions{
		Stateless:                    true,
		JSONResponse:                 true,
		CrossOriginProtection:        http.NewCrossOriginProtection(),
		PropagateRequestCancellation: true,
	})
	legacy := mcpsdk.NewStreamableHTTPHandler(getServer, &mcpsdk.StreamableHTTPOptions{
		JSONResponse:          true,
		CrossOriginProtection: http.NewCrossOriginProtection(),
	})

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if isModernRequest(request) {
			modern.ServeHTTP(writer, request)
			return
		}
		legacy.ServeHTTP(writer, request)
	})
}

func isModernRequest(request *http.Request) bool {
	version := request.Header.Get("MCP-Protocol-Version")
	return version >= protocolVersion20260728
}

func serveHTTP(handler http.Handler) gin.HandlerFunc {
	scopedHandler := withEncryptedBoxOperationScope(handler)
	return func(ginContext *gin.Context) {
		scopedHandler.ServeHTTP(ginContext.Writer, ginContext.Request)
	}
}

func syncTool(server *mcpsdk.Server, name string, tool *tools.Tool) {
	if tool == nil {
		server.RemoveTools(name)
		return
	}
	validator, err := tools.CompileToolValidator(tool)
	if err != nil {
		server.RemoveTools(name)
		logging.LogWarnf("mcp: skip invalid server tool [%s]: %v", name, err)
		return
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			server.RemoveTools(name)
			logging.LogWarnf("mcp: skip invalid server tool [%s]: %v", name, recovered)
		}
	}()

	sdkTool := &mcpsdk.Tool{
		Name:        name,
		Title:       tool.Title,
		Description: tool.Description,
		InputSchema: tool.InputSchema,
	}
	if tool.OutputSchema != nil {
		sdkTool.OutputSchema = tool.OutputSchema
	}
	if tool.ReadOnlyHint {
		sdkTool.Annotations = &mcpsdk.ToolAnnotations{ReadOnlyHint: true}
	}

	server.AddTool(sdkTool, func(ctx context.Context, request *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
		arguments := map[string]any{}
		if len(request.Params.Arguments) > 0 {
			if err := json.Unmarshal(request.Params.Arguments, &arguments); err != nil {
				return nil, fmt.Errorf("invalid tool arguments: %w", err)
			}
		}
		if arguments == nil {
			arguments = map[string]any{}
		}
		if err := validator.ValidateInputContext(ctx, arguments); err != nil {
			return toolErrorResult(fmt.Sprintf("invalid tool arguments: %v", err)), nil
		}
		releaseBoxLeases := func() {}
		if tool.BoxLeaseResolver != nil {
			leaseContext, contextErr := requestOperationContext(ctx, request)
			if contextErr != nil {
				logging.LogWarnf("mcp: acquire request operation scope for tool [%s] failed: %v", name, contextErr)
				return toolErrorResult(contextErr.Error()), nil
			}
			releaseBoxLeases, err = model.AcquireEncryptedBoxOperations(leaseContext, tool.BoxLeaseResolver(arguments))
			if err != nil {
				if errors.Is(err, model.ErrEncryptedBoxNotUnlocked) {
					return toolErrorResult("encrypted notebook is locked, please unlock it first"), nil
				}
				logging.LogWarnf("mcp: acquire encrypted notebook operations for tool [%s] failed: %v", name, err)
				return toolErrorResult(err.Error()), nil
			}
		}
		defer releaseBoxLeases()

		var (
			result tools.CallToolResult
			err    error
		)
		if tool.ContextHandler != nil {
			result, err = tool.ContextHandler(ctx, arguments)
		} else if tool.Handler != nil {
			result, err = tool.Handler(arguments)
		} else {
			err = fmt.Errorf("tool handler is not configured")
		}
		if err != nil {
			return toolErrorResult(err.Error()), nil
		}
		if err = validator.ValidateOutputContext(ctx, result); err != nil {
			return toolErrorResult(fmt.Sprintf(
				"invalid tool output after execution; execution result may have side effects and must not be retried automatically: %v",
				err)), nil
		}

		content := make([]mcpsdk.Content, 0, len(result.Content))
		for _, item := range result.Content {
			converted, convertErr := convertContentItem(item)
			if convertErr != nil {
				return toolErrorResult(fmt.Sprintf(
					"invalid tool content after execution; execution result may have side effects and must not be retried automatically: %v",
					convertErr)), nil
			}
			content = append(content, converted)
		}
		structuredContent := result.StructuredContent
		if result.HasStructuredContent() && structuredContent == nil {
			structuredContent = json.RawMessage("null")
		}
		return &mcpsdk.CallToolResult{
			Content:           content,
			StructuredContent: structuredContent,
			IsError:           result.IsError,
		}, nil
	})
}

func convertContentItem(item tools.ContentItem) (mcpsdk.Content, error) {
	data, err := json.Marshal(item)
	if err != nil {
		return nil, err
	}
	wrapped := append([]byte(`{"content":[`), data...)
	wrapped = append(wrapped, []byte(`]}`)...)
	var result mcpsdk.CallToolResult
	if err = json.Unmarshal(wrapped, &result); err != nil {
		return nil, err
	}
	if len(result.Content) != 1 {
		return nil, fmt.Errorf("expected one content item, got %d", len(result.Content))
	}
	return result.Content[0], nil
}

func toolErrorResult(message string) *mcpsdk.CallToolResult {
	return &mcpsdk.CallToolResult{
		Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: message}},
		IsError: true,
	}
}
