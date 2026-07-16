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

package client

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/oauthex"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/oauth2"
)

const oauthAuthorizationTimeout = 5 * time.Minute

var errOAuthAuthorizationRequired = errors.New("mcp oauth authorization required")

type oauthCallbackResult struct {
	Code  string
	State string
	Error string
}

type oauthFlow struct {
	State   string
	Result  chan oauthCallbackResult
	Expires time.Time
}

var oauthFlows = struct {
	sync.Mutex
	items map[string]*oauthFlow
}{items: map[string]*oauthFlow{}}

type mcpOAuthHandler struct {
	server conf.MCPServer
	client *http.Client

	interactive atomic.Bool

	sourceMu sync.Mutex
	source   *storedOAuthTokenSource
}

type storedOAuthTokenSource struct {
	sync.Mutex
	credential oauthCredential
	client     *http.Client
	invalid    bool
}

type oauthTokenError struct {
	Code        string `json:"error"`
	Description string `json:"error_description"`
}

func (e *oauthTokenError) Error() string {
	if e.Description == "" {
		return e.Code
	}
	return e.Code + ": " + e.Description
}

func newMCPOAuthHandler(server conf.MCPServer, interactive bool) *mcpOAuthHandler {
	handler := &mcpOAuthHandler{
		server: server,
		client: &http.Client{
			Transport: httpclient.NewUserAgentRoundTripper(http.DefaultTransport),
			Timeout:   30 * time.Second,
		},
	}
	handler.interactive.Store(interactive)
	return handler
}

func (h *mcpOAuthHandler) disableInteractive() {
	h.interactive.Store(false)
}

func (h *mcpOAuthHandler) TokenSource(ctx context.Context) (oauth2.TokenSource, error) {
	h.sourceMu.Lock()
	defer h.sourceMu.Unlock()
	if h.source != nil {
		return h.source, nil
	}
	credential, ok := getOAuthCredential(h.server.ID, h.server.URL)
	if !ok || credential.Rejected {
		return nil, nil
	}
	valid, err := h.validateCredentialIssuer(ctx, credential)
	if err != nil {
		return nil, err
	}
	if !valid {
		return nil, nil
	}
	h.source = &storedOAuthTokenSource{credential: credential, client: h.client}
	return h.source, nil
}

func (s *storedOAuthTokenSource) Token() (*oauth2.Token, error) {
	s.Lock()
	defer s.Unlock()
	if s.invalid {
		return nil, nil
	}
	credential := s.credential
	if credential.AccessToken != "" && (credential.Expiry.IsZero() || time.Now().Add(30*time.Second).Before(credential.Expiry)) {
		return credentialToken(credential), nil
	}
	if oauthClientRegistrationExpired(credential) {
		s.invalid = true
		credential.AccessToken = ""
		credential.RefreshToken = ""
		credential.Expiry = time.Time{}
		_ = putOAuthCredential(credential)
		return nil, nil
	}
	if credential.RefreshToken == "" {
		return nil, nil
	}

	refreshed, permanent, err := refreshOAuthCredential(context.Background(), s.client, credential)
	if err != nil {
		if permanent {
			s.invalid = true
			credential.AccessToken = ""
			credential.RefreshToken = ""
			credential.Expiry = time.Time{}
			_ = putOAuthCredential(credential)
			return nil, nil
		}
		return nil, err
	}
	s.credential = refreshed
	if err = putOAuthCredential(refreshed); err != nil {
		return nil, err
	}
	return credentialToken(refreshed), nil
}

func credentialToken(credential oauthCredential) *oauth2.Token {
	return &oauth2.Token{
		AccessToken:  credential.AccessToken,
		TokenType:    credential.TokenType,
		RefreshToken: credential.RefreshToken,
		Expiry:       credential.Expiry,
	}
}

