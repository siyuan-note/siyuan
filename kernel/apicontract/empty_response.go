package apicontract

// EmptyHTTPResponse 保留显式声明的无正文 HTTP 响应。
func EmptyHTTPResponse[Data any](status int) Response[Data] {
	if status == 0 {
		panic("empty response status must be explicit")
	}
	return Response[Data]{emptyStatus: status}
}

func (r Response[Data]) Empty() bool { return r.emptyStatus != 0 }

type HTTPRedirect struct {
	Status   int
	Location string
}

// RedirectHTTPContent 由 HTTP 适配器保留标准重定向的 Location 和 HTML 正文。
func RedirectHTTPContent(status int, location string) Response[BinaryContent] {
	return Response[BinaryContent]{redirect: &HTTPRedirect{Status: status, Location: location}}
}

func (r Response[Data]) Redirect() *HTTPRedirect { return r.redirect }
