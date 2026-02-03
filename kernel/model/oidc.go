// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"container/heap"
	"context"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	oidcprovider "github.com/siyuan-note/siyuan/kernel/model/oidc_provider"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	oidcFlowWeb     = "web"
	oidcFlowDesktop = "desktop"
	oidcFlowMobile  = "mobile"
)

const (
	oidcStatusPending = "pending"
	oidcStatusOK      = "ok"
	oidcStatusError   = "error"
)

type oidcStateReason int

const (
	oidcStateReasonOK oidcStateReason = iota
	oidcStateReasonSessionInvalid
	oidcStateReasonSessionExpired
	oidcStateReasonSessionHandled
	oidcStateReasonCallbackParamsMissing
	oidcStateReasonProviderMismatch
	oidcStateReasonFilterRejected
	oidcStateReasonAuthFailed
	oidcStateReasonSessionSaveFailed
	oidcStateReasonNotEnabled
	oidcStateReasonProviderInitFailed
)

func oidcReasonMessage(reason oidcStateReason, args ...any) string {
	switch reason {
	case oidcStateReasonSessionInvalid:
		return Conf.Language(277)
	case oidcStateReasonSessionExpired:
		return Conf.Language(284)
	case oidcStateReasonSessionHandled:
		return Conf.Language(285)
	case oidcStateReasonCallbackParamsMissing:
		return Conf.Language(286)
	case oidcStateReasonProviderMismatch:
		return Conf.Language(287)
	case oidcStateReasonFilterRejected:
		return Conf.Language(278)
	case oidcStateReasonSessionSaveFailed:
		return Conf.Language(288)
	case oidcStateReasonNotEnabled:
		return Conf.Language(280)
	case oidcStateReasonProviderInitFailed:
		return fmt.Sprintf(Conf.Language(281), args...)
	case oidcStateReasonAuthFailed:
		return Conf.Language(276)
	default:
		return Conf.Language(276)
	}
}

func OIDCLogin(c *gin.Context) {
	if !OIDCIsEnabled(Conf.OIDC) {
		oidcLoginError(c, oidcStateReasonNotEnabled, "oidc not enabled", nil)
		return
	}

	p, err := oidcProvider(Conf.OIDC)
	if err != nil {
		oidcLoginError(c, oidcStateReasonProviderInitFailed, "init oidc provider failed", err, Conf.OIDC.Provider)
		return
	}

	entry := oidcChallenge(p.ID(), oidcFlowFromQuery(c), util.SanitizeRedirectPath(c.Query("to")), util.ParseBoolQuery(c.Query("rememberMe")))
	authURL, extra, err := p.AuthURL(entry.state, entry.nonce)
	entry.extra = extra
	if err != nil {
		oidcLoginError(c, oidcStateReasonAuthFailed, "oidc auth url failed", err)
		return
	} else if "" == authURL {
		oidcLoginError(c, oidcStateReasonAuthFailed, "oidc auth url is empty", nil)
		return
	}
	stateStore().put(entry)

	oidcLoginSuccess(c, authURL, entry.state)
}

func oidcFlowFromQuery(c *gin.Context) string {
	flow := strings.ToLower(strings.TrimSpace(c.Query("flow")))

	// Unknown flow, default to web flow for maximum compatibility
	if oidcFlowDesktop != flow && oidcFlowMobile != flow && oidcFlowWeb != flow {
		logging.LogWarnf("unknown oidc flow [%s], default to web flow", flow)
		flow = oidcFlowWeb
	}

	return flow
}

func oidcLoginError(c *gin.Context, reason oidcStateReason, logMsg string, err error, args ...any) {
	ret := util.NewResult()
	ret.Code = -1
	ret.Msg = oidcReasonMessage(reason, args...)
	c.JSON(http.StatusOK, ret)
	logOIDCFailure(logMsg, err, c.Request)
}

