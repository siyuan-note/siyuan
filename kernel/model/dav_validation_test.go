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
	foldedEvent := func(uid, fold string) string {
		return strings.Replace(davTestEvent(uid, uid), "END:VCALENDAR", "END:VCAL"+fold+"ENDAR", 1)
	}
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
		{"overwrite with same UID", "/existing.ics", davTestEvent("existing", "Updated"), http.StatusNoContent, ""},
		{"recurrence override", "/series.ics", wrap(recurrence...), http.StatusCreated, ""},
		{"two calendar objects", "/two.ics", davTestEvent("first", "First") + davTestEvent("second", "Second"), http.StatusConflict, "valid-calendar-data"},
		{"trailing data", "/trailing.ics", davTestEvent("trailing", "T") + "BEGIN:VEVENT\r\n", http.StatusConflict, "valid-calendar-data"},
		{"trailing blank lines", "/blank.ics", davTestEvent("blank", "B") + "\r\n\r\n", http.StatusCreated, ""},
		{"folded calendar end", "/folded.ics", foldedEvent("folded", "\r\n "), http.StatusCreated, ""},
		{"tab-folded calendar end", "/tab-folded.ics", foldedEvent("tab-folded", "\r\n\t"), http.StatusCreated, ""},
		{"LF-folded calendar end", "/lf-folded.ics", foldedEvent("lf-folded", "\n "), http.StatusCreated, ""},
		{"folded end before another calendar", "/folded-two.ics", foldedEvent("folded-first", "\r\n ") + davTestEvent("folded-second", "Second"), http.StatusConflict, "valid-calendar-data"},
		{"two folded calendar ends", "/both-folded.ics", foldedEvent("both-first", "\r\n ") + foldedEvent("both-second", "\r\n\t"), http.StatusConflict, "valid-calendar-data"},
		{"folded end before trailing data", "/folded-trailing.ics", foldedEvent("folded-trailing", "\r\n ") + "BEGIN:VEVENT\r\n", http.StatusConflict, "valid-calendar-data"},
		{"folded end with blank lines", "/folded-blank.ics", foldedEvent("folded-blank", "\r\n\t") + "\r\n\r\n", http.StatusCreated, ""},
		{"multiple calendars cannot overwrite", "/existing.ics", foldedEvent("existing", "\r\n ") + davTestEvent("extra", "Extra"), http.StatusConflict, "valid-calendar-data"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := davTestRequest(calDAV, http.MethodPut, calendar+test.target, davICalendarHeader, test.body)
			if response.Code != test.status || !strings.Contains(response.Body.String(), test.precondition) {
				t.Fatalf("status = %d, want %d with %q; body = %s", response.Code, test.status, test.precondition, response.Body.String())
			}
			if 400 <= test.status && test.target != "/existing.ics" {
				if get := davTestRequest(calDAV, http.MethodGet, calendar+test.target, nil, ""); get.Code != http.StatusNotFound {
					t.Fatalf("rejected PUT created the resource: GET status = %d", get.Code)
				}
			}
			if test.name == "multiple calendars cannot overwrite" {
				get := davTestRequest(calDAV, http.MethodGet, calendar+test.target, nil, "")
				if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), "SUMMARY:Updated") {
					t.Fatalf("rejected PUT changed existing object: status = %d; body = %s", get.Code, get.Body.String())
				}
			}
		})
	}
	// RFC 4791 §5.3.2.1：no-uid-conflict 要给出已使用该 UID 的资源
	conflict := davTestRequest(calDAV, http.MethodPut, calendar+"/copy.ics", davICalendarHeader, davTestEvent("existing", "Copy"))
	if !strings.Contains(conflict.Body.String(), calendar+"/existing.ics</href>") {
		t.Fatalf("no-uid-conflict lacks the conflicting href: %s", conflict.Body.String())
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
		{"overwrite with same UID", "/alice.vcf", davTestCard("alice", "Alice updated"), http.StatusNoContent},
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

// TestCardDAVPutRejectsMultipleCards 验证一个联系人资源只能包含一张 vCard（RFC 6352 §5.1），
// 多出的卡片不会在写入时被静默丢弃。
func TestCardDAVPutRejectsMultipleCards(t *testing.T) {
	_, cardDAV := newDAVHandlerFixture(t)
	book := CardDavDefaultAddressBookPath
	response := davTestRequest(cardDAV, http.MethodPut, book+"/two.vcf", davVCardHeader, davTestCard("alice", "Alice")+davTestCard("bob", "Bob"))
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "valid-address-data") {
		t.Fatalf("PUT with two cards: status = %d; body = %s", response.Code, response.Body.String())
	}
	if get := davTestRequest(cardDAV, http.MethodGet, book+"/two.vcf", nil, ""); get.Code != http.StatusNotFound {
		t.Fatalf("rejected PUT created the resource: GET status = %d", get.Code)
	}
	if response := davTestRequest(cardDAV, http.MethodPut, book+"/one.vcf", davVCardHeader, davTestCard("alice", "Alice")+"\r\n"); response.Code != http.StatusCreated {
		t.Fatalf("PUT with one card and a trailing blank line: status = %d; body = %s", response.Code, response.Body.String())
	}
}
