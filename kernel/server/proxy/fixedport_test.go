// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package proxy

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestInitFixedPortService(t *testing.T) {
	const childEnv = "SIYUAN_TEST_FIXED_PORT_SERVICE_CASE"
	cases := []struct {
		name     string
		disabled bool
		tls      bool
		samePort bool
		occupied bool
	}{
		{name: "default keeps proxy enabled"},
		{name: "disabled HTTP proxy", disabled: true},
		{name: "disabled TLS proxy", disabled: true, tls: true},
		{name: "main port stays available", disabled: true, samePort: true},
		{name: "same main port needs no proxy", samePort: true},
		{name: "occupied port stays available", occupied: true},
	}

	for _, tc := range cases {
		if os.Getenv(childEnv) == tc.name {
			// Each startup runs in its own test process: the production service
			// blocks while serving and has no separate shutdown handle.
			backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Write([]byte("fixed-port-backend:" + request.URL.Path))
			}))
			defer backend.Close()
			util.ServerURL = mustParseURL(t, backend.URL)
			util.ServerPort = util.ServerURL.Port()
			if !util.FixedPortEnabled {
				t.Fatal("fixed-port proxy must be enabled by default")
			}
			util.FixedPortEnabled = !tc.disabled
			var fixedPort string
			if tc.samePort || tc.occupied {
				fixedPort = util.ServerPort
				if tc.occupied {
					util.ServerPort = "0"
				}
			} else {
				listener, err := net.Listen("tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				fixedPort = strings.TrimPrefix(listener.Addr().String(), "127.0.0.1:")
				listener.Close()
			}

			certPath, keyPath := "", ""
			if tc.tls {
				// Disabling the proxy must return before trying to load certificates.
				certPath, keyPath = "unused-cert.pem", "unused-key.pem"
			}
			done := make(chan struct{})
			go func() {
				initFixedPortService("127.0.0.1", certPath, keyPath, fixedPort)
				close(done)
			}()
			address := net.JoinHostPort("127.0.0.1", fixedPort)
			if tc.disabled || tc.samePort || tc.occupied {
				select {
				case <-done:
				case <-time.After(3 * time.Second):
					t.Fatal("fixed-port service did not skip startup")
				}
				if !tc.samePort && !tc.occupied {
					listener, err := net.Listen("tcp", address)
					if err != nil {
						t.Fatalf("disabled proxy still occupies its port: %s", err)
					}
					listener.Close()
					return
				}
			}

			client := &http.Client{Timeout: time.Second}
			deadline := time.Now().Add(3 * time.Second)
			for {
				response, err := client.Get("http://" + address + "/api/system/version")
				if err == nil {
					body, readErr := io.ReadAll(response.Body)
					response.Body.Close()
					if readErr != nil || response.StatusCode != http.StatusOK || string(body) != "fixed-port-backend:/api/system/version" {
						t.Fatalf("unexpected backend response: status=%d body=%q err=%v", response.StatusCode, body, readErr)
					}
					return
				}
				if time.Now().After(deadline) {
					t.Fatalf("service did not become available: %s", err)
				}
				time.Sleep(10 * time.Millisecond)
			}
		}
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestInitFixedPortService$", "-test.v")
			for _, env := range os.Environ() {
				if !strings.HasPrefix(env, childEnv+"=") {
					command.Env = append(command.Env, env)
				}
			}
			command.Env = append(command.Env, childEnv+"="+tc.name)
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("startup test failed: %s\n%s", err, output)
			}
		})
	}
}

func TestFixedPortReverseProxyRebuildsForwardedHeaders(t *testing.T) {
	requestInfo := make(chan http.Header, 1)
	hostInfo := make(chan string, 1)
	backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestInfo <- request.Header.Clone()
		hostInfo <- request.Host
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()

	proxy := httptest.NewServer(newFixedPortReverseProxy(mustParseURL(t, backend.URL)))
	defer proxy.Close()

	request, err := http.NewRequest(http.MethodGet, proxy.URL+"/api/system/getWorkspaceInfo", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = "192.0.2.1:6806"
	request.Header.Set("Forwarded", "for=127.0.0.1")
	request.Header.Set("X-Forwarded-For", "127.0.0.1")
	request.Header.Set("X-Forwarded-Host", "127.0.0.1:6806")
	request.Header.Set("X-Forwarded-Proto", "https")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("proxy returned %d, want %d", response.StatusCode, http.StatusNoContent)
	}

	headers := <-requestInfo
	forwardedFor := headers.Get("X-Forwarded-For")
	if ip := net.ParseIP(forwardedFor); ip == nil || !ip.IsLoopback() {
		t.Fatalf("X-Forwarded-For = %q, want proxy client loopback address", forwardedFor)
	}
	if actual := headers.Get("X-Forwarded-Host"); actual != request.Host {
		t.Fatalf("X-Forwarded-Host = %q, want %q", actual, request.Host)
	}
	if actual := headers.Get("X-Forwarded-Proto"); actual != "http" {
		t.Fatalf("X-Forwarded-Proto = %q, want http", actual)
	}
	if actual := headers.Get("Forwarded"); actual != "" {
		t.Fatalf("Forwarded = %q, want empty", actual)
	}
	if actual := <-hostInfo; actual != request.Host {
		t.Fatalf("Host = %q, want %q", actual, request.Host)
	}
}

func mustParseURL(t *testing.T, rawURL string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}
