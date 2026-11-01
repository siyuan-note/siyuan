// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"net/http"
	"strings"
	"testing"
)

// TestCalDAVPutValidation 验证 RFC 4791 §4.1 与 §5.3.2.1 对新写入日历对象的限制。
func TestCalDAVPutValidation(t *testing.T) {
	calDAV, _ := newDAVHandlerFixture(t)
	calendar := CalDavDefaultCalendarPath
	if response := davTestRequest(calDAV, http.MethodPut, calendar+"/existing.ics", davICalendarHeader, davTestEvent("existing", "Existing")); response.Code != http.StatusCreated {
		t.Fatalf("setup PUT: status = %d", response.Code)
	}
	wrap := func(lines ...string) string {
		return davCRLF(append(append([]string{"BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SiYuan test//EN"}, lines...), "END:VCALENDAR")...)
	}
	event := func(uid string, extra ...string) []string {
		return append(append([]string{"BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:20261101T000000Z", "DTSTART:20261102T090000Z"}, extra...), "END:VEVENT")
	}
	recurrence := append(event("series", "RRULE:FREQ=DAILY;COUNT=3"), event("series", "RECURRENCE-ID:20261103T090000Z")...)
	for _, test := range []struct {
		name, target, body string
		status             int
		precondition       string
	}{
		{"mixed components", "/mixed.ics", wrap(append(event("mixed"), "BEGIN:VTODO", "UID:mixed", "DTSTAMP:20261101T000000Z", "END:VTODO")...), http.StatusConflict, "valid-calendar-object-resource"},
		{"method property", "/method.ics", strings.Replace(davTestEvent("method", "M"), "PRODID", "METHOD:REQUEST\r\nPRODID", 1), http.StatusConflict, "valid-calendar-object-resource"},
		{"different UIDs", "/uids.ics", wrap(append(event("one"), event("two")...)...), http.StatusConflict, "valid-calendar-object-resource"},
		{"unsupported component", "/journal.ics", wrap("BEGIN:VJOURNAL", "UID:journal", "DTSTAMP:20261101T000000Z", "END:VJOURNAL"), http.StatusConflict, "supported-calendar-component"},
		{"UID used by another resource", "/copy.ics", davTestEvent("existing", "Copy"), http.StatusConflict, "no-uid-conflict"},
		{"overwrite with another UID", "/existing.ics", davTestEvent("replacement", "Other"), http.StatusConflict, "no-uid-conflict"},
		{"overwrite with same UID", "/existing.ics", davTestEvent("existing", "Updated"), http.StatusCreated, ""},
		{"recurrence override", "/series.ics", wrap(recurrence...), http.StatusCreated, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := davTestRequest(calDAV, http.MethodPut, calendar+test.target, davICalendarHeader, test.body)
			if response.Code != test.status || !strings.Contains(response.Body.String(), test.precondition) {
				t.Fatalf("status = %d, want %d with %q; body = %s", response.Code, test.status, test.precondition, response.Body.String())
			}
			if test.status != http.StatusCreated && test.target != "/existing.ics" {
				if get := davTestRequest(calDAV, http.MethodGet, calendar+test.target, nil, ""); get.Code != http.StatusNotFound {
					t.Fatalf("rejected PUT created the resource: GET status = %d", get.Code)
				}
			}
		})
	}
}

// TestCardDAVPutRejectsUIDConflict 验证同一通讯录内 vCard UID 不能重复，也不能用其他 UID 覆盖已有联系人。
func TestCardDAVPutRejectsUIDConflict(t *testing.T) {
	_, cardDAV := newDAVHandlerFixture(t)
	book := CardDavDefaultAddressBookPath
	if response := davTestRequest(cardDAV, http.MethodPut, book+"/alice.vcf", davVCardHeader, davTestCard("alice", "Alice")); response.Code != http.StatusCreated {
		t.Fatalf("setup PUT: status = %d", response.Code)
	}
	noUID := davCRLF("BEGIN:VCARD", "VERSION:3.0", "FN:No UID", "END:VCARD")
	for _, test := range []struct {
		name, target, body string
		status             int
	}{
		{"UID used by another resource", "/copy.vcf", davTestCard("alice", "Alice copy"), http.StatusConflict},
		{"overwrite with another UID", "/alice.vcf", davTestCard("bob", "Bob"), http.StatusConflict},
		{"overwrite with same UID", "/alice.vcf", davTestCard("alice", "Alice updated"), http.StatusCreated},
		{"card without UID", "/no-uid.vcf", noUID, http.StatusCreated},
		{"second card without UID", "/no-uid-2.vcf", noUID, http.StatusCreated},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := davTestRequest(cardDAV, http.MethodPut, book+test.target, davVCardHeader, test.body)
			want := ""
			if test.status == http.StatusConflict {
				want = "no-uid-conflict"
			}
			if response.Code != test.status || !strings.Contains(response.Body.String(), want) {
				t.Fatalf("status = %d, want %d with %q; body = %s", response.Code, test.status, want, response.Body.String())
			}
		})
	}
}