func (h *mcpOAuthHandler) Authorize(ctx context.Context, req *http.Request, resp *http.Response) (retErr error) {
	defer resp.Body.Close()
	defer io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))

	challenges, err := oauthex.ParseWWWAuthenticate(resp.Header.Values("WWW-Authenticate"))
	if err != nil {
		return fmt.Errorf("parse OAuth challenge: %w", err)
	}
	if !hasBearerChallenge(challenges) {
		return fmt.Errorf("server returned %s without an OAuth Bearer challenge", resp.Status)
	}
	challengeError := bearerChallengeParam(challenges, "error")
	if resp.StatusCode == http.StatusForbidden && challengeError != "insufficient_scope" {
		return fmt.Errorf("server returned %s", resp.Status)
	}
	interactive := h.interactive.Load()
	if interactive {
		defer func() {
			if retErr != nil && !errors.Is(retErr, context.Canceled) {
				setMCPRuntimeStateForContext(ctx, h.server.ID, "authorization_required", 0, retErr.Error(), "")
			}
		}()
	}

	prm, err := discoverProtectedResource(ctx, challenges, req.URL.String(), h.client)
	if err != nil {
		return err
	}

	asm, err := auth.GetAuthServerMetadata(ctx, prm.AuthorizationServers[0], h.client)
	if err != nil {
		return fmt.Errorf("discover OAuth authorization server: %w", err)
	}
	if asm == nil {
		return fmt.Errorf("OAuth authorization server metadata not found")
	}
	credential, hasCredential := getOAuthCredential(h.server.ID, h.server.URL)
	if hasCredential && credential.Issuer == asm.Issuer {
		credential.TokenEndpoint = asm.TokenEndpoint
		credential.RevocationEndpoint = asm.RevocationEndpoint
	}
	if hasCredential && credential.Issuer == asm.Issuer && credential.RefreshToken != "" &&
		challengeError != "insufficient_scope" && !credential.Rejected && !oauthClientRegistrationExpired(credential) {
		refreshed, permanent, refreshErr := refreshOAuthCredential(ctx, h.client, credential)
		if refreshErr == nil {
			if saveErr := putOAuthCredential(refreshed); saveErr != nil {
				logging.LogWarnf("mcp oauth: save refreshed credentials failed: %s", saveErr)
			}
			h.sourceMu.Lock()
			h.source = &storedOAuthTokenSource{credential: refreshed, client: h.client}
			h.sourceMu.Unlock()
			setMCPRuntimeStateForContext(ctx, h.server.ID, "oauth_retrying", 0, "", "")
			return nil
		}
		if !permanent {
			return fmt.Errorf("refresh OAuth credentials: %w", refreshErr)
		}
		credential.AccessToken = ""
		credential.RefreshToken = ""
		credential.Expiry = time.Time{}
		if saveErr := putOAuthCredential(credential); saveErr != nil {
			logging.LogWarnf("mcp oauth: clear invalid credentials failed: %s", saveErr)
		}
	}
	if !interactive {
		setMCPRuntimeStateForContext(ctx, h.server.ID, "authorization_required", 0, "", "")
		return errOAuthAuthorizationRequired
	}
	if !slices.Contains(asm.CodeChallengeMethodsSupported, "S256") {
		return fmt.Errorf("OAuth authorization server does not support PKCE S256")
	}
	if len(asm.ResponseTypesSupported) > 0 && !slices.Contains(asm.ResponseTypesSupported, "code") {
		return fmt.Errorf("OAuth authorization server does not support the authorization code response type")
	}
	if len(asm.GrantTypesSupported) > 0 && !slices.Contains(asm.GrantTypesSupported, "authorization_code") {
		return fmt.Errorf("OAuth authorization server does not support the authorization code grant")
	}

	flowID := reusableOAuthFlowID(credential)
	if flowID == "" {
		flowID, err = secureRandomString(24)
		if err != nil {
			return err
		}
	}
	state, err := secureRandomString(24)
	if err != nil {
		return err
	}
	callbackURL := fmt.Sprintf("http://127.0.0.1:%s/api/ai/mcp/oauth/callback/%s", util.ServerPort, flowID)
	scopes := append([]string(nil), prm.ScopesSupported...)
	if len(scopes) == 0 {
		scopes = append(scopes, asm.ScopesSupported...)
	}
	for _, scope := range strings.Fields(bearerChallengeParam(challenges, "scope")) {
		if !slices.Contains(scopes, scope) {
			scopes = append(scopes, scope)
		}
	}
	registrationCredential := credential
	canReuseRegistration := hasCredential && credential.Issuer == asm.Issuer && credential.RedirectURL == callbackURL &&
		credential.ClientID != "" && !oauthClientRegistrationExpired(credential) && oauthScopesContain(credential.Scopes, scopes)
	if !canReuseRegistration {
		if asm.RegistrationEndpoint == "" {
			return fmt.Errorf("OAuth authorization server does not support dynamic client registration")
		}
		tokenAuthMethod := preferredTokenAuthMethod(asm.TokenEndpointAuthMethodsSupported)
		if len(asm.TokenEndpointAuthMethodsSupported) > 0 && tokenAuthMethod == "" {
			return fmt.Errorf("OAuth authorization server does not support a compatible token endpoint authentication method")
		}
		grantTypes := []string{"authorization_code"}
		if len(asm.GrantTypesSupported) == 0 || slices.Contains(asm.GrantTypesSupported, "refresh_token") {
			grantTypes = append(grantTypes, "refresh_token")
		}
		registration, registerErr := oauthex.RegisterClient(ctx, asm.RegistrationEndpoint, &oauthex.ClientRegistrationMetadata{
			RedirectURIs:            []string{callbackURL},
			TokenEndpointAuthMethod: tokenAuthMethod,
			GrantTypes:              grantTypes,
			ResponseTypes:           []string{"code"},
			ClientName:              "SiYuan",
			Scope:                   strings.Join(scopes, " "),
			ApplicationType:         "native",
		}, h.client)
		if registerErr != nil {
			return fmt.Errorf("register OAuth client: %w", registerErr)
		}
		registrationCredential = oauthCredential{
			ServerID:            h.server.ID,
			Endpoint:            h.server.URL,
			Resource:            prm.Resource,
			Issuer:              asm.Issuer,
			ResourceMetadataURL: prm.MetadataURL,
			RedirectURL:         callbackURL,
			ClientID:            registration.ClientID,
			ClientSecret:        registration.ClientSecret,
			ClientSecretExpiry:  registration.ClientSecretExpiresAt,
			TokenEndpoint:       asm.TokenEndpoint,
			RevocationEndpoint:  asm.RevocationEndpoint,
			TokenAuthMethod:     registration.TokenEndpointAuthMethod,
			Scopes:              scopes,
		}
		if registrationCredential.TokenAuthMethod == "" {
			if registration.ClientSecret == "" {
				registrationCredential.TokenAuthMethod = "none"
			} else {
				registrationCredential.TokenAuthMethod = "client_secret_basic"
			}
		}
		if !isSupportedTokenAuthMethod(registrationCredential.TokenAuthMethod) {
			return fmt.Errorf("OAuth client registration returned an unsupported token endpoint authentication method")
		}
		if err = putOAuthCredential(registrationCredential); err != nil {
			return fmt.Errorf("save OAuth client registration: %w", err)
		}
	}

	authMethod := registrationCredential.TokenAuthMethod
	if authMethod == "" {
		if registrationCredential.ClientSecret == "" {
			authMethod = "none"
		} else {
			authMethod = "client_secret_basic"
		}
	}
	config := &oauth2.Config{
		ClientID:     registrationCredential.ClientID,
		ClientSecret: registrationCredential.ClientSecret,
		RedirectURL:  callbackURL,
		Scopes:       scopes,
		Endpoint: oauth2.Endpoint{
			AuthURL:   asm.AuthorizationEndpoint,
			TokenURL:  asm.TokenEndpoint,
			AuthStyle: oauthAuthStyle(authMethod),
		},
	}
	verifier := oauth2.GenerateVerifier()
	authorizationURL := config.AuthCodeURL(state,
		oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("resource", prm.Resource))

	flow := &oauthFlow{
		State:   state,
		Result:  make(chan oauthCallbackResult, 1),
		Expires: time.Now().Add(oauthAuthorizationTimeout),
	}
	oauthFlows.Lock()
	oauthFlows.items[flowID] = flow
	oauthFlows.Unlock()
	defer removeOAuthFlow(flowID, flow)
	setMCPRuntimeStateForContext(ctx, h.server.ID, "authorizing", 0, "", authorizationURL)

	var callback oauthCallbackResult
	timer := time.NewTimer(oauthAuthorizationTimeout)
	defer timer.Stop()
	select {
	case callback = <-flow.Result:
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return fmt.Errorf("OAuth authorization timed out")
	}
	if callback.Error != "" {
		return fmt.Errorf("OAuth authorization failed: %s", callback.Error)
	}
	if callback.State != state {
		return fmt.Errorf("OAuth state mismatch")
	}
	if callback.Code == "" {
		return fmt.Errorf("OAuth callback did not include an authorization code")
	}

	exchangeCtx := context.WithValue(ctx, oauth2.HTTPClient, h.client)
	token, err := config.Exchange(exchangeCtx, callback.Code,
		oauth2.VerifierOption(verifier),
		oauth2.SetAuthURLParam("resource", prm.Resource))
	if err != nil {
		return fmt.Errorf("exchange OAuth authorization code: %w", err)
	}
	if token.TokenType != "" && !strings.EqualFold(token.TokenType, "Bearer") {
		return fmt.Errorf("OAuth token endpoint returned unsupported token type %q", token.TokenType)
	}
	credential = registrationCredential
	credential.TokenAuthMethod = authMethod
	credential.AccessToken = token.AccessToken
	credential.RefreshToken = token.RefreshToken
	credential.TokenType = token.TokenType
	credential.Expiry = token.Expiry
	credential.Scopes = scopes
	credential.Rejected = false
	if err = putOAuthCredential(credential); err != nil {
		return fmt.Errorf("save OAuth credentials: %w", err)
	}
	h.sourceMu.Lock()
	h.source = &storedOAuthTokenSource{credential: credential, client: h.client}
	h.sourceMu.Unlock()
	setMCPRuntimeStateForContext(ctx, h.server.ID, "oauth_retrying", 0, "", "")
	return nil
}

