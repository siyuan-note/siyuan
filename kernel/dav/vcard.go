// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package dav

import (
	"errors"
	"net/http"
	"strings"

	"github.com/emersion/go-vcard"
)

// AddressFilter 是 CARDDAV:filter（RFC 6352 §10.5）。
type AddressFilter struct {
	AllOf bool
	Props []*AddressPropFilter
}

// AddressPropFilter 是 CARDDAV:prop-filter；Group 为空时匹配任意分组前缀的同名属性。
type AddressPropFilter struct {
	Group        string
	Name         string
	AllOf        bool
	IsNotDefined bool
	TextMatches  []*TextMatch
	Params       []*ParamFilter
}

func parseFilterTest(n *Node) (allOf bool, err error) {
	switch test, _ := n.Attr("test"); test {
	case "", "anyof":
		return false, nil
	case "allof":
		return true, nil
	}
	return false, cardDAVTextMatch.filterError("invalid test attribute")
}

// splitGroup 把 "X-ABC.TEL" 拆成分组和属性名，并转换为 go-vcard 使用的大写形式。
func splitGroup(name string) (group, property string) {
	if group, property, ok := strings.Cut(name, "."); ok {
		return strings.ToUpper(group), strings.ToUpper(property)
	}
	return "", strings.ToUpper(name)
}

// ParseAddressFilter 解析 CARDDAV:filter；n 为 nil 时返回匹配全部联系人的过滤器。
func ParseAddressFilter(n *Node) (*AddressFilter, error) {
	filter := &AddressFilter{}
	if nil == n {
		return filter, nil
	}
	var err error
	if filter.AllOf, err = parseFilterTest(n); err != nil {
		return nil, err
	}
	for _, child := range n.Children() {
		if !child.Is(CardDAVName("prop-filter")) {
			return nil, cardDAVTextMatch.filterError("unexpected element in filter")
		}
		propFilter, err := parseAddressPropFilter(child)
		if err != nil {
			return nil, err
		}
		filter.Props = append(filter.Props, propFilter)
	}
	return filter, nil
}

func parseAddressPropFilter(n *Node) (*AddressPropFilter, error) {
	name, _ := n.Attr("name")
	if "" == name {
		return nil, cardDAVTextMatch.filterError("prop-filter requires a name")
	}
	filter := &AddressPropFilter{}
	filter.Group, filter.Name = splitGroup(name)
	var err error
	if filter.AllOf, err = parseFilterTest(n); err != nil {
		return nil, err
	}
	for _, child := range n.Children() {
		switch child.XMLName {
		case CardDAVName("is-not-defined"):
			filter.IsNotDefined = true
		case CardDAVName("text-match"):
			match, err := cardDAVTextMatch.parse(child)
			if err != nil {
				return nil, err
			}
			filter.TextMatches = append(filter.TextMatches, match)
		case CardDAVName("param-filter"):
			paramFilter, err := cardDAVTextMatch.parseParamFilter(child)
			if err != nil {
				return nil, err
			}
			filter.Params = append(filter.Params, paramFilter)
		default:
			return nil, cardDAVTextMatch.filterError("unexpected element in prop-filter")
		}
	}
	if filter.IsNotDefined && (0 < len(filter.TextMatches) || 0 < len(filter.Params)) {
		return nil, cardDAVTextMatch.filterError("is-not-defined cannot be combined with other conditions")
	}
	return filter, nil
}

// Match 判断联系人是否满足过滤器；没有 prop-filter 时匹配全部联系人。
func (f *AddressFilter) Match(card vcard.Card) bool {
	if 0 == len(f.Props) {
		return true
	}
	for _, propFilter := range f.Props {
		if propFilter.match(card) != f.AllOf {
			return !f.AllOf
		}
	}
	return f.AllOf
}

func cardFields(card vcard.Card, group, name string) (fields []*vcard.Field) {
	for _, field := range card[name] {
		if "" == group || strings.EqualFold(group, field.Group) {
			fields = append(fields, field)
		}
	}
	return
}

// match 对每个属性实例分别求值，任一实例满足 text-match 与 param-filter 的组合条件即匹配。
func (f *AddressPropFilter) match(card vcard.Card) bool {
	fields := cardFields(card, f.Group, f.Name)
	if f.IsNotDefined {
		return 0 == len(fields)
	}
	if 0 == len(f.TextMatches) && 0 == len(f.Params) {
		return 0 < len(fields)
	}
	for _, field := range fields {
		if f.matchField(field) {
			return true
		}
	}
	return false
}

func (f *AddressPropFilter) matchField(field *vcard.Field) bool {
	for _, match := range f.TextMatches {
		if match.Match(field.Value) != f.AllOf {
			return !f.AllOf
		}
	}
	for _, param := range f.Params {
		if param.Match(field.Params[param.Name]) != f.AllOf {
			return !f.AllOf
		}
	}
	return f.AllOf
}

// AddressDataRequest 是 REPORT 中 CARDDAV:address-data 指定的返回内容（RFC 6352 §10.4）。
type AddressDataRequest struct {
	Props []PropRequest
}

// ParseAddressDataRequest 解析 CARDDAV:address-data；不含 prop 或含 allprop 时返回完整联系人。
// 联系人按存储的 vCard 版本返回，content-type 与 version 只校验是否为受支持的类型。
func ParseAddressDataRequest(n *Node) (*AddressDataRequest, error) {
	contentType, _ := n.Attr("content-type")
	version, _ := n.Attr("version")
	if ("" != contentType && !strings.EqualFold(vcard.MIMEType, contentType)) || ("" != version && "3.0" != version && "4.0" != version) {
		return nil, NewConditionError(http.StatusForbidden, NewElement(CardDAVName("supported-address-data")))
	}
	request := &AddressDataRequest{}
	for _, child := range n.Children() {
		switch child.XMLName {
		case CardDAVName("allprop"):
			return &AddressDataRequest{}, nil
		case CardDAVName("prop"):
			name, _ := child.Attr("name")
			if "" == name {
				return nil, NewError(http.StatusBadRequest, errors.New("prop requires a name"))
			}
			noValue, _ := child.Attr("novalue")
			request.Props = append(request.Props, PropRequest{Name: name, NoValue: "yes" == noValue})
		default:
			return nil, NewError(http.StatusBadRequest, errors.New("unexpected element in address-data"))
		}
	}
	return request, nil
}

// Full 判断请求是否要求返回完整联系人。
func (r *AddressDataRequest) Full() bool {
	return nil == r || 0 == len(r.Props)
}

// Select 只保留请求的属性，并保留 VERSION 使结果仍是合法的 vCard。
func (r *AddressDataRequest) Select(card vcard.Card) vcard.Card {
	if r.Full() {
		return card
	}
	selected := vcard.Card{vcard.FieldVersion: card[vcard.FieldVersion]}
	for _, prop := range r.Props {
		group, name := splitGroup(prop.Name)
		for _, field := range cardFields(card, group, name) {
			if prop.NoValue {
				field = &vcard.Field{Params: field.Params, Group: field.Group}
			}
			if !containsField(selected[name], field) {
				selected[name] = append(selected[name], field)
			}
		}
	}
	return selected
}

func containsField(fields []*vcard.Field, field *vcard.Field) bool {
	for _, existing := range fields {
		if existing == field {
			return true
		}
	}
	return false
}
