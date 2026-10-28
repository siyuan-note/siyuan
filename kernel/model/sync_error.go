// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/siyuan-note/dejavu/cloud"
	"github.com/studio-b12/gowebdav"
)

// cloudLockErrorDetail 仅展示本地化的错误类别和主机名，不展示请求地址、凭据或响应正文。
func cloudLockErrorDetail(err error, language func(int) string) string {
	if detail := webDAVErrorDetail(err, language); detail != "" {
		return detail
	}
	var dnsErr *net.DNSError
	var networkErr net.Error
	var requestErr *url.Error
	number := 0
	host := ""
	switch {
	case errors.As(err, &dnsErr):
		number = 408
		host = dnsErr.Name
	case errors.Is(err, context.DeadlineExceeded):
		number = 24
	case errors.As(err, &networkErr):
		if networkErr.Timeout() {
			number = 24
		} else {
			number = 409
		}
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		number = 409
	case errors.Is(err, os.ErrPermission):
		number = 33
	}
	if 0 == number {
		return ""
	}
	if "" == host && errors.As(err, &requestErr) {
		if address, parseErr := url.Parse(requestErr.URL); nil == parseErr {
			host = address.Hostname()
		}
	}
	detail := language(number)
	if safeCloudErrorHost(host) {
		detail += " [" + host + "]"
	}
	return detail
}

// webDAVErrorDetail 仅从类型化错误提取状态码，避免将地址、凭据和响应正文带入提示。
func webDAVErrorDetail(err error, language func(int) string) string {
	if errors.Is(err, cloud.ErrWebDAVInvalidResponse) {
		return language(430)
	}
	var status gowebdav.StatusError
	if !errors.As(err, &status) {
		var pathErr *os.PathError
		if errors.As(err, &pathErr) && pathErr.Op == "Mkdir" && errors.Is(err, os.ErrExist) {
			return language(429)
		}
		return ""
	}
	number := 249
	switch status.Status {
	case http.StatusBadRequest:
		number = 425
	case http.StatusUnauthorized:
		number = 426
	case http.StatusForbidden:
		number = 427
	case http.StatusMethodNotAllowed:
		number = 428
	case http.StatusConflict:
		number = 429
	case http.StatusTooManyRequests:
		number = 250
	default:
		if status.Status >= 500 {
			number = 219
		}
	}
	return fmt.Sprintf("%s (HTTP %d)", language(number), status.Status)
}

// safeCloudErrorHost 限制主机名字符，防止异常字段携带 HTML、路径或查询参数。
func safeCloudErrorHost(host string) bool {
	if "" == host || 253 < len(host) {
		return false
	}
	if nil != net.ParseIP(host) {
		return true
	}
	for label := range strings.SplitSeq(strings.TrimSuffix(host, "."), ".") {
		if "" == label || 63 < len(label) || '-' == label[0] || '-' == label[len(label)-1] {
			return false
		}
		for _, ch := range label {
			if !('a' <= ch && ch <= 'z' || 'A' <= ch && ch <= 'Z' || '0' <= ch && ch <= '9' || '-' == ch) {
				return false
			}
		}
	}
	return true
}

// safeWebDAVEndpoint 仅保留协议和主机端口，不记录用户信息、路径、查询或片段。
func safeWebDAVEndpoint(endpoint string) string {
	address, err := url.Parse(endpoint)
	if err != nil || (address.Scheme != "http" && address.Scheme != "https") || !safeCloudErrorHost(address.Hostname()) {
		return ""
	}
	return address.Scheme + "://" + address.Host
}
