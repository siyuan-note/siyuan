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

package server

import (
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"

	"github.com/gin-gonic/gin"
)

type assetRequestPathTest struct {
	name        string
	requestPath string
	want        bool
}

func TestIsValidAssetRequestPath(t *testing.T) {
	tests := []assetRequestPathTest{
		{name: "regular", requestPath: "/image.png", want: true},
		{name: "Chinese ellipsis", requestPath: "/何照人-东方女性不只...-20260721.mp4", want: true},
		{name: "double dots in filename", requestPath: "/foo..bar.mp4", want: true},
		{name: "nested", requestPath: "/images/cover.png", want: true},
		{name: "empty", requestPath: "", want: false},
		{name: "root", requestPath: "/", want: false},
		{name: "current directory", requestPath: "/.", want: false},
		{name: "parent directory", requestPath: "/../secret", want: false},
		{name: "nested parent directory", requestPath: "/images/../secret", want: false},
		{name: "nested current directory", requestPath: "/images/./cover.png", want: false},
		{name: "empty segment", requestPath: "/images//cover.png", want: false},
	}

	if runtime.GOOS == "windows" {
		tests = append(tests,
			assetRequestPathTest{name: "Windows parent directory", requestPath: `/images\..\secret`, want: false},
			assetRequestPathTest{name: "Windows drive", requestPath: `/C:\secret`, want: false},
		)
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isValidAssetRequestPath(test.requestPath); got != test.want {
				t.Fatalf("isValidAssetRequestPath(%q) = %v, want %v", test.requestPath, got, test.want)
			}
		})
	}
}

func TestAssetRequestPathURLDecoding(t *testing.T) {
	engine := gin.New()
	engine.GET("/assets/*path", func(context *gin.Context) {
		if !isValidAssetRequestPath(context.Param("path")) {
			context.Status(http.StatusForbidden)
			return
		}
		context.Status(http.StatusNoContent)
	})

	tests := []struct {
		name       string
		requestURL string
		wantStatus int
	}{
		{name: "encoded Chinese filename", requestURL: "/assets/%E4%BD%95%E7%85%A7%E4%BA%BA...mp4", wantStatus: http.StatusNoContent},
		{name: "encoded parent directory", requestURL: "/assets/%2e%2e/secret", wantStatus: http.StatusForbidden},
		{name: "encoded separators", requestURL: "/assets/images%2f..%2fsecret", wantStatus: http.StatusForbidden},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, test.requestURL, nil)
			engine.ServeHTTP(recorder, request)
			if recorder.Code != test.wantStatus {
				t.Fatalf("GET %q returned %d, want %d", test.requestURL, recorder.Code, test.wantStatus)
			}
		})
	}
}
