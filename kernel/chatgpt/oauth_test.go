package chatgpt

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	josejwt "github.com/go-jose/go-jose/v4/jwt"
)

type fixture struct {
	service                                 *Service
	server                                  *httptest.Server
	nonce, challenge, subject, refreshError string
	refreshes                               atomic.Int32
	revokeFailed                            bool
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{subject: "user-1"}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithHeader("kid", "test-key"))
	if err != nil {
		t.Fatal(err)
	}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			json.NewEncoder(w).Encode(discovery{Issuer: f.server.URL, JWKS: f.server.URL + "/jwks", Revocation: f.server.URL + "/revoke"})
		case "/jwks":
			json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "test-key", Algorithm: "RS256", Use: "sig"}}})
		case "/api/accounts/oauth/token":
			r.ParseForm()
			if r.Form.Get("client_id") != "oaiapp_test" || r.Form.Get("resource") != f.server.URL+"/v1" {
				t.Error("wrong token registration or resource")
			}
			if r.Form.Get("grant_type") == "authorization_code" {
				hash := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
				if base64.RawURLEncoding.EncodeToString(hash[:]) != f.challenge {
					t.Error("PKCE verifier mismatch")
				}
			} else {
				f.refreshes.Add(1)
				if f.refreshError != "" {
					w.WriteHeader(400)
					json.NewEncoder(w).Encode(map[string]string{"error": f.refreshError})
					return
				}
			}
			claims := identity{Claims: josejwt.Claims{Issuer: f.server.URL, Subject: f.subject, Audience: josejwt.Audience{"oaiapp_test"},
				Expiry: josejwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: josejwt.NewNumericDate(time.Now())}, Email: "user@example.com", Nonce: f.nonce}
			token, err := josejwt.Signed(signer).Claims(claims).Serialize()
			if err != nil {
				t.Error(err)
			}
			scope := "openid offline_access resource.invoke " + permission
			json.NewEncoder(w).Encode(tokenResponse{AccessToken: "access-secret", RefreshToken: "refresh-secret", IDToken: token, TokenType: "Bearer", Scope: &scope, ExpiresIn: 3600})
		case "/v1/models":
			if r.Header.Get("Authorization") != "Bearer access-secret" {
				t.Error("missing bearer credential")
			}
			io.WriteString(w, `{"models":[{"slug":"model-a","display_name":"Model A","visibility":"list"},{"slug":"hidden","visibility":"hide"},{"slug":"model-b","display_name":"Model B","visibility":"list"}]}`)
		case "/revoke":
			if f.revokeFailed {
				w.WriteHeader(http.StatusServiceUnavailable)
				io.WriteString(w, `{"error":"server_error"}`)
				return
			}
			w.WriteHeader(200)
		default:
			w.WriteHeader(404)
		}
	}))
	f.service = Open(t.TempDir())
	f.service.issuer = f.server.URL
	f.service.resource = f.server.URL + "/v1"
	t.Cleanup(f.server.Close)
	return f
}

func (f *fixture) login(t *testing.T, accountID string, pages ...CallbackPages) Login {
	t.Helper()
	login, err := f.service.Start(context.Background(), accountID, pages...)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(login.URL)
	f.nonce, f.challenge = u.Query().Get("nonce"), u.Query().Get("code_challenge")
	if u.Query().Get("ext_agent_host_id") == "" || u.Query().Get("code_challenge_method") != "S256" {
		t.Fatal("missing host or PKCE")
	}
	t.Cleanup(func() { f.service.Cancel(login.ID) })
	return login
}

func (f *fixture) callback(t *testing.T, login Login, state string) int {
	t.Helper()
	u, _ := url.Parse(login.URL)
	q := url.Values{"code": {"code"}, "state": {state}, "client_id": {"oaiapp_test"}}
	response, err := http.Get(u.Query().Get("redirect_uri") + "?" + q.Encode())
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	return response.StatusCode
}