func hasBearerChallenge(challenges []oauthex.Challenge) bool {
	for _, challenge := range challenges {
		if strings.EqualFold(challenge.Scheme, "bearer") {
			return true
		}
	}
	return false
}

func bearerChallengeParam(challenges []oauthex.Challenge, name string) string {
	for _, challenge := range challenges {
		if strings.EqualFold(challenge.Scheme, "bearer") {
			return challenge.Params[name]
		}
	}
	return ""
}

func preferredTokenAuthMethod(supported []string) string {
	for _, method := range []string{"none", "client_secret_post", "client_secret_basic"} {
		if slices.Contains(supported, method) {
			return method
		}
	}
	return ""
}

func isSupportedTokenAuthMethod(method string) bool {
	return method == "none" || method == "client_secret_post" || method == "client_secret_basic"
}

func oauthClientRegistrationExpired(credential oauthCredential) bool {
	return !credential.ClientSecretExpiry.IsZero() && !time.Now().Before(credential.ClientSecretExpiry)
}

func oauthScopesContain(available, required []string) bool {
	for _, scope := range required {
		if !slices.Contains(available, scope) {
			return false
		}
	}
	return true
}

func reusableOAuthFlowID(credential oauthCredential) string {
	callback, err := url.Parse(credential.RedirectURL)
	if err != nil || callback.Scheme != "http" || callback.Hostname() != "127.0.0.1" || callback.Port() != util.ServerPort {
		return ""
	}
	prefix := "/api/ai/mcp/oauth/callback/"
	if !strings.HasPrefix(callback.Path, prefix) || callback.RawQuery != "" || callback.Fragment != "" {
		return ""
	}
	flowID := strings.TrimPrefix(callback.Path, prefix)
	if flowID == "" || strings.Contains(flowID, "/") {
		return ""
	}
	return flowID
}