func oidcChallenge(providerID, flow, to string, rememberMe bool) *stateEntry {
	if "" == flow {
		flow = oidcFlowWeb
	}
	entry := &stateEntry{
		state:      gulu.Rand.String(32),
		nonce:      gulu.Rand.String(32),
		providerID: providerID,
		to:         to,
		remember:   rememberMe,
		flow:       flow,
		status:     oidcStatusPending,
		expiresAt:  time.Now().Add(oidcStateTTL),
	}
	return entry
}

func oidcLoginSuccess(c *gin.Context, authURL, state string) {
	ret := util.NewResult()
	ret.Data = map[string]any{
		"authUrl": authURL,
		"state":   state,
	}
	c.JSON(http.StatusOK, ret)
}

const oidcLoginTimeout = 10 * time.Second

func OIDCCallback(c *gin.Context) {
	if !OIDCIsEnabled(Conf.OIDC) {
		c.Status(http.StatusNotFound)
		return
	}

	state := strings.TrimSpace(c.Query("state"))
	if "" == state {
		oidcCallbackError(c, nil, oidcStateReasonCallbackParamsMissing, "missing oidc state", nil)
		return
	}

	code := strings.TrimSpace(c.Query("code"))
	if "" == code {
		oidcCallbackError(c, nil, oidcStateReasonCallbackParamsMissing, "missing oidc code", nil)
		return
	}

	entry, reason := stateStore().do(state, func(entry *stateEntry) bool {
		return oidcFlowDesktop != entry.flow
	})
	if nil == entry {
		oidcCallbackError(c, entry, reason, "get entry failed", nil)
		return
	}

	p, err := oidcProvider(Conf.OIDC)
	if err != nil {
		oidcCallbackError(c, entry, oidcStateReasonProviderInitFailed, "init oidc provider failed", err, Conf.OIDC.Provider)
		return
	}

	if entry.providerID != p.ID() {
		oidcCallbackError(c, entry, oidcStateReasonProviderMismatch, "oidc provider mismatch", nil)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), oidcLoginTimeout)
	defer cancel()

	claims, err := p.HandleCallback(ctx, code, entry.nonce, entry.extra)
	if err != nil {
		oidcCallbackError(c, entry, oidcStateReasonAuthFailed, "oidc callback failed", err)
		return
	}

	if !IsAllowed(Conf.OIDC.Filters, claims) {
		oidcCallbackError(c, entry, oidcStateReasonFilterRejected, "oidc filter rejected", nil)
		return
	}

	oidcCallbackSuccess(c, entry)
}

func oidcCallbackError(c *gin.Context, entry *stateEntry, reason oidcStateReason, logMsg string, err error, args ...any) {
	userMsg := oidcReasonMessage(reason, args...)
	flow := ""
	to := ""
	state := ""
	if nil != entry {
		flow = entry.flow
		to = entry.to
		state = entry.state
	}

	if oidcFlowDesktop == flow {
		oidcRenderCallbackResult(c, false, state, userMsg, logMsg, err)
		return
	}

	oidcRedirectToCheckAuthError(c, to, userMsg, logMsg, err)
}

func oidcCallbackSuccess(c *gin.Context, entry *stateEntry) {
	if oidcFlowDesktop == entry.flow {
		oidcRenderCallbackResult(c, true, entry.state, "", "oidc auth success", nil)
		return
	}

	if err := applyOIDCSession(c, entry); nil != err {
		oidcRedirectToCheckAuthError(c, entry.to, oidcReasonMessage(oidcStateReasonSessionSaveFailed), "save session failed", err)
		return
	}

	logging.LogInfof("oidc auth success [ip=%s, maxAge=%d]", util.GetRemoteAddr(c.Request), oidcRememberMaxAge(entry.remember))
	c.Redirect(http.StatusFound, entry.to)
}

