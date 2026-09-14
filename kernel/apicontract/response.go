package apicontract

import (
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"slices"
)

// BinaryContent 保留文件的原始字节和媒体类型，不经过 JSON 编码。
type BinaryContent struct {
	Status      int
	ContentType string
	Bytes       []byte
}

func SuccessBinary(contentType string, data []byte) Response[BinaryContent] {
	return Response[BinaryContent]{binary: &BinaryContent{ContentType: contentType, Bytes: data}}
}

func (r Response[Data]) Binary() *BinaryContent { return r.binary }

// SuccessDirectJSON 返回协议自身定义的 JSON 载荷，不添加统一信封。
func SuccessDirectJSON[Data any](data Data) Response[Data] {
	return Response[Data]{data: data, directJSON: true}
}

// SuccessNoContent 保留通知类请求的空响应，是否允许由端点声明控制。
func SuccessNoContent[Data any]() Response[Data] {
	return Response[Data]{noContent: true}
}

// Status 只为显式声明的非 JSON 协议使用独立错误状态。
func (e Endpoint[Request, Data]) Status(r Response[Data]) int {
	if e.definition.Output == PluginServiceOutput {
		return e.pluginServiceStatus(r)
	}
	if e.definition.Proxy != nil {
		return e.proxyStatus(r)
	}
	if r.emptyStatus != 0 {
		if !slices.Contains(e.definition.EmptyResponseStatuses, r.emptyStatus) {
			panic("endpoint does not declare this empty response status")
		}
		return r.emptyStatus
	}
	if r.redirect != nil {
		status := r.redirect.Status
		if e.definition.Output != BinaryOutput || (status != 301 && status != 302 && status != 303 && status != 307 && status != 308) || !matchesContentVariant(e.definition.ContentVariants, status, "text/html") {
			panic("endpoint does not declare this redirect response")
		}
		return status
	}
	if r.httpStatus != 0 {
		if (e.definition.Output != "" && e.definition.Output != SSEOutput) || r.code == 0 || !slices.Contains(e.definition.AdditionalErrorStatuses, r.httpStatus) {
			panic("endpoint does not declare this JSON error status")
		}
		return r.httpStatus
	}
	if r.upgrade != nil || r.websocketFailure {
		if e.definition.Output != WebSocketOutput || e.definition.WebSocket == nil {
			panic("endpoint does not declare WebSocket output")
		}
		if r.websocketFailure && e.definition.WebSocket.Raw != nil {
			panic("raw WebSocket errors must be written by the upgrader")
		}
		if r.upgrade != nil {
			return 101
		}
		return e.definition.WebSocket.FailureStatus
	}
	if e.definition.Output == WebSocketOutput && r.code == 0 {
		panic("WebSocket response requires an upgrade or rejection")
	}
	if r.stream != nil {
		if e.definition.Output != SSEOutput || e.definition.SSE == nil {
			panic("endpoint does not declare SSE output")
		}
		return 200
	}
	if e.definition.Output == SSEOutput && r.code == 0 {
		panic("SSE response requires StreamSSE")
	}
	if r.noContent {
		if e.definition.Output != DirectJSONOutput || !e.definition.NoContent {
			panic("endpoint does not declare an empty response")
		}
		return 204
	}
	if r.directJSON && e.definition.Output != DirectJSONOutput {
		panic("endpoint does not declare a direct JSON response")
	}
	if e.definition.Output == DirectJSONOutput && r.code == 0 && !r.directJSON {
		panic("direct JSON response requires SuccessDirectJSON")
	}
	if e.definition.Output == BinaryOutput {
		if r.binary != nil {
			status := r.binary.Status
			if status == 0 {
				status = 200
			}
			if len(e.definition.ContentVariants) > 0 {
				media, _, err := mime.ParseMediaType(r.binary.ContentType)
				if err != nil || !matchesContentVariant(e.definition.ContentVariants, status, media) {
					panic("endpoint does not declare this HTTP content variant")
				}
			} else if status != 200 {
				panic("endpoint does not declare this HTTP content status")
			}
			return status
		}
		if r.code == 0 {
			panic("binary response requires SuccessBinary")
		}
		if e.definition.ErrorStatus != 0 {
			return e.definition.ErrorStatus
		}
	} else if r.binary != nil {
		panic("JSON endpoint cannot return binary content")
	}
	return 200
}

