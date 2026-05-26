// SiYuan - Refactor your thinking
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

package plugin

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestConnectionHopByHopHeaders(t *testing.T) {
	header := http.Header{}
	header.Add("Connection", "X-Request-Id, keep-alive")
	header.Add("Connection", "X-Trace")

	got := connectionHopByHopHeaders(header)
	for _, name := range []string{"x-request-id", "keep-alive", "x-trace"} {
		if !got[name] {
			t.Fatalf("expected %q to be treated as hop-by-hop", name)
		}
	}
}

func TestCopyProxyHeadersFiltersAndOverwrites(t *testing.T) {
	dst := http.Header{}
	dst.Add("Content-Type", "application/json")
	dst.Add("Accept-Ranges", "old")
	dst.Add("X-Keep", "plugin")

	src := http.Header{}
	src.Add("Content-Type", "video/mp4")
	src.Add("Accept-Ranges", "bytes")
	src.Add("Connection", "X-Hop")
	src.Add("X-Hop", "drop")
	src.Add("Proxy-Connection", "close")
	src.Add("Set-Cookie", "cloud=session")
	src.Add("Transfer-Encoding", "chunked")

	copyProxyHeaders(dst, src)

	if got := dst.Values("Content-Type"); len(got) != 1 || got[0] != "video/mp4" {
		t.Fatalf("expected upstream content type to overwrite plugin header, got %v", got)
	}
	if got := dst.Values("Accept-Ranges"); len(got) != 1 || got[0] != "bytes" {
		t.Fatalf("expected upstream accept-ranges to overwrite plugin header, got %v", got)
	}
	for _, name := range []string{"Connection", "X-Hop", "Proxy-Connection", "Set-Cookie", "Transfer-Encoding"} {
		if got := dst.Values(name); len(got) != 0 {
			t.Fatalf("expected %q to be filtered, got %v", name, got)
		}
	}
	if got := dst.Values("X-Keep"); len(got) != 1 || got[0] != "plugin" {
		t.Fatalf("expected unrelated plugin header to remain, got %v", got)
	}
}

func TestNewProxyHTTPClientStreamsRedirectsWithProxyHeaders(t *testing.T) {
	client := newProxyHTTPClient()
	if client.CheckRedirect == nil {
		t.Fatal("expected redirect policy to be set")
	}

	final := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Range"); got != "bytes=0-" {
			t.Fatalf("expected Range to reach redirected request, got %q", got)
		}
		if got := r.Header.Get("User-Agent"); got != "pan.baidu.com" {
			t.Fatalf("expected User-Agent to reach redirected request, got %q", got)
		}
		if got := r.Header.Get("Referer"); got != "" {
			t.Fatalf("expected Referer to be dropped on redirected request, got %q", got)
		}
		w.WriteHeader(http.StatusPartialContent)
	}))
	defer final.Close()

	start := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, final.URL, http.StatusFound)
	}))
	defer start.Close()

	savedTransport := client.Transport
	client.Transport = http.DefaultTransport
	req, err := http.NewRequest(http.MethodGet, start.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Range", "bytes=0-")
	req.Header.Set("User-Agent", "pan.baidu.com")
	req.Header.Set("Referer", "https://drop.example.test/")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("expected redirect to be followed, got %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent {
		t.Fatalf("expected final response status, got %d", resp.StatusCode)
	}
	client.Transport = savedTransport

	tooMany := make([]*http.Request, 10)
	for i := range tooMany {
		tooMany[i] = &http.Request{Header: http.Header{}}
	}
	if err := client.CheckRedirect(&http.Request{Header: http.Header{}}, tooMany); err == nil {
		t.Fatal("expected redirect limit error")
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("expected *http.Transport, got %T", client.Transport)
	}
	if !transport.DisableCompression {
		t.Fatal("expected automatic compression handling to be disabled")
	}
}
