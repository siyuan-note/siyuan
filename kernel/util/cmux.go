package util

import (
	"crypto/tls"
	"errors"
	"net"
	"net/http"

	"github.com/siyuan-note/logging"
	"github.com/soheilhy/cmux"
)

// ServeMultiplexed 在同一个 listener 上同时承载 HTTP 与 HTTPS（含 HTTP/2）。
//
// httpServer / httpsServer 用于承载两种连接的 *http.Server，传 nil 时内部自行创建。
// 返回实际使用的两个 server，方便调用方在需要时关闭其上的活跃连接（如发布服务）。
//
// 注意：cmux 派生出的 listener 内部嵌入的是底层 root listener，对其调用 Close 实际会关闭 root，
// 因此 HTTP 与 HTTPS 必须使用各自的 *http.Server，不能共用——否则共用 server 的 Close 会把 root
// 一并关掉，导致 m.Serve 提前返回非关闭类错误。
func ServeMultiplexed(ln net.Listener, handler http.Handler, certPath, keyPath string, httpServer, httpsServer *http.Server) (*http.Server, *http.Server, error) {
	m := cmux.New(ln)

	tlsL := m.Match(cmux.TLS())
	httpL := m.Match(cmux.Any())

	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		logging.LogErrorf("failed to load TLS cert for multiplexing: %s", err)
		return nil, nil, err
	}

	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		NextProtos:   []string{"h2", "http/1.1"},
	}

	tlsListener := tls.NewListener(tlsL, tlsConfig)

	if httpServer == nil {
		httpServer = &http.Server{Handler: handler}
	} else {
		httpServer.Handler = handler
	}
	if httpsServer == nil {
		httpsServer = &http.Server{Handler: handler}
	} else {
		httpsServer.Handler = handler
	}

	go func() {
		if serveErr := httpServer.Serve(httpL); serveErr != nil && !errors.Is(serveErr, cmux.ErrListenerClosed) && !errors.Is(serveErr, http.ErrServerClosed) {
			logging.LogErrorf("multiplexed HTTP server error: %s", serveErr)
		}
	}()

	go func() {
		if serveErr := httpsServer.Serve(tlsListener); serveErr != nil && !errors.Is(serveErr, cmux.ErrListenerClosed) && !errors.Is(serveErr, http.ErrServerClosed) {
			logging.LogErrorf("multiplexed HTTPS server error: %s", serveErr)
		}
	}()

	return httpServer, httpsServer, m.Serve()
}