// DecodeFailure 保留端点在请求解析失败时声明的响应载荷。
func (e Endpoint[Request, Data]) DecodeFailure(err error) Response[Data] {
	if e.decodeFailure != nil {
		return e.decodeFailure(err)
	}
	return Failure[Data](-1, err.Error())
}

// FailureWithData 仅为显式声明失败载荷的端点保留业务结果。
func (e Endpoint[Request, Data]) FailureWithData(code int, msg string, data Data) Response[Data] {
	if !e.definition.DataOnError {
		panic("endpoint does not declare data on error")
	}
	return Response[Data]{code: code, msg: msg, data: data}
}

// Null 表示成功但没有数据，线协议始终写出 null。
type Null struct{}

func (Null) MarshalJSON() ([]byte, error) { return []byte("null"), nil }

// Response 的载荷仅能通过有类型的成功构造函数或明确的错误构造函数设置。
type Response[Data any] struct {
	pluginServiceMode PluginServiceMode
	code              int
	msg               string
	data              any
	binary            *BinaryContent
	queryLimit        *SQLQueryLimit
	directJSON        bool
	noContent         bool
	upgrade           func(http.ResponseWriter, *http.Request)
	stream            func(http.ResponseWriter, *http.Request)
	websocketFailure  bool
	httpStatus        int
	afterWrite        func()
	emptyStatus       int
	redirect          *HTTPRedirect
}

// WithAfterWrite 将通知保留到响应写入完成后执行。
func WithAfterWrite[Data any](response Response[Data], after func()) Response[Data] {
	response.afterWrite = after
	return response
}

func (r Response[Data]) AfterWrite() func() { return r.afterWrite }

// WithHTTPStatus 只为声明过的业务错误保留额外 HTTP 状态。
func (e Endpoint[Request, Data]) WithHTTPStatus(response Response[Data], status int) Response[Data] {
	response.httpStatus = status
	if status == 0 {
		panic("HTTP status must be explicit")
	}
	e.Status(response)
	return response
}

func Success[Data any](data Data) Response[Data] { return Response[Data]{data: data} }

// SuccessWithMessage 保留成功响应中的提示，例如批量上传中部分文件未完成。
func SuccessWithMessage[Data any](data Data, message string) Response[Data] {
	return Response[Data]{data: data, msg: message}
}

func Failure[Data any](code int, msg string) Response[Data] {
	return Response[Data]{code: code, msg: msg}
}

func FailureWithText[Data any](code int, msg, data string) Response[Data] {
	return Response[Data]{code: code, msg: msg, data: data}
}

// FailureWithTimeout 保留业务错误提示的显示时长。
func FailureWithTimeout[Data any](code int, msg string, milliseconds int) Response[Data] {
	return Response[Data]{code: code, msg: msg, data: struct {
		CloseTimeout int `json:"closeTimeout"`
	}{milliseconds}}
}

func (r Response[Data]) MarshalJSON() ([]byte, error) {
	return r.MarshalWith(json.Marshal)
}

// MarshalWith 使用指定编码器序列化相同的有类型载荷，供大体量 JSON 响应保留快速编码路径。
func (r Response[Data]) MarshalWith(marshal func(any) ([]byte, error)) ([]byte, error) {
	if r.Empty() || r.redirect != nil {
		return nil, fmt.Errorf("raw HTTP response cannot be encoded as JSON")
	}
	if r.stream != nil {
		return nil, fmt.Errorf("SSE stream cannot be encoded as JSON")
	}
	if r.upgrade != nil {
		return nil, fmt.Errorf("WebSocket upgrade cannot be encoded as JSON")
	}
	if r.websocketFailure {
		return marshal(r.data)
	}
	if r.noContent {
		return nil, fmt.Errorf("empty response cannot be encoded as JSON")
	}
	if r.directJSON {
		return marshal(r.data)
	}
	if r.binary != nil {
		return nil, fmt.Errorf("binary response cannot be encoded as JSON")
	}
	return marshal(struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data any    `json:"data"`
		*SQLQueryLimit
	}{r.code, r.msg, r.data, r.queryLimit})
}