func TestChatGPTCallbackPages(t *testing.T) {
	for _, scenario := range []string{"success", "denied", "invalid-state", "duplicate-state", "invalid-nonce"} {
		t.Run(scenario, func(t *testing.T) {
			f := newFixture(t)
			pages := CallbackPages{Success: []byte("<!doctype html><h1>completed</h1>"), Failure: []byte("<!doctype html><h1>failed</h1>")}
			login := f.login(t, "", pages)
			u, _ := url.Parse(login.URL)
			query := url.Values{"code": {"code"}, "state": {u.Query().Get("state")}, "client_id": {"oaiapp_test"}}
			expectedStatus, expectedState := http.StatusOK, "failed"
			if scenario == "success" {
				expectedState = "completed"
			}
			switch scenario {
			case "denied":
				query.Set("error", "access_denied")
				query.Set("error_description", "<script>credential</script>")
			case "invalid-state":
				query.Set("state", "invalid")
				expectedStatus, expectedState = http.StatusBadRequest, "pending"
			case "duplicate-state":
				query.Add("state", "invalid")
				expectedStatus, expectedState = http.StatusBadRequest, "pending"
			case "invalid-nonce":
				f.nonce = "invalid"
			}
			response, err := http.Get(u.Query().Get("redirect_uri") + "?" + query.Encode())
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			expectedPage := pages.Failure
			if scenario == "success" {
				expectedPage = pages.Success
			}
			if response.StatusCode != expectedStatus || string(body) != string(expectedPage) {
				t.Fatalf("unexpected callback page: %d %s", response.StatusCode, body)
			}
			if response.Header.Get("Content-Type") != "text/html; charset=utf-8" || response.Header.Get("Cache-Control") != "no-store" ||
				response.Header.Get("Referrer-Policy") != "no-referrer" || response.Header.Get("X-Content-Type-Options") != "nosniff" ||
				!strings.Contains(response.Header.Get("Content-Security-Policy"), "default-src 'none'") {
				t.Fatalf("missing callback security headers: %v", response.Header)
			}
			if status, _ := f.service.Status(login.ID); status.State != expectedState {
				t.Fatalf("unexpected callback state: %+v", status)
			}
		})
	}
}

func TestChatGPTSignInIdentityAndEncryptedStore(t *testing.T) {
	f := newFixture(t)
	login := f.login(t, "")
	u, _ := url.Parse(login.URL)
	if u.Query().Get("client_id") != "dynamic_agent_client" || u.Query().Get("agent_name_hint") != "SiYuan" {
		t.Fatal("wrong dynamic registration")
	}
	if status := f.callback(t, login, "wrong-state"); status != 400 {
		t.Fatalf("wrong-state status = %d", status)
	}
	if status, _ := f.service.Status(login.ID); status.State != "pending" {
		t.Fatal("invalid callback consumed attempt")
	}
	f.callback(t, login, u.Query().Get("state"))
	status, _ := f.service.Status(login.ID)
	if status.State != "completed" || status.AccountID != "oaiapp_test" {
		t.Fatalf("status: %+v", status)
	}
	profiles, err := f.service.Profiles(context.Background())
	if err != nil || len(profiles) != 1 || !profiles[0].Sharing {
		t.Fatalf("profiles: %+v %v", profiles, err)
	}
	data, _ := os.ReadFile(filepath.Join(f.service.dir, "accounts"))
	if strings.Contains(string(data), "secret") || strings.Contains(string(data), "user@example.com") {
		t.Fatal("credentials written in plaintext")
	}
	models, err := f.service.Models(context.Background(), "oaiapp_test")
	if err != nil || len(models) != 2 || models[0].DisplayName != "Model A" {
		t.Fatalf("models: %+v %v", models, err)
	}
	returning := f.login(t, "oaiapp_test")
	u, _ = url.Parse(returning.URL)
	if u.Query().Get("client_id") != "oaiapp_test" || u.Query().Get("agent_name_hint") != "" || u.Query().Get("id_token_hint") == "" {
		t.Fatal("registration not reused")
	}
	f.subject = "different-user"
	f.callback(t, returning, u.Query().Get("state"))
	status, _ = f.service.Status(returning.ID)
	if status.State != "failed" {
		t.Fatal("account mismatch accepted")
	}
	profiles, _ = f.service.Profiles(context.Background())
	if !profiles[0].Connected {
		t.Fatal("failed reauthorization replaced credentials")
	}
}

