// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequestAcceptsHEIF(t *testing.T) {
	tests := []struct {
		name   string
		accept []string
		want   bool
	}{
		{name: "HEIC", accept: []string{"image/heic"}, want: true},
		{name: "HEIF", accept: []string{"image/heif"}, want: true},
		{name: "case insensitive", accept: []string{"IMAGE/HEIC"}, want: true},
		{name: "positive quality", accept: []string{"image/avif, image/heif; q=0.5, image/webp"}, want: true},
		{name: "minimum positive quality", accept: []string{"image/heic;q=0.001"}, want: true},
		{name: "maximum quality", accept: []string{"image/heif;q=1.000"}, want: true},
		{name: "parameters", accept: []string{"image/heic; q=1; version=1"}, want: true},
		{name: "quoted comma parameter", accept: []string{`image/heic; profile="alpha,beta"; q=0.7`}, want: true},
		{name: "HEIC inside quoted parameter", accept: []string{`application/example; profile=",image/heic,"`}, want: false},
		{name: "unclosed quoted parameter", accept: []string{`image/heic; profile="alpha,beta`}, want: false},
		{name: "multiple header lines", accept: []string{"image/avif", "image/heif; q=0.8"}, want: true},
		{name: "zero quality HEIC", accept: []string{"image/heic;q=0"}, want: false},
		{name: "zero quality HEIF", accept: []string{"image/png, image/heif; q=0"}, want: false},
		{name: "extended quality cannot override zero", accept: []string{`image/heic;q=0;q*=utf-8''1`}, want: false},
		{name: "continued quality is invalid", accept: []string{`image/heif;q*0*=utf-8''0.;q*1=8`}, want: false},
		{name: "NaN quality", accept: []string{"image/heic;q=NaN"}, want: false},
		{name: "infinite quality", accept: []string{"image/heif;q=Inf"}, want: false},
		{name: "quality above one", accept: []string{"image/heic;q=1.1"}, want: false},
		{name: "quality without leading zero", accept: []string{"image/heic;q=.5"}, want: false},
		{name: "exponential quality", accept: []string{"image/heic;q=1e-1"}, want: false},
		{name: "quality with leading zero", accept: []string{"image/heic;q=01"}, want: false},
		{name: "quality with four decimal places", accept: []string{"image/heic;q=0.5000"}, want: false},
		{name: "quoted quality", accept: []string{`image/heic;q="0.5"`}, want: false},
		{name: "invalid quality", accept: []string{"image/heic;q=invalid"}, want: false},
		{name: "image wildcard", accept: []string{"image/*"}, want: false},
		{name: "any wildcard", accept: []string{"*/*"}, want: false},
		{name: "missing", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/assets/image.heic", nil)
			for _, accept := range test.accept {
				request.Header.Add("Accept", accept)
			}
			if got := requestAcceptsHEIF(request); got != test.want {
				t.Fatalf("requestAcceptsHEIF() = %v, want %v for Accept %q", got, test.want, test.accept)
			}
		})
	}
}

func TestShouldTranscodeHEIF(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name       string
		requestURL string
		accept     string
		want       bool
	}{
		{name: "native full preview", requestURL: "/assets/image.heic", accept: "image/heic", want: false},
		{name: "fallback full preview", requestURL: "/assets/image.heic", accept: "image/webp", want: true},
		{name: "missing capability", requestURL: "/assets/image.heic", want: true},
		{name: "thumbnail with native support", requestURL: "/assets/image.heic?style=thumb", accept: "image/heic", want: true},
		{name: "thumbnail without native support", requestURL: "/assets/image.heic?style=thumb", want: true},
		{name: "download without native support", requestURL: "/assets/image.heic?download=true", want: false},
		{name: "case insensitive download", requestURL: "/assets/image.heic?download=TRUE", want: false},
		{name: "download overrides thumbnail", requestURL: "/assets/image.heic?download=true&style=thumb", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Request = httptest.NewRequest(http.MethodGet, test.requestURL, nil)
			if test.accept != "" {
				context.Request.Header.Set("Accept", test.accept)
			}
			if got := shouldTranscodeHEIF(context); got != test.want {
				t.Fatalf("shouldTranscodeHEIF() = %v, want %v for %q with Accept %q",
					got, test.want, test.requestURL, test.accept)
			}
		})
	}
}

func TestAddHEIFVaryAccept(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name           string
		requestURL     string
		initialVary    string
		wantAccept     bool
		wantOrigin     bool
		wantAcceptOnce bool
	}{
		{name: "full preview", requestURL: "/assets/image.heic", wantAccept: true, wantAcceptOnce: true},
		{
			name:           "preserves existing value",
			requestURL:     "/assets/image.heic",
			initialVary:    "Origin",
			wantAccept:     true,
			wantOrigin:     true,
			wantAcceptOnce: true,
		},
		{
			name:           "does not duplicate value",
			requestURL:     "/assets/image.heic",
			initialVary:    "Origin, accept",
			wantAccept:     true,
			wantOrigin:     true,
			wantAcceptOnce: true,
		},
		{name: "wildcard already varies", requestURL: "/assets/image.heic", initialVary: "*"},
		{name: "thumbnail", requestURL: "/assets/image.heic?style=thumb"},
		{name: "download", requestURL: "/assets/image.heic?download=true"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest(http.MethodGet, test.requestURL, nil)
			if test.initialVary != "" {
				context.Header("Vary", test.initialVary)
			}

			addHEIFVaryAccept(context)

			acceptCount := 0
			originFound := false
			for _, value := range recorder.Header().Values("Vary") {
				for _, field := range strings.Split(value, ",") {
					switch {
					case strings.EqualFold(strings.TrimSpace(field), "Accept"):
						acceptCount++
					case strings.EqualFold(strings.TrimSpace(field), "Origin"):
						originFound = true
					}
				}
			}
			if got := acceptCount > 0; got != test.wantAccept {
				t.Fatalf("Vary Accept presence = %v, want %v; header is %q", got, test.wantAccept,
					recorder.Header().Values("Vary"))
			}
			if originFound != test.wantOrigin {
				t.Fatalf("Vary Origin presence = %v, want %v; header is %q", originFound, test.wantOrigin,
					recorder.Header().Values("Vary"))
			}
			if test.wantAcceptOnce && acceptCount != 1 {
				t.Fatalf("Vary Accept count = %d, want 1; header is %q", acceptCount,
					recorder.Header().Values("Vary"))
			}
		})
	}
}
