// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model/oidc_provider"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	oidcFlowWeb     = "web"
	oidcFlowDesktop = "desktop"
	oidcFlowMobile  = "mobile"

	oidcMobileRedirectURL  = "siyuan:/oidc-callback"
	oidcTransactionMax     = 512
	oidcTransactionTimeout = 10 * time.Minute
	oidcProviderCacheMax   = 8
)

type oidcTransaction struct {
	State         string
	Nonce         string
	CodeVerifier  string
	PollToken     string
	Binding       string
	Flow          string
	RedirectURL   string
	To            string
	ConfigVersion string
	RememberMe    bool
	Claimed       bool
	Completed     bool
	Success       bool
	Message       string
	ExpiresAt     time.Time
}

var oidcTransactions = struct {
	sync.Mutex
	byState map[string]*oidcTransaction
	byPoll  map[string]string
}{byState: map[string]*oidcTransaction{}, byPoll: map[string]string{}}

var oidcProviders = struct {
	sync.Mutex
	version string
	items   map[string]*oidc_provider.Provider
}{items: map[string]*oidc_provider.Provider{}}

type oidcStartInput struct {
	Flow       string `json:"flow"`
	To         string `json:"to"`
	RememberMe bool   `json:"rememberMe"`
}

type oidcMobileCallbackInput struct {
	CallbackURL string `json:"callbackURL"`
}

type oidcPollInput struct {
	PollToken string `json:"pollToken"`
}

func OIDCStart(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if err := validateOIDCConfiguration(); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	input := &oidcStartInput{}
	if err := c.ShouldBindJSON(input); err != nil {
		ret.Code = -1
		ret.Msg = "Invalid OIDC login request"
		return
	}
	if input.Flow == "" {
		input.Flow = oidcFlowWeb
	}
	if input.Flow != oidcFlowWeb && input.Flow != oidcFlowDesktop && input.Flow != oidcFlowMobile {
		ret.Code = -1
		ret.Msg = "Invalid OIDC login flow"
		return
	}

	session := util.GetSession(c)
	workspaceSession := util.GetWorkspaceSession(session)
	if workspaceSession.OIDCBinding == "" {
		var err error
		workspaceSession.OIDCBinding, err = secureRandomToken(32)
		if err != nil {
			ret.Code = -1
			ret.Msg = "Create OIDC login binding failed"
			return
		}
	}
	redirectURL, err := effectiveOIDCRedirectURL(c, input.Flow)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	transaction, err := newOIDCTransaction(input, workspaceSession.OIDCBinding, redirectURL)
	if err != nil {
		ret.Code = -1
		ret.Msg = "Create OIDC login transaction failed"
		return
	}
	provider, err := getOIDCProvider(c.Request.Context(), redirectURL)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if err = session.Save(c); err != nil {
		ret.Code = -1
		ret.Msg = Conf.Language(258)
		return
	}
	storeOIDCTransaction(transaction)
	authURL := provider.AuthURL(transaction.State, transaction.Nonce, pkceChallenge(transaction.CodeVerifier))
	ret.Data = map[string]any{"authURL": authURL, "expiresIn": int(oidcTransactionTimeout.Seconds())}
	if input.Flow == oidcFlowDesktop {
		ret.Data.(map[string]any)["pollToken"] = transaction.PollToken
	}
}