func TestChatGPTRefreshAcrossServicesAndTerminalFailure(t *testing.T) {
	f := newFixture(t)
	login := f.login(t, "")
	u, _ := url.Parse(login.URL)
	f.callback(t, login, u.Query().Get("state"))
	err := f.service.withStore(context.Background(), func(store *diskStore) error { store.Accounts[0].ExpiresAt = 0; return nil })
	if err != nil {
		t.Fatal(err)
	}
	other := Open(f.service.dir)
	other.issuer, other.resource = f.service.issuer, f.service.resource
	var wg sync.WaitGroup
	for _, s := range []*Service{f.service, other} {
		wg.Go(func() {
			token, err := s.Token(context.Background(), "oaiapp_test", false)
			if err != nil || token == "" {
				t.Errorf("token: %s %v", token, err)
			}
		})
	}
	wg.Wait()
	if f.refreshes.Load() != 1 {
		t.Fatalf("refreshes: %d", f.refreshes.Load())
	}
	f.refreshError = "invalid_grant"
	if _, err = f.service.Token(context.Background(), "oaiapp_test", true); err == nil {
		t.Fatal("terminal refresh accepted")
	}
	profiles, _ := f.service.Profiles(context.Background())
	if profiles[0].Connected {
		t.Fatal("unusable token was retained")
	}
}

func TestChatGPTTransferPreservesHostAndAuthenticatesFile(t *testing.T) {
	f := newFixture(t)
	login := f.login(t, "")
	u, _ := url.Parse(login.URL)
	f.callback(t, login, u.Query().Get("state"))
	if _, err := f.service.Export(context.Background(), "oaiapp_test", "long-password-123", func(string) error { return os.ErrPermission }); err == nil {
		t.Fatal("failed export publication accepted")
	}
	profiles, _ := f.service.Profiles(context.Background())
	if !profiles[0].Connected {
		t.Fatal("failed export removed source session")
	}
	data, err := f.service.Export(context.Background(), "oaiapp_test", "long-password-123", nil)
	if err != nil {
		t.Fatal(err)
	}
	profiles, _ = f.service.Profiles(context.Background())
	if profiles[0].Connected || strings.Contains(data, "secret") {
		t.Fatal("export did not transfer protected session")
	}
	destination := Open(t.TempDir())
	destination.issuer, destination.resource = f.service.issuer, f.service.resource
	var host string
	destination.withStore(context.Background(), func(store *diskStore) error { host = store.HostID; return nil })
	if _, err = destination.Import(context.Background(), data, "wrong-password-123"); err == nil {
		t.Fatal("incorrect password accepted")
	}
	var damaged transfer
	json.Unmarshal([]byte(data), &damaged)
	damaged.Data[len(damaged.Data)-1] ^= 1
	encoded, _ := json.Marshal(damaged)
	if _, err = destination.Import(context.Background(), string(encoded), "long-password-123"); err == nil {
		t.Fatal("damaged transfer accepted")
	}
	result, err := destination.Import(context.Background(), data, "long-password-123")
	if err != nil || !result.Sharing {
		t.Fatalf("import: %+v %v", result, err)
	}
	destination.withStore(context.Background(), func(store *diskStore) error {
		if store.HostID != host {
			t.Error("import replaced host ID")
		}
		return nil
	})
	request, _ := http.NewRequest("GET", "https://untrusted.example/models", nil)
	if _, err = destination.Do(request, "oaiapp_test"); err == nil {
		t.Fatal("credentials sent to an untrusted endpoint")
	}
	revoked, err := destination.Logout(context.Background(), "oaiapp_test")
	if err != nil || !revoked {
		t.Fatalf("logout: %v %v", revoked, err)
	}
	profiles, _ = destination.Profiles(context.Background())
	if profiles[0].Connected {
		t.Fatal("logout retained credentials")
	}
}

func TestChatGPTCorruptionPreservesOriginal(t *testing.T) {
	s := Open(t.TempDir())
	if _, err := s.Profiles(context.Background()); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(s.dir, "accounts")
	data, _ := os.ReadFile(path)
	data[len(data)-1] ^= 1
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Profiles(context.Background()); err == nil {
		t.Fatal("corrupted credentials accepted")
	}
	if _, err := s.Remove(context.Background(), "missing"); err == nil {
		t.Fatal("removal accepted corrupted credentials")
	}
	current, _ := os.ReadFile(path)
	if string(current) != string(data) {
		t.Fatal("corrupted credentials overwritten")
	}
}