func OIDCCheck(c *gin.Context) {
	ret := util.NewResult()

	state := strings.TrimSpace(c.Query("state"))
	if "" == state {
		oidcCheckInvalid(c, ret, oidcStateReasonSessionInvalid)
		return
	}

	entry, reason := stateStore().do(state, func(entry *stateEntry) bool {
		return entry.status != oidcStatusPending
	})
	if entry == nil {
		oidcCheckInvalid(c, ret, reason)
		return
	}

	if entry.status == oidcStatusPending {
		oidcCheckPending(c, ret)
		return
	}

	if oidcStatusError == entry.status {
		oidcCheckError(c, ret, oidcStateReasonAuthFailed, entry.msg)
		return
	}

	if err := applyOIDCSession(c, entry); nil != err {
		oidcCheckError(c, ret, oidcStateReasonSessionSaveFailed, "")
		return
	}

	logging.LogInfof("oidc auth success [ip=%s, maxAge=%d]", util.GetRemoteAddr(c.Request), oidcRememberMaxAge(entry.remember))
	oidcCheckOK(c, ret, entry.to)
}

func oidcCheckInvalid(c *gin.Context, ret *util.Result, reason oidcStateReason) {
	ret.Code = -1
	ret.Msg = oidcReasonMessage(reason)
	ret.Data = map[string]any{
		"status": oidcStatusError,
	}
	c.JSON(http.StatusOK, ret)
}

func oidcCheckPending(c *gin.Context, ret *util.Result) {
	ret.Code = 1
	ret.Msg = "Pending"
	ret.Data = map[string]any{
		"status": oidcStatusPending,
	}
	c.JSON(http.StatusOK, ret)
}

func oidcCheckError(c *gin.Context, ret *util.Result, reason oidcStateReason, msg string) {
	if msg == "" {
		msg = oidcReasonMessage(reason)
	}
	ret.Code = -1
	ret.Msg = oidcDefaultErrorMsg(msg)
	ret.Data = map[string]any{
		"status": oidcStatusError,
	}
	c.JSON(http.StatusOK, ret)
}

func oidcCheckOK(c *gin.Context, ret *util.Result, to string) {
	ret.Code = 0
	ret.Msg = "OK"
	ret.Data = map[string]any{
		"status": oidcStatusOK,
		"to":     to,
	}
	c.JSON(http.StatusOK, ret)
}

func applyOIDCSession(c *gin.Context, entry *stateEntry) error {
	session := util.GetSession(c)
	workspaceSession := util.GetWorkspaceSession(session)

	workspaceSession.OIDC.ProviderID = entry.providerID
	workspaceSession.OIDC.ProviderHash = Conf.OIDC.ProviderHash
	workspaceSession.OIDC.FilterHash = Conf.OIDC.FilterHash

	ginSessions.Default(c).Options(ginSessions.Options{
		Path:     "/",
		Secure:   util.SSL,
		MaxAge:   oidcRememberMaxAge(entry.remember),
		HttpOnly: true,
	})

	return session.Save(c)
}

func oidcRememberMaxAge(remember bool) int {
	if remember {
		return 60 * 60 * 24 * 30
	}
	return 0
}

func oidcRenderCallbackResult(c *gin.Context, ok bool, state, userMsg, logMsg string, err error) {
	status := ""

	if ok {
		status = oidcStatusOK
	} else {
		status = oidcStatusError
		userMsg = oidcDefaultErrorMsg(userMsg)
		logOIDCFailure(logMsg, err, c.Request)
	}

	if "" != state {
		stateStore().setResult(state, status, userMsg)
	}
	oidcRenderAppCallbackPage(c, ok, userMsg)
}

func oidcDefaultErrorMsg(msg string) string {
	if "" == msg {
		return oidcReasonMessage(oidcStateReasonAuthFailed)
	}
	return msg
}

