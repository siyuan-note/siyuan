package chatgpt

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-jose/go-jose/v4"
	josejwt "github.com/go-jose/go-jose/v4/jwt"
)

type Login struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

type LoginStatus struct {
	State     string `json:"state"`
	AccountID string `json:"accountID"`
	Error     string `json:"error"`
}

// CallbackPages 由调用方提供本地化的通用授权结果页面。
type CallbackPages struct {
	Success, Failure []byte
}

type attempt struct {
	state, nonce, verifier, redirect string
	account                          *Account
	status                           LoginStatus
	consumed                         bool
	server                           *http.Server
	cancel                           context.CancelFunc
}

type tokenResponse struct {
	AccessToken  string  `json:"access_token"`
	RefreshToken string  `json:"refresh_token"`
	IDToken      string  `json:"id_token"`
	TokenType    string  `json:"token_type"`
	Scope        *string `json:"scope"`
	ExpiresIn    int64   `json:"expires_in"`
}

type identity struct {
	josejwt.Claims
	Email string `json:"email"`
	Name  string `json:"name"`
	Nonce string `json:"nonce"`
}

type discovery struct {
	Issuer     string `json:"issuer"`
	JWKS       string `json:"jwks_uri"`
	Revocation string `json:"revocation_endpoint"`
}

type RequestError struct {
	Status                   int
	Code, Message, RequestID string
}

func (e *RequestError) Error() string {
	return fmt.Sprintf("ChatGPT HTTP %d: %s (%s) [%s]", e.Status, e.Message, e.Code, e.RequestID)
}

func newHTTPClient() *http.Client {
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func (s *Service) readJSON(ctx context.Context, method, endpoint, body string, result any) error {
	requestCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, method, endpoint, strings.NewReader(body))
	if err != nil {
		return err
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	response, err := s.http.Do(req)
	if err != nil {
		if requestCtx.Err() != nil {
			return requestCtx.Err()
		}
		return errors.New("ChatGPT connection failed")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024+1))
	if err != nil || len(data) > 1024*1024 {
		return errors.New("invalid ChatGPT response")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return responseError(response, data)
	}
	if result == nil {
		return nil
	}
	return json.Unmarshal(data, result)
}

func responseError(response *http.Response, data []byte) error {
	var body struct {
		Error       json.RawMessage `json:"error"`
		Description string          `json:"error_description"`
		Detail      string          `json:"detail"`
	}
	_ = json.Unmarshal(data, &body)
	var code string
	var structured struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if json.Unmarshal(body.Error, &code) != nil {
		_ = json.Unmarshal(body.Error, &structured)
		code = structured.Code
	}
	message := structured.Message
	if message == "" {
		message = body.Description
	}
	if message == "" {
		message = body.Detail
	}
	return &RequestError{Status: response.StatusCode, Code: code, Message: message, RequestID: response.Header.Get("X-Request-ID")}
}

func (s *Service) metadata(ctx context.Context) (d discovery, err error) {
	err = s.readJSON(ctx, "GET", s.issuer+"/.well-known/openid-configuration", "", &d)
	if err == nil && (d.Issuer != s.issuer || !s.identityEndpoint(d.JWKS)) {
		err = errors.New("invalid ChatGPT issuer metadata")
	}
	return
}

func (s *Service) identityEndpoint(endpoint string) bool {
	u, err := url.Parse(endpoint)
	issuer, _ := url.Parse(s.issuer)
	return err == nil && u.Scheme == issuer.Scheme && u.Host == issuer.Host && u.User == nil && u.Fragment == ""
}

func (s *Service) verifyIdentity(ctx context.Context, token, clientID, nonce string, retained bool) (claims identity, err error) {
	d, err := s.metadata(ctx)
	if err != nil {
		return
	}
	var keys jose.JSONWebKeySet
	if err = s.readJSON(ctx, "GET", d.JWKS, "", &keys); err != nil {
		return
	}
	signed, err := josejwt.ParseSigned(token, []jose.SignatureAlgorithm{jose.RS256})
	if err != nil {
		return
	}
	if err = signed.Claims(&keys, &claims); err != nil {
		return
	}
	if claims.Issuer != s.issuer || !claims.Audience.Contains(clientID) || claims.Subject == "" || claims.Expiry == nil || claims.IssuedAt == nil {
		return claims, errors.New("invalid ChatGPT account identity")
	}
	if !retained {
		if err = claims.ValidateWithLeeway(josejwt.Expected{Issuer: s.issuer, Time: time.Now()}, time.Minute); err != nil {
			return
		}
	}
	if nonce != "" && subtle.ConstantTimeCompare([]byte(claims.Nonce), []byte(nonce)) != 1 {
		return claims, errors.New("ChatGPT authorization nonce mismatch")
	}
	return
}