func TestChatGPTRemoveRegistration(t *testing.T) {
	for _, scenario := range []string{"connected", "signed-out", "revocation-failed"} {
		t.Run(scenario, func(t *testing.T) {
			f := newFixture(t)
			login := f.login(t, "")
			u, _ := url.Parse(login.URL)
			f.callback(t, login, u.Query().Get("state"))
			var hostID string
			if err := f.service.withStore(context.Background(), func(store *diskStore) error {
				hostID = store.HostID
				copy := *store.Accounts[0]
				copy.ClientID = "other-registration"
				store.Accounts = append(store.Accounts, &copy)
				if scenario == "signed-out" {
					clearTokens(store.Accounts[0])
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			returning := f.login(t, "oaiapp_test")
			f.service.mu.Lock()
			pending := f.service.attempts[returning.ID]
			f.service.mu.Unlock()
			f.revokeFailed = scenario == "revocation-failed"
			revoked, err := f.service.Remove(context.Background(), "oaiapp_test")
			if err != nil || revoked == f.revokeFailed {
				t.Fatalf("remove: %v %v", revoked, err)
			}
			profiles, err := f.service.Profiles(context.Background())
			if err != nil || len(profiles) != 1 || profiles[0].ID != "other-registration" || !profiles[0].Connected {
				t.Fatalf("other registration changed: %+v %v", profiles, err)
			}
			if status, _ := f.service.Status(returning.ID); status.State != "failed" {
				t.Fatalf("pending sign-in was not cancelled: %+v", status)
			}
			if _, err = f.service.complete(context.Background(), pending, url.Values{"code": {"late"}}); err == nil {
				t.Fatal("late sign-in recreated removed registration")
			}
			if _, err = f.service.Token(context.Background(), "oaiapp_test", false); err == nil {
				t.Fatal("removed credentials remained usable")
			}
			if err = f.service.withStore(context.Background(), func(store *diskStore) error {
				if store.HostID != hostID || len(store.Accounts) != 1 {
					t.Fatal("host or account mappings changed")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestChatGPTRejectedNoncePreservesRegistration(t *testing.T) {
	f := newFixture(t)
	login := f.login(t, "")
	u, _ := url.Parse(login.URL)
	f.nonce = "invalid-nonce"
	f.callback(t, login, u.Query().Get("state"))
	status, _ := f.service.Status(login.ID)
	if status.State != "failed" {
		t.Fatal("wrong nonce accepted")
	}
	profiles, _ := f.service.Profiles(context.Background())
	if len(profiles) != 1 || profiles[0].Connected || profiles[0].ID != "oaiapp_test" {
		t.Fatal("registration or credentials changed")
	}
}

type blockingHTTP struct {
	base    HTTPClient
	started chan struct{}
}

func (h *blockingHTTP) Do(r *http.Request) (*http.Response, error) {
	if strings.HasSuffix(r.URL.Path, "/responses") {
		close(h.started)
		<-r.Context().Done()
		return nil, r.Context().Err()
	}
	return h.base.Do(r)
}

func TestChatGPTLogoutCancelsActiveRequest(t *testing.T) {
	f := newFixture(t)
	login := f.login(t, "")
	u, _ := url.Parse(login.URL)
	f.callback(t, login, u.Query().Get("state"))
	client := &blockingHTTP{base: f.service.http, started: make(chan struct{})}
	f.service.http = client
	done := make(chan error, 1)
	go func() {
		r, _ := http.NewRequest("POST", f.service.resource+"/responses", strings.NewReader(`{}`))
		_, err := f.service.Do(r, "oaiapp_test")
		done <- err
	}()
	select {
	case <-client.started:
	case <-time.After(5 * time.Second):
		t.Fatal("request not started")
	}
	if _, err := f.service.Logout(context.Background(), "oaiapp_test"); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("request error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("logout left request running")
	}
}
