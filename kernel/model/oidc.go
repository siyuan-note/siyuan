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
	"container/heap"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
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
	oidcLoginTimeout = 10 * time.Second
)

func OIDCLogin(c *gin.Context) {
	redirectTo := util.SanitizeRedirectPath(c.Query("to"))

	if !OIDCIsEnabled(Conf.OIDC) {
		OIDCAuthError(c, redirectTo, Conf.Language(280), "oidc not enabled", nil)
		return
	}

	p, err := OIDCProviderInstance(Conf.OIDC)
	if err != nil {
		OIDCAuthError(c, redirectTo, fmt.Sprintf(Conf.Language(281), Conf.OIDC.Provider), "init oidc provider failed", err)
		return
	}

	state, nonce := OIDCChallenge(p.ID(), redirectTo, util.ParseBoolQuery(c.Query("rememberMe")))

	authURL := p.AuthURL(state, nonce)
	if "" == authURL {
		OIDCAuthError(c, redirectTo, Conf.Language(276), "oidc auth url is empty", nil)
		return
	}
	c.Redirect(http.StatusFound, authURL)
}

func OIDCCallback(c *gin.Context) {
	if !OIDCIsEnabled(Conf.OIDC) {
		c.Status(http.StatusNotFound)
		return
	}

	state := strings.TrimSpace(c.Query("state"))
	if "" == state {
		OIDCAuthError(c, "", Conf.Language(277), "missing oidc state", nil)
		return
	}
	entry, ok := stateStore().take(state)
	if !ok {
		OIDCAuthError(c, "", Conf.Language(277), "invalid oidc state", nil)
		return
	}

	code := strings.TrimSpace(c.Query("code"))
	if "" == code {
		OIDCAuthError(c, entry.to, Conf.Language(277), "missing oidc code", nil)
		return
	}

	p, err := OIDCProviderInstance(Conf.OIDC)
	if err != nil {
		OIDCAuthError(c, entry.to, fmt.Sprintf(Conf.Language(281), Conf.OIDC.Provider), "init oidc provider failed", err)
		return
	}

	if entry.providerID != p.ID() {
		OIDCAuthError(c, entry.to, Conf.Language(277), "oidc provider mismatch", nil)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), oidcLoginTimeout)
	defer cancel()

	claims, err := p.HandleCallback(ctx, code, entry.nonce)
	if err != nil {
		OIDCAuthError(c, entry.to, Conf.Language(276), "oidc callback failed", err)
		return
	}

	if !IsAllowed(Conf.OIDC.Filters, claims) {
		OIDCAuthError(c, entry.to, Conf.Language(278), "oidc filter rejected", nil)
		return
	}

	session := util.GetSession(c)
	workspaceSession := util.GetWorkspaceSession(session)

	workspaceSession.OIDC.ProviderID = entry.providerID
	workspaceSession.OIDC.ProviderHash = Conf.OIDC.ProviderHash
	workspaceSession.OIDC.FilterHash = Conf.OIDC.FilterHash

	maxAge := 0
	if entry.remember {
		maxAge = 60 * 60 * 24 * 30
	}
	ginSessions.Default(c).Options(ginSessions.Options{
		Path:     "/",
		Secure:   util.SSL,
		MaxAge:   maxAge,
		HttpOnly: true,
	})

	if err = session.Save(c); err != nil {
		OIDCAuthError(c, entry.to, Conf.Language(276), "save session failed", err)
		return
	}
	logging.LogInfof("oidc auth success [ip=%s, maxAge=%d]", util.GetRemoteAddr(c.Request), maxAge)

	c.Redirect(http.StatusFound, entry.to)
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

func OIDCChallenge(providerID, to string, rememberMe bool) (state, nonce string) {
	entry := &stateEntry{
		state:      gulu.Rand.String(32),
		nonce:      gulu.Rand.String(32),
		providerID: providerID,
		to:         to,
		remember:   rememberMe,
		expiresAt:  time.Now().Add(oidcStateTTL),
	}
	stateStore().put(entry)
	return entry.state, entry.nonce
}

const defaultProviderLabel = "Login with SSO"

func OIDCProviderLabel(oidcConf *conf.OIDC) string {
	if !OIDCIsEnabled(oidcConf) {
		return defaultProviderLabel
	}
	p, err := OIDCProviderInstance(oidcConf)
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

func OIDCProviderInstance(oidcConf *conf.OIDC) (oidcprovider.Provider, error) {
	pc := providerConf(oidcConf)
	if nil == pc {
		return nil, errors.New("OIDC provider config not found")
	}
	return oidcprovider.New(oidcConf.Provider, pc)
}

func OIDCAuthError(c *gin.Context, redirectTo string, userMsg string, logMsg string, err error) {
	if "" == userMsg {
		userMsg = "OIDC authentication failed, please retry."
	}
	if 200 < len(userMsg) {
		userMsg = userMsg[:200] + "..."
	}

	if err != nil {
		logging.LogWarnf("oidc auth failed: %s [err=%s, ip=%s]", logMsg, err, util.GetRemoteAddr(c.Request))
	} else {
		logging.LogWarnf("oidc auth failed: %s [ip=%s]", logMsg, util.GetRemoteAddr(c.Request))
	}

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
const oidcStateTTL = 10 * time.Minute

// stateEntry tracks the transient OIDC login state.
type stateEntry struct {
	state      string
	nonce      string
	providerID string
	to         string
	remember   bool
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
	s.mu.Lock()

	if existing, ok := s.entries[entry.state]; ok {
		idx := existing.index
		*existing = *entry
		existing.index = idx
		heap.Fix(&s.heap, existing.index)
		s.mu.Unlock()
		s.signal()
		return
	}
	heap.Push(&s.heap, entry)
	s.entries[entry.state] = entry

	s.mu.Unlock()
	s.signal()
}

// take removes and returns a state entry if it exists and is not expired.
func (s *oidcStateStore) take(state string) (*stateEntry, bool) {
	s.mu.Lock()

	entry, ok := s.entries[state]
	if !ok {
		s.mu.Unlock()
		return nil, false
	}
	heap.Remove(&s.heap, entry.index)
	delete(s.entries, state)

	s.mu.Unlock()

	s.signal()

	if time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry, true
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
