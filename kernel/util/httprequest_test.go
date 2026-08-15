// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package util

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestSSRFSafeClientUsesLocalProxyAndPinsTarget(t *testing.T) {
	var connectHost, requestedHost string
	proxy := testTunnelProxy(t, "proxied", func(connectReq, targetReq *http.Request) {
		connectHost = connectReq.Host
		requestedHost = targetReq.Host
	})
	setTestNetworkProxy(t, proxy.URL)

	client := newSSRFSafeClientWithResolver(testPublicResolver)
	resp, err := client.Get("http://public.test/path")
	if err != nil {
		t.Fatalf("request through local proxy failed: %v", err)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read proxy response failed: %v", err)
	}
	if err = resp.Body.Close(); err != nil {
		t.Fatalf("close proxy response failed: %v", err)
	}
	if string(body) != "proxied" {
		t.Fatalf("response body = %q, want %q", body, "proxied")
	}
	if connectHost != "203.0.113.10:80" {
		t.Fatalf("proxy target = %q, want pinned public IP", connectHost)
	}
	if requestedHost != "public.test" {
		t.Fatalf("Host = %q, want original host", requestedHost)
	}
}

func TestSSRFSafeClientRejectsPrivateTargetBeforeProxy(t *testing.T) {
	var proxyRequests atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		proxyRequests.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer proxy.Close()
	setTestNetworkProxy(t, proxy.URL)

	client := newSSRFSafeClientWithResolver(func(_ context.Context, host string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
	})
	_, err := client.Get("http://private.test/")
	if err == nil || !strings.Contains(err.Error(), "access to private/internal IP is prohibited") {
		t.Fatalf("private target error = %v", err)
	}
	if proxyRequests.Load() != 0 {
		t.Fatalf("proxy received %d private target requests, want 0", proxyRequests.Load())
	}
}

func TestSSRFSafeClientUsesUpdatedProxy(t *testing.T) {
	firstProxy := testResponseProxy(t, "first")
	secondProxy := testResponseProxy(t, "second")
	client := newSSRFSafeClientWithResolver(testPublicResolver)

	setTestNetworkProxy(t, firstProxy.URL)
	if body := getTestResponseBody(t, client, "http://public.test/"); body != "first" {
		t.Fatalf("first proxy response = %q, want %q", body, "first")
	}

	setTestNetworkProxy(t, secondProxy.URL)
	if body := getTestResponseBody(t, client, "http://public.test/"); body != "second" {
		t.Fatalf("second proxy response = %q, want %q", body, "second")
	}
}

func TestSSRFSafeClientUsesSOCKS5Proxy(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen SOCKS5 proxy failed: %v", err)
	}
	t.Cleanup(func() { listener.Close() })
	targets := make(chan string, 1)
	errs := make(chan error, 1)
	go serveTestSOCKS5Connection(listener, targets, errs)

	setTestNetworkProxy(t, "socks5://"+listener.Addr().String())
	client := newSSRFSafeClientWithResolver(testPublicResolver)
	if body := getTestResponseBody(t, client, "http://public.test/"); body != "socks5" {
		t.Fatalf("SOCKS5 proxy response = %q, want %q", body, "socks5")
	}
	select {
	case err = <-errs:
		t.Fatalf("SOCKS5 proxy failed: %v", err)
	case target := <-targets:
		if target != "203.0.113.10:80" {
			t.Fatalf("SOCKS5 target = %q, want pinned public IP", target)
		}
	}
}

func TestSSRFSafeClientUsesHTTPProxyAuthentication(t *testing.T) {
	var proxyAuthorization string
	proxy := testTunnelProxy(t, "authenticated", func(connectReq, _ *http.Request) {
		proxyAuthorization = connectReq.Header.Get("Proxy-Authorization")
	})
	authenticatedProxyURL := strings.Replace(proxy.URL, "http://", "http://user:pass@", 1)
	setTestNetworkProxy(t, authenticatedProxyURL)

	client := newSSRFSafeClientWithResolver(testPublicResolver)
	if body := getTestResponseBody(t, client, "http://public.test/"); body != "authenticated" {
		t.Fatalf("authenticated proxy response = %q, want %q", body, "authenticated")
	}
	if proxyAuthorization != "Basic dXNlcjpwYXNz" {
		t.Fatalf("Proxy-Authorization = %q", proxyAuthorization)
	}
}

