// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"net/http"
	"strings"
	"testing"
)

// TestDAVErrorStatuses 验证缺失或无效的资源返回 RFC 规定的状态码，而不是 500。
func TestDAVErrorStatuses(t *testing.T) {
	calDAV, cardDAV := newDAVHandlerFixture(t)
	calendar, book := CalDavDefaultCalendarPath, CardDavDefaultAddressBookPath
	noStamp := strings.Replace(davTestEvent("no-stamp", "No stamp"), "DTSTAMP:20261101T000000Z\r\n", "", 1)
	for _, test := range []struct {
		name    string
		handler http.Handler
		method  string
		target  string
		header  map[string]string
		body    string
		status  int
		want    string
	}{
		{"calendar/get missing", calDAV, http.MethodGet, calendar + "/missing.ics", nil, "", http.StatusNotFound, ""},
		{"calendar/delete missing", calDAV, http.MethodDelete, calendar + "/missing.ics", nil, "", http.StatusNotFound, ""},
		{"calendar/options missing", calDAV, http.MethodOptions, calendar + "/missing.ics", nil, "", http.StatusNoContent, ""},
		{"calendar/propfind missing collection", calDAV, "PROPFIND", CalDavHomeSetPath + "/missing", map[string]string{"Depth": "0"}, "", http.StatusNotFound, ""},
		{"calendar/put missing collection", calDAV, http.MethodPut, CalDavHomeSetPath + "/missing/a.ics", davICalendarHeader, davTestEvent("a", "A"), http.StatusConflict, ""},
		{"calendar/put without extension", calDAV, http.MethodPut, calendar + "/a", davICalendarHeader, davTestEvent("a", "A"), http.StatusForbidden, ""},
		{"calendar/put invalid data", calDAV, http.MethodPut, calendar + "/a.ics", davICalendarHeader, noStamp, http.StatusConflict, "valid-calendar-data"},
		{"calendar/multiget missing href", calDAV, "REPORT", calendar, davXMLHeader,
			`<?xml version="1.0"?><C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/></D:prop><D:href>` + calendar + `/missing.ics</D:href></C:calendar-multiget>`,
			http.StatusMultiStatus, "404 Not Found"},
		{"contact/get missing", cardDAV, http.MethodGet, book + "/missing.vcf", nil, "", http.StatusNotFound, ""},
		{"contact/delete missing", cardDAV, http.MethodDelete, book + "/missing.vcf", nil, "", http.StatusNotFound, ""},
		{"contact/options missing", cardDAV, http.MethodOptions, book + "/missing.vcf", nil, "", http.StatusNoContent, ""},
		{"contact/put missing collection", cardDAV, http.MethodPut, CardDavHomeSetPath + "/missing/a.vcf", davVCardHeader, davTestCard("a", "A"), http.StatusConflict, ""},
		{"contact/put without extension", cardDAV, http.MethodPut, book + "/a", davVCardHeader, davTestCard("a", "A"), http.StatusForbidden, ""},
		{"contact/multiget missing href", cardDAV, "REPORT", book, davXMLHeader,
			`<?xml version="1.0"?><C:addressbook-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:prop><D:getetag/></D:prop><D:href>` + book + `/missing.vcf</D:href></C:addressbook-multiget>`,
			http.StatusMultiStatus, "404 Not Found"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := davTestRequest(test.handler, test.method, test.target, test.header, test.body)
			if response.Code != test.status || !strings.Contains(response.Body.String(), test.want) {
				t.Fatalf("status = %d, want %d containing %q; body = %s", response.Code, test.status, test.want, response.Body.String())
			}
		})
	}
}
