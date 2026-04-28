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

package plugin

import (
	"fmt"
	"net/http"

	"github.com/dop251/goja"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
)

const (
	SseHeaderAcceptName  = "Accept"
	SseHeaderAcceptValue = "text/event-stream"
)

type AccessScope string
type SerializedType string
type RequestType string

const (
	AccessScopePublic  AccessScope = "public"
	AccessScopePrivate AccessScope = "private"

	SerializedTypeJSON         SerializedType = "JSON"
	SerializedTypeJSONP        SerializedType = "JSONP"
	SerializedTypeAsciiJSON    SerializedType = "AsciiJSON"
	SerializedTypeIndentedJSON SerializedType = "IndentedJSON"
	SerializedTypePureJSON     SerializedType = "PureJSON"
	SerializedTypeSecureJSON   SerializedType = "SecureJSON"

	SerializedTypeXML      SerializedType = "XML"
	SerializedTypeYAML     SerializedType = "YAML"
	SerializedTypeTOML     SerializedType = "TOML"
	SerializedTypeProtoBuf SerializedType = "ProtoBuf"

	RequestTypeHTTP RequestType = "http"
	RequestTypeWS   RequestType = "ws"
	RequestTypeSSE  RequestType = "es"
)

type Request struct {
	URL     RequestUrl     `json:"url"`
	Request RequestContent `json:"request"`
	Context RequestContext `json:"context"`
	Port    *goja.Object   `json:"port"`
}

type RequestUrl struct {
	User            *RequestUser `json:"user"`
	Host            string       `json:"host"`     // e.g. 127.0.0.1:6806
	Path            string       `json:"path"`     // e.g. /plugin/public/sample/api/hello/a space
	EscapedPath     string       `json:"pathname"` // e.g. /plugin/public/sample/api/hello/a%20space
	Fragment        string       `json:"fragment"` // e.g. "hash abc"
	EscapedFragment string       `json:"hash"`     // e.g. "hash%20abc"
	RawQuery        string       `json:"search"`   // e.g. a=1&b=2

	Query map[string][]string `json:"query"` // e.g. {"a": ["1"], "b": ["2"]}
}

type RequestUser struct {
	Username string `json:"username"` // e.g. "alice"
	Password string `json:"password"` // e.g. "123456"
}

type RequestContent struct {
	/* Request Line */
	Method     string `json:"method"`     // e.g. "GET"
	URI        string `json:"uri"`        // e.g. "/plugin/public/sample/api/hello?a=1&b=2"
	Proto      string `json:"proto"`      // e.g. "HTTP/1.1"
	ProtoMajor int    `json:"protoMajor"` // e.g. 1
	ProtoMinor int    `json:"protoMinor"` // e.g. 1

	/* Request Headers */
	Headers map[string][]string `json:"headers"` // e.g. {"Content-Type": ["application/json"], "Accept": ["*/*"]}
	Cookies map[string][]string `json:"cookies"` // e.g. {"siyuan": ["abc123"]}

	ContentType   string `json:"contentType"`   // e.g. "application/json"
	ContentLength int64  `json:"contentLength"` // e.g. 123
	Referer       string `json:"referer"`       // e.g. "http://127.0.0.1:6806/stage/build/app/"
	UserAgent     string `json:"userAgent"`     // e.g. "SiYuan/3.6.5 https://b3log.org/siyuan Electron Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SiYuan/3.6.5 Chrome/144.0.7559.236 Electron/40.9.1 Safari/537.36"

	/* Request Body */
	Body RequestBody `json:"body"`
}

type RequestBody struct {
	Form *RequestForm `json:"form"` // parsed form data if Content-Type is application/x-www-form-urlencoded or multipart/form-data
	Data any          `json:"data"` // *[]byte | *goja.Object, content of all request body (if form != nil, it will be an empty byte array)
}