func oidcRenderAppCallbackPage(c *gin.Context, ok bool, msg string) {
	title := Conf.Language(283)
	if ok {
		title = Conf.Language(282)
	}

	detail := strings.TrimSpace(msg)

	data, err := os.ReadFile(filepath.Join(util.WorkingDir, "stage/oidc-callback.html"))
	if err != nil {
		logging.LogErrorf("load oidc callback page failed: %s", err)
		c.String(http.StatusOK, detail)
		return
	}

	tpl, err := template.New("oidc-callback").Parse(string(data))
	if err != nil {
		logging.LogErrorf("parse oidc callback page failed: %s", err)
		c.String(http.StatusOK, detail)
		return
	}

	safeDetail := template.HTMLEscapeString(detail)
	safeDetail = strings.ReplaceAll(safeDetail, "\n", "<br>")
	model := map[string]any{
		"title":            title,
		"ok":               ok,
		"detail":           template.HTML(safeDetail),
		"appearanceMode":   Conf.Appearance.Mode,
		"appearanceModeOS": Conf.Appearance.ModeOS,
	}

	buf := &bytes.Buffer{}
	if err = tpl.Execute(buf, model); err != nil {
		logging.LogErrorf("execute oidc callback page failed: %s", err)
		c.String(http.StatusOK, detail)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", buf.Bytes())
}

func OIDCIsEnabled(oidcConf *conf.OIDC) bool {
	if nil == oidcConf || "" == strings.TrimSpace(oidcConf.Provider) {
		return false
	}

	pc := providerConf(oidcConf)
	if nil == pc {
		return false
	}

	return true
}

const defaultProviderLabel = "Login with SSO"

func OIDCProviderLabel(oidcConf *conf.OIDC) string {
	if !OIDCIsEnabled(oidcConf) {
		return defaultProviderLabel
	}
	p, err := oidcProvider(oidcConf)
	if err != nil {
		return defaultProviderLabel
	}
	return p.Label()
}

func OIDCIsValid(oidcConf *conf.OIDC, workspaceSession *util.WorkspaceSession) bool {
	if nil == workspaceSession || nil == workspaceSession.OIDC {
		return false
	}
	if !OIDCIsEnabled(oidcConf) {
		return false
	}
	if "" == workspaceSession.OIDC.ProviderID {
		return false
	}
	if workspaceSession.OIDC.ProviderID != oidcConf.Provider {
		return false
	}
	if workspaceSession.OIDC.ProviderHash != oidcConf.ProviderHash {
		return false
	}
	if workspaceSession.OIDC.FilterHash != oidcConf.FilterHash {
		return false
	}
	return true
}

func providerConf(oidcConf *conf.OIDC) *conf.OIDCProviderConf {
	providerID := strings.TrimSpace(oidcConf.Provider)
	return oidcConf.Providers[providerID]
}

func oidcProvider(oidcConf *conf.OIDC) (oidcprovider.Provider, error) {
	pc := providerConf(oidcConf)
	if nil == pc {
		return nil, errors.New("OIDC provider config not found")
	}
	return oidcprovider.New(oidcConf.Provider, pc)
}

func logOIDCFailure(logMsg string, err error, req *http.Request) {
	if err != nil {
		logging.LogWarnf("oidc auth failed: %s [err=%s, ip=%s]", logMsg, err, util.GetRemoteAddr(req))
	} else {
		logging.LogWarnf("oidc auth failed: %s [ip=%s]", logMsg, util.GetRemoteAddr(req))
	}
}

func oidcRedirectToCheckAuthError(c *gin.Context, redirectTo string, userMsg string, logMsg string, err error) {
	userMsg = oidcDefaultErrorMsg(userMsg)
	if 200 < len(userMsg) {
		userMsg = userMsg[:200] + "..."
	}

	logOIDCFailure(logMsg, err, c.Request)

	location := url.URL{Path: "/check-auth"}
	queryParams := url.Values{}
	if "" != redirectTo {
		queryParams.Set("to", redirectTo)
	}
	queryParams.Set("error", userMsg)
	location.RawQuery = queryParams.Encode()
	c.Redirect(http.StatusFound, location.String())
}

func IsAllowed(filters map[string][]string, claims *oidcprovider.OIDCClaims) bool {
	if 0 == len(filters) {
		return true
	}

	values := claims.FilterValues()
	for key, patterns := range filters {
		if 0 == len(patterns) {
			continue
		}
		vals, ok := values[key]
		if !ok || 0 == len(vals) {
			return false
		}

		if !matchAnyPattern(vals, patterns) {
			return false
		}
	}
	return true
}

func matchAnyPattern(values []string, patterns []string) bool {
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if "" == pattern {
			continue
		}

		matcher, err := buildMatcher(pattern)
		if err != nil {
			logging.LogErrorf("invalid oidc filter pattern [%s]: %s", pattern, err)
			continue
		}
		if slices.ContainsFunc(values, matcher.Match) {
			return true
		}
	}
	return false
}