type protectedResourceURL struct {
	URL      string
	Resource string
}

type discoveredProtectedResource struct {
	*oauthex.ProtectedResourceMetadata
	MetadataURL string
}

func discoverProtectedResource(ctx context.Context, challenges []oauthex.Challenge, resource string, client *http.Client) (*discoveredProtectedResource, error) {
	metadataURL := ""
	for _, challenge := range challenges {
		if strings.EqualFold(challenge.Scheme, "bearer") && challenge.Params["resource_metadata"] != "" {
			metadataURL = challenge.Params["resource_metadata"]
			break
		}
	}
	for _, candidate := range protectedResourceURLs(metadataURL, resource) {
		prm, err := oauthex.GetProtectedResourceMetadata(ctx, candidate.URL, candidate.Resource, client)
		if err != nil {
			continue
		}
		if len(prm.AuthorizationServers) == 0 {
			return nil, fmt.Errorf("OAuth protected resource metadata has no authorization server")
		}
		return &discoveredProtectedResource{ProtectedResourceMetadata: prm, MetadataURL: candidate.URL}, nil
	}
	return nil, fmt.Errorf("OAuth protected resource metadata not found")
}

func (h *mcpOAuthHandler) validateCredentialIssuer(ctx context.Context, credential oauthCredential) (bool, error) {
	var challenges []oauthex.Challenge
	resource := h.server.URL
	if credential.ResourceMetadataURL != "" {
		challenges = []oauthex.Challenge{{Scheme: "bearer", Params: map[string]string{"resource_metadata": credential.ResourceMetadataURL}}}
		resource = credential.Resource
	}
	prm, err := discoverProtectedResource(ctx, challenges, resource, h.client)
	if err != nil {
		return false, fmt.Errorf("validate OAuth protected resource: %w", err)
	}
	if prm.Resource != credential.Resource || len(prm.AuthorizationServers) == 0 {
		return false, nil
	}
	asm, err := auth.GetAuthServerMetadata(ctx, prm.AuthorizationServers[0], h.client)
	if err != nil {
		return false, fmt.Errorf("validate OAuth issuer: %w", err)
	}
	return asm != nil && asm.Issuer == credential.Issuer && asm.TokenEndpoint == credential.TokenEndpoint, nil
}

