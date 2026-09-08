package util

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/siyuan-note/httpclient"
	"golang.org/x/net/http/httpguts"
)

type aiProviderHeaderTransport struct {
	base    http.RoundTripper
	origin  *url.URL
	headers http.Header
	err     error
}

// ValidateAIProviderHeaders 在保存配置和发送请求前校验请求头，不在错误中包含凭据。
func ValidateAIProviderHeaders(headers map[string]string) error {
	names := map[string]bool{}
	for name, value := range headers {
		key := http.CanonicalHeaderKey(name)
		if !httpguts.ValidHeaderFieldName(name) || !httpguts.ValidHeaderFieldValue(value) || names[key] {
			return errors.New("invalid AI provider HTTP headers")
		}
		names[key] = true
	}
	return nil
}

// newAIProviderHTTPClient 为供应商请求注入自定义头，覆盖同名默认头，并限制在配置的源站内。
func newAIProviderHTTPClient(baseURL string, headers ...map[string]string) *http.Client {
	if len(headers) == 0 || len(headers[0]) == 0 {
		return httpclient.NewUserAgentClient(nil)
	}
	origin, err := url.Parse(baseURL)
	transport := &aiProviderHeaderTransport{
		base: httpclient.NewTransport(false), origin: origin, headers: http.Header{}, err: err,
	}
	if err := ValidateAIProviderHeaders(headers[0]); err != nil {
		transport.err = err
	}
	for name, value := range headers[0] {
		transport.headers.Set(name, value)
	}
	return httpclient.NewUserAgentClient(transport)
}

func (t *aiProviderHeaderTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if t.err != nil {
		if req.Body != nil {
			req.Body.Close()
		}
		return nil, t.err
	}
	// 重定向到其他源站时不附加供应商凭据。
	if strings.EqualFold(req.URL.Scheme, t.origin.Scheme) && strings.EqualFold(req.URL.Host, t.origin.Host) {
		req = req.Clone(req.Context())
		for name, values := range t.headers {
			if name == "Host" {
				req.Host = values[0]
			} else {
				req.Header[name] = append([]string(nil), values...)
			}
		}
	}
	return t.base.RoundTrip(req)
}