type RequestForm struct {
	Value map[string][]string      `json:"values"` // e.g. {"field1": ["value1"], "field2": ["value2-1", "value2-2"]}
	File  map[string][]RequestFile `json:"files"`  // e.g. {"file1": [{"Filename": "hello.txt", "Headers": {"Content-Disposition": ["form-data; name=\"file1\"; filename=\"hello.txt\""], "Content-Type": ["text/plain"]}, "Size": 123, "Data": []byte{...}}]}
}

type RequestFile struct {
	Filename string              `json:"filename"` // e.g. "hello.txt"
	Headers  map[string][]string `json:"headers"`  // e.g. {"Content-Disposition": ["form-data; name=\"file1\"; filename=\"hello.txt\""], "Content-Type": ["text/plain"]}
	Size     int64               `json:"size"`     // e.g. 123
	Data     any                 `json:"data"`     // *[]byte | *goja.Object, content of the file
}

type RequestContext struct {
	Path     string `json:"path"`     // e.g. "/api/hello"
	FullPath string `json:"fullPath"` // e.g. "/plugin/public/:name/*path"

	ClientIP   string `json:"clientIp"`   // e.g. "127.0.0.1"
	RemoteIP   string `json:"remoteIp"`   // e.g. "127.0.0.1"
	RemoteAddr string `json:"remoteAddr"` // e.g. "127.0.0.1:54321"

	Params map[string][]string `json:"params"` // e.g. [{"Key": "name", "Value": "plugin-sample"}, {"Key": "path", "Value": "/api/hello"}]

	IsWebsocket bool `json:"-"`
	IsSse       bool `json:"-"`
}

type HttpResponse struct {
	StatusCode int                 `json:"statusCode"` // e.g. 200
	Headers    map[string][]string `json:"headers"`    // e.g. {"Content-Type": ["application/json"], "Set-Cookie": ["siyuan=abc123; Path=/; HttpOnly"]}
	Cookies    []*http.Cookie      `json:"cookies"`    // e.g. [{"Name": "plugin-sample", "Value": "abc123", "Quoted": false, "Path": "/plugin/private/plugin-sample/", "Domain": "", "Expires": "0001-01-01T00:00:00Z", "RawExpires": "", "MaxAge": 0, "Secure": false, "HttpOnly": false, "SameSite": 0, "Partitioned": false, "Raw": "", "Unparsed": null}]
	Body       *ResponseBody       `json:"body"`       // response body, can be either raw data or a file
}

type ResponseBody struct {
	Data     *ResponseSerializedData `json:"data"`     // if the response is serialized data, Data will be non-nil.
	File     *ResponseFile           `json:"file"`     // if the response is a file, File will be non-nil.
	String   *ResponseString         `json:"string"`   // if the response is a formatted string, String will be non-nil.
	Raw      *ResponseRawData        `json:"raw"`      // if the response is raw data, Raw will be non-nil.
	Redirect *ResponseRedirect       `json:"redirect"` // if the response is a redirect, Redirect will be non-nil.
}

type ResponseSerializedData struct {
	Type SerializedType `json:"type"` // the serialization type, e.g. JSON, XML, etc.
	Data any            `json:"data"` // the data to be serialized and sent in the response body
}

type ResponseFile struct {
	Name string `json:"name"` // e.g. "index.html". If Name is not empty, the file will be sent with Content-Disposition header.
	Path string `json:"path"` // e.g. "/data/plugins/<plugin-name>/app/index.html"
}

type ResponseString struct {
	Format string `json:"format"` // string formatting template (Go string formatting style)
	Values []any  `json:"values"` // the values to be formatted into the template
}

type ResponseRawData struct {
	ContentType string `json:"contentType"` // e.g. "image/png"
	Data        []byte `json:"data"`        // content of the response body
}

type ResponseRedirect struct {
	Location string `json:"location"` // the URL to redirect to
}

// isSseRequest checks if the incoming HTTP request is a Server-Sent Events (SSE) request by inspecting the "Accept" header for the "text/event-stream" value.
func isSseRequest(c *gin.Context) bool {
	return c.GetHeader(SseHeaderAcceptName) == SseHeaderAcceptValue
}

