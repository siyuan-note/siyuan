package model

import (
	"context"
	"errors"
	"io"
	"net"
	"net/url"
	"os"
	"strings"
)

// cloudLockErrorDetail 仅展示本地化的错误类别和主机名，不展示请求地址、凭据或响应正文。
func cloudLockErrorDetail(err error, language func(int) string) string {
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

// safeCloudErrorHost 限制主机名字符，防止异常字段携带 HTML、路径或查询参数。
func safeCloudErrorHost(host string) bool {
	if "" == host || 253 < len(host) {
		return false
	}
	if nil != net.ParseIP(host) {
		return true
	}
	for _, label := range strings.Split(strings.TrimSuffix(host, "."), ".") {
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