func protectedResourceURLs(metadataURL, resource string) []protectedResourceURL {
	var result []protectedResourceURL
	if metadataURL != "" {
		result = append(result, protectedResourceURL{URL: metadataURL, Resource: resource})
	}
	resourceURL, err := url.Parse(resource)
	if err != nil {
		return result
	}
	metadata := *resourceURL
	metadata.RawPath = ""
	metadata.RawQuery = ""
	metadata.Fragment = ""
	metadata.Path = "/.well-known/oauth-protected-resource/" + strings.TrimLeft(resourceURL.Path, "/")
	result = append(result, protectedResourceURL{URL: metadata.String(), Resource: resource})
	metadata.Path = "/.well-known/oauth-protected-resource"
	resourceURL.Path = ""
	resourceURL.RawPath = ""
	resourceURL.RawQuery = ""
	resourceURL.Fragment = ""
	result = append(result, protectedResourceURL{URL: metadata.String(), Resource: resourceURL.String()})
	return result
}

func oauthAuthStyle(method string) oauth2.AuthStyle {
	switch method {
	case "none", "client_secret_post":
		return oauth2.AuthStyleInParams
	case "client_secret_basic":
		return oauth2.AuthStyleInHeader
	default:
		return oauth2.AuthStyleAutoDetect
	}
}

func secureRandomString(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func removeOAuthFlow(flowID string, flow *oauthFlow) {
	oauthFlows.Lock()
	if oauthFlows.items[flowID] == flow {
		delete(oauthFlows.items, flowID)
	}
	oauthFlows.Unlock()
}

func CompleteMCPOAuth(flowID, code, state, callbackError string) error {
	oauthFlows.Lock()
	flow := oauthFlows.items[flowID]
	if flow == nil || time.Now().After(flow.Expires) {
		delete(oauthFlows.items, flowID)
		oauthFlows.Unlock()
		return fmt.Errorf("OAuth flow is missing or expired")
	}
	if state != flow.State {
		oauthFlows.Unlock()
		return fmt.Errorf("OAuth state mismatch")
	}
	delete(oauthFlows.items, flowID)
	oauthFlows.Unlock()
	select {
	case flow.Result <- oauthCallbackResult{Code: code, State: state, Error: callbackError}:
		return nil
	default:
		return fmt.Errorf("OAuth callback was already handled")
	}
}

func IsLoopbackCallback(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func refreshOAuthCredential(ctx context.Context, client *http.Client, credential oauthCredential) (oauthCredential, bool, error) {
	values := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {credential.RefreshToken},
		"resource":      {credential.Resource},
	}
	response, tokenErr, err := oauthTokenRequest(ctx, client, credential, values)
	if err != nil {
		permanent := tokenErr != nil && (tokenErr.Code == "invalid_grant" || tokenErr.Code == "invalid_client")
		return credential, permanent, err
	}
	credential.AccessToken = response.AccessToken
	credential.TokenType = response.TokenType
	credential.Rejected = false
	if response.RefreshToken != "" {
		credential.RefreshToken = response.RefreshToken
	}
	if response.ExpiresIn > 0 {
		credential.Expiry = time.Now().Add(time.Duration(response.ExpiresIn) * time.Second)
	} else {
		credential.Expiry = time.Time{}
	}
	if response.Scope != "" {
		credential.Scopes = strings.Fields(response.Scope)
	}
	return credential, false, nil
}

type oauthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	Scope        string `json:"scope"`
}