func parseRequest(c *gin.Context) (request *Request, err error) {
	var form *RequestForm
	var data *[]byte
	// c.MultipartForm() will parse application/x-www-form-urlencoded and multipart/form-data
	if multipartForm, formErr := c.MultipartForm(); formErr != nil {
		// Not a form request, do nothing and leave form as nil
	} else if multipartForm != nil {
		// multipart/form-data
		form = &RequestForm{
			Value: multipartForm.Value,
			File:  make(map[string][]RequestFile),
		}

		for partName, fileHandlers := range multipartForm.File {
			files := make([]RequestFile, len(fileHandlers))
			form.File[partName] = files
			for i, handler := range fileHandlers {
				files[i].Filename = handler.Filename
				files[i].Headers = handler.Header
				files[i].Size = handler.Size
				if file, openErr := handler.Open(); openErr != nil {
					err = fmt.Errorf("open form part [%s] file [%s] error: %s", partName, handler.Filename, openErr.Error())
					return
				} else {
					content := make([]byte, handler.Size)
					if n, readErr := file.Read(content); readErr != nil {
						err = fmt.Errorf("read form part [%s] file [%s] error: %s", partName, handler.Filename, readErr.Error())
						return
					} else {
						fileData := content[:n]
						files[i].Data = &fileData
					}
				}
			}
		}
	} else if len(c.Request.PostForm) > 0 {
		// application/x-www-form-urlencoded
		form = &RequestForm{
			Value: c.Request.PostForm,
			File:  nil,
		}
	}

	if form == nil {
		// Not a form request, read raw body data
		if rawData, readErr := c.GetRawData(); readErr != nil {
			// request don't have body, do nothing
		} else {
			data = &rawData
		}
	}

	var user *RequestUser
	username, password, ok := c.Request.BasicAuth()
	if ok {
		user = &RequestUser{
			Username: username,
			Password: password,
		}
	}

	headers := map[string][]string(c.Request.Header)
	delete(headers, "Cookie")
	delete(headers, "Authorization")

	cookies := make(map[string][]string)
	for _, cookie := range c.Request.Cookies() {
		cookies[cookie.Name] = append(cookies[cookie.Name], cookie.Value)
	}

	params := make(map[string][]string)
	for _, param := range c.Params {
		params[param.Key] = append(params[param.Key], param.Value)
	}

	request = &Request{
		URL: RequestUrl{
			User:            user,
			Host:            c.Request.Host,
			Path:            c.Request.URL.Path,
			EscapedPath:     c.Request.URL.EscapedPath(),
			Fragment:        c.Request.URL.Fragment,
			EscapedFragment: c.Request.URL.EscapedFragment(),
			RawQuery:        c.Request.URL.RawQuery,
			Query:           c.Request.URL.Query(),
		},
		Request: RequestContent{
			Method:     c.Request.Method,
			URI:        c.Request.RequestURI,
			Proto:      c.Request.Proto,
			ProtoMajor: c.Request.ProtoMajor,
			ProtoMinor: c.Request.ProtoMinor,

			Headers:       headers,
			Cookies:       cookies,
			ContentType:   c.ContentType(),
			ContentLength: c.Request.ContentLength,
			Referer:       c.Request.Referer(),
			UserAgent:     c.Request.UserAgent(),

			Body: RequestBody{
				Form: form,
				Data: data,
			},
		},
		Context: RequestContext{
			Path:       c.Param("path"),
			FullPath:   c.FullPath(),
			ClientIP:   c.ClientIP(),
			RemoteIP:   c.RemoteIP(),
			RemoteAddr: c.Request.RemoteAddr,
			Params:     params,

			IsWebsocket: c.IsWebsocket(),
			IsSse:       isSseRequest(c),
		},
	}
	return
}

