// Package mcpoauth 实现仅用于内置 MCP 的授权码、刷新和撤销，持久化文件只保存凭证摘要。
package mcpoauth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

const AccessPrefix = "sy-mcp-a."
const scope = "mcp"
const maxClients = 64
const maxGrants = 256
const maxPending = 256

var ErrInvalid = errors.New("invalid_request")
var ErrGrant = errors.New("invalid_grant")
var ErrClient = errors.New("invalid_client")
var ErrDisabled = errors.New("MCP OAuth is disabled")

type client struct {
	apicontract.MCPOAuthClient
	SecretHash string `json:"secretHash"`
}

type grant struct {
	ClientID      string   `json:"clientID"`
	AccessHash    string   `json:"accessHash"`
	AccessExpires int64    `json:"accessExpires"`
	RefreshHash   string   `json:"refreshHash"`
	Expires       int64    `json:"expires"`
	Scope         string   `json:"scope"`
	Spent         []string `json:"spent"`
}

type state struct {
	Version int                        `json:"version"`
	Epoch   string                     `json:"epoch"`
	Config  apicontract.MCPOAuthConfig `json:"config"`
	Clients map[string]client          `json:"clients"`
	Grants  map[string]grant           `json:"grants"`
}

type Authorization struct {
	ClientID    string
	RedirectURI string
	State       string
	Challenge   string
	Scope       string
	Resource    string
}

type pending struct {
	Authorization
	Binding string
	Expires time.Time
}

type Service struct {
	mu      sync.Mutex
	path    string
	data    state
	pending map[string]pending
	codes   map[string]pending
	now     func() time.Time
	write   func(string, []byte) error
}

func Open(path, epoch string) (*Service, error) {
	s := &Service{path: path, now: time.Now, write: writeAtomic,
		pending: map[string]pending{}, codes: map[string]pending{},
		data: state{Version: 1, Epoch: epoch, Clients: map[string]client{}, Grants: map[string]grant{}}}
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		s.data = state{}
		if err = json.Unmarshal(data, &s.data); err != nil {
			return nil, err
		}
		if s.data.Version != 1 || s.data.Clients == nil || s.data.Grants == nil {
			return nil, ErrInvalid
		}
		if err = validateConfig(s.data.Config); err != nil {
			return nil, err
		}
	}
	if err = s.EnsureEpoch(epoch); err != nil {
		return nil, err
	}
	return s, nil
}