func TestNetworkProxyLogValueRemovesCredentials(t *testing.T) {
	got := networkProxyLogValue("http://user:pass@127.0.0.1:7890")
	if got != "http://127.0.0.1:7890" {
		t.Fatalf("network proxy log value = %q", got)
	}
}

func testPublicResolver(_ context.Context, host string) ([]net.IPAddr, error) {
	return []net.IPAddr{{IP: net.ParseIP("203.0.113.10")}}, nil
}

func setTestNetworkProxy(t *testing.T, proxyURL string) {
	t.Helper()
	t.Setenv("HTTP_PROXY", proxyURL)
	t.Setenv("HTTPS_PROXY", proxyURL)
	t.Setenv("http_proxy", proxyURL)
	t.Setenv("https_proxy", proxyURL)
	t.Setenv("NO_PROXY", "")
	t.Setenv("no_proxy", "")
}

func testResponseProxy(t *testing.T, body string) *httptest.Server {
	t.Helper()
	return testTunnelProxy(t, body, nil)
}

func getTestResponseBody(t *testing.T, client *http.Client, rawURL string) string {
	t.Helper()
	resp, err := client.Get(rawURL)
	if err != nil {
		t.Fatalf("GET %q failed: %v", rawURL, err)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read %q failed: %v", rawURL, err)
	}
	if err = resp.Body.Close(); err != nil {
		t.Fatalf("close %q failed: %v", rawURL, err)
	}
	return string(body)
}

func testTunnelProxy(t *testing.T, body string, inspect func(*http.Request, *http.Request)) *httptest.Server {
	t.Helper()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, connectReq *http.Request) {
		if connectReq.Method != http.MethodConnect {
			t.Errorf("proxy method = %q, want CONNECT", connectReq.Method)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			t.Error("proxy response writer does not support hijacking")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		conn, rw, err := hijacker.Hijack()
		if err != nil {
			t.Errorf("hijack proxy connection failed: %v", err)
			return
		}
		defer conn.Close()
		if _, err = rw.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
			t.Errorf("write CONNECT response failed: %v", err)
			return
		}
		if err = rw.Flush(); err != nil {
			t.Errorf("flush CONNECT response failed: %v", err)
			return
		}
		targetReq, err := http.ReadRequest(bufio.NewReader(conn))
		if err != nil {
			t.Errorf("read tunneled request failed: %v", err)
			return
		}
		if inspect != nil {
			inspect(connectReq, targetReq)
		}
		if _, err = fmt.Fprintf(conn, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: %d\r\n\r\n%s", len(body), body); err != nil {
			t.Errorf("write tunneled response failed: %v", err)
		}
	}))
	t.Cleanup(proxy.Close)
	return proxy
}

func serveTestSOCKS5Connection(listener net.Listener, targets chan<- string, errs chan<- error) {
	conn, err := listener.Accept()
	if err != nil {
		errs <- err
		return
	}
	defer conn.Close()
	reader := bufio.NewReader(conn)
	greeting := make([]byte, 2)
	if _, err = io.ReadFull(reader, greeting); err != nil {
		errs <- err
		return
	}
	methods := make([]byte, int(greeting[1]))
	if _, err = io.ReadFull(reader, methods); err != nil {
		errs <- err
		return
	}
	if _, err = conn.Write([]byte{5, 0}); err != nil {
		errs <- err
		return
	}
	request := make([]byte, 10)
	if _, err = io.ReadFull(reader, request); err != nil {
		errs <- err
		return
	}
	if request[0] != 5 || request[1] != 1 || request[3] != 1 {
		errs <- fmt.Errorf("unexpected SOCKS5 request header %v", request[:4])
		return
	}
	targetIP := net.IP(request[4:8]).String()
	targetPort := int(request[8])<<8 | int(request[9])
	targets <- net.JoinHostPort(targetIP, fmt.Sprintf("%d", targetPort))
	if _, err = conn.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}); err != nil {
		errs <- err
		return
	}
	targetReq, err := http.ReadRequest(reader)
	if err != nil {
		errs <- err
		return
	}
	if targetReq.Host != "public.test" {
		errs <- fmt.Errorf("Host = %q, want original host", targetReq.Host)
		return
	}
	_, err = fmt.Fprint(conn, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 6\r\n\r\nsocks5")
	if err != nil {
		errs <- err
	}
}