func HandleHttpRequest(c *gin.Context, scope AccessScope) {
	// /plugin/(public|private)/:name/*path
	name := c.Param("name")
	// path := c.Param("path")

	p := GetManager().GetPlugin(name)
	if p == nil {
		c.String(http.StatusNotFound, "[plugin:%s] not found", name)
		return
	}
	if p.State() != PluginStateRunning {
		c.String(http.StatusServiceUnavailable, "[plugin:%s] is not running", name)
		return
	}

	request, parseErr := parseRequest(c)
	if parseErr != nil {
		c.String(http.StatusBadRequest, "[plugin:%s] Error occurred while parsing HTTP request: %s", name, parseErr)
		return
	}

	if request.Context.IsWebsocket {
		handleErr := p.handleWebSocketRequest(c, request, scope)
		if handleErr != nil {
			msg := fmt.Sprintf("[plugin:%s] Error occurred while handling WebSocket request: %s", name, handleErr)
			logging.LogWarn(msg)
			c.String(http.StatusInternalServerError, msg)
		}
		return
	}

	if request.Context.IsSse {
		handleErr := p.handleServerSentEventRequest(c, request, scope)
		if handleErr != nil {
			msg := fmt.Sprintf("[plugin:%s] Error occurred while handling SSE request: %s", name, handleErr)
			logging.LogWarn(msg)
			c.String(http.StatusInternalServerError, msg)
		}
		return
	}

	response, handleErr := p.handleHttpRequest(request, scope)
	if handleErr != nil {
		msg := fmt.Sprintf("[plugin:%s] Error occurred while handling HTTP request: %s", name, handleErr)
		logging.LogWarn(msg)
		c.String(http.StatusInternalServerError, msg)
		return
	}

	// Set response headers
	for headerKey, headerValues := range response.Headers {
		for _, headerValue := range headerValues {
			c.Header(headerKey, headerValue)
		}
	}

	// Set response cookies
	for _, cookie := range response.Cookies {
		http.SetCookie(c.Writer, cookie)
	}

	// Write response body
	if response.Body != nil {
		if response.Body.Data != nil {
			// Serialized data
			switch response.Body.Data.Type {
			case SerializedTypeJSON:
				c.JSON(response.StatusCode, response.Body.Data.Data)
			case SerializedTypeJSONP:
				c.JSONP(response.StatusCode, response.Body.Data.Data)
			case SerializedTypeAsciiJSON:
				c.AsciiJSON(response.StatusCode, response.Body.Data.Data)
			case SerializedTypeIndentedJSON:
				c.IndentedJSON(response.StatusCode, response.Body.Data.Data)
			case SerializedTypePureJSON:
				c.PureJSON(response.StatusCode, response.Body.Data.Data)
			case SerializedTypeSecureJSON:
				c.SecureJSON(response.StatusCode, response.Body.Data.Data)

			case SerializedTypeXML:
				c.XML(response.StatusCode, response.Body.Data.Data)
			case SerializedTypeYAML:
				c.YAML(response.StatusCode, response.Body.Data.Data)
			case SerializedTypeTOML:
				c.TOML(response.StatusCode, response.Body.Data.Data)
			case SerializedTypeProtoBuf:
				c.ProtoBuf(response.StatusCode, response.Body.Data.Data)

			default:
				c.String(http.StatusInternalServerError, "[plugin:%s] Unsupported serialized data type [%s] in response", name, response.Body.Data.Type)
			}
			return
		} else if response.Body.File != nil {
			// If Path is not empty, use it as the file content and ignore Data.
			// This is for streaming large files without loading the whole content into memory.
			if response.Body.File.Name != "" {
				c.FileAttachment(response.Body.File.Path, response.Body.File.Name)
			} else {
				c.File(response.Body.File.Path)
			}
			return
		} else if response.Body.String != nil {
			// Format the string with the provided values and write it to the response.
			c.String(response.StatusCode, response.Body.String.Format, response.Body.String.Values...)
			return
		} else if response.Body.Raw != nil {
			// Raw data
			c.Data(response.StatusCode, response.Body.Raw.ContentType, response.Body.Raw.Data)
			return
		} else if response.Body.Redirect != nil {
			// Redirect
			c.Redirect(response.StatusCode, response.Body.Redirect.Location)
			return
		} else {
			// No body
		}
	}
	c.Status(response.StatusCode)
}