func (s *Service) Start(ctx context.Context, accountID string, pages ...CallbackPages) (login Login, err error) {
	var hostID string
	var selected *Account
	err = s.withStore(ctx, func(store *diskStore) error {
		hostID = store.HostID
		if accountID != "" {
			a, err := findAccount(store, accountID)
			if err != nil {
				return err
			}
			copy := *a
			selected = &copy
		}
		return nil
	})
	if err != nil {
		return
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return login, errors.New("unable to start ChatGPT loopback callback")
	}
	authCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	a := &attempt{state: randomText(32), nonce: randomText(32), verifier: randomText(32), account: selected,
		redirect: "http://" + listener.Addr().String() + "/auth/callback", status: LoginStatus{State: "pending"}, cancel: cancel}
	login.ID = randomText(32)
	challenge := sha256.Sum256([]byte(a.verifier))
	q := url.Values{"client_id": {"dynamic_agent_client"}, "agent_name_hint": {"SiYuan"}, "ext_agent_host_id": {hostID},
		"response_type": {"code"}, "redirect_uri": {a.redirect}, "scope": {"openid profile email offline_access resource.invoke " + permission},
		"resource": {s.resource}, "state": {a.state}, "nonce": {a.nonce}, "code_challenge_method": {"S256"},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])}}
	if selected != nil {
		q.Set("client_id", selected.ClientID)
		q.Del("agent_name_hint")
		if selected.IDToken != "" {
			q.Set("id_token_hint", selected.IDToken)
		}
		if selected.Email != "" {
			q.Set("login_hint", selected.Email)
		}
		if !profile(selected).Sharing {
			q.Set("prompt", "consent")
		}
	}
	login.URL = s.issuer + "/api/accounts/authorize?" + q.Encode()
	a.server = &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		writePage := func(status int, success bool) {
			content := []byte("SiYuan")
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			if len(pages) > 0 {
				content = pages[0].Failure
				if success {
					content = pages[0].Success
				}
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
			}
			w.WriteHeader(status)
			_, _ = w.Write(content)
		}
		if r.Method != "GET" || r.URL.Path != "/auth/callback" {
			w.WriteHeader(404)
			return
		}
		values := r.URL.Query()
		for _, key := range []string{"state", "code", "client_id", "error"} {
			if len(values[key]) > 1 {
				writePage(http.StatusBadRequest, false)
				return
			}
		}
		if subtle.ConstantTimeCompare([]byte(values.Get("state")), []byte(a.state)) != 1 {
			writePage(http.StatusBadRequest, false)
			return
		}
		s.mu.Lock()
		if a.consumed || a.status.State != "pending" {
			s.mu.Unlock()
			writePage(http.StatusConflict, false)
			return
		}
		a.consumed = true
		s.mu.Unlock()
		result, completeErr := s.complete(authCtx, a, values)
		s.mu.Lock()
		if completeErr != nil {
			a.status = LoginStatus{State: "failed", Error: completeErr.Error()}
		} else {
			a.status = LoginStatus{State: "completed", AccountID: result.ClientID}
		}
		s.mu.Unlock()
		writePage(http.StatusOK, completeErr == nil)
		cancel()
	})}
	s.mu.Lock()
	pending := 0
	for _, old := range s.attempts {
		if old.status.State == "pending" {
			pending++
		}
	}
	if pending >= 8 {
		s.mu.Unlock()
		listener.Close()
		cancel()
		return login, errors.New("too many pending ChatGPT sign-ins")
	}
	s.attempts[login.ID] = a
	s.mu.Unlock()
	go a.server.Serve(listener)
	go func() {
		<-authCtx.Done()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), time.Second)
		defer shutdownCancel()
		_ = a.server.Shutdown(shutdownCtx)
		s.mu.Lock()
		if a.status.State == "pending" {
			a.status = LoginStatus{State: "failed", Error: "ChatGPT sign-in expired or was cancelled"}
		}
		s.mu.Unlock()
		time.AfterFunc(10*time.Minute, func() { s.mu.Lock(); delete(s.attempts, login.ID); s.mu.Unlock() })
	}()
	return
}

func (s *Service) Status(id string) (LoginStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if a := s.attempts[id]; a != nil {
		return a.status, nil
	}
	return LoginStatus{}, errors.New("ChatGPT sign-in attempt not found")
}

func (s *Service) Cancel(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if a := s.attempts[id]; a != nil {
		a.cancel()
	}
}