func OIDCCallback(c *gin.Context) {
	state := c.Query("state")
	workspaceSession := util.GetWorkspaceSession(util.GetSession(c))
	transaction, err := claimOIDCTransaction(state, workspaceSession.OIDCBinding, true)
	if err != nil {
		writeOIDCCallbackPage(c, false, err.Error())
		return
	}
	if transaction.Flow == oidcFlowMobile {
		completeOIDCTransaction(transaction.State, false, "The mobile OIDC callback must be returned to the SiYuan app")
		writeOIDCCallbackPage(c, false, "The mobile OIDC callback must be returned to the SiYuan app")
		return
	}
	if transaction.Flow == oidcFlowWeb {
		if workspaceSession.OIDCBinding == "" || workspaceSession.OIDCBinding != transaction.Binding {
			completeOIDCTransaction(transaction.State, false, "OIDC login binding does not match")
			writeOIDCCallbackPage(c, false, "OIDC login binding does not match")
			return
		}
	}
	if providerError := c.Query("error"); providerError != "" {
		message := "OIDC provider rejected the login: " + providerError
		completeOIDCTransaction(transaction.State, false, message)
		writeOIDCCallbackPage(c, false, message)
		return
	}
	if err = finishOIDCExchange(c, transaction, c.Query("code")); err != nil {
		completeOIDCTransaction(transaction.State, false, err.Error())
		writeOIDCCallbackPage(c, false, err.Error())
		return
	}
	if transaction.Flow == oidcFlowDesktop {
		completeOIDCTransaction(transaction.State, true, "")
		writeOIDCCallbackPage(c, true, "You can close this window and return to SiYuan")
		return
	}
	if err = authenticateOIDCSession(c, transaction.RememberMe); err != nil {
		completeOIDCTransaction(transaction.State, false, err.Error())
		writeOIDCCallbackPage(c, false, err.Error())
		return
	}
	completeOIDCTransaction(transaction.State, true, "")
	c.Redirect(http.StatusFound, safeOIDCRedirectTarget(transaction.To))
}

func OIDCMobileCallback(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	input := &oidcMobileCallbackInput{}
	if err := c.ShouldBindJSON(input); err != nil {
		ret.Code = -1
		ret.Msg = "Invalid OIDC callback request"
		return
	}
	callbackURL, err := url.Parse(input.CallbackURL)
	if err != nil || callbackURL.Scheme != "siyuan" || callbackURL.Host != "" || callbackURL.Path != "/oidc-callback" {
		ret.Code = -1
		ret.Msg = "Invalid mobile OIDC callback URL"
		return
	}
	workspaceSession := util.GetWorkspaceSession(util.GetSession(c))
	transaction, err := claimOIDCTransaction(callbackURL.Query().Get("state"), workspaceSession.OIDCBinding, false)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if transaction.Flow != oidcFlowMobile {
		ret.Code = -1
		ret.Msg = "OIDC login flow does not match"
		return
	}
	if providerError := callbackURL.Query().Get("error"); providerError != "" {
		ret.Code = -1
		ret.Msg = "OIDC provider rejected the login: " + providerError
		completeOIDCTransaction(transaction.State, false, ret.Msg)
		return
	}
	if err = finishOIDCExchange(c, transaction, callbackURL.Query().Get("code")); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		completeOIDCTransaction(transaction.State, false, ret.Msg)
		return
	}
	if err = authenticateOIDCSession(c, transaction.RememberMe); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		completeOIDCTransaction(transaction.State, false, ret.Msg)
		return
	}
	completeOIDCTransaction(transaction.State, true, "")
	ret.Data = map[string]any{"to": safeOIDCRedirectTarget(transaction.To)}
}

func OIDCPoll(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	input := &oidcPollInput{}
	if err := c.ShouldBindJSON(input); err != nil || input.PollToken == "" {
		ret.Code = -1
		ret.Msg = "Invalid OIDC poll request"
		return
	}
	workspaceSession := util.GetWorkspaceSession(util.GetSession(c))
	transaction, found := pollOIDCTransaction(input.PollToken, workspaceSession.OIDCBinding)
	if !found {
		ret.Code = -1
		ret.Msg = "OIDC login transaction was not found or has expired"
		return
	}
	if !transaction.Completed {
		ret.Data = map[string]any{"status": "pending"}
		return
	}
	if !transaction.Success {
		ret.Code = -1
		ret.Msg = transaction.Message
		deleteOIDCTransaction(transaction.State)
		return
	}
	if err := authenticateOIDCSession(c, transaction.RememberMe); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]any{"status": "completed", "to": safeOIDCRedirectTarget(transaction.To)}
	deleteOIDCTransaction(transaction.State)
}

func validateOIDCConfiguration() error {
	return ValidateOIDCConfiguration(Conf.GetOIDC())
}

