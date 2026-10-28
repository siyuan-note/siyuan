// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/soheilhy/cmux"
)

func TestShutdownHTTPServersWaitsForResponses(t *testing.T) {
	testShutdownHTTPServersWaitsForResponses(t, false)
}

func TestShutdownHTTPServersWaitsForMultiplexedResponses(t *testing.T) {
	testShutdownHTTPServersWaitsForResponses(t, true)
}

func testShutdownHTTPServersWaitsForResponses(t *testing.T, multiplexed bool) {
	t.Helper()
	originalPath := logging.LogPath
	t.Cleanup(func() { logging.SetLogPath(originalPath) })
	logPath := filepath.Join(t.TempDir(), "shutdown.log")
	logging.SetLogPath(logPath)

	release := make(chan struct{})
	started := make(chan struct{}, 2)
	shutdownStarted := make(chan struct{}, 2)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		_, _ = io.WriteString(w, "exit completed")
	})
	httpServer := httptest.NewUnstartedServer(handler)
	httpsServer := httptest.NewUnstartedServer(handler)
	if multiplexed {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		m := cmux.New(listener)
		_ = httpServer.Listener.Close()
		_ = httpsServer.Listener.Close()
		httpsServer.Listener = m.Match(cmux.TLS())
		httpServer.Listener = m.Match(cmux.Any())
		serveDone := make(chan struct{})
		go func() {
			_ = m.Serve()
			close(serveDone)
		}()
		t.Cleanup(func() {
			_ = listener.Close()
			select {
			case <-serveDone:
			case <-time.After(5 * time.Second):
				t.Error("multiplexer did not stop")
			}
		})
	}
	t.Cleanup(httpServer.Close)
	t.Cleanup(httpsServer.Close)
	httpServer.Start()
	httpsServer.StartTLS()
	for _, server := range []*httptest.Server{httpServer, httpsServer} {
		server.Config.RegisterOnShutdown(func() { shutdownStarted <- struct{}{} })
	}
	results := make(chan error, 2)
	for _, server := range []*httptest.Server{httpServer, httpsServer} {
		go func(server *httptest.Server) {
			response, err := server.Client().Get(server.URL)
			if err == nil {
				var body []byte
				body, err = io.ReadAll(response.Body)
				response.Body.Close()
				if err == nil && string(body) != "exit completed" {
					err = io.ErrUnexpectedEOF
				}
			}
			results <- err
		}(server)
	}
	for range 2 {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			close(release)
			t.Fatal("exit request did not start")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	finished := make(chan struct{})
	go func() {
		ShutdownHTTPServers(ctx, nil, httpServer.Config, httpsServer.Config)
		close(finished)
	}()
	for range 2 {
		select {
		case <-shutdownStarted:
		case <-time.After(5 * time.Second):
			close(release)
			t.Fatal("HTTP and HTTPS shutdown did not start together")
		}
	}
	select {
	case <-finished:
		close(release)
		t.Fatal("server shutdown dropped an active exit response")
	case <-time.After(650 * time.Millisecond):
	}
	close(release)
	for range 2 {
		select {
		case err := <-results:
			if err != nil {
				t.Fatalf("exit response failed during shutdown: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("exit response was not received")
		}
	}
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("server shutdown did not finish after exit responses")
	}
	data, err := os.ReadFile(logPath)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "graceful HTTP server shutdown failed") {
		t.Fatalf("successful shutdown logged as a failure: %s", data)
	}
}

func TestShutdownHTTPServersClosesOnTimeout(t *testing.T) {
	started := make(chan struct{})
	requestEnded := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(requestEnded)
	}))
	t.Cleanup(server.Close)
	result := make(chan error, 1)
	go func() {
		response, err := server.Client().Get(server.URL)
		if response != nil {
			response.Body.Close()
		}
		result <- err
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("blocking request did not start")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	ShutdownHTTPServers(ctx, server.Config)
	select {
	case <-requestEnded:
	case <-time.After(5 * time.Second):
		t.Fatal("timed-out shutdown did not close the active connection")
	}
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("timed-out request unexpectedly succeeded")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed-out request was not canceled")
	}
}