func oauthTokenRequest(ctx context.Context, client *http.Client, credential oauthCredential, values url.Values) (*oauthTokenResponse, *oauthTokenError, error) {
	applyOAuthClientAuthentication(values, nil, credential)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, credential.TokenEndpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	applyOAuthClientAuthentication(nil, req, credential)
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		tokenErr := &oauthTokenError{}
		if json.Unmarshal(body, tokenErr) != nil || tokenErr.Code == "" {
			return nil, nil, fmt.Errorf("OAuth token endpoint returned %s", resp.Status)
		}
		return nil, tokenErr, tokenErr
	}
	result := &oauthTokenResponse{}
	if err = json.Unmarshal(body, result); err != nil {
		return nil, nil, err
	}
	if result.AccessToken == "" {
		return nil, nil, fmt.Errorf("OAuth token endpoint returned no access token")
	}
	if result.TokenType != "" && !strings.EqualFold(result.TokenType, "Bearer") {
		return nil, nil, fmt.Errorf("OAuth token endpoint returned unsupported token type %q", result.TokenType)
	}
	return result, nil, nil
}

func applyOAuthClientAuthentication(values url.Values, req *http.Request, credential oauthCredential) {
	switch credential.TokenAuthMethod {
	case "client_secret_basic":
		if req != nil {
			req.SetBasicAuth(url.QueryEscape(credential.ClientID), url.QueryEscape(credential.ClientSecret))
		}
	default:
		if values != nil {
			values.Set("client_id", credential.ClientID)
			if credential.TokenAuthMethod == "client_secret_post" && credential.ClientSecret != "" {
				values.Set("client_secret", credential.ClientSecret)
			}
		}
	}
}

func DisconnectMCPOAuth(serverID string) error {
	credentials := listOAuthCredentials(serverID)
	if err := removeOAuthCredential(serverID, "", ""); err != nil {
		return err
	}
	setMCPRuntimeState(serverID, "authorization_required", 0, "", "")
	if len(credentials) > 0 {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			client := &http.Client{Transport: httpclient.NewUserAgentRoundTripper(http.DefaultTransport), Timeout: 15 * time.Second}
			var revokeErr error
			for _, credential := range credentials {
				if err := revokeOAuthCredential(ctx, client, credential); err != nil {
					revokeErr = errors.Join(revokeErr, err)
				}
			}
			if revokeErr != nil {
				logging.LogWarnf("mcp oauth: revoke credentials for server [%s] failed: %s", serverID, revokeErr)
			}
		}()
	}
	return nil
}

func revokeOAuthCredential(ctx context.Context, client *http.Client, credential oauthCredential) error {
	if credential.RevocationEndpoint == "" {
		return nil
	}
	if !isSecureOAuthEndpoint(credential.RevocationEndpoint) {
		return fmt.Errorf("OAuth revocation endpoint must use HTTPS or loopback HTTP")
	}
	var result error
	for _, token := range []struct {
		value string
		hint  string
	}{{credential.RefreshToken, "refresh_token"}, {credential.AccessToken, "access_token"}} {
		if token.value == "" {
			continue
		}
		values := url.Values{"token": {token.value}, "token_type_hint": {token.hint}}
		applyOAuthClientAuthentication(values, nil, credential)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, credential.RevocationEndpoint, strings.NewReader(values.Encode()))
		if err != nil {
			result = errors.Join(result, err)
			continue
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		applyOAuthClientAuthentication(nil, req, credential)
		resp, err := client.Do(req)
		if err != nil {
			result = errors.Join(result, err)
			continue
		}
		io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			result = errors.Join(result, fmt.Errorf("OAuth revocation endpoint returned %s", resp.Status))
		}
	}
	if result != nil {
		logging.LogWarnf("mcp oauth: revoke credentials failed: %s", result)
	}
	return result
}

func isSecureOAuthEndpoint(endpoint string) bool {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return false
	}
	if parsed.Scheme == "https" {
		return true
	}
	if parsed.Scheme != "http" {
		return false
	}
	if strings.EqualFold(parsed.Hostname(), "localhost") {
		return true
	}
	ip := net.ParseIP(parsed.Hostname())
	return ip != nil && ip.IsLoopback()
}