func ValidateOIDCConfiguration(config *conf.OIDC) error {
	if config == nil || !config.Enabled {
		return errors.New("OIDC login is not enabled")
	}
	if config.ClientID == "" {
		return errors.New("OIDC client ID is required")
	}
	if config.Provider == conf.OIDCProviderGitHub && config.ClientSecret == "" {
		return errors.New("GitHub OAuth client secret is required")
	}
	if (config.Provider == conf.OIDCProviderCustom || config.Provider == conf.OIDCProviderMicrosoft) && config.IssuerURL == "" {
		return errors.New("OIDC issuer URL is required")
	}
	if (config.Provider == conf.OIDCProviderCustom || config.Provider == conf.OIDCProviderMicrosoft) && config.IssuerURL != "" {
		issuer, err := url.Parse(config.IssuerURL)
		if err != nil || issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" ||
			(issuer.Scheme != "https" && !util.IsLocalHostname(issuer.Hostname())) {
			return errors.New("OIDC issuer URL must use HTTPS unless it is a loopback address")
		}
	}
	if config.Provider != conf.OIDCProviderCustom && config.Provider != conf.OIDCProviderGoogle &&
		config.Provider != conf.OIDCProviderMicrosoft && config.Provider != conf.OIDCProviderGitHub {
		return errors.New("Unsupported OIDC provider")
	}
	if !config.AllowAll && len(config.ClaimRules) == 0 {
		return errors.New("OIDC login requires at least one claim rule when Allow all users is disabled")
	}
	for _, rule := range config.ClaimRules {
		if rule == nil || rule.Claim == "" || len(rule.Values) == 0 {
			return errors.New("OIDC claim rules must include a claim and at least one value")
		}
		if rule.Operator != conf.OIDCClaimOperatorEquals && rule.Operator != conf.OIDCClaimOperatorContains {
			return errors.New("Unsupported OIDC claim rule operator")
		}
		for _, value := range rule.Values {
			if value == "" {
				return errors.New("OIDC claim rule values cannot be empty")
			}
		}
	}
	return nil
}

func effectiveOIDCRedirectURL(c *gin.Context, flow string) (string, error) {
	if flow == oidcFlowMobile {
		return oidcMobileRedirectURL, nil
	}
	if flow == oidcFlowWeb && !IsLocalRequest(c) {
		return validatePublicOIDCRedirectURL(Conf.GetOIDC().RedirectURL)
	}
	if !IsLocalRequest(c) {
		return "", errors.New("Desktop OIDC login requires a loopback listener")
	}
	scheme := "http"
	if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := c.Request.Host
	if !util.IsLocalHost(host) {
		return "", errors.New("A loopback OIDC redirect URL is required for local access")
	}
	return scheme + "://" + host + "/api/system/oidc/callback", nil
}

func validatePublicOIDCRedirectURL(redirectURL string) (string, error) {
	if redirectURL == "" {
		return "", errors.New("A public HTTPS OIDC redirect URL is required for remote access")
	}
	parsed, err := url.Parse(redirectURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Path != "/api/system/oidc/callback" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("OIDC redirect URL must end with /api/system/oidc/callback")
	}
	if parsed.Scheme != "https" {
		return "", errors.New("Public OIDC redirect URL must use HTTPS")
	}
	return parsed.String(), nil
}

func getOIDCProvider(ctx context.Context, redirectURL string) (*oidc_provider.Provider, error) {
	version := oidcSessionVersion()
	key := version + "\x00" + redirectURL
	oidcProviders.Lock()
	if oidcProviders.version != version {
		oidcProviders.version = version
		oidcProviders.items = map[string]*oidc_provider.Provider{}
	}
	if provider := oidcProviders.items[key]; provider != nil {
		oidcProviders.Unlock()
		return provider, nil
	}
	oidcProviders.Unlock()
	provider, err := oidc_provider.New(ctx, Conf.GetOIDC(), redirectURL)
	if err != nil {
		return nil, err
	}
	oidcProviders.Lock()
	defer oidcProviders.Unlock()
	if oidcProviders.version != version || oidcSessionVersion() != version {
		return nil, errors.New("OIDC configuration changed during provider discovery")
	}
	if existing := oidcProviders.items[key]; existing != nil {
		return existing, nil
	}
	if len(oidcProviders.items) >= oidcProviderCacheMax {
		oidcProviders.items = map[string]*oidc_provider.Provider{}
	}
	oidcProviders.items[key] = provider
	return provider, nil
}