func (s *Service) complete(ctx context.Context, a *attempt, values url.Values) (*Account, error) {
	if values.Get("error") != "" {
		return nil, errors.New("ChatGPT authorization was declined")
	}
	clientID := values.Get("client_id")
	if a.account != nil {
		if clientID != "" && clientID != a.account.ClientID {
			return nil, errors.New("ChatGPT registration mismatch")
		}
		clientID = a.account.ClientID
	}
	if clientID == "" || clientID == "dynamic_agent_client" || values.Get("code") == "" {
		return nil, errors.New("invalid ChatGPT registration callback")
	}
	// 签发的注册 ID 在换码失败后仍可复用，未校验的账户不会成为已连接账户。
	if err := s.withStore(ctx, func(store *diskStore) error {
		if _, err := findAccount(store, clientID); err != nil {
			store.Accounts = append(store.Accounts, &Account{ClientID: clientID})
		}
		return nil
	}); err != nil {
		return nil, err
	}
	form := url.Values{"grant_type": {"authorization_code"}, "client_id": {clientID}, "code": {values.Get("code")},
		"code_verifier": {a.verifier}, "redirect_uri": {a.redirect}, "resource": {s.resource}}
	var tokens tokenResponse
	if err := s.readJSON(ctx, "POST", s.issuer+"/api/accounts/oauth/token", form.Encode(), &tokens); err != nil {
		return nil, err
	}
	claims, err := s.verifyIdentity(ctx, tokens.IDToken, clientID, a.nonce, false)
	if err != nil {
		return nil, errors.New("ChatGPT ID token validation failed")
	}
	if a.account != nil && a.account.Subject != "" && a.account.Subject != claims.Subject {
		return nil, errors.New("ChatGPT account identity mismatch")
	}
	result := &Account{ClientID: clientID, Subject: claims.Subject, Email: claims.Email, Name: claims.Name}
	if err = applyTokens(result, tokens); err != nil {
		return nil, err
	}
	err = s.withStore(ctx, func(store *diskStore) error {
		old, err := findAccount(store, clientID)
		if err != nil {
			return err
		}
		if old.Subject != "" && old.Subject != result.Subject {
			return errors.New("ChatGPT account identity mismatch")
		}
		*old = *result
		return nil
	})
	if err == nil {
		s.resumeRequests(clientID)
	}
	return result, err
}

func applyTokens(a *Account, tokens tokenResponse) error {
	if tokens.AccessToken == "" || !strings.EqualFold(tokens.TokenType, "Bearer") || tokens.ExpiresIn <= 0 || tokens.ExpiresIn > 86400 {
		return errors.New("invalid ChatGPT token response")
	}
	a.AccessToken = tokens.AccessToken
	if tokens.RefreshToken != "" {
		a.RefreshToken = tokens.RefreshToken
	}
	if tokens.IDToken != "" {
		a.IDToken = tokens.IDToken
	}
	if tokens.Scope != nil {
		a.Scopes = strings.Fields(*tokens.Scope)
	}
	a.ExpiresAt = time.Now().Add(time.Duration(tokens.ExpiresIn) * time.Second).Unix()
	return nil
}

func (s *Service) refresh(ctx context.Context, a *Account) error {
	if a.RefreshToken == "" {
		return errors.New("sign in to ChatGPT again")
	}
	var tokens tokenResponse
	form := url.Values{"grant_type": {"refresh_token"}, "client_id": {a.ClientID}, "refresh_token": {a.RefreshToken}, "resource": {s.resource}}
	if err := s.readJSON(ctx, "POST", s.issuer+"/api/accounts/oauth/token", form.Encode(), &tokens); err != nil {
		var requestErr *RequestError
		if errors.As(err, &requestErr) {
			switch requestErr.Code {
			case "invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused":
				clearTokens(a)
			}
		}
		return err
	}
	if tokens.IDToken != "" {
		claims, err := s.verifyIdentity(ctx, tokens.IDToken, a.ClientID, "", false)
		if err != nil || claims.Subject != a.Subject {
			return errors.New("ChatGPT account identity mismatch")
		}
	}
	return applyTokens(a, tokens)
}

func (s *Service) Token(ctx context.Context, id string, force bool) (token string, err error) {
	var requestErr error
	err = s.withStore(ctx, func(store *diskStore) error {
		a, err := findAccount(store, id)
		if err != nil {
			return err
		}
		if a.AccessToken == "" {
			return errors.New("sign in to ChatGPT again")
		}
		if !profile(a).Sharing {
			requestErr = errors.New("ChatGPT plan usage was not authorized")
			return nil
		}
		if force || a.ExpiresAt <= time.Now().Add(time.Minute).Unix() {
			requestErr = s.refresh(ctx, a)
		}
		if requestErr != nil {
			return nil
		}
		if !profile(a).Sharing {
			requestErr = errors.New("ChatGPT plan usage was not authorized")
			return nil
		}
		token = a.AccessToken
		return nil
	})
	if err == nil {
		err = requestErr
	}
	return
}

func (s *Service) Logout(ctx context.Context, id string) (revoked bool, err error) {
	s.stopRequests(id)
	err = s.withStore(ctx, func(store *diskStore) error {
		a, err := findAccount(store, id)
		if err != nil {
			return err
		}
		if a.RefreshToken == "" {
			revoked = true
		} else {
			d, metadataErr := s.metadata(ctx)
			if metadataErr == nil && s.identityEndpoint(d.Revocation) {
				form := url.Values{"token": {a.RefreshToken}, "token_type_hint": {"refresh_token"}, "client_id": {a.ClientID}}
				for i := 0; i < 2; i++ {
					if s.readJSON(ctx, "POST", d.Revocation, form.Encode(), nil) == nil {
						revoked = true
						break
					}
					if ctx.Err() != nil {
						break
					}
					if i == 0 {
						timer := time.NewTimer(250 * time.Millisecond)
						select {
						case <-timer.C:
						case <-ctx.Done():
							timer.Stop()
						}
					}
				}
			}
		}
		clearTokens(a)
		return nil
	})
	return
}
