// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package dav

import (
	"encoding/xml"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestNodeRoundTrip 验证死属性序列化后仍保留命名空间、属性和子节点次序。
func TestNodeRoundTrip(t *testing.T) {
	root, err := ParseXML(strings.NewReader(`<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:" xmlns:A="http://apple.com/ns/ical/">` +
		`<A:calendar-color symbolic-color="custom">#FF0000FF</A:calendar-color><X:mixed xmlns:X="urn:x">a<X:b/>c</X:mixed></D:prop>`))
	if err != nil {
		t.Fatal(err)
	}
	if !root.Is(DAVName("prop")) {
		t.Fatalf("root = %v", root.XMLName)
	}
	color := root.Child(xml.Name{Space: "http://apple.com/ns/ical/", Local: "calendar-color"})
	if nil == color || "#FF0000FF" != color.Text() {
		t.Fatalf("calendar-color = %+v", color)
	}
	if value, _ := color.Attr("symbolic-color"); "custom" != value || 0 != len(root.Attrs) {
		t.Fatalf("attributes: %v, root attributes %v", color.Attrs, root.Attrs)
	}
	for _, node := range root.Children() {
		data, err := node.Marshal()
		if err != nil {
			t.Fatal(err)
		}
		parsed, err := ParseXML(strings.NewReader(string(data)))
		if err != nil {
			t.Fatal(err)
		}
		again, _ := parsed.Marshal()
		if string(again) != string(data) || parsed.XMLName != node.XMLName {
			t.Fatalf("round trip changed %s into %s", data, again)
		}
	}
	mixed, _ := root.Children()[1].Marshal()
	if want := `<mixed xmlns="urn:x">a<b xmlns="urn:x"></b>c</mixed>`; string(mixed) != want {
		t.Fatalf("mixed content = %s, want %s", mixed, want)
	}
	if empty, err := ParseXML(strings.NewReader(" \r\n")); err != nil || nil != empty {
		t.Fatalf("blank body = %v, %v", empty, err)
	}
}

func TestMultistatus(t *testing.T) {
	recorder := httptest.NewRecorder()
	var props PropstatSet
	props.Add(404, NewElement(DAVName("getetag")))
	props.Add(200, NewTextElement(DAVName("displayname"), "A & B"))
	if err := WriteMultistatus(recorder, []*Response{{Href: "/caldav/a b.ics", Propstats: props.Propstats()}, {Href: "/x", Status: 404}}); err != nil {
		t.Fatal(err)
	}
	body := recorder.Body.String()
	for _, want := range []string{"/caldav/a%20b.ics<", "A &amp; B", "HTTP/1.1 200 OK", "HTTP/1.1 404 Not Found"} {
		if !strings.Contains(body, want) {
			t.Fatalf("multistatus lacks %q: %s", want, body)
		}
	}
	if strings.Index(body, "200 OK") > strings.Index(body, "404 Not Found") {
		t.Fatalf("propstats are not ordered by status: %s", body)
	}
	if recorder.Code != 207 || !strings.HasPrefix(recorder.Header().Get("Content-Type"), "application/xml") {
		t.Fatalf("status = %d, content type = %s", recorder.Code, recorder.Header().Get("Content-Type"))
	}
}

func TestParseDepth(t *testing.T) {
	for value, want := range map[string]Depth{"": DepthOne, "0": DepthZero, "1": DepthOne, "Infinity": DepthInfinity} {
		if got, err := ParseDepth(value, DepthOne); err != nil || got != want {
			t.Errorf("ParseDepth(%q) = %v, %v", value, got, err)
		}
	}
	if _, err := ParseDepth("2", DepthZero); err == nil {
		t.Error("Depth 2 must be rejected")
	}
	if !DepthInfinity.Includes(5) || DepthOne.Includes(2) || !DepthZero.Includes(0) {
		t.Error("Includes")
	}
}

func TestTextMatchCollations(t *testing.T) {
	for _, test := range []struct {
		collation, text, value string
		want                   bool
	}{
		{CollationOctet, "abc", "xABCx", false},
		{CollationASCIICasemap, "abc", "xABCx", true},
		{CollationASCIICasemap, "é", "É", false},
		{CollationUnicodeCasemap, "é", "É", true},
		{CollationUnicodeCasemap, "e\u0301", "É", true},
		{CollationUnicodeCasemap, "fi", "\ufb01", true},
	} {
		match := &TextMatch{Text: test.text, Collation: test.collation, MatchType: MatchContains}
		if got := match.Match(test.value); got != test.want {
			t.Errorf("%s: %q in %q = %v, want %v", test.collation, test.text, test.value, got, test.want)
		}
	}
}