type patternMatcher interface {
	Match(value string) bool
}

type matcherFactory func(pattern string) (patternMatcher, error)

var matcherFactories = map[string]matcherFactory{
	"regex": func(pattern string) (patternMatcher, error) { return newRegexMatcher(pattern, false) },
	"re":    func(pattern string) (patternMatcher, error) { return newRegexMatcher(pattern, false) },

	"regexi": func(pattern string) (patternMatcher, error) { return newRegexMatcher(pattern, true) },

	"str":    func(pattern string) (patternMatcher, error) { return newStringMatcher(pattern, true) },
	"string": func(pattern string) (patternMatcher, error) { return newStringMatcher(pattern, true) },

	"exact": func(pattern string) (patternMatcher, error) { return newStringMatcher(pattern, false) },
}

func buildMatcher(pattern string) (patternMatcher, error) {
	if prefix, after, ok := strings.Cut(pattern, ":"); ok {
		prefix = strings.ToLower(strings.TrimSpace(prefix))
		if factory, ok := matcherFactories[prefix]; ok {
			return factory(strings.TrimSpace(after))
		}
	}

	return newRegexMatcher(pattern, true)
}

type regexMatcher struct {
	re *regexp.Regexp
}

func newRegexMatcher(pattern string, forceCaseInsensitive bool) (patternMatcher, error) {
	if forceCaseInsensitive {
		pattern = ensureCaseInsensitiveRegex(pattern)
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, err
	}
	return &regexMatcher{re: re}, nil
}

func (m *regexMatcher) Match(value string) bool {
	return m.re.MatchString(value)
}

func ensureCaseInsensitiveRegex(pattern string) string {
	if strings.HasPrefix(pattern, "(?i)") || strings.HasPrefix(pattern, "(?-i)") {
		return pattern
	}
	return "(?i)" + pattern
}

type stringMatcher struct {
	pattern         string
	caseInsensitive bool
}

func newStringMatcher(pattern string, caseInsensitive bool) (patternMatcher, error) {
	return &stringMatcher{pattern: pattern, caseInsensitive: caseInsensitive}, nil
}

func (m *stringMatcher) Match(value string) bool {
	if m.caseInsensitive {
		return strings.EqualFold(value, m.pattern)
	}
	return value == m.pattern
}

// long enough for user to complete OIDC login, maybe?
const oidcStateTTL = 15 * time.Minute

// stateEntry tracks the transient OIDC login state.
type stateEntry struct {
	state      string
	nonce      string
	extra      any
	providerID string
	to         string
	remember   bool
	flow       string
	status     string
	msg        string
	expiresAt  time.Time

	// current position in heap, internally used by heap.Fix/Remove
	// to reduce find complexity.
	index int
}

// oidcStateStore keeps short-lived OIDC login states in memory.
// It maps state -> entry and uses a min-heap to track the next expiration.
// The cleanup loop sleeps until the earliest expiry and stops when the store is empty.
// TTL expiration is enforced on both take() and in the cleanup loop.
type oidcStateStore struct {
	mu sync.Mutex

	entries map[string]*stateEntry
	heap    stateHeap

	timer *time.Timer
	wake  chan struct{}
}

var (
	oidcStateStoreOnce sync.Once
	oidcStateStoreInst *oidcStateStore
)

// stateStore returns the singleton store (lazy init).
func stateStore() *oidcStateStore {
	oidcStateStoreOnce.Do(func() {
		oidcStateStoreInst = &oidcStateStore{
			entries: map[string]*stateEntry{},
			wake:    make(chan struct{}, 1),
		}
		go oidcStateStoreInst.loop()
	})
	return oidcStateStoreInst
}

