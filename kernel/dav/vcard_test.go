// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package dav

import (
	"bytes"
	"strings"
	"testing"

	"github.com/emersion/go-vcard"
)

func testCard(t *testing.T, lines ...string) vcard.Card {
	t.Helper()
	card, err := vcard.NewDecoder(strings.NewReader("BEGIN:VCARD\r\nVERSION:3.0\r\n" + strings.Join(lines, "\r\n") + "\r\nEND:VCARD\r\n")).Decode()
	if err != nil {
		t.Fatal(err)
	}
	return card
}

func testAddressFilter(t *testing.T, xml string) *AddressFilter {
	t.Helper()
	node, err := ParseXML(strings.NewReader(xml))
	if err != nil {
		t.Fatal(err)
	}
	filter, err := ParseAddressFilter(node)
	if err != nil {
		t.Fatalf("parse filter: %v", err)
	}
	return filter
}

// TestAddressFilter 覆盖 RFC 6352 §10.5 的 anyof/allof、分组前缀、匹配方式、默认排序规则和参数过滤。
func TestAddressFilter(t *testing.T) {
	card := testCard(t, "UID:alice", "FN:Ä Müller", "NICKNAME:Ally", "TEL;TYPE=work:+1 555 0100", "ITEM1.TEL;TYPE=home:+1 555 0199", "EMAIL:alice@example.com")
	const ns = `xmlns:C="urn:ietf:params:xml:ns:carddav"`
	for _, test := range []struct {
		name, xml string
		want      bool
	}{
		{"empty filter", `<C:filter ` + ns + `/>`, true},
		{"unicode casemap by default", `<C:filter ` + ns + `><C:prop-filter name="FN"><C:text-match>ä müller</C:text-match></C:prop-filter></C:filter>`, true},
		{"ascii casemap leaves non-ASCII case", `<C:filter ` + ns + `><C:prop-filter name="FN"><C:text-match collation="i;ascii-casemap">ä müller</C:text-match></C:prop-filter></C:filter>`, false},
		{"equals", `<C:filter ` + ns + `><C:prop-filter name="NICKNAME"><C:text-match match-type="equals">ally</C:text-match></C:prop-filter></C:filter>`, true},
		{"equals rejects substring", `<C:filter ` + ns + `><C:prop-filter name="NICKNAME"><C:text-match match-type="equals">all</C:text-match></C:prop-filter></C:filter>`, false},
		{"starts-with", `<C:filter ` + ns + `><C:prop-filter name="EMAIL"><C:text-match match-type="starts-with">alice@</C:text-match></C:prop-filter></C:filter>`, true},
		{"ends-with", `<C:filter ` + ns + `><C:prop-filter name="EMAIL"><C:text-match match-type="ends-with">example.org</C:text-match></C:prop-filter></C:filter>`, false},
		{"name without group matches grouped property", `<C:filter ` + ns + `><C:prop-filter name="TEL"><C:text-match>0199</C:text-match></C:prop-filter></C:filter>`, true},
		{"group must match exactly", `<C:filter ` + ns + `><C:prop-filter name="ITEM2.TEL"/></C:filter>`, false},
		{"grouped name", `<C:filter ` + ns + `><C:prop-filter name="item1.TEL"><C:param-filter name="TYPE"><C:text-match>home</C:text-match></C:param-filter></C:prop-filter></C:filter>`, true},
		{"allof on the same instance", `<C:filter ` + ns + `><C:prop-filter name="TEL" test="allof"><C:text-match>0100</C:text-match><C:param-filter name="TYPE"><C:text-match>home</C:text-match></C:param-filter></C:prop-filter></C:filter>`, false},
		{"anyof prop-filters", `<C:filter ` + ns + `><C:prop-filter name="ORG"/><C:prop-filter name="NICKNAME"/></C:filter>`, true},
		{"allof prop-filters", `<C:filter ` + ns + ` test="allof"><C:prop-filter name="ORG"/><C:prop-filter name="NICKNAME"/></C:filter>`, false},
		{"is-not-defined", `<C:filter ` + ns + `><C:prop-filter name="ORG"><C:is-not-defined/></C:prop-filter></C:filter>`, true},
		{"negate", `<C:filter ` + ns + `><C:prop-filter name="NICKNAME"><C:text-match negate-condition="yes">ally</C:text-match></C:prop-filter></C:filter>`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := testAddressFilter(t, test.xml).Match(card); got != test.want {
				t.Fatalf("match = %v, want %v", got, test.want)
			}
		})
	}
	node, _ := ParseXML(strings.NewReader(`<C:filter ` + ns + `><C:prop-filter name="FN"><C:text-match collation="i;basic">x</C:text-match></C:prop-filter></C:filter>`))
	if _, err := ParseAddressFilter(node); ConditionErrorName(err) != CardDAVName("supported-collation") {
		t.Fatalf("unsupported collation: %v", err)
	}
}

func TestAddressDataSelect(t *testing.T) {
	card := testCard(t, "UID:alice", "FN:Alice", "ITEM1.TEL:+1 555 0100", "TEL:+1 555 0101", "EMAIL:alice@example.com")
	node, err := ParseXML(strings.NewReader(`<C:address-data xmlns:C="urn:ietf:params:xml:ns:carddav"><C:prop name="FN" novalue="yes"/><C:prop name="item1.TEL"/></C:address-data>`))
	if err != nil {
		t.Fatal(err)
	}
	request, err := ParseAddressDataRequest(node)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err = vcard.NewEncoder(&buf).Encode(request.Select(card)); err != nil {
		t.Fatal(err)
	}
	if want := "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:\r\nITEM1.TEL:+1 555 0100\r\nEND:VCARD\r\n"; buf.String() != want {
		t.Fatalf("selected card:\n%q\nwant\n%q", buf.String(), want)
	}
	if card.Value(vcard.FieldFormattedName) != "Alice" {
		t.Fatal("novalue modified the stored card")
	}
	node, _ = ParseXML(strings.NewReader(`<C:address-data xmlns:C="urn:ietf:params:xml:ns:carddav" content-type="text/x-vcard"/>`))
	if _, err = ParseAddressDataRequest(node); ConditionErrorName(err) != CardDAVName("supported-address-data") {
		t.Fatalf("unsupported content type: %v", err)
	}
}
