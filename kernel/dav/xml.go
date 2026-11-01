// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package dav 实现 WebDAV（RFC 4918）、CalDAV（RFC 4791）与 CardDAV（RFC 6352）中与存储无关的协议部分：
// XML 请求解析与多状态响应、文本匹配排序规则、iCalendar 与 vCard 的过滤和部分检索、空闲忙碌时间计算。
package dav

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/net/html/charset"
)

const (
	NamespaceDAV     = "DAV:"
	NamespaceCalDAV  = "urn:ietf:params:xml:ns:caldav"
	NamespaceCardDAV = "urn:ietf:params:xml:ns:carddav"
)

func xmlName(space, local string) xml.Name { return xml.Name{Space: space, Local: local} }

func DAVName(local string) xml.Name     { return xml.Name{Space: NamespaceDAV, Local: local} }
func CalDAVName(local string) xml.Name  { return xml.Name{Space: NamespaceCalDAV, Local: local} }
func CardDAVName(local string) xml.Name { return xml.Name{Space: NamespaceCardDAV, Local: local} }

// Node 是 XML 元素或文本节点。元素节点的 XMLName.Local 非空；文本节点只有 CharData。
// 子节点按文档顺序保存，死属性写回时能保持原有的元素与文本次序（RFC 4918 §4.3）。
type Node struct {
	XMLName  xml.Name
	Attrs    []xml.Attr
	CharData string
	Nodes    []*Node
}

func NewElement(name xml.Name, children ...*Node) *Node {
	return &Node{XMLName: name, Nodes: children}
}

func NewTextElement(name xml.Name, text string) *Node {
	node := &Node{XMLName: name}
	if "" != text {
		node.Nodes = []*Node{{CharData: text}}
	}
	return node
}

// WithAttr 设置不带命名空间的属性并返回节点本身。
func (n *Node) WithAttr(local, value string) *Node {
	for i := range n.Attrs {
		if "" == n.Attrs[i].Name.Space && local == n.Attrs[i].Name.Local {
			n.Attrs[i].Value = value
			return n
		}
	}
	n.Attrs = append(n.Attrs, xml.Attr{Name: xml.Name{Local: local}, Value: value})
	return n
}

func (n *Node) Append(children ...*Node) *Node {
	n.Nodes = append(n.Nodes, children...)
	return n
}

func (n *Node) IsElement() bool { return "" != n.XMLName.Local }

func (n *Node) Is(name xml.Name) bool { return nil != n && n.XMLName == name }

// Children 返回子元素，不含文本节点。
func (n *Node) Children() (children []*Node) {
	for _, child := range n.Nodes {
		if child.IsElement() {
			children = append(children, child)
		}
	}
	return
}

func (n *Node) Child(name xml.Name) *Node {
	for _, child := range n.Nodes {
		if child.XMLName == name {
			return child
		}
	}
	return nil
}

func (n *Node) ChildrenNamed(name xml.Name) (children []*Node) {
	for _, child := range n.Nodes {
		if child.XMLName == name {
			children = append(children, child)
		}
	}
	return
}

// Text 返回直接子文本（含 CDATA）拼接后的内容。
func (n *Node) Text() string {
	var text strings.Builder
	for _, child := range n.Nodes {
		if !child.IsElement() {
			text.WriteString(child.CharData)
		}
	}
	return text.String()
}

// Attr 返回不带命名空间的属性值。
func (n *Node) Attr(local string) (string, bool) {
	for _, attr := range n.Attrs {
		if "" == attr.Name.Space && local == attr.Name.Local {
			return attr.Value, true
		}
	}
	return "", false
}

// Clone 深拷贝节点，返回的节点可以单独修改。
func (n *Node) Clone() *Node {
	clone := &Node{XMLName: n.XMLName, CharData: n.CharData, Attrs: append([]xml.Attr(nil), n.Attrs...)}
	for _, child := range n.Nodes {
		clone.Nodes = append(clone.Nodes, child.Clone())
	}
	return clone
}

// ParseXML 解析 XML 文档并返回根元素；请求体为空或只有空白时返回 nil。
func ParseXML(r io.Reader) (*Node, error) {
	decoder := xml.NewDecoder(r)
	decoder.CharsetReader = charset.NewReaderLabel
	var root *Node
	var stack []*Node
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		switch t := token.(type) {
		case xml.StartElement:
			node := &Node{XMLName: t.Name}
			for _, attr := range t.Attr {
				// 命名空间声明已经解析进元素名，不作为普通属性保存
				if "xmlns" == attr.Name.Space || ("" == attr.Name.Space && "xmlns" == attr.Name.Local) {
					continue
				}
				node.Attrs = append(node.Attrs, attr)
			}
			if 0 == len(stack) {
				if nil != root {
					return nil, errors.New("XML document has multiple root elements")
				}
				root = node
			} else {
				parent := stack[len(stack)-1]
				parent.Nodes = append(parent.Nodes, node)
			}
			stack = append(stack, node)
		case xml.EndElement:
			stack = stack[:len(stack)-1]
		case xml.CharData:
			if 0 < len(stack) {
				parent := stack[len(stack)-1]
				parent.Nodes = append(parent.Nodes, &Node{CharData: string(t)})
			}
		}
	}
	return root, nil
}