func newOIDCTransaction(input *oidcStartInput, binding, redirectURL string) (*oidcTransaction, error) {
	state, err := secureRandomToken(32)
	if err != nil {
		return nil, err
	}
	nonce, err := secureRandomToken(32)
	if err != nil {
		return nil, err
	}
	verifier, err := secureRandomToken(32)
	if err != nil {
		return nil, err
	}
	pollToken := ""
	if input.Flow == oidcFlowDesktop {
		pollToken, err = secureRandomToken(32)
		if err != nil {
			return nil, err
		}
	}
	return &oidcTransaction{State: state, Nonce: nonce, CodeVerifier: verifier, PollToken: pollToken, Binding: binding,
		Flow: input.Flow, RedirectURL: redirectURL, To: input.To, ConfigVersion: oidcSessionVersion(), RememberMe: input.RememberMe,
		ExpiresAt: time.Now().Add(oidcTransactionTimeout)}, nil
}

func storeOIDCTransaction(transaction *oidcTransaction) {
	oidcTransactions.Lock()
	defer oidcTransactions.Unlock()
	cleanupOIDCTransactionsLocked()
	if len(oidcTransactions.byState) >= oidcTransactionMax {
		var oldest *oidcTransaction
		for _, candidate := range oidcTransactions.byState {
			if oldest == nil || candidate.ExpiresAt.Before(oldest.ExpiresAt) {
				oldest = candidate
			}
		}
		if oldest != nil {
			deleteOIDCTransactionLocked(oldest.State)
		}
	}
	oidcTransactions.byState[transaction.State] = transaction
	if transaction.PollToken != "" {
		oidcTransactions.byPoll[transaction.PollToken] = transaction.State
	}
}

func claimOIDCTransaction(state, binding string, allowDesktopWithoutBinding bool) (*oidcTransaction, error) {
	if state == "" {
		return nil, errors.New("OIDC state is missing")
	}
	oidcTransactions.Lock()
	defer oidcTransactions.Unlock()
	cleanupOIDCTransactionsLocked()
	transaction := oidcTransactions.byState[state]
	if transaction == nil {
		return nil, errors.New("OIDC login transaction was not found or has expired")
	}
	if transaction.Claimed {
		return nil, errors.New("OIDC login transaction has already been used")
	}
	if transaction.ConfigVersion != oidcSessionVersion() {
		deleteOIDCTransactionLocked(state)
		return nil, errors.New("OIDC configuration changed during login")
	}
	if !(allowDesktopWithoutBinding && transaction.Flow == oidcFlowDesktop) &&
		(binding == "" || binding != transaction.Binding) {
		return nil, errors.New("OIDC login binding does not match")
	}
	transaction.Claimed = true
	copy := *transaction
	return &copy, nil
}

func completeOIDCTransaction(state string, success bool, message string) {
	oidcTransactions.Lock()
	defer oidcTransactions.Unlock()
	transaction := oidcTransactions.byState[state]
	if transaction == nil {
		return
	}
	transaction.Completed = true
	transaction.Success = success
	transaction.Message = message
	if transaction.Flow != oidcFlowDesktop {
		deleteOIDCTransactionLocked(state)
	}
}

func pollOIDCTransaction(pollToken, binding string) (*oidcTransaction, bool) {
	oidcTransactions.Lock()
	defer oidcTransactions.Unlock()
	cleanupOIDCTransactionsLocked()
	state := oidcTransactions.byPoll[pollToken]
	transaction := oidcTransactions.byState[state]
	if transaction == nil || transaction.Flow != oidcFlowDesktop || binding == "" || binding != transaction.Binding {
		return nil, false
	}
	copy := *transaction
	return &copy, true
}

