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

package model

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestIsLocalRequest(t *testing.T) {
	tests := []struct {
		name         string
		remoteAddr   string
		forwardedFor string
		wantLocal    bool
	}{
		{name: "direct loopback", remoteAddr: "127.0.0.1:1234", wantLocal: true},
		{name: "direct remote", remoteAddr: "192.0.2.10:1234", wantLocal: false},
		{name: "direct remote with spoofed forwarding", remoteAddr: "192.0.2.10:1234", forwardedFor: "127.0.0.1", wantLocal: false},
		{name: "local proxy for local client", remoteAddr: "127.0.0.1:1234", forwardedFor: "127.0.0.1", wantLocal: true},
		{name: "local proxy for remote client", remoteAddr: "127.0.0.1:1234", forwardedFor: "192.0.2.10", wantLocal: false},
		{name: "local proxy with spoofed chain", remoteAddr: "127.0.0.1:1234", forwardedFor: "127.0.0.1, 192.0.2.10", wantLocal: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			engine := gin.New()
			if err := engine.SetTrustedProxies([]string{"127.0.0.1", "::1"}); err != nil {
				t.Fatal(err)
			}
			engine.RemoteIPHeaders = []string{"X-Forwarded-For"}
			engine.GET("/", func(c *gin.Context) {
				if IsLocalRequest(c) {
					c.Status(http.StatusNoContent)
					return
				}
				c.Status(http.StatusUnauthorized)
			})

			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.RemoteAddr = test.remoteAddr
			if test.forwardedFor != "" {
				request.Header.Set("X-Forwarded-For", test.forwardedFor)
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)

			wantStatus := http.StatusUnauthorized
			if test.wantLocal {
				wantStatus = http.StatusNoContent
			}
			if recorder.Code != wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, wantStatus)
			}
		})
	}
}