func (n *Node) encode(encoder *xml.Encoder) error {
	if !n.IsElement() {
		return encoder.EncodeToken(xml.CharData(n.CharData))
	}
	start := xml.StartElement{Name: n.XMLName, Attr: n.Attrs}
	if err := encoder.EncodeToken(start); err != nil {
		return err
	}
	for _, child := range n.Nodes {
		if err := child.encode(encoder); err != nil {
			return err
		}
	}
	return encoder.EncodeToken(start.End())
}

// Marshal 把节点序列化为独立的 XML 片段，所有命名空间都在片段内声明。
func (n *Node) Marshal() ([]byte, error) {
	var buf bytes.Buffer
	encoder := xml.NewEncoder(&buf)
	if err := n.encode(encoder); err != nil {
		return nil, err
	}
	if err := encoder.Flush(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// WriteXML 写出以 root 为根元素的 XML 响应。
func WriteXML(w http.ResponseWriter, status int, root *Node) error {
	body, err := root.Marshal()
	if err != nil {
		return err
	}
	body = append([]byte(xml.Header), body...)
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	_, err = w.Write(body)
	return err
}

// StatusLine 返回 DAV:status 使用的 HTTP 状态行。
func StatusLine(code int) string {
	return fmt.Sprintf("HTTP/1.1 %d %s", code, http.StatusText(code))
}

// EncodeHref 把 URL 路径编码为 DAV:href 的值。
func EncodeHref(p string) string {
	return (&url.URL{Path: p}).EscapedPath()
}

func HrefNode(p string) *Node {
	return NewTextElement(DAVName("href"), EncodeHref(p))
}

// Propstat 是 DAV:propstat 元素：同一状态码下的属性。
type Propstat struct {
	Props  []*Node
	Status int
	Error  *Node
}

// Response 是 DAV:response 元素。Status 非 0 时使用 (href, status) 形式，否则使用 propstat 形式。
type Response struct {
	Href      string
	Status    int
	Propstats []*Propstat
	Error     *Node
}

func (r *Response) Node() *Node {
	node := NewElement(DAVName("response"), HrefNode(r.Href))
	if 0 != r.Status {
		node.Append(NewTextElement(DAVName("status"), StatusLine(r.Status)))
	}
	for _, propstat := range r.Propstats {
		node.Append(propstat.Node())
	}
	if nil != r.Error {
		node.Append(NewElement(DAVName("error"), r.Error))
	}
	return node
}

func (p *Propstat) Node() *Node {
	node := NewElement(DAVName("propstat"), NewElement(DAVName("prop"), p.Props...), NewTextElement(DAVName("status"), StatusLine(p.Status)))
	if nil != p.Error {
		node.Append(NewElement(DAVName("error"), p.Error))
	}
	return node
}

// PropstatSet 按状态码归并属性，生成的 propstat 按状态码升序排列。
type PropstatSet struct {
	props  map[int][]*Node
	errors map[int]*Node
}

func (s *PropstatSet) Add(status int, prop *Node) {
	if nil == s.props {
		s.props = map[int][]*Node{}
	}
	s.props[status] = append(s.props[status], prop)
}

// SetError 为某个状态码的 propstat 附加前置条件元素。
func (s *PropstatSet) SetError(status int, condition *Node) {
	if nil == s.errors {
		s.errors = map[int]*Node{}
	}
	s.errors[status] = condition
}

func (s *PropstatSet) Propstats() (propstats []*Propstat) {
	var statuses []int
	for status := range s.props {
		statuses = append(statuses, status)
	}
	sort.Ints(statuses)
	for _, status := range statuses {
		propstats = append(propstats, &Propstat{Props: s.props[status], Status: status, Error: s.errors[status]})
	}
	return
}

// WriteMultistatus 写出 207 Multi-Status 响应。
func WriteMultistatus(w http.ResponseWriter, responses []*Response) error {
	root := NewElement(DAVName("multistatus"))
	for _, response := range responses {
		root.Append(response.Node())
	}
	return WriteXML(w, http.StatusMultiStatus, root)
}