func deleteOIDCTransaction(state string) {
	oidcTransactions.Lock()
	defer oidcTransactions.Unlock()
	deleteOIDCTransactionLocked(state)
}

func deleteOIDCTransactionLocked(state string) {
	if transaction := oidcTransactions.byState[state]; transaction != nil {
		delete(oidcTransactions.byPoll, transaction.PollToken)
	}
	delete(oidcTransactions.byState, state)
}

func cleanupOIDCTransactionsLocked() {
	now := time.Now()
	for state, transaction := range oidcTransactions.byState {
		if now.After(transaction.ExpiresAt) {
			deleteOIDCTransactionLocked(state)
		}
	}
}

func finishOIDCExchange(c *gin.Context, transaction *oidcTransaction, code string) error {
	if code == "" {
		return errors.New("OIDC authorization code is missing")
	}
	provider, err := getOIDCProvider(c.Request.Context(), transaction.RedirectURL)
	if err != nil {
		return err
	}
	claims, err := provider.Exchange(c.Request.Context(), code, transaction.CodeVerifier, transaction.Nonce)
	if err != nil {
		return err
	}
	if err = authorizeOIDCClaims(claims); err != nil {
		return err
	}
	return nil
}

func authorizeOIDCClaims(claims map[string]any) error {
	config := Conf.GetOIDC()
	if config.AllowAll {
		return nil
	}
	for _, rule := range config.ClaimRules {
		claimValues := oidcClaimValues(claims[rule.Claim])
		matched := false
		for _, claimValue := range claimValues {
			for _, allowedValue := range rule.Values {
				switch rule.Operator {
				case conf.OIDCClaimOperatorEquals:
					matched = claimValue == allowedValue
				case conf.OIDCClaimOperatorContains:
					matched = strings.Contains(claimValue, allowedValue)
				}
				if matched {
					break
				}
			}
			if matched {
				break
			}
		}
		if !matched {
			return fmt.Errorf("OIDC claim [%s] is not allowed", rule.Claim)
		}
	}
	return nil
}

func oidcClaimValues(value any) []string {
	switch typed := value.(type) {
	case string:
		return []string{typed}
	case bool, float64, float32, int, int64, json.Number:
		return []string{fmt.Sprint(typed)}
	case []string:
		return typed
	case []any:
		ret := make([]string, 0, len(typed))
		for _, item := range typed {
			values := oidcClaimValues(item)
			if len(values) == 1 {
				ret = append(ret, values[0])
			}
		}
		return ret
	default:
		return nil
	}
}

func authenticateOIDCSession(c *gin.Context, rememberMe bool) error {
	session := util.GetSession(c)
	workspaceSession := util.GetWorkspaceSession(session)
	workspaceSession.AccessAuthCode = ""
	applyAuthenticatedSession(c, workspaceSession, rememberMe)
	util.WrongAuthCount = 0
	util.AuthThrottleReset(c.ClientIP())
	if err := session.Save(c); err != nil {
		logging.LogErrorf("save OIDC session failed: %s", err)
		return errors.New("Save OIDC login session failed")
	}
	util.BroadcastByType("auth", "loginAuth", 0, "", nil)
	return nil
}

func secureRandomToken(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func pkceChallenge(verifier string) string {
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func safeOIDCRedirectTarget(target string) string {
	parsed, err := url.Parse(target)
	if err != nil || parsed.IsAbs() || strings.HasPrefix(target, "//") || !strings.HasPrefix(target, "/") ||
		strings.Contains(target, "\\") {
		return "/"
	}
	return target
}

func writeOIDCCallbackPage(c *gin.Context, success bool, message string) {
	title := "OIDC login failed"
	if success {
		title = "OIDC login completed"
	}
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	c.Header("X-Content-Type-Options", "nosniff")
	c.String(http.StatusOK, "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" "+
		"content=\"width=device-width,initial-scale=1\"><title>%s</title></head><body><main><h1>%s</h1><p>%s</p></main></body></html>",
		html.EscapeString(title), html.EscapeString(title), html.EscapeString(message))
}
