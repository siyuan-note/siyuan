package mcpoauth

import (
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

func setup(t *testing.T) (*Service, apicontract.MCPOAuthClientSecret) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "oauth.json"), "epoch")
	if err != nil {
		t.Fatal(err)
	}
	if s.Status().Enabled {
		t.Fatal("enabled by default")
	}
	if err = s.Configure(apicontract.MCPOAuthConfig{Enabled: true, PublicURL: "https://note.example.com"}); err != nil {
		t.Fatal(err)
	}
	c, err := s.AddClient(apicontract.MCPOAuthClientRequest{Name: "ChatGPT", RedirectURI: "https://chatgpt.com/connector_platform_oauth_redirect"})
	if err != nil {
		t.Fatal(err)
	}
	return s, c
}

func authorization(c apicontract.MCPOAuthClientSecret, verifier string) url.Values {
	return url.Values{"client_id": {c.ID}, "redirect_uri": {c.RedirectURI}, "response_type": {"code"}, "state": {"client-state"}, "code_challenge": {hash(verifier)}, "code_challenge_method": {"S256"}, "resource": {"https://note.example.com/mcp"}, "scope": {"mcp offline_access"}}
}

func codeRequest(t *testing.T, s *Service, c apicontract.MCPOAuthClientSecret) apicontract.MCPOAuthTokenRequest {
	t.Helper()
	verifier := random()
	ticket, _, err := s.Begin(authorization(c, verifier), "browser")
	if err != nil {
		t.Fatal(err)
	}
	location, err := s.Consent(ticket, "browser", true)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(location)
	if u.Query().Get("state") != "client-state" || u.Query().Get("iss") != "https://note.example.com" {
		t.Fatal(location)
	}
	return apicontract.MCPOAuthTokenRequest{GrantType: "authorization_code", ClientID: c.ID, ClientSecret: c.Secret, Code: u.Query().Get("code"), RedirectURI: c.RedirectURI, CodeVerifier: verifier, Resource: "https://note.example.com/mcp"}
}

func issue(t *testing.T, s *Service, c apicontract.MCPOAuthClientSecret) apicontract.MCPOAuthTokenResponse {
	t.Helper()
	ret, err := s.Token(codeRequest(t, s, c))
	if err != nil {
		t.Fatal(err)
	}
	return ret
}

