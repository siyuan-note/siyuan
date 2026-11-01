// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package dav

import (
	"encoding/xml"
	"errors"
	"net/http"
	"strings"
)

// Error 是带 HTTP 状态码的协议错误；Condition 非空时响应体是包含该前置或后置条件的 DAV:error（RFC 4918 §16）。
type Error struct {
	Status    int
	Condition *Node
	Err       error
}

func (e *Error) Error() string {
	if nil != e.Err {
		return e.Err.Error()
	}
	if nil != e.Condition {
		return e.Condition.XMLName.Local
	}
	return http.StatusText(e.Status)
}

func (e *Error) Unwrap() error { return e.Err }

func NewError(status int, err error) *Error {
	return &Error{Status: status, Err: err}
}

// NewConditionError 返回违反前置或后置条件的错误；condition 是条件元素，例如 CALDAV:no-uid-conflict。
func NewConditionError(status int, condition *Node) *Error {
	return &Error{Status: status, Condition: condition}
}

// ConditionErrorName 返回错误携带的条件元素名；不是条件错误时返回零值。
func ConditionErrorName(err error) xml.Name {
	var davErr *Error
	if errors.As(err, &davErr) && nil != davErr.Condition {
		return davErr.Condition.XMLName
	}
	return xml.Name{}
}

// WriteError 把错误写成 HTTP 响应；不是 *Error 的错误一律视为服务端内部错误，不向客户端暴露细节。
func WriteError(w http.ResponseWriter, err error) {
	var davErr *Error
	if !errors.As(err, &davErr) {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}
	if nil != davErr.Condition {
		_ = WriteXML(w, davErr.Status, NewElement(DAVName("error"), davErr.Condition))
		return
	}
	http.Error(w, davErr.Error(), davErr.Status)
}

// Depth 是 Depth 请求头的值（RFC 4918 §10.2）。
type Depth int

const (
	DepthZero     Depth = 0
	DepthOne      Depth = 1
	DepthInfinity Depth = -1
)

// ParseDepth 解析 Depth 请求头；请求头缺失时返回 fallback，不同方法的默认值不同。
func ParseDepth(value string, fallback Depth) (Depth, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "":
		return fallback, nil
	case "0":
		return DepthZero, nil
	case "1":
		return DepthOne, nil
	case "infinity":
		return DepthInfinity, nil
	}
	return 0, NewError(http.StatusBadRequest, errors.New("invalid Depth header"))
}

// Includes 判断位于请求资源之下 levels 层的资源是否在深度范围内。
func (d Depth) Includes(levels int) bool {
	return DepthInfinity == d || levels <= int(d)
}
