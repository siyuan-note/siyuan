// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-vcard"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/dav"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// NewCalDAVHandler 返回挂载在 /caldav 与 /.well-known/caldav 下的 CalDAV 处理器。
func NewCalDAVHandler() http.Handler {
	return newCalDAVHandler(&calendars)
}

// NewCardDAVHandler 返回挂载在 /carddav 与 /.well-known/carddav 下的 CardDAV 处理器。
func NewCardDAVHandler() http.Handler {
	return newCardDAVHandler(&contacts)
}

func newCalDAVHandler(store *Calendars) http.Handler {
	return RejectNonCanonicalDAVPath(&davHandler{service: &calDAVService{store: store}, cfg: calDAVConfig})
}

func newCardDAVHandler(store *Contacts) http.Handler {
	return RejectNonCanonicalDAVPath(&davHandler{service: &cardDAVService{store: store}, cfg: cardDAVConfig})
}

// RejectNonCanonicalDAVPath 拒绝含 "."、".." 段、反斜杠或 NUL 的请求路径。
// net/http 与 gin 都不清理请求路径，后端清理后可能跳到另一个 DAV 命名空间；Windows 上反斜杠也是路径分隔符。
func RejectNonCanonicalDAVPath(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isCanonicalDAVPath(r.URL.Path) {
			http.Error(w, "DAV: request path must not contain dot segments, backslashes or NUL", http.StatusBadRequest)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isCanonicalDAVPath(p string) bool {
	if strings.ContainsAny(p, "\\\x00") {
		return false
	}
	for _, segment := range strings.Split(p, "/") {
		if "." == segment || ".." == segment {
			return false
		}
	}
	return true
}

// davConfig 描述 CalDAV 与 CardDAV 在通用 WebDAV 处理流程中的静态差异。
type davConfig struct {
	namespace  string
	capability string // DAV 响应头中的服务能力
	wellKnown  string

	prefix, principals, principal, homeSet string

	homeSetProp      xml.Name
	collectionType   xml.Name
	descriptionProp  xml.Name
	componentSetProp xml.Name // 只有 CalDAV 能在创建集合时声明组件集
	dataProp         xml.Name // calendar-data / address-data 只在 REPORT 中出现，不是 WebDAV 属性

	queryReport, multigetReport xml.Name
	collectionReports           []xml.Name // 只能作用于集合的报告

	mimeType          string
	contentCondition  string // PUT 的媒体类型不受支持时返回的前置条件
	locationCondition string // 不能在请求地址创建集合时返回的前置条件
	mkcalendar        bool
	privileges        []xml.Name // 服务特有的权限
	protected         []xml.Name // 服务特有的受保护属性
}

// davService 是 CalDAV 或 CardDAV 的存储与协议差异，读方法返回快照，写方法各自持有存储锁。
type davService interface {
	load() error
	collections() []*davCollection
	collection(p string) *davCollection
	objects(collectionPath string) []*davObject
	object(p string) *davObject
	// collectionProps 返回集合的服务特有活属性
	collectionProps(collection *davCollection) []davProp
	// validateProperty 校验写入集合的死属性；返回的错误带前置条件
	validateProperty(prop *dav.Node) error
	createCollection(p string, state *davCollectionState) error
	updateCollection(p string, update func(state *davCollectionState) error) error
	deleteCollection(p string, conditions *DAVConditions) error
	putObject(p string, body []byte, conditions *DAVConditions) (object *davObject, created bool, err error)
	deleteObject(p string, conditions *DAVConditions) error
	// dataRenderer 解析 REPORT 中的 calendar-data / address-data；timezone 为 nil 时由服务决定浮动时间的时区
	dataRenderer(request *dav.Node, timezone *time.Location) (davDataRenderer, error)
	// report 处理服务特有的报告；不认识的报告返回 false
	report(h *davHandler, w http.ResponseWriter, r *http.Request, target *davResource, root *dav.Node) (bool, error)
}

// davCollectionState 是集合可由 MKCOL / MKCALENDAR / PROPPATCH 修改的部分。
type davCollectionState struct {
	name, description string
	components        []string
	properties        []*dav.Node
}

type davCollection struct {
	path            string
	state           davCollectionState
	maxResourceSize int64
	addressData     []AddressDataType
}

type davObject struct {
	path     string
	etag     string
	modTime  time.Time
	content  []byte
	calendar *ical.Calendar
	card     vcard.Card
}

type davDataRenderer func(object *davObject) (string, error)

type davResourceKind int

const (
	davKindMissing davResourceKind = iota
	davKindRoot
	davKindPrincipal
	davKindHomeSet
	davKindCollection
	davKindObject
)

// davResource 是请求路径对应的资源。资源不存在时，parentIsHomeSet 表示可以在此创建集合，parentIsCollection 表示可以在此 PUT 对象。
type davResource struct {
	kind davResourceKind
	path string
	// href 是响应中表示该资源的地址，为空时使用 path
	href               string
	collection         *davCollection
	object             *davObject
	parentIsHomeSet    bool
	parentIsCollection bool
}

// davProp 是活属性；allprop 表示 PROPFIND allprop 是否返回它。allprop 返回 RFC 4918 定义的属性和发现服务所需的
// 属性（主体、home set、集合的数据类型与权限），客户端可能用不带请求体的 PROPFIND 发现服务；其余属性只在明确请求时返回。
type davProp struct {
	name    xml.Name
	allprop bool
	value   func() *dav.Node
}

type davPropRequest struct {
	allprop, propname bool
	names             []xml.Name
	render            davDataRenderer
}

type davHandler struct {
	service davService
	cfg     *davConfig
}

func (h *davHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if "/.well-known/"+h.cfg.wellKnown == strings.TrimRight(r.URL.Path, "/") {
		// RFC 6764 §5：well-known URI 只能重定向到服务的实际地址，不能直接提供服务
		w.Header().Set("Cache-Control", "no-cache")
		http.Redirect(w, r, h.cfg.principal, http.StatusPermanentRedirect)
		return
	}
	p := PathCleanWithSlash(r.URL.Path)
	if p != r.URL.Path {
		// 思源返回的集合地址都不带尾斜杠，按 RFC 4918 §5.2 告知规范地址
		w.Header().Set("Content-Location", dav.EncodeHref(p))
	}
	if err := h.service.load(); err != nil {
		h.writeError(w, r, err)
		return
	}
	target := h.resolve(p)
	if davKindObject != target.kind && davKindMissing != target.kind && p+"/" == r.URL.Path {
		// 集合地址在响应中不带尾斜杠；客户端用尾斜杠形式请求时，请求资源本身按客户端的形式返回，
		// 否则按请求地址查找响应的客户端找不到对应的 response
		target.href = p + "/"
	}
	if err := h.serve(w, r, target); err != nil {
		h.writeError(w, r, err)
	}
}

func (target *davResource) hrefPath() string {
	if "" != target.href {
		return target.href
	}
	return target.path
}

func (h *davHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	var davErr *dav.Error
	if !errors.As(err, &davErr) || http.StatusInternalServerError <= davErr.Status {
		logging.LogErrorf("%s %s failed: %s", r.Method, r.URL.Path, err)
	}
	dav.WriteError(w, err)
}

func (h *davHandler) serve(w http.ResponseWriter, r *http.Request, target *davResource) error {
	switch r.Method {
	case http.MethodOptions:
		w.Header().Set("DAV", "1, 3, extended-mkcol, "+h.cfg.capability)
		w.Header().Set("Allow", strings.Join(h.allowedMethods(target), ", "))
		w.WriteHeader(http.StatusNoContent)
		return nil
	case http.MethodGet, http.MethodHead:
		return h.get(w, r, target)
	case http.MethodPut:
		return h.put(w, r, target)
	case http.MethodDelete:
		return h.delete(w, r, target)
	case "PROPFIND":
		return h.propfind(w, r, target)
	case "PROPPATCH":
		return h.proppatch(w, r, target)
	case "MKCOL":
		return h.mkcol(w, r, target, false)
	case "MKCALENDAR":
		if h.cfg.mkcalendar {
			return h.mkcol(w, r, target, true)
		}
	case "REPORT":
		return h.report(w, r, target)
	}
	if davKindMissing == target.kind {
		return errDAVNotFound
	}
	return h.methodNotAllowed(w, target)
}

var errDAVNotFound = dav.NewError(http.StatusNotFound, errors.New("resource not found"))

// methodNotAllowed 按 RFC 9110 §15.5.6 在 405 响应中列出资源支持的方法。
func (h *davHandler) methodNotAllowed(w http.ResponseWriter, target *davResource) error {
	w.Header().Set("Allow", strings.Join(h.allowedMethods(target), ", "))
	http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
	return nil
}

func (h *davHandler) allowedMethods(target *davResource) []string {
	switch target.kind {
	case davKindObject:
		return []string{http.MethodOptions, http.MethodGet, http.MethodHead, http.MethodPut, http.MethodDelete, "PROPFIND", "PROPPATCH", "REPORT"}
	case davKindCollection:
		return []string{http.MethodOptions, http.MethodDelete, "PROPFIND", "PROPPATCH", "REPORT"}
	case davKindRoot, davKindPrincipal, davKindHomeSet:
		return []string{http.MethodOptions, "PROPFIND", "PROPPATCH", "REPORT"}
	}
	switch {
	case target.parentIsHomeSet && h.cfg.mkcalendar:
		return []string{http.MethodOptions, "MKCOL", "MKCALENDAR"}
	case target.parentIsHomeSet:
		return []string{http.MethodOptions, "MKCOL"}
	case target.parentIsCollection:
		return []string{http.MethodOptions, http.MethodPut}
	}
	return []string{http.MethodOptions}
}

func (h *davHandler) resolve(p string) *davResource {
	switch p {
	case h.cfg.prefix, h.cfg.principals:
		return &davResource{kind: davKindRoot, path: p}
	case h.cfg.principal:
		return &davResource{kind: davKindPrincipal, path: p}
	case h.cfg.homeSet:
		return &davResource{kind: davKindHomeSet, path: p}
	}
	parent := path.Dir(p)
	if parent == h.cfg.homeSet {
		if collection := h.service.collection(p); nil != collection {
			return &davResource{kind: davKindCollection, path: p, collection: collection}
		}
		return &davResource{kind: davKindMissing, path: p, parentIsHomeSet: true}
	}
	if path.Dir(parent) == h.cfg.homeSet && nil != h.service.collection(parent) {
		if object := h.service.object(p); nil != object {
			return &davResource{kind: davKindObject, path: p, object: object}
		}
		return &davResource{kind: davKindMissing, path: p, parentIsCollection: true}
	}
	return &davResource{kind: davKindMissing, path: p}
}

func (h *davHandler) children(target *davResource) (children []*davResource) {
	switch target.kind {
	case davKindRoot:
		if h.cfg.prefix == target.path {
			return []*davResource{h.resolve(h.cfg.principals)}
		}
		return []*davResource{h.resolve(h.cfg.principal)}
	case davKindPrincipal:
		return []*davResource{h.resolve(h.cfg.homeSet)}
	case davKindHomeSet:
		for _, collection := range h.service.collections() {
			children = append(children, &davResource{kind: davKindCollection, path: collection.path, collection: collection})
		}
	case davKindCollection:
		for _, object := range h.service.objects(target.path) {
			children = append(children, &davResource{kind: davKindObject, path: object.path, object: object})
		}
	}
	return
}

func (h *davHandler) walk(target *davResource, depth dav.Depth, visit func(*davResource)) {
	visit(target)
	if dav.DepthZero == depth {
		return
	}
	next := depth
	if dav.DepthInfinity != depth {
		next = depth - 1
	}
	for _, child := range h.children(target) {
		h.walk(child, next, visit)
	}
}

// objectsInScope 返回报告要考虑的对象：对象本身、深度范围内集合中的对象；普通集合上的报告
// 只考虑深度范围内各集合包含的对象（RFC 4791 §7.2、RFC 6352 §8.2）。
func (h *davHandler) objectsInScope(target *davResource, depth dav.Depth) (objects []*davResource) {
	switch target.kind {
	case davKindObject:
		return []*davResource{target}
	case davKindCollection:
		if dav.DepthZero == depth {
			return nil
		}
		return h.children(target)
	case davKindRoot, davKindPrincipal, davKindHomeSet:
		levels := strings.Count(strings.TrimPrefix(h.cfg.homeSet, target.path), "/") + 1
		if !depth.Includes(levels) {
			return nil
		}
		for _, collection := range h.children(h.resolve(h.cfg.homeSet)) {
			objects = append(objects, h.children(collection)...)
		}
	}
	return
}

func parseDAVBody(r *http.Request) (*dav.Node, error) {
	root, err := dav.ParseXML(r.Body)
	if err != nil {
		return nil, dav.NewError(http.StatusBadRequest, fmt.Errorf("malformed XML request body: %w", err))
	}
	return root, nil
}

// parseDAVHref 把 DAV:href 转换为规范的 URL 路径；绝对 URI 只取路径部分。
func parseDAVHref(href string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(href))
	if err != nil || !isCanonicalDAVPath(u.Path) {
		return href, false
	}
	return PathCleanWithSlash(u.Path), true
}

func davQuoteETag(etag string) string {
	return `"` + etag + `"`
}

func (h *davHandler) get(w http.ResponseWriter, r *http.Request, target *davResource) error {
	switch target.kind {
	case davKindObject:
	case davKindMissing:
		return errDAVNotFound
	default:
		return h.methodNotAllowed(w, target)
	}
	object := target.object
	w.Header().Set("Content-Type", h.cfg.mimeType)
	w.Header().Set("ETag", davQuoteETag(object.etag))
	// ServeContent 按 ETag 与修改时间处理 If-Match、If-None-Match 等条件请求，HEAD 请求不写响应体
	http.ServeContent(w, r, "", object.modTime, bytes.NewReader(object.content))
	return nil
}

func (h *davHandler) put(w http.ResponseWriter, r *http.Request, target *davResource) error {
	if davKindObject != target.kind && davKindMissing != target.kind {
		return h.methodNotAllowed(w, target)
	}
	if contentType := r.Header.Get("Content-Type"); "" != contentType {
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil {
			return dav.NewError(http.StatusBadRequest, err)
		}
		if !strings.EqualFold(h.cfg.mimeType, mediaType) {
			return dav.NewConditionError(http.StatusUnsupportedMediaType, dav.NewElement(xml.Name{Space: h.cfg.namespace, Local: h.cfg.contentCondition}))
		}
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return dav.NewError(http.StatusBadRequest, err)
	}
	object, created, err := h.service.putObject(target.path, body, davConditionsOf(r))
	if err != nil {
		return err
	}
	// RFC 4791 §5.3.4、RFC 6352 §6.3.2.3：只有存储内容与提交内容逐字节相同时才能在响应中返回强 ETag
	if bytes.Equal(object.content, body) {
		w.Header().Set("ETag", davQuoteETag(object.etag))
	}
	// RFC 9110 §9.3.4：新建资源返回 201，替换已有资源返回 204
	if created {
		w.WriteHeader(http.StatusCreated)
	} else {
		w.WriteHeader(http.StatusNoContent)
	}
	return nil
}

func (h *davHandler) delete(w http.ResponseWriter, r *http.Request, target *davResource) error {
	var err error
	switch target.kind {
	case davKindObject:
		err = h.service.deleteObject(target.path, davConditionsOf(r))
	case davKindCollection:
		err = h.service.deleteCollection(target.path, davConditionsOf(r))
	case davKindMissing:
		return errDAVNotFound
	default:
		return dav.NewError(http.StatusForbidden, errors.New("resource cannot be deleted"))
	}
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *davHandler) propfind(w http.ResponseWriter, r *http.Request, target *davResource) error {
	if davKindMissing == target.kind {
		return errDAVNotFound
	}
	// RFC 4918 §9.1：没有 Depth 头的 PROPFIND 按 infinity 处理
	depth, err := dav.ParseDepth(r.Header.Get("Depth"), dav.DepthInfinity)
	if err != nil {
		return err
	}
	root, err := parseDAVBody(r)
	if err != nil {
		return err
	}
	request := &davPropRequest{allprop: true}
	if nil != root {
		if !root.Is(dav.DAVName("propfind")) {
			return dav.NewError(http.StatusBadRequest, errors.New("PROPFIND body must be a propfind element"))
		}
		if request, err = h.parsePropRequest(root, nil, false); err != nil {
			return err
		}
	}
	var responses []*dav.Response
	h.walk(target, depth, func(resource *davResource) {
		responses = append(responses, h.propResponse(resource, request))
	})
	return dav.WriteMultistatus(w, responses)
}

// parsePropRequest 解析 PROPFIND 或 REPORT 中的 allprop、propname、prop、include；report 为 true 时
// prop 中的 calendar-data / address-data 是数据请求，没有 prop 选择时按 allprop 处理。
func (h *davHandler) parsePropRequest(root *dav.Node, timezone *time.Location, report bool) (*davPropRequest, error) {
	request := &davPropRequest{}
	selected := false
	for _, child := range root.Children() {
		switch child.XMLName {
		case dav.DAVName("allprop"):
			request.allprop, selected = true, true
		case dav.DAVName("propname"):
			request.propname, selected = true, true
		case dav.DAVName("prop"), dav.DAVName("include"):
			selected = selected || dav.DAVName("prop") == child.XMLName
			for _, prop := range child.Children() {
				if report && h.cfg.dataProp == prop.XMLName {
					render, err := h.service.dataRenderer(prop, timezone)
					if err != nil {
						return nil, err
					}
					request.render = render
				}
				request.names = append(request.names, prop.XMLName)
			}
		}
	}
	if !selected {
		request.allprop = true
	}
	return request, nil
}

func (h *davHandler) propResponse(target *davResource, request *davPropRequest) *dav.Response {
	props := h.liveProps(target)
	var dead []*dav.Node
	if davKindCollection == target.kind {
		dead = target.collection.state.properties
	}
	var set dav.PropstatSet
	if request.propname {
		for _, prop := range props {
			set.Add(http.StatusOK, dav.NewElement(prop.name))
		}
		for _, node := range dead {
			set.Add(http.StatusOK, dav.NewElement(node.XMLName))
		}
	} else {
		included := map[xml.Name]bool{}
		if request.allprop {
			for _, prop := range props {
				if prop.allprop {
					set.Add(http.StatusOK, prop.value())
					included[prop.name] = true
				}
			}
			for _, node := range dead {
				set.Add(http.StatusOK, node.Clone())
				included[node.XMLName] = true
			}
		}
		for _, name := range request.names {
			if !included[name] {
				included[name] = true
				set.Add(h.lookupProp(target, request, props, dead, name))
			}
		}
	}
	propstats := set.Propstats()
	if 0 == len(propstats) {
		propstats = []*dav.Propstat{{Status: http.StatusOK}}
	}
	return &dav.Response{Href: target.hrefPath(), Propstats: propstats}
}

func (h *davHandler) lookupProp(target *davResource, request *davPropRequest, props []davProp, dead []*dav.Node, name xml.Name) (int, *dav.Node) {
	if h.cfg.dataProp == name && nil != request.render && davKindObject == target.kind {
		data, err := request.render(target.object)
		if err != nil {
			logging.LogErrorf("render %s of [%s] failed: %s", name.Local, target.path, err)
			return http.StatusInternalServerError, dav.NewElement(name)
		}
		return http.StatusOK, dav.NewTextElement(name, data)
	}
	for _, prop := range props {
		if prop.name == name {
			return http.StatusOK, prop.value()
		}
	}
	for _, node := range dead {
		if node.XMLName == name {
			return http.StatusOK, node.Clone()
		}
	}
	return http.StatusNotFound, dav.NewElement(name)
}

func davHrefProp(name xml.Name, allprop bool, href string) davProp {
	return davProp{name: name, allprop: allprop, value: func() *dav.Node { return dav.NewElement(name, dav.HrefNode(href)) }}
}

func davTextProp(name xml.Name, allprop bool, text string) davProp {
	return davProp{name: name, allprop: allprop, value: func() *dav.Node { return dav.NewTextElement(name, text) }}
}

func (h *davHandler) liveProps(target *davResource) []davProp {
	collationSet := xml.Name{Space: h.cfg.namespace, Local: "supported-collation-set"}
	props := []davProp{
		{name: dav.DAVName("resourcetype"), allprop: true, value: func() *dav.Node { return h.resourceType(target) }},
		davHrefProp(dav.DAVName("current-user-principal"), true, h.cfg.principal),
		{name: dav.DAVName("current-user-privilege-set"), allprop: davKindCollection == target.kind, value: h.privilegeSet},
		{name: dav.DAVName("supported-report-set"), value: func() *dav.Node { return h.supportedReports(target) }},
		{name: collationSet, value: func() *dav.Node {
			node := dav.NewElement(collationSet)
			for _, collation := range dav.Collations {
				node.Append(dav.NewTextElement(xml.Name{Space: h.cfg.namespace, Local: "supported-collation"}, collation))
			}
			return node
		}},
	}
	switch target.kind {
	case davKindPrincipal:
		props = append(props, davHrefProp(dav.DAVName("principal-URL"), false, h.cfg.principal), davHrefProp(h.cfg.homeSetProp, true, h.cfg.homeSet))
	case davKindCollection:
		collection := target.collection
		if "" != collection.state.name {
			props = append(props, davTextProp(dav.DAVName("displayname"), true, collection.state.name))
		}
		if "" != collection.state.description {
			props = append(props, davTextProp(h.cfg.descriptionProp, true, collection.state.description))
		}
		if 0 < collection.maxResourceSize {
			props = append(props, davTextProp(xml.Name{Space: h.cfg.namespace, Local: "max-resource-size"}, false, strconv.FormatInt(collection.maxResourceSize, 10)))
		}
		props = append(props, h.service.collectionProps(collection)...)
	case davKindObject:
		object := target.object
		props = append(props,
			davTextProp(dav.DAVName("getetag"), true, davQuoteETag(object.etag)),
			davTextProp(dav.DAVName("getcontenttype"), true, h.cfg.mimeType),
			davTextProp(dav.DAVName("getcontentlength"), true, strconv.Itoa(len(object.content))),
		)
		if !object.modTime.IsZero() {
			props = append(props, davTextProp(dav.DAVName("getlastmodified"), true, object.modTime.UTC().Format(http.TimeFormat)))
		}
	}
	return props
}

func (h *davHandler) resourceType(target *davResource) *dav.Node {
	node := dav.NewElement(dav.DAVName("resourcetype"))
	switch target.kind {
	case davKindRoot, davKindHomeSet:
		node.Append(dav.NewElement(dav.DAVName("collection")))
	case davKindPrincipal:
		node.Append(dav.NewElement(dav.DAVName("collection")), dav.NewElement(dav.DAVName("principal")))
	case davKindCollection:
		node.Append(dav.NewElement(dav.DAVName("collection")), dav.NewElement(h.cfg.collectionType))
	}
	return node
}

// privilegeSet 返回 DAV:current-user-privilege-set（RFC 3744 §5.4）：管理员拥有全部权限，只读模式下只能读取。
func (h *davHandler) privilegeSet() *dav.Node {
	var privileges []xml.Name
	if !util.ReadOnly {
		for _, name := range []string{"all", "read", "write", "write-properties", "write-content", "bind", "unbind", "read-current-user-privilege-set"} {
			privileges = append(privileges, dav.DAVName(name))
		}
	} else {
		privileges = []xml.Name{dav.DAVName("read"), dav.DAVName("read-current-user-privilege-set")}
	}
	node := dav.NewElement(dav.DAVName("current-user-privilege-set"))
	for _, privilege := range append(privileges, h.cfg.privileges...) {
		node.Append(dav.NewElement(dav.DAVName("privilege"), dav.NewElement(privilege)))
	}
	return node
}

// supportedReports 返回 DAV:supported-report-set（RFC 3253 §3.1.5），RFC 4791 §2 与 RFC 6352 §3 要求集合和对象都声明。
func (h *davHandler) supportedReports(target *davResource) *dav.Node {
	reports := []xml.Name{h.cfg.queryReport, h.cfg.multigetReport, dav.DAVName("expand-property")}
	if davKindObject != target.kind {
		reports = append(reports, h.cfg.collectionReports...)
	}
	node := dav.NewElement(dav.DAVName("supported-report-set"))
	for _, report := range reports {
		node.Append(dav.NewElement(dav.DAVName("supported-report"), dav.NewElement(dav.DAVName("report"), dav.NewElement(report))))
	}
	return node
}

func (h *davHandler) report(w http.ResponseWriter, r *http.Request, target *davResource) error {
	if davKindMissing == target.kind {
		return errDAVNotFound
	}
	root, err := parseDAVBody(r)
	if err != nil {
		return err
	}
	if nil == root {
		return dav.NewError(http.StatusBadRequest, errors.New("REPORT requires a request body"))
	}
	switch root.XMLName {
	case dav.DAVName("expand-property"):
		return dav.WriteMultistatus(w, []*dav.Response{h.expandProperty(target, root.ChildrenNamed(dav.DAVName("property")), 0)})
	case h.cfg.multigetReport:
		return h.multiget(w, target, root)
	}
	if handled, err := h.service.report(h, w, r, target, root); handled || err != nil {
		return err
	}
	// RFC 3253 §3.6
	return dav.NewConditionError(http.StatusForbidden, dav.NewElement(dav.DAVName("supported-report")))
}

// multiget 返回 href 列出的对象；Depth 被忽略，href 必须位于请求地址之下（RFC 4791 §7.9、RFC 6352 §8.7）。
func (h *davHandler) multiget(w http.ResponseWriter, target *davResource, root *dav.Node) error {
	request, err := h.parsePropRequest(root, nil, true)
	if err != nil {
		return err
	}
	var responses []*dav.Response
	for _, href := range root.ChildrenNamed(dav.DAVName("href")) {
		p, ok := parseDAVHref(href.Text())
		var object *davResource
		if ok && (p == target.path || strings.HasPrefix(p, target.path+"/")) {
			object = h.resolve(p)
		}
		if nil == object || davKindObject != object.kind {
			responses = append(responses, &dav.Response{Href: p, Status: http.StatusNotFound})
			continue
		}
		responses = append(responses, h.propResponse(object, request))
	}
	return dav.WriteMultistatus(w, responses)
}

// expandProperty 实现 DAV:expand-property 报告（RFC 3253 §3.8）：嵌套的 property 元素把属性值中的每个 href
// 替换为该资源的 response。嵌套层数有限，避免属性互相引用时无限展开。
func (h *davHandler) expandProperty(target *davResource, properties []*dav.Node, level int) *dav.Response {
	request := &davPropRequest{}
	nested := map[xml.Name][]*dav.Node{}
	for _, property := range properties {
		local, _ := property.Attr("name")
		namespace, ok := property.Attr("namespace")
		if !ok {
			namespace = dav.NamespaceDAV
		}
		name := xml.Name{Space: namespace, Local: local}
		request.names = append(request.names, name)
		if children := property.ChildrenNamed(dav.DAVName("property")); 0 < len(children) && level < 3 {
			nested[name] = children
		}
	}
	response := h.propResponse(target, request)
	for _, propstat := range response.Propstats {
		if http.StatusOK != propstat.Status {
			continue
		}
		for i, prop := range propstat.Props {
			children, ok := nested[prop.XMLName]
			if !ok {
				continue
			}
			expanded := &dav.Node{XMLName: prop.XMLName, Attrs: prop.Attrs}
			for _, child := range prop.Nodes {
				if child.Is(dav.DAVName("href")) {
					if p, ok := parseDAVHref(child.Text()); ok {
						if resource := h.resolve(p); davKindMissing != resource.kind {
							expanded.Append(h.expandProperty(resource, children, level+1).Node())
						} else {
							expanded.Append((&dav.Response{Href: p, Status: http.StatusNotFound}).Node())
						}
						continue
					}
				}
				expanded.Append(child)
			}
			propstat.Props[i] = expanded
		}
	}
	return response
}

type davPropertyInstruction struct {
	prop   *dav.Node
	remove bool
}

type davPropertyResult struct {
	status    int
	condition *dav.Node
}

var errDAVPropertyFailed = errors.New("DAV: property instruction failed")

func davPropertyInstructions(root *dav.Node, allowRemove bool) (instructions []davPropertyInstruction) {
	for _, child := range root.Children() {
		remove := child.Is(dav.DAVName("remove"))
		if !child.Is(dav.DAVName("set")) && !(allowRemove && remove) {
			continue
		}
		for _, prop := range child.ChildrenNamed(dav.DAVName("prop")) {
			for _, node := range prop.Children() {
				instructions = append(instructions, davPropertyInstruction{prop: node, remove: remove})
			}
		}
	}
	return
}

func davPropertyPropstats(instructions []davPropertyInstruction, results []davPropertyResult) []*dav.Propstat {
	var set dav.PropstatSet
	for i, instruction := range instructions {
		set.Add(results[i].status, dav.NewElement(instruction.prop.XMLName))
		if nil != results[i].condition {
			set.SetError(results[i].status, results[i].condition)
		}
	}
	return set.Propstats()
}

func (h *davHandler) proppatch(w http.ResponseWriter, r *http.Request, target *davResource) error {
	if davKindMissing == target.kind {
		return errDAVNotFound
	}
	root, err := parseDAVBody(r)
	if err != nil {
		return err
	}
	if nil == root || !root.Is(dav.DAVName("propertyupdate")) {
		return dav.NewError(http.StatusBadRequest, errors.New("PROPPATCH body must be a propertyupdate element"))
	}
	instructions := davPropertyInstructions(root, true)
	results := make([]davPropertyResult, len(instructions))
	if davKindCollection == target.kind {
		err = h.service.updateCollection(target.path, func(state *davCollectionState) error {
			if h.applyProperties(state, instructions, results, false) {
				return errDAVPropertyFailed
			}
			return nil
		})
		if err != nil && !errors.Is(err, errDAVPropertyFailed) {
			return err
		}
	} else {
		// 只有日历和通讯录集合可以保存属性
		for i := range results {
			results[i] = davPropertyResult{status: http.StatusForbidden}
		}
	}
	return dav.WriteMultistatus(w, []*dav.Response{{Href: target.hrefPath(), Propstats: davPropertyPropstats(instructions, results)}})
}

// applyProperties 按文档顺序执行属性指令（RFC 4918 §9.2）；任一指令失败时其余指令标记为 424，调用方不能保存 state。
func (h *davHandler) applyProperties(state *davCollectionState, instructions []davPropertyInstruction, results []davPropertyResult, creating bool) (failed bool) {
	for i, instruction := range instructions {
		results[i] = h.applyProperty(state, instruction, creating)
		failed = failed || http.StatusOK != results[i].status
	}
	if failed {
		for i := range results {
			if http.StatusOK == results[i].status {
				results[i] = davPropertyResult{status: http.StatusFailedDependency}
			}
		}
	}
	return
}

func (h *davHandler) applyProperty(state *davCollectionState, instruction davPropertyInstruction, creating bool) davPropertyResult {
	prop, ok := instruction.prop, davPropertyResult{status: http.StatusOK}
	switch prop.XMLName {
	case dav.DAVName("displayname"):
		state.name = ""
		if !instruction.remove {
			state.name = prop.Text()
		}
		return ok
	case h.cfg.descriptionProp:
		state.description = ""
		if !instruction.remove {
			state.description = prop.Text()
		}
		return ok
	case dav.DAVName("resourcetype"):
		if creating {
			if h.validResourceType(prop) {
				return ok
			}
			return davPropertyResult{status: http.StatusForbidden, condition: dav.NewElement(dav.DAVName("valid-resourcetype"))}
		}
	case h.cfg.componentSetProp:
		if creating {
			var components []string
			for _, comp := range prop.ChildrenNamed(dav.CalDAVName("comp")) {
				name, _ := comp.Attr("name")
				name = strings.ToUpper(name)
				if !slices.Contains(calendarAllowedComponents, name) {
					return davPropertyResult{status: http.StatusForbidden}
				}
				components = append(components, name)
			}
			if 0 == len(components) {
				return davPropertyResult{status: http.StatusForbidden}
			}
			state.components = components
			return ok
		}
	}
	if h.isProtected(prop.XMLName) {
		return davPropertyResult{status: http.StatusForbidden, condition: dav.NewElement(dav.DAVName("cannot-modify-protected-property"))}
	}
	if !instruction.remove {
		if err := h.service.validateProperty(prop); err != nil {
			var davErr *dav.Error
			if errors.As(err, &davErr) {
				return davPropertyResult{status: davErr.Status, condition: davErr.Condition}
			}
			return davPropertyResult{status: http.StatusConflict}
		}
	}
	state.properties = slices.DeleteFunc(state.properties, func(node *dav.Node) bool { return node.XMLName == prop.XMLName })
	if !instruction.remove {
		state.properties = append(state.properties, prop.Clone())
	}
	return ok
}

var davProtectedProps = []xml.Name{
	dav.DAVName("resourcetype"), dav.DAVName("getetag"), dav.DAVName("getcontenttype"), dav.DAVName("getcontentlength"),
	dav.DAVName("getlastmodified"), dav.DAVName("creationdate"), dav.DAVName("lockdiscovery"), dav.DAVName("supportedlock"),
	dav.DAVName("current-user-principal"), dav.DAVName("current-user-privilege-set"), dav.DAVName("supported-report-set"),
	dav.DAVName("principal-URL"), dav.DAVName("owner"), dav.DAVName("acl"), dav.DAVName("sync-token"),
}

func (h *davHandler) isProtected(name xml.Name) bool {
	if name == h.cfg.homeSetProp || name == h.cfg.dataProp || name == h.cfg.componentSetProp {
		return true
	}
	if name.Space == h.cfg.namespace && ("supported-collation-set" == name.Local || "max-resource-size" == name.Local) {
		return true
	}
	return slices.Contains(davProtectedProps, name) || slices.Contains(h.cfg.protected, name)
}

// validResourceType 判断扩展 MKCOL 声明的资源类型是否正是本服务的集合类型（RFC 5689 §3.3）。
func (h *davHandler) validResourceType(prop *dav.Node) bool {
	children := prop.Children()
	if 2 != len(children) {
		return false
	}
	return (children[0].Is(dav.DAVName("collection")) && children[1].Is(h.cfg.collectionType)) ||
		(children[1].Is(dav.DAVName("collection")) && children[0].Is(h.cfg.collectionType))
}

// mkcol 处理 MKCOL（RFC 4918 §9.3、RFC 5689）与 MKCALENDAR（RFC 4791 §5.3.1）：只能在 home set 下创建集合，
// 请求体中的属性全部设置成功才创建集合。home set 下只有日历或通讯录，没有请求体的 MKCOL 也创建本服务的集合。
func (h *davHandler) mkcol(w http.ResponseWriter, r *http.Request, target *davResource, mkcalendar bool) error {
	if davKindMissing != target.kind {
		return h.methodNotAllowed(w, target)
	}
	if !target.parentIsHomeSet {
		return dav.NewConditionError(http.StatusForbidden, dav.NewElement(xml.Name{Space: h.cfg.namespace, Local: h.cfg.locationCondition}))
	}
	root, err := parseDAVBody(r)
	if err != nil {
		return err
	}
	state := &davCollectionState{}
	if nil != root {
		expected := dav.DAVName("mkcol")
		if mkcalendar {
			expected = dav.CalDAVName("mkcalendar")
		}
		if !root.Is(expected) {
			return dav.NewError(http.StatusUnsupportedMediaType, errors.New("unsupported request body"))
		}
		instructions := davPropertyInstructions(root, false)
		results := make([]davPropertyResult, len(instructions))
		if h.applyProperties(state, instructions, results, true) {
			propstats := davPropertyPropstats(instructions, results)
			if mkcalendar {
				return dav.WriteMultistatus(w, []*dav.Response{{Href: target.hrefPath(), Propstats: propstats}})
			}
			response := dav.NewElement(dav.DAVName("mkcol-response"))
			for _, propstat := range propstats {
				response.Append(propstat.Node())
			}
			return dav.WriteXML(w, http.StatusForbidden, response)
		}
	}
	if err = h.service.createCollection(target.path, state); err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusCreated)
	return nil
}