func TestMCPOAuthLifecycle(t *testing.T) {
	s, c := setup(t)
	req := codeRequest(t, s, c)
	token, err := s.Token(req)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Token(req); !errors.Is(err, ErrGrant) {
		t.Fatal("code replay accepted", err)
	}
	identity, err := s.Access(token.AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := Open(s.path, "epoch")
	if err != nil {
		t.Fatal(err)
	}
	if id, err := restarted.Access(token.AccessToken); err != nil || id != identity {
		t.Fatal("restart lost token", err)
	}
	refresh := apicontract.MCPOAuthTokenRequest{GrantType: "refresh_token", ClientID: c.ID, ClientSecret: c.Secret, RefreshToken: token.RefreshToken, Resource: req.Resource}
	rotated, err := restarted.Token(refresh)
	if err != nil || rotated.RefreshToken == token.RefreshToken {
		t.Fatal("refresh not rotated", err)
	}
	if _, err = restarted.Access(token.AccessToken); err == nil {
		t.Fatal("old access token survived rotation")
	}
	if id, err := restarted.Access(rotated.AccessToken); err != nil || id.ID != identity.ID {
		t.Fatal("refresh changed grant identity", err)
	}
	if _, err = restarted.Token(refresh); !errors.Is(err, ErrGrant) {
		t.Fatal("refresh replay accepted", err)
	}
	if _, err = restarted.Access(rotated.AccessToken); err == nil {
		t.Fatal("replay did not revoke grant")
	}
	bytes, _ := os.ReadFile(s.path)
	for _, secret := range []string{c.Secret, token.AccessToken, token.RefreshToken, rotated.AccessToken, rotated.RefreshToken, req.Code} {
		if strings.Contains(string(bytes), secret) {
			t.Fatal("plaintext credential on disk")
		}
	}
}

func TestMCPOAuthAuthorizationValidation(t *testing.T) {
	s, c := setup(t)
	for _, mutation := range []func(url.Values){
		func(v url.Values) { v.Set("redirect_uri", c.RedirectURI+"/other") },
		func(v url.Values) { v.Set("code_challenge_method", "plain") },
		func(v url.Values) { v.Set("code_challenge", "short") },
		func(v url.Values) { v.Set("resource", "https://other.example/mcp") },
		func(v url.Values) { v.Set("scope", "admin") },
		func(v url.Values) { v.Add("client_id", c.ID) },
		func(v url.Values) { v.Set("response_type", "token") },
	} {
		v := authorization(c, random())
		mutation(v)
		if err := s.ValidateAuthorization(v); err == nil {
			t.Fatal("invalid authorization accepted", v)
		}
	}
	ticket, _, err := s.Begin(authorization(c, random()), "browser")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Consent(ticket, "attacker", true); err == nil {
		t.Fatal("cross-browser consent accepted")
	}
	location, err := s.Consent(ticket, "browser", false)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(location)
	if u.Query().Get("error") != "access_denied" || u.Query().Get("iss") == "" || u.Query().Get("code") != "" {
		t.Fatal(location)
	}
	if _, err = s.Consent(ticket, "browser", true); err == nil {
		t.Fatal("consent replay accepted")
	}
}

func TestMCPOAuthTokenBinding(t *testing.T) {
	s, c := setup(t)
	for _, mutation := range []func(*apicontract.MCPOAuthTokenRequest){
		func(r *apicontract.MCPOAuthTokenRequest) { r.CodeVerifier = random() },
		func(r *apicontract.MCPOAuthTokenRequest) { r.Resource += "/other" },
		func(r *apicontract.MCPOAuthTokenRequest) { r.RedirectURI += "/other" },
		func(r *apicontract.MCPOAuthTokenRequest) { r.ClientSecret = "wrong" },
		func(r *apicontract.MCPOAuthTokenRequest) { r.ClientID = "wrong" },
	} {
		r := codeRequest(t, s, c)
		mutation(&r)
		if _, err := s.Token(r); err == nil {
			t.Fatal("invalid token binding accepted")
		}
	}
	r := codeRequest(t, s, c)
	var wg sync.WaitGroup
	var mu sync.Mutex
	success := 0
	for range 8 {
		wg.Go(func() {
			if _, err := s.Token(r); err == nil {
				mu.Lock()
				success++
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	if success != 1 {
		t.Fatal("code exchanged more than once", success)
	}
}

func TestMCPOAuthRevocationAndConfiguration(t *testing.T) {
	for _, action := range []string{"revoke", "remove", "all", "disable", "origin", "epoch"} {
		t.Run(action, func(t *testing.T) {
			s, c := setup(t)
			token := issue(t, s, c)
			var err error
			switch action {
			case "revoke":
				err = s.Revoke(apicontract.MCPOAuthTokenRequest{ClientID: c.ID, ClientSecret: c.Secret, Token: token.RefreshToken})
			case "remove":
				err = s.Remove(c.ID, false)
			case "all":
				err = s.Remove("", true)
			case "disable":
				err = s.Configure(apicontract.MCPOAuthConfig{})
			case "origin":
				err = s.Configure(apicontract.MCPOAuthConfig{Enabled: true, PublicURL: "https://other.example"})
			case "epoch":
				err = s.EnsureEpoch("changed")
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.Access(token.AccessToken); err == nil {
				t.Fatal("revoked token accepted")
			}
			s, err = Open(s.path, s.data.Epoch)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.Access(token.AccessToken); err == nil {
				t.Fatal("revoked token restored after restart")
			}
		})
	}
}

func TestMCPOAuthExpiry(t *testing.T) {
	s, c := setup(t)
	now := time.Now()
	s.now = func() time.Time { return now }
	r := codeRequest(t, s, c)
	now = now.Add(3 * time.Minute)
	if _, err := s.Token(r); err == nil {
		t.Fatal("expired code accepted")
	}
	token := issue(t, s, c)
	now = now.Add(2 * time.Hour)
	if _, err := s.Access(token.AccessToken); err == nil {
		t.Fatal("expired access accepted")
	}
	refresh := apicontract.MCPOAuthTokenRequest{GrantType: "refresh_token", ClientID: c.ID, ClientSecret: c.Secret, RefreshToken: token.RefreshToken, Resource: "https://note.example.com/mcp"}
	if _, err := s.Token(refresh); err != nil {
		t.Fatal("refresh after access expiry failed", err)
	}
	now = now.Add(31 * 24 * time.Hour)
	if _, err := s.Token(refresh); err == nil {
		t.Fatal("expired refresh accepted")
	}
}

func TestMCPOAuthPersistenceFailureAndCorruption(t *testing.T) {
	s, c := setup(t)
	token := issue(t, s, c)
	before, _ := os.ReadFile(s.path)
	s.write = func(string, []byte) error { return errors.New("disk failure") }
	refresh := apicontract.MCPOAuthTokenRequest{GrantType: "refresh_token", ClientID: c.ID, ClientSecret: c.Secret, RefreshToken: token.RefreshToken, Resource: "https://note.example.com/mcp"}
	if ret, err := s.Token(refresh); err == nil || ret.AccessToken != "" {
		t.Fatal("unpersisted token issued")
	}
	if _, err := s.Access(token.AccessToken); err != nil {
		t.Fatal("failed save changed memory")
	}
	if err := s.Configure(apicontract.MCPOAuthConfig{}); err == nil {
		t.Fatal("failed config save accepted")
	}
	if !s.Status().Enabled {
		t.Fatal("failed save changed config")
	}
	after, _ := os.ReadFile(s.path)
	if string(before) != string(after) {
		t.Fatal("failed write changed disk")
	}
	for _, content := range []string{`broken`, `{"version":999}`, `{}`} {
		if err := os.WriteFile(s.path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Open(s.path, "epoch"); err == nil {
			t.Fatal("corruption accepted")
		}
		after, _ = os.ReadFile(s.path)
		if string(after) != content {
			t.Fatal("corrupt file overwritten")
		}
	}
}

func TestMCPOAuthURLValidation(t *testing.T) {
	s, _ := setup(t)
	for _, origin := range []string{"http://example.com", "https://example.com/path", "https://user@example.com", "https://example.com?evil=1", "https://example.com#fragment", "https://example.com#", "https://"} {
		if err := s.Configure(apicontract.MCPOAuthConfig{Enabled: true, PublicURL: origin}); err == nil {
			t.Fatal("unsafe origin", origin)
		}
	}
	if err := s.Configure(apicontract.MCPOAuthConfig{Enabled: true, PublicURL: "https://NOTE.example.com:443/"}); err != nil || s.Status().PublicURL != "https://note.example.com" {
		t.Fatal("origin normalization", err)
	}
	for _, callback := range []string{"javascript:evil", "http://remote.example/callback", "https://example.com/#fragment", "https://user@example.com/callback"} {
		if _, err := s.AddClient(apicontract.MCPOAuthClientRequest{Name: "client", RedirectURI: callback}); err == nil {
			t.Fatal("unsafe callback", callback)
		}
	}
}
