package apicontract

import "encoding/json"

// Null 表示成功但没有数据，线协议始终写出 null。
type Null struct{}

func (Null) MarshalJSON() ([]byte, error) { return []byte("null"), nil }

// Response 的载荷仅能通过有类型的成功构造函数或明确的错误构造函数设置。
type Response[Data any] struct {
	code int
	msg  string
	data any
}

func Success[Data any](data Data) Response[Data] { return Response[Data]{data: data} }

func Failure[Data any](code int, msg string) Response[Data] {
	return Response[Data]{code: code, msg: msg}
}

func FailureWithText[Data any](code int, msg, data string) Response[Data] {
	return Response[Data]{code: code, msg: msg, data: data}
}

func (r Response[Data]) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data any    `json:"data"`
	}{r.code, r.msg, r.data})
}
