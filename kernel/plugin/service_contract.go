package plugin

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

func PreparePrivateService(c *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[apicontract.PluginServiceContent] {
	return preparePluginService(c, AccessScopePrivate)
}

func pluginServiceStream(mode apicontract.PluginServiceMode, status int, write func()) apicontract.Response[apicontract.PluginServiceContent] {
	return apicontract.StreamPluginService(mode, status, func(http.ResponseWriter, *http.Request) { write() })
}

func pluginServiceError(c *gin.Context, status int, message string) apicontract.Response[apicontract.PluginServiceContent] {
	return pluginServiceStream(apicontract.PluginServiceAdmission, status, func() { c.String(status, "%s", message) })
}

func preparePluginService(c *gin.Context, scope AccessScope) apicontract.Response[apicontract.PluginServiceContent] {
	name := c.Param("name")

	p := GetManager().GetPlugin(name)
	if p == nil {
		return pluginServiceError(c, http.StatusNotFound, fmt.Sprintf("[plugin:%s] not found", name))
	}
	if p.State() != PluginStateRunning {
		return pluginServiceError(c, http.StatusServiceUnavailable, fmt.Sprintf("[plugin:%s] is not running", name))
	}

	request, parseErr := parseRequest(c)
	if parseErr != nil {
		return pluginServiceError(c, http.StatusBadRequest, fmt.Sprintf("[plugin:%s] Error occurred while parsing HTTP request: %s", name, parseErr))
	}

	if request.Context.IsWebsocket {
		return pluginServiceStream(apicontract.PluginServiceWebSocket, 101, func() {
			handleErr := p.handleWebSocketRequest(c, request, scope)
			if handleErr != nil {
				msg := fmt.Sprintf("[plugin:%s] Error occurred while handling WebSocket request: %s", name, handleErr)
				logging.LogWarn(msg)
				c.String(http.StatusInternalServerError, msg)
			}
		})
	}

	if request.Context.IsSse {
		return pluginServiceStream(apicontract.PluginServiceSSE, 200, func() {
			handleErr := p.handleServerSentEventRequest(c, request, scope)
			if handleErr != nil {
				msg := fmt.Sprintf("[plugin:%s] Error occurred while handling SSE request: %s", name, handleErr)
				logging.LogWarn(msg)
				c.String(http.StatusInternalServerError, msg)
			}
		})
	}

	response, handleErr := p.handleHttpRequest(c, request, scope)
	if handleErr != nil {
		msg := fmt.Sprintf("[plugin:%s] Error occurred while handling HTTP request: %s", name, handleErr)
		logging.LogWarn(msg)
		return pluginServiceError(c, http.StatusInternalServerError, msg)
	}

	if response == nil {
		return pluginServiceStream(apicontract.PluginServiceEmpty, 500, func() { c.Status(500) })
	}
	return pluginServiceHTTPResponse(c, name, response)
}

func pluginServiceHTTPResponse(c *gin.Context, name string, response *HttpResponse) apicontract.Response[apicontract.PluginServiceContent] {

	// 插件头的重复值依次覆盖，Cookie 则逐个追加。
	for headerKey, headerValues := range response.Headers {
		for _, headerValue := range headerValues {
			c.Header(headerKey, headerValue)
		}
	}

	for _, cookie := range response.Cookies {
		http.SetCookie(c.Writer, cookie)
	}

	// 按声明优先级选择唯一响应模式，流执行时使用对应序列化器。
	if response.Body != nil {
		if response.Body.Data != nil {
			switch response.Body.Data.Type {
			case SerializedTypeJSON:
				return pluginServiceStream(apicontract.PluginServiceJSON, response.StatusCode, func() { c.JSON(response.StatusCode, response.Body.Data.Data) })
			case SerializedTypeJSONP:
				return pluginServiceStream(apicontract.PluginServiceJSONP, response.StatusCode, func() { c.JSONP(response.StatusCode, response.Body.Data.Data) })
			case SerializedTypeAsciiJSON:
				return pluginServiceStream(apicontract.PluginServiceASCIIJSON, response.StatusCode, func() { c.AsciiJSON(response.StatusCode, response.Body.Data.Data) })
			case SerializedTypeIndentedJSON:
				return pluginServiceStream(apicontract.PluginServiceIndentedJSON, response.StatusCode, func() { c.IndentedJSON(response.StatusCode, response.Body.Data.Data) })
			case SerializedTypePureJSON:
				return pluginServiceStream(apicontract.PluginServicePureJSON, response.StatusCode, func() { c.PureJSON(response.StatusCode, response.Body.Data.Data) })
			case SerializedTypeSecureJSON:
				return pluginServiceStream(apicontract.PluginServiceSecureJSON, response.StatusCode, func() { c.SecureJSON(response.StatusCode, response.Body.Data.Data) })

			case SerializedTypeXML:
				return pluginServiceStream(apicontract.PluginServiceXML, response.StatusCode, func() { c.XML(response.StatusCode, response.Body.Data.Data) })
			case SerializedTypeYAML:
				return pluginServiceStream(apicontract.PluginServiceYAML, response.StatusCode, func() { c.YAML(response.StatusCode, response.Body.Data.Data) })
			case SerializedTypeTOML:
				return pluginServiceStream(apicontract.PluginServiceTOML, response.StatusCode, func() { c.TOML(response.StatusCode, response.Body.Data.Data) })
			case SerializedTypeProtoBuf:
				return pluginServiceStream(apicontract.PluginServiceProtoBuf, response.StatusCode, func() { c.ProtoBuf(response.StatusCode, response.Body.Data.Data) })

			default:
				return pluginServiceError(c, http.StatusInternalServerError, fmt.Sprintf("[plugin:%s] Unsupported serialized data type [%s] in response", name, response.Body.Data.Type))
			}
		} else if response.Body.File != nil {
			// 文件由 HTTP 文件服务处理范围请求和条件读取，不预先加载文件内容。
			if response.Body.File.Name != "" {
				return pluginServiceStream(apicontract.PluginServiceFile, 200, func() { c.FileAttachment(response.Body.File.Path, response.Body.File.Name) })
			} else {
				return pluginServiceStream(apicontract.PluginServiceFile, 200, func() { c.File(response.Body.File.Path) })
			}
		} else if response.Body.String != nil {
			return pluginServiceStream(apicontract.PluginServiceString, response.StatusCode, func() { c.String(response.StatusCode, response.Body.String.Format, response.Body.String.Values...) })
		} else if response.Body.Raw != nil {
			return pluginServiceStream(apicontract.PluginServiceRaw, response.StatusCode, func() { c.Data(response.StatusCode, response.Body.Raw.ContentType, response.Body.Raw.Data) })
		} else if response.Body.Redirect != nil {
			return pluginServiceStream(apicontract.PluginServiceRedirect, response.StatusCode, func() { c.Redirect(response.StatusCode, response.Body.Redirect.Location) })
		} else if response.Body.Proxy != nil {
			return pluginServiceStream(apicontract.PluginServiceProxy, 200, func() { writeProxyResponse(c, response.Body.Proxy) })
		}
	}
	return pluginServiceStream(apicontract.PluginServiceEmpty, response.StatusCode, func() { c.Status(response.StatusCode) })
}