// writeAtomic 先完整写入同目录临时文件，再替换配置；失败时保留原文件及内存状态。
func writeAtomic(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".mcp-oauth-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}

func (s *Service) clone() state {
	data, _ := json.Marshal(s.data)
	var next state
	_ = json.Unmarshal(data, &next)
	return next
}

func (s *Service) save(next state) error {
	data, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if err = s.write(s.path, data); err != nil {
		return err
	}
	s.data = next
	return nil
}

func (s *Service) EnsureEpoch(epoch string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Epoch == epoch {
		return nil
	}
	next := s.clone()
	next.Epoch = epoch
	next.Grants = map[string]grant{}
	if err := s.save(next); err != nil {
		return err
	}
	s.pending, s.codes = map[string]pending{}, map[string]pending{}
	return nil
}

func validateConfig(config apicontract.MCPOAuthConfig) error {
	if !config.Enabled && config.PublicURL == "" {
		return nil
	}
	u, err := url.Parse(config.PublicURL)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || u.ForceQuery || strings.ContainsAny(config.PublicURL, "?#*") {
		return ErrInvalid
	}
	return nil
}

func (s *Service) Configure(config apicontract.MCPOAuthConfig) error {
	config.PublicURL = strings.TrimRight(strings.TrimSpace(config.PublicURL), "/")
	if err := validateConfig(config); err != nil {
		return err
	}
	if config.PublicURL != "" {
		u, _ := url.Parse(config.PublicURL)
		u.Host = strings.ToLower(u.Host)
		if u.Port() == "443" {
			u.Host = strings.TrimSuffix(u.Host, ":443")
		}
		config.PublicURL = u.String()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if config == s.data.Config {
		return nil
	}
	next := s.clone()
	next.Config = config
	next.Grants = map[string]grant{}
	if err := s.save(next); err != nil {
		return err
	}
	s.pending, s.codes = map[string]pending{}, map[string]pending{}
	return nil
}

func (s *Service) Status() apicontract.MCPOAuthStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	ret := apicontract.MCPOAuthStatus{MCPOAuthConfig: s.data.Config, Clients: []apicontract.MCPOAuthClient{}}
	for _, c := range s.data.Clients {
		ret.Clients = append(ret.Clients, c.MCPOAuthClient)
	}
	sort.Slice(ret.Clients, func(i, j int) bool { return ret.Clients[i].ID < ret.Clients[j].ID })
	return ret
}

func random() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func hash(value string) string {
	h := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

func equal(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }

func (s *Service) AddClient(req apicontract.MCPOAuthClientRequest) (ret apicontract.MCPOAuthClientSecret, err error) {
	req.Name = strings.TrimSpace(req.Name)
	u, parseErr := url.Parse(req.RedirectURI)
	if parseErr != nil || u.User != nil || strings.ContainsAny(req.RedirectURI, "#*") || u.Hostname() == "" || len(req.RedirectURI) > 2048 ||
		(u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"))) || req.Name == "" || len(req.Name) > 128 {
		return ret, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.data.Clients) >= maxClients {
		return ret, ErrInvalid
	}
	ret = apicontract.MCPOAuthClientSecret{MCPOAuthClient: apicontract.MCPOAuthClient{ID: random(), Name: req.Name, RedirectURI: req.RedirectURI}, Secret: random()}
	next := s.clone()
	next.Clients[ret.ID] = client{MCPOAuthClient: ret.MCPOAuthClient, SecretHash: hash(ret.Secret)}
	err = s.save(next)
	return
}

func (s *Service) Remove(id string, all bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id == "" && !all {
		return ErrInvalid
	}
	next := s.clone()
	if !all {
		delete(next.Clients, id)
	}
	for key, g := range next.Grants {
		if all || g.ClientID == id {
			delete(next.Grants, key)
		}
	}
	if err := s.save(next); err != nil {
		return err
	}
	for key, p := range s.pending {
		if all || p.ClientID == id {
			delete(s.pending, key)
		}
	}
	for key, p := range s.codes {
		if all || p.ClientID == id {
			delete(s.codes, key)
		}
	}
	return nil
}

func normalizeScope(value string) (string, error) {
	if value == "" {
		return scope, nil
	}
	hasMCP, offline := false, false
	for _, item := range strings.Fields(value) {
		switch item {
		case scope:
			hasMCP = true
		case "offline_access":
			offline = true
		default:
			return "", ErrInvalid
		}
	}
	if !hasMCP {
		return "", ErrInvalid
	}
	if offline {
		return "mcp offline_access", nil
	}
	return scope, nil
}

func (s *Service) authorizeLocked(values url.Values) (Authorization, error) {
	a := Authorization{ClientID: values.Get("client_id"), RedirectURI: values.Get("redirect_uri"), State: values.Get("state"), Challenge: values.Get("code_challenge"), Resource: values.Get("resource")}
	if !s.data.Config.Enabled {
		return a, ErrDisabled
	}
	for _, v := range values {
		if len(v) != 1 || len(v[0]) > 4096 {
			return a, ErrInvalid
		}
	}
	c, ok := s.data.Clients[a.ClientID]
	challenge, err := base64.RawURLEncoding.DecodeString(a.Challenge)
	if !ok || c.RedirectURI != a.RedirectURI || values.Get("response_type") != "code" || values.Get("code_challenge_method") != "S256" || err != nil || len(challenge) != 32 || a.Resource != s.data.Config.PublicURL+"/mcp" {
		return a, ErrInvalid
	}
	a.Scope, err = normalizeScope(values.Get("scope"))
	return a, err
}

func (s *Service) ValidateAuthorization(values url.Values) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.authorizeLocked(values)
	return err
}

func (s *Service) Begin(values url.Values, binding string) (ticket string, c apicontract.MCPOAuthClient, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, err := s.authorizeLocked(values)
	if err != nil {
		return "", c, err
	}
	for key, p := range s.pending {
		if !s.now().Before(p.Expires) {
			delete(s.pending, key)
		}
	}
	if len(s.pending) >= maxPending || binding == "" {
		return "", c, ErrInvalid
	}
	ticket = random()
	s.pending[hash(ticket)] = pending{Authorization: a, Binding: hash(binding), Expires: s.now().Add(10 * time.Minute)}
	return ticket, s.data.Clients[a.ClientID].MCPOAuthClient, nil
}

func (s *Service) Consent(ticket, binding string, approve bool) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.pending[hash(ticket)]
	if !s.data.Config.Enabled || !ok || !equal(p.Binding, hash(binding)) || !s.now().Before(p.Expires) {
		return "", ErrInvalid
	}
	delete(s.pending, hash(ticket))
	u, _ := url.Parse(p.RedirectURI)
	q := u.Query()
	q.Set("state", p.State)
	q.Set("iss", s.data.Config.PublicURL)
	if approve {
		for key, code := range s.codes {
			if !s.now().Before(code.Expires) {
				delete(s.codes, key)
			}
		}
		if len(s.codes) >= maxPending {
			return "", ErrInvalid
		}
		code := random()
		p.Expires = s.now().Add(2 * time.Minute)
		s.codes[hash(code)] = p
		q.Set("code", code)
	} else {
		q.Set("error", "access_denied")
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func (s *Service) authenticate(req apicontract.MCPOAuthTokenRequest) error {
	if !s.data.Config.Enabled {
		return ErrDisabled
	}
	c, ok := s.data.Clients[req.ClientID]
	if !ok || req.ClientSecret == "" || !equal(c.SecretHash, hash(req.ClientSecret)) {
		return ErrClient
	}
	return nil
}

func validVerifier(v string) bool {
	if len(v) < 43 || len(v) > 128 {
		return false
	}
	for _, c := range v {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("-._~", c)) {
			return false
		}
	}
	return true
}

func (s *Service) Token(req apicontract.MCPOAuthTokenRequest) (ret apicontract.MCPOAuthTokenResponse, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err = s.authenticate(req); err != nil {
		return
	}
	if req.Resource != s.data.Config.PublicURL+"/mcp" {
		return ret, ErrGrant
	}
	next := s.clone()
	now := s.now().Unix()
	for id, g := range next.Grants {
		if g.Expires <= now {
			delete(next.Grants, id)
		}
	}
	id := ""
	var g grant
	switch req.GrantType {
	case "authorization_code":
		p, ok := s.codes[hash(req.Code)]
		if !ok || p.ClientID != req.ClientID || p.RedirectURI != req.RedirectURI || p.Resource != req.Resource || !s.now().Before(p.Expires) || !validVerifier(req.CodeVerifier) || !equal(p.Challenge, hash(req.CodeVerifier)) {
			return ret, ErrGrant
		}
		delete(s.codes, hash(req.Code))
		if len(next.Grants) >= maxGrants {
			return ret, ErrGrant
		}
		id = random()
		g = grant{ClientID: req.ClientID, Scope: p.Scope, Expires: s.now().Add(30 * 24 * time.Hour).Unix(), Spent: []string{}}
	case "refresh_token":
		if req.RefreshToken == "" {
			return ret, ErrGrant
		}
		digest := hash(req.RefreshToken)
		for key, candidate := range next.Grants {
			if candidate.ClientID != req.ClientID {
				continue
			}
			for _, spent := range candidate.Spent {
				if equal(spent, digest) {
					delete(next.Grants, key)
					if err = s.save(next); err != nil {
						return ret, err
					}
					return ret, ErrGrant
				}
			}
			if candidate.RefreshHash != "" && equal(candidate.RefreshHash, digest) {
				id, g = key, candidate
			}
		}
		if id == "" || len(g.Spent) >= 4096 {
			return ret, ErrGrant
		}
		if req.Scope != "" {
			narrowed, scopeErr := normalizeScope(req.Scope)
			if scopeErr != nil || narrowed != g.Scope && narrowed != scope {
				return ret, ErrGrant
			}
			g.Scope = narrowed
		}
		g.Spent = append(g.Spent, g.RefreshHash)
	default:
		return ret, errors.New("unsupported_grant_type")
	}
	ret = apicontract.MCPOAuthTokenResponse{AccessToken: AccessPrefix + random(), TokenType: "Bearer", ExpiresIn: 3600, Scope: g.Scope}
	if remaining := g.Expires - now; remaining < int64(ret.ExpiresIn) {
		ret.ExpiresIn = int(remaining)
	}
	g.AccessHash, g.AccessExpires = hash(ret.AccessToken), now+int64(ret.ExpiresIn)
	if strings.Contains(g.Scope, "offline_access") {
		ret.RefreshToken = "sy-mcp-r." + random()
		g.RefreshHash = hash(ret.RefreshToken)
	} else {
		g.Expires = g.AccessExpires
		g.RefreshHash = ""
	}
	next.Grants[id] = g
	if err = s.save(next); err != nil {
		return apicontract.MCPOAuthTokenResponse{}, err
	}
	return ret, nil
}

type AccessInfo struct {
	ID      string
	Expires time.Time
	Scope   string
}

func (s *Service) Access(token string) (AccessInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.data.Config.Enabled {
		return AccessInfo{}, ErrDisabled
	}
	digest := hash(token)
	for id, g := range s.data.Grants {
		if equal(g.AccessHash, digest) && g.AccessExpires > s.now().Unix() && g.Expires > s.now().Unix() {
			return AccessInfo{ID: id, Expires: time.Unix(g.AccessExpires, 0), Scope: g.Scope}, nil
		}
	}
	return AccessInfo{}, ErrGrant
}

func (s *Service) Revoke(req apicontract.MCPOAuthTokenRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.authenticate(req); err != nil {
		return err
	}
	if req.Token == "" {
		return ErrInvalid
	}
	next := s.clone()
	digest, changed := hash(req.Token), false
	for id, g := range next.Grants {
		if g.ClientID != req.ClientID {
			continue
		}
		match := equal(g.AccessHash, digest) || equal(g.RefreshHash, digest)
		for _, spent := range g.Spent {
			match = match || equal(spent, digest)
		}
		if match {
			delete(next.Grants, id)
			changed = true
		}
	}
	if changed {
		return s.save(next)
	}
	return nil
}
