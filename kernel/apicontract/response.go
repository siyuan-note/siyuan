package apicontract

import (
	"encoding/json"
	"fmt"
)

// BinaryContent 保留文件的原始字节和媒体类型，不经过 JSON 编码。
type BinaryContent struct {
	ContentType string
	Bytes       []byte
}

func SuccessBinary(contentType string, data []byte) Response[BinaryContent] {
	return Response[BinaryContent]{binary: &BinaryContent{ContentType: contentType, Bytes: data}}
}

func (r Response[Data]) Binary() *BinaryContent { return r.binary }

// Status 只为显式声明的非 JSON 协议使用独立错误状态。
func (e Endpoint[Request, Data]) Status(r Response[Data]) int {
	if e.definition.Output == BinaryOutput {
		if r.binary != nil {
			return 200
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
	code       int
	msg        string
	data       any
	binary     *BinaryContent
	queryLimit *SQLQueryLimit
}

func Success[Data any](data Data) Response[Data] { return Response[Data]{data: data} }

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
	if r.binary != nil {
		return nil, fmt.Errorf("binary response cannot be encoded as JSON")
	}
	return json.Marshal(struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data any    `json:"data"`
		*SQLQueryLimit
	}{r.code, r.msg, r.data, r.queryLimit})
}
