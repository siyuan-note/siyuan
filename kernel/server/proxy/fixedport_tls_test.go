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

package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestFixedPortReverseProxyMarksClientTLSState 校验固定端口反代把客户端侧的真实连接方式
// 传给以 HTTPS 回源的内核，并清除调用方伪造的同名头部。
func TestFixedPortReverseProxyMarksClientTLSState(t *testing.T) {
	requestInfo := make(chan http.Header, 2)
	backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestInfo <- request.Header.Clone()
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()

	proxy := httptest.NewServer(newFixedPortReverseProxy(mustParseURL(t, backend.URL)))
	defer proxy.Close()

	// 明文客户端连接：不得标记，且调用方伪造的头部要被清除
	request, err := http.NewRequest(http.MethodGet, proxy.URL+"/api/system/version", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set(util.ClientTLSHeader, util.ClientTLSHeaderValue)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if header := <-requestInfo; "" != header.Get(util.ClientTLSHeader) {
		t.Fatalf("%s = %q, want empty for plaintext client", util.ClientTLSHeader, header.Get(util.ClientTLSHeader))
	}

	// TLS 客户端连接：回源请求必须带上标记
	tlsProxy := httptest.NewTLSServer(newFixedPortReverseProxy(mustParseURL(t, backend.URL)))
	defer tlsProxy.Close()
	response, err = tlsProxy.Client().Get(tlsProxy.URL + "/api/system/version")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if header := <-requestInfo; util.ClientTLSHeaderValue != header.Get(util.ClientTLSHeader) {
		t.Fatalf("%s = %q, want %q for TLS client", util.ClientTLSHeader, header.Get(util.ClientTLSHeader), util.ClientTLSHeaderValue)
	}
}