// signal wakes the cleanup loop to recompute the next deadline.
func (s *oidcStateStore) signal() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// put inserts or updates a state entry.
func (s *oidcStateStore) put(entry *stateEntry) {
	defer s.signal()

	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, ok := s.entries[entry.state]; ok {
		idx := existing.index
		*existing = *entry
		existing.index = idx
		heap.Fix(&s.heap, existing.index)
		return
	}

	heap.Push(&s.heap, entry)
	s.entries[entry.state] = entry
}

// do returns a copy of the entry and removes it when decide returns true.
func (s *oidcStateStore) do(state string, decide func(entry *stateEntry) bool) (*stateEntry, oidcStateReason) {
	remove := false
	defer func() {
		if remove {
			s.signal()
		}
	}()

	s.mu.Lock()
	defer s.mu.Unlock()

	entry, ok := s.entries[state]
	if !ok {
		return nil, oidcStateReasonSessionInvalid
	}
	if time.Now().After(entry.expiresAt) {
		s.mu.Unlock()
		return nil, oidcStateReasonSessionExpired
	}

	copied := *entry
	remove = decide(&copied)
	if remove {
		heap.Remove(&s.heap, entry.index)
		delete(s.entries, state)
	}

	return &copied, oidcStateReasonOK
}

// setResult marks a state entry as finished and extends its TTL for polling.
func (s *oidcStateStore) setResult(state, status, msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry, ok := s.entries[state]
	if !ok {
		logging.LogErrorf("oidc set result [state: %s, status: %s, msg: %s] failed: cannot find entry", state, status, msg)
		return
	}

	entry.status = status
	entry.msg = msg
}

// resetTimerLocked restarts the timer with the next delay.
func (s *oidcStateStore) resetTimerLocked(d time.Duration) {
	if nil == s.timer {
		s.timer = time.NewTimer(d)
		return
	}
	s.timer.Stop()
	s.timer.Reset(d)
}

// stopTimerLocked stops the timer if it exists.
func (s *oidcStateStore) stopTimerLocked() {
	if nil == s.timer {
		return
	}
	s.timer.Stop()
}

// purgeExpiredLocked pops expired entries from the heap.
func (s *oidcStateStore) purgeExpiredLocked(now time.Time) {
	for len(s.heap) > 0 {
		entry := s.heap[0]
		if entry.expiresAt.After(now) {
			return
		}
		heap.Pop(&s.heap)
		delete(s.entries, entry.state)
	}
}

// loop sleeps until the next expiry, or wakes on updates.
func (s *oidcStateStore) loop() {
	for {
		s.mu.Lock()
		if len(s.heap) == 0 {
			s.stopTimerLocked()
			s.mu.Unlock()
			<-s.wake
			continue
		}

		now := time.Now()
		s.purgeExpiredLocked(now)
		if len(s.heap) == 0 {
			s.stopTimerLocked()
			s.mu.Unlock()
			continue
		}

		next := s.heap[0].expiresAt
		delay := max(next.Sub(now), 0)
		s.resetTimerLocked(delay)
		s.mu.Unlock()

		select {
		case <-s.timer.C:
		case <-s.wake:
		}
	}
}

// stateHeap is a min-heap ordered by expiration time.
type stateHeap []*stateEntry

func (h stateHeap) Len() int { return len(h) }

func (h stateHeap) Less(i, j int) bool {
	return h[i].expiresAt.Before(h[j].expiresAt)
}

func (h stateHeap) Swap(i, j int) {
	h[i], h[j] = h[j], h[i]
	h[i].index = i
	h[j].index = j
}

func (h *stateHeap) Push(x any) {
	entry := x.(*stateEntry)
	entry.index = len(*h)
	*h = append(*h, entry)
}

func (h *stateHeap) Pop() any {
	old := *h
	n := len(old)
	entry := old[n-1]
	entry.index = -1
	*h = old[:n-1]
	return entry
}
