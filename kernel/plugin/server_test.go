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
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
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

func TestNewProxyHTTPClientUsesStrictSSRFPolicy(t *testing.T) {
	client := newProxyHTTPClient()
	if client.CheckRedirect == nil {
		t.Fatal("expected redirect policy to be set")
	}

	publicRedirect := &http.Request{
		URL:    &url.URL{Scheme: "https", Host: "1.1.1.1", Path: "/file"},
		Header: http.Header{"Referer": []string{"https://drop.example.test/"}},
	}
	if err := client.CheckRedirect(publicRedirect, nil); err != nil {
		t.Fatalf("expected public redirect to be accepted, got %v", err)
	}
	if got := publicRedirect.Header.Get("Referer"); got != "" {
		t.Fatalf("expected Referer to be dropped on redirect, got %q", got)
	}

	privateRedirect := &http.Request{URL: &url.URL{Scheme: "http", Host: "127.0.0.1"}}
	if err := client.CheckRedirect(privateRedirect, nil); err == nil {
		t.Fatal("expected private redirect to be rejected")
	}

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
	if _, err := transport.DialContext(context.Background(), "tcp", "127.0.0.1:80"); err == nil ||
		!strings.Contains(err.Error(), "prohibited") {
		t.Fatalf("expected strict dialer to reject loopback, got %v", err)
	}
}

func TestWriteProxyResponseRejectsPrivateTargets(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/plugin/private/test/proxy", nil)

	writeProxyResponse(context, &ResponseProxy{URL: "http://127.0.0.1/private"})
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected private proxy target to be forbidden, got %d", recorder.Code)
	}
}

func TestParseRequestRemovesInternalAuthorization(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/plugin/private/test/ping", nil)
	context.Request.Header.Set("Cookie", "session=secret")
	context.Request.Header.Set("Authorization", "Bearer secret")
	context.Request.Header.Set(model.XAuthTokenKey, "plugin-jwt")
	context.Request.Header.Set("X-Keep", "visible")

	request, err := parseRequest(context)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"Cookie", "Authorization", model.XAuthTokenKey} {
		if values := request.Request.Headers[name]; len(values) != 0 {
			t.Fatalf("expected %s to be removed, got %v", name, values)
		}
	}
	if values := request.Request.Headers["X-Keep"]; len(values) != 1 || values[0] != "visible" {
		t.Fatalf("expected unrelated header to remain, got %v", values)
	}
}

func TestOpenPluginResponseFileStaysInsidePluginRoots(t *testing.T) {
	root := t.TempDir()
	pluginDir := filepath.Join(root, "plugins", "test")
	storageDir := filepath.Join(root, "storage", "petal", "test")
	if err := os.MkdirAll(pluginDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(storageDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pluginDir, "asset.txt"), []byte("plugin"), 0644); err != nil {
		t.Fatal(err)
	}
	secretPath := filepath.Join(root, "secret.txt")
	if err := os.WriteFile(secretPath, []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	plugin := &KernelPlugin{
		Petal:      &model.Petal{Name: "test"},
		pluginDir:  pluginDir,
		storageDir: storageDir,
	}

	file, _, err := openPluginResponseFile(plugin, &ResponseFile{Path: "/data/plugins/test/asset.txt"})
	if err != nil {
		t.Fatalf("expected plugin file to open, got %v", err)
	}
	content, err := io.ReadAll(file)
	file.Close()
	if err != nil || string(content) != "plugin" {
		t.Fatalf("unexpected plugin file content %q, err=%v", content, err)
	}

	for _, path := range []string{secretPath, "/data/plugins/test/../other/secret.txt"} {
		if file, _, openErr := openPluginResponseFile(plugin, &ResponseFile{Path: path}); openErr == nil {
			file.Close()
			t.Fatalf("expected path %q to be rejected", path)
		}
	}
}
