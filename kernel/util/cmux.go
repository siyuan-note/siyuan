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
	}

	tlsListener := tls.NewListener(tlsL, tlsConfig)

	if httpServer == nil {
		httpServer = &http.Server{Handler: handler}
	} else {
		httpServer.Handler = handler
	}

	httpsServer := &http.Server{Handler: handler}

	go func() {
		if serveErr := httpServer.Serve(httpL); serveErr != nil && serveErr != cmux.ErrListenerClosed && !errors.Is(serveErr, http.ErrServerClosed) {
			logging.LogErrorf("multiplexed HTTP server error: %s", serveErr)
		}
	}()

	go func() {
		if serveErr := httpsServer.Serve(tlsListener); serveErr != nil && serveErr != cmux.ErrListenerClosed && !errors.Is(serveErr, http.ErrServerClosed) {
			logging.LogErrorf("multiplexed HTTPS server error: %s", serveErr)
		}
	}()

	return m.Serve()
}
