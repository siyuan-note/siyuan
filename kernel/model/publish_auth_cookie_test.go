// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPublishAuthCookieValueIsNotClientComputable(t *testing.T) {
	const (
		ID       = "20260101000000-abcdefg"
		password = "hunter2"
	)
	value := PublishAuthCookieValue(ID, password)
	clientValue := util.SHA256Hash([]byte(ID + password))
	if value == clientValue || strings.Contains(value, clientValue) {
		t.Fatalf("cookie value is still client computable: %s", value)
	}
	if !checkPublishAuthCookieValue(value, ID, password) {
		t.Fatal("valid cookie value should pass")
	}
	if checkPublishAuthCookieValue(value, ID, "wrong-password") {
		t.Fatal("cookie value for a wrong password should fail")
	}
	if checkPublishAuthCookieValue(clientValue, ID, password) {
		t.Fatalf("client computable SHA-256 value should be rejected: %s", clientValue)
	}
}

func TestPublishAuthCookieValueServerSideExpiry(t *testing.T) {
	const (
		ID       = "20260101000000-abcdefg"
		password = "hunter2"
	)
	expired := publishAuthCookieValue(ID, password, time.Now().Add(-time.Minute).Unix())
	if checkPublishAuthCookieValue(expired, ID, password) {
		t.Fatal("expired cookie value should fail")
	}

	value := PublishAuthCookieValue(ID, password)
	expiry, signature, ok := strings.Cut(value, ":")
	if !ok || "" == expiry || "" == signature {
		t.Fatalf("unexpected cookie value format: %s", value)
	}
	forged := expiry + "1:" + signature
	if checkPublishAuthCookieValue(forged, ID, password) {
		t.Fatal("cookie value with a tampered expiry should fail")
	}
}

func TestCheckPublishAuthCookie(t *testing.T) {
	const (
		ID       = "20260101000000-abcdefg"
		password = "hunter2"
	)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	if CheckPublishAuthCookie(c, ID, password) {
		t.Fatal("request without a cookie should fail")
	}
	if CheckPublishAuthCookie(nil, ID, password) {
		t.Fatal("nil context should fail")
	}

	c.Request.AddCookie(&http.Cookie{Name: "publish-auth-" + ID, Value: PublishAuthCookieValue(ID, password)})
	if !CheckPublishAuthCookie(c, ID, password) {
		t.Fatal("request with a valid cookie should pass")
	}
	if CheckPublishAuthCookie(c, ID, "other-password") {
		t.Fatal("request with a wrong password should fail")
	}
}
