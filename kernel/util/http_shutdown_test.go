package util

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestShutdownHTTPServersWaitsForResponses(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{}, 2)
	shutdownStarted := make(chan struct{}, 2)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		<-release
		_, _ = io.WriteString(w, "exit completed")
	})
	httpServer := httptest.NewServer(handler)
	httpsServer := httptest.NewTLSServer(handler)
	t.Cleanup(httpServer.Close)
	t.Cleanup(httpsServer.Close)
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
