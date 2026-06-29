package util

import (
	"crypto/tls"
	"errors"
	"net"
	"net/http"

	"github.com/siyuan-note/logging"
	"github.com/soheilhy/cmux"
)

func ServeMultiplexed(ln net.Listener, handler http.Handler, certPath, keyPath string, httpServer *http.Server) error {
	m := cmux.New(ln)

	tlsL := m.Match(cmux.TLS())
	httpL := m.Match(cmux.Any())

	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		logging.LogErrorf("failed to load TLS cert for multiplexing: %s", err)
		return err
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

	// HTTP 与 HTTPS 共用同一个 *http.Server，这样外部调用其 Shutdown 时可以一次性关闭两种连接上的活跃请求
	// （一个 *http.Server 允许同时在多个 listener 上 Serve，内部按 listener 各自 Accept 并复用同一组 handler）
	go func() {
		if serveErr := httpServer.Serve(httpL); serveErr != nil && !errors.Is(serveErr, cmux.ErrListenerClosed) && !errors.Is(serveErr, http.ErrServerClosed) {
			logging.LogErrorf("multiplexed HTTP server error: %s", serveErr)
		}
	}()

	go func() {
		if serveErr := httpServer.Serve(tlsListener); serveErr != nil && !errors.Is(serveErr, cmux.ErrListenerClosed) && !errors.Is(serveErr, http.ErrServerClosed) {
			logging.LogErrorf("multiplexed HTTPS server error: %s", serveErr)
		}
	}()

	return m.Serve()
}
