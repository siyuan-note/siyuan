// SiYuan - From thought to insight, with agents
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
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
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
	oidcFlowWeb      = "web"
	oidcFlowDesktop  = "desktop"
	oidcFlowMobile   = "mobile"
	oidcFlowValidate = "validate"

	oidcMobileRedirectURL  = "siyuan:/oidc-callback"
	oidcTransactionMax     = 512
	oidcTransactionPerIP   = 32
	oidcTransactionPerBind = 8
	oidcTransactionTimeout = 10 * time.Minute
	oidcCompletedTimeout   = 30 * time.Second
	oidcProviderTimeout    = 10 * time.Second
	oidcExchangeTimeout    = 20 * time.Second
	oidcProviderCacheMax   = 8
)

type oidcTransaction struct {
	State            string
	Nonce            string
	CodeVerifier     string
	PollToken        string
	Binding          string
	ClientIP         string
	Flow             string
	RedirectURL      string
	To               string
	ConfigVersion    string
	RememberMe       bool
	Claimed          bool
	Completed        bool
	Success          bool
	Message          string
	ExpiresAt        time.Time
	Done             chan struct{}
	Config           *conf.OIDC
	Provider         *oidc_provider.Provider
	Activated        bool
	MobileValidation bool
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

func OIDCValidateStart(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	config := conf.NewOIDC()
	if err := c.ShouldBindJSON(config); err != nil {
		ret.Code = -1
		ret.Msg = oidcLanguage(369, "Invalid OIDC configuration")
		return
	}
	config.Normalize()
	mobileValidation := util.IsMobileContainer()
	if mobileValidation && config.Provider == conf.OIDCProviderGoogle {
		ret.Code = -1
		ret.Msg = oidcLanguage(368, "This OIDC provider does not support the SiYuan mobile callback URI")
		logging.LogErrorf("validate mobile OIDC candidate configuration failed [ip=%s]: Google does not support the fixed SiYuan mobile OIDC callback URI", c.ClientIP())
		return
	}
	requireRemoteAuthentication := util.ContainerDocker == util.Container || !IsLocalRequest(c)
	if err := ValidateOIDCConfigurationChange(c.Request.Context(), config, requireRemoteAuthentication,
		Conf.AccessAuthCode != "", util.SiYuanAccessAuthCodeBypass); err != nil {
		ret.Code = -1
		ret.Msg = oidcLanguage(369, "Invalid OIDC configuration")
		logging.LogErrorf("validate OIDC candidate configuration failed [ip=%s]: %s", c.ClientIP(), err)
		return
	}
	redirectURL, err := oidcValidationRedirectURL(c, config, mobileValidation)
	if err != nil {
		ret.Code = -1
		ret.Msg = oidcLanguage(369, "Invalid OIDC configuration")
		logging.LogErrorf("resolve OIDC validation redirect URL failed: %s", err)
		return
	}
	providerContext, cancel := context.WithTimeout(c.Request.Context(), oidcProviderTimeout)
	defer cancel()
	provider, err := oidc_provider.New(providerContext, config, redirectURL)
	if err != nil {
		ret.Code = -1
		ret.Msg = oidcLanguage(369, "Invalid OIDC configuration")
		logging.LogErrorf("create OIDC validation provider failed: %s", err)
		return
	}

	session := util.GetSession(c)
	workspaceSession := util.GetWorkspaceSession(session)
	if workspaceSession.OIDCBinding == "" {
		if workspaceSession.OIDCBinding, err = secureRandomToken(32); err != nil {
			ret.Code = -1
			ret.Msg = oidcUserMessage()
			return
		}
	}
	transaction, err := newOIDCTransaction(&oidcStartInput{Flow: oidcFlowValidate}, workspaceSession.OIDCBinding,
		c.ClientIP(), redirectURL)
	if err != nil {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		return
	}
	transaction.Config = config
	transaction.Provider = provider
	transaction.MobileValidation = mobileValidation
	if err = session.Save(c); err != nil {
		ret.Code = -1
		ret.Msg = Conf.Language(258)
		return
	}
	if err = storeOIDCTransaction(transaction); err != nil {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		logging.LogWarnf("store OIDC validation transaction failed [ip=%s]: %s", c.ClientIP(), err)
		return
	}
	ret.Data = map[string]any{
		"authURL":   provider.AuthURL(transaction.State, transaction.Nonce, transaction.CodeVerifier),
		"pollToken": transaction.PollToken,
		"expiresIn": int(oidcTransactionTimeout.Seconds()),
	}
}

func OIDCStart(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if err := validateOIDCConfiguration(); err != nil {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		logging.LogErrorf("invalid OIDC login configuration: %s", err)
		return
	}
	input := &oidcStartInput{}
	if err := c.ShouldBindJSON(input); err != nil {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		return
	}
	if input.Flow == "" {
		input.Flow = oidcFlowWeb
	}
	if input.Flow != oidcFlowWeb && input.Flow != oidcFlowDesktop && input.Flow != oidcFlowMobile {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		return
	}
	if input.Flow == oidcFlowMobile && Conf.GetOIDC().Provider == conf.OIDCProviderGoogle {
		ret.Code = -1
		ret.Msg = oidcLanguage(368, "This OIDC provider does not support the SiYuan mobile callback URI")
		logging.LogWarn("Google does not support the fixed SiYuan mobile OIDC callback URI")
		return
	}

	session := util.GetSession(c)
	workspaceSession := util.GetWorkspaceSession(session)
	if workspaceSession.OIDCBinding == "" {
		var err error
		workspaceSession.OIDCBinding, err = secureRandomToken(32)
		if err != nil {
			ret.Code = -1
			ret.Msg = oidcUserMessage()
			logging.LogErrorf("create OIDC login binding failed: %s", err)
			return
		}
	}
	redirectURL, err := effectiveOIDCRedirectURL(c, input.Flow)
	if err != nil {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		logging.LogErrorf("resolve OIDC redirect URL failed: %s", err)
		return
	}
	transaction, err := newOIDCTransaction(input, workspaceSession.OIDCBinding, c.ClientIP(), redirectURL)
	if err != nil {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		logging.LogErrorf("create OIDC login transaction failed: %s", err)
		return
	}
	provider, err := getOIDCProvider(c.Request.Context(), redirectURL)
	if err != nil {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		logging.LogErrorf("create OIDC provider failed: %s", err)
		return
	}
	if err = session.Save(c); err != nil {
		ret.Code = -1
		ret.Msg = Conf.Language(258)
		return
	}
	if err = storeOIDCTransaction(transaction); err != nil {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		logging.LogWarnf("store OIDC login transaction failed [ip=%s]: %s", c.ClientIP(), err)
		return
	}
	authURL := provider.AuthURL(transaction.State, transaction.Nonce, transaction.CodeVerifier)
	ret.Data = map[string]any{"authURL": authURL, "expiresIn": int(oidcTransactionTimeout.Seconds())}
	if input.Flow == oidcFlowDesktop {
		ret.Data.(map[string]any)["pollToken"] = transaction.PollToken
	}
}

func OIDCCallback(c *gin.Context) {
	state := c.Query("state")
	workspaceSession := util.GetWorkspaceSession(util.GetSession(c))
	transaction, repeated, err := claimOIDCTransaction(c.Request.Context(), state, workspaceSession.OIDCBinding, true)
	if err != nil {
		logging.LogWarnf("claim OIDC callback transaction failed: %s", err)
		writeOIDCCallbackPage(c, false, oidcUserMessage())
		return
	}
	if repeated {
		respondRepeatedOIDCCallback(c, transaction)
		return
	}
	if transaction.Flow == oidcFlowMobile || (transaction.Flow == oidcFlowValidate && transaction.MobileValidation) {
		completeOIDCTransaction(transaction.State, false, oidcUserMessage())
		writeOIDCCallbackPage(c, false, oidcUserMessage())
		return
	}
	if transaction.Flow == oidcFlowWeb {
		if workspaceSession.OIDCBinding == "" || workspaceSession.OIDCBinding != transaction.Binding {
			logging.LogWarn("OIDC login binding does not match")
			completeOIDCTransaction(transaction.State, false, oidcUserMessage())
			writeOIDCCallbackPage(c, false, oidcUserMessage())
			return
		}
	}
	if providerError := c.Query("error"); providerError != "" {
		logging.LogWarnf("OIDC provider rejected the login: %s", providerError)
		message := oidcUserMessage()
		completeOIDCTransaction(transaction.State, false, message)
		writeOIDCCallbackPage(c, false, message)
		return
	}
	if err = finishOIDCExchange(c, transaction, c.Query("code")); err != nil {
		logging.LogErrorf("finish OIDC authorization code exchange failed: %s", err)
		completeOIDCTransaction(transaction.State, false, oidcUserMessage())
		writeOIDCCallbackPage(c, false, oidcUserMessage())
		return
	}
	if transaction.Flow == oidcFlowValidate {
		completeOIDCTransaction(transaction.State, true, "")
		writeOIDCCallbackPage(c, true, oidcLanguage(367, "You can close this window and return to SiYuan"))
		return
	}
	if transaction.Flow == oidcFlowDesktop {
		completeOIDCTransaction(transaction.State, true, "")
		writeOIDCCallbackPage(c, true, oidcLanguage(367, "You can close this window and return to SiYuan"))
		return
	}
	if err = authenticateOIDCSession(c, transaction.RememberMe); err != nil {
		completeOIDCTransaction(transaction.State, false, oidcUserMessage())
		writeOIDCCallbackPage(c, false, oidcUserMessage())
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
		ret.Msg = oidcUserMessage()
		return
	}
	callbackURL, err := url.Parse(input.CallbackURL)
	if err != nil || callbackURL.Scheme != "siyuan" || callbackURL.Host != "" || callbackURL.Path != "/oidc-callback" {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		return
	}
	workspaceSession := util.GetWorkspaceSession(util.GetSession(c))
	transaction, repeated, err := claimOIDCTransaction(c.Request.Context(), callbackURL.Query().Get("state"),
		workspaceSession.OIDCBinding, false)
	if err != nil {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		logging.LogWarnf("claim mobile OIDC callback transaction failed: %s", err)
		return
	}
	if repeated {
		if transaction.Flow == oidcFlowValidate && transaction.MobileValidation && transaction.Success {
			ret.Data = map[string]any{"validation": true}
			return
		}
		if transaction.Flow != oidcFlowMobile || !transaction.Success {
			ret.Code = -1
			ret.Msg = oidcUserMessage()
			return
		}
		if err = authenticateOIDCSession(c, transaction.RememberMe); err != nil {
			ret.Code = -1
			ret.Msg = oidcUserMessage()
			return
		}
		ret.Data = map[string]any{"to": safeOIDCRedirectTarget(transaction.To)}
		return
	}
	if transaction.Flow != oidcFlowMobile && !(transaction.Flow == oidcFlowValidate && transaction.MobileValidation) {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		completeOIDCTransaction(transaction.State, false, ret.Msg)
		return
	}
	if providerError := callbackURL.Query().Get("error"); providerError != "" {
		logging.LogWarnf("OIDC provider rejected the mobile login: %s", providerError)
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		completeOIDCTransaction(transaction.State, false, ret.Msg)
		return
	}
	if err = finishOIDCExchange(c, transaction, callbackURL.Query().Get("code")); err != nil {
		logging.LogErrorf("finish mobile OIDC authorization code exchange failed: %s", err)
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		completeOIDCTransaction(transaction.State, false, ret.Msg)
		return
	}
	if transaction.Flow == oidcFlowValidate {
		completeOIDCTransaction(transaction.State, true, "")
		ret.Data = map[string]any{"validation": true}
		return
	}
	if err = authenticateOIDCSession(c, transaction.RememberMe); err != nil {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
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
		ret.Msg = oidcUserMessage()
		return
	}
	workspaceSession := util.GetWorkspaceSession(util.GetSession(c))
	transaction, found := pollOIDCTransaction(input.PollToken, workspaceSession.OIDCBinding)
	if !found || transaction.Flow != oidcFlowDesktop {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		return
	}
	if !transaction.Completed {
		ret.Data = map[string]any{"status": "pending"}
		return
	}
	if !transaction.Success {
		ret.Code = -1
		ret.Msg = transaction.Message
		return
	}
	if err := authenticateOIDCSession(c, transaction.RememberMe); err != nil {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		return
	}
	ret.Data = map[string]any{"status": "completed", "to": safeOIDCRedirectTarget(transaction.To)}
}

func OIDCValidatePoll(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	input := &oidcPollInput{}
	if err := c.ShouldBindJSON(input); err != nil || input.PollToken == "" {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		return
	}
	workspaceSession := util.GetWorkspaceSession(util.GetSession(c))
	transaction, found := pollOIDCTransaction(input.PollToken, workspaceSession.OIDCBinding)
	if !found || transaction.Flow != oidcFlowValidate {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		return
	}
	if !transaction.Completed {
		ret.Data = map[string]any{"status": "pending"}
		return
	}
	if !transaction.Success {
		ret.Code = -1
		ret.Msg = transaction.Message
		return
	}
	ret.Data = map[string]any{"status": "completed"}
}

func OIDCValidateActivate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	input := &oidcPollInput{}
	if err := c.ShouldBindJSON(input); err != nil || input.PollToken == "" {
		ret.Code = -1
		ret.Msg = oidcLanguage(369, "Invalid OIDC configuration")
		return
	}
	workspaceSession := util.GetWorkspaceSession(util.GetSession(c))
	activated, err := activateOIDCValidation(input.PollToken, workspaceSession.OIDCBinding)
	if err != nil {
		ret.Code = -1
		ret.Msg = oidcLanguage(369, "Invalid OIDC configuration")
		logging.LogErrorf("activate validated OIDC configuration failed: %s", err)
		return
	}
	if err = authenticateOIDCSession(c, false); err != nil {
		ret.Code = -1
		ret.Msg = oidcUserMessage()
		return
	}
	if activated {
		util.CloseOIDCSessions()
	}
	masked, err := GetMaskedConf()
	if err != nil {
		ret.Code = -1
		ret.Msg = oidcLanguage(369, "Invalid OIDC configuration")
		return
	}
	ret.Data = map[string]any{"status": "completed", "config": masked.OIDC}
}

func OIDCValidateCancel(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	input := &oidcPollInput{}
	if err := c.ShouldBindJSON(input); err != nil || input.PollToken == "" {
		ret.Code = -1
		ret.Msg = oidcLanguage(369, "Invalid OIDC configuration")
		return
	}
	workspaceSession := util.GetWorkspaceSession(util.GetSession(c))
	if !cancelOIDCValidation(input.PollToken, workspaceSession.OIDCBinding) {
		ret.Code = -1
		ret.Msg = oidcLanguage(369, "Invalid OIDC configuration")
	}
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

func ValidateOIDCMobileConfiguration(config *conf.OIDC) error {
	if err := ValidateOIDCConfiguration(config); err != nil {
		return err
	}
	if config.Provider == conf.OIDCProviderGoogle {
		return errors.New("Google does not support the fixed SiYuan mobile OIDC callback URI")
	}
	return nil
}

func ValidateOIDCProviderConfiguration(ctx context.Context, config *conf.OIDC) error {
	if err := ValidateOIDCConfiguration(config); err != nil {
		return err
	}
	redirectURL := "http://127.0.0.1:6806/api/system/oidc/callback"
	if config.RedirectURL != "" {
		var err error
		if redirectURL, err = validatePublicOIDCRedirectURL(config.RedirectURL); err != nil {
			return err
		}
	}
	validationContext, cancel := context.WithTimeout(ctx, oidcProviderTimeout)
	defer cancel()
	_, err := oidc_provider.New(validationContext, config, redirectURL)
	return err
}

func ValidateOIDCConfigurationChange(ctx context.Context, config *conf.OIDC, requireRemoteRedirect,
	hasAlternativeAuthentication, bypassAuthentication bool) error {
	if config == nil || !config.Enabled {
		if requireRemoteRedirect && !hasAlternativeAuthentication && !bypassAuthentication {
			return errors.New("remote access requires at least one authentication method")
		}
		return nil
	}
	if requireRemoteRedirect {
		if _, err := validatePublicOIDCRedirectURL(config.RedirectURL); err != nil {
			return err
		}
	}
	return ValidateOIDCProviderConfiguration(ctx, config)
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

func oidcValidationRedirectURL(c *gin.Context, config *conf.OIDC, mobile bool) (string, error) {
	if mobile {
		return oidcMobileRedirectURL, nil
	}
	if config.RedirectURL != "" {
		return validatePublicOIDCRedirectURL(config.RedirectURL)
	}
	return effectiveOIDCRedirectURL(c, oidcFlowDesktop)
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
	version := oidcConfigurationVersion(Conf.GetOIDC())
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
	discoveryContext, cancel := context.WithTimeout(ctx, oidcProviderTimeout)
	defer cancel()
	provider, err := oidc_provider.New(discoveryContext, Conf.GetOIDC(), redirectURL)
	if err != nil {
		return nil, err
	}
	oidcProviders.Lock()
	defer oidcProviders.Unlock()
	if oidcProviders.version != version || oidcConfigurationVersion(Conf.GetOIDC()) != version {
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

func newOIDCTransaction(input *oidcStartInput, binding, clientIP, redirectURL string) (*oidcTransaction, error) {
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
	if input.Flow == oidcFlowDesktop || input.Flow == oidcFlowValidate {
		pollToken, err = secureRandomToken(32)
		if err != nil {
			return nil, err
		}
	}
	return &oidcTransaction{State: state, Nonce: nonce, CodeVerifier: verifier, PollToken: pollToken, Binding: binding,
		ClientIP: clientIP,
		Flow:     input.Flow, RedirectURL: redirectURL, To: input.To, ConfigVersion: oidcConfigurationVersion(Conf.GetOIDC()), RememberMe: input.RememberMe,
		ExpiresAt: time.Now().Add(oidcTransactionTimeout), Done: make(chan struct{})}, nil
}

func storeOIDCTransaction(transaction *oidcTransaction) error {
	oidcTransactions.Lock()
	defer oidcTransactions.Unlock()
	cleanupOIDCTransactionsLocked()
	if transaction.Done == nil {
		transaction.Done = make(chan struct{})
	}
	if len(oidcTransactions.byState) >= oidcTransactionMax {
		return errors.New("OIDC login transaction capacity reached")
	}
	perIP, perBinding := 0, 0
	for _, candidate := range oidcTransactions.byState {
		if candidate.Completed {
			continue
		}
		if transaction.ClientIP != "" && candidate.ClientIP == transaction.ClientIP {
			perIP++
		}
		if transaction.Binding != "" && candidate.Binding == transaction.Binding {
			perBinding++
		}
	}
	if perIP >= oidcTransactionPerIP || perBinding >= oidcTransactionPerBind {
		return errors.New("too many pending OIDC login transactions")
	}
	oidcTransactions.byState[transaction.State] = transaction
	if transaction.PollToken != "" {
		oidcTransactions.byPoll[transaction.PollToken] = transaction.State
	}
	return nil
}

func claimOIDCTransaction(ctx context.Context, state, binding string,
	allowDesktopWithoutBinding bool) (*oidcTransaction, bool, error) {
	if state == "" {
		return nil, false, errors.New("OIDC state is missing")
	}
	oidcTransactions.Lock()
	cleanupOIDCTransactionsLocked()
	transaction := oidcTransactions.byState[state]
	if transaction == nil {
		oidcTransactions.Unlock()
		return nil, false, errors.New("OIDC login transaction was not found or has expired")
	}
	if transaction.ConfigVersion != oidcConfigurationVersion(Conf.GetOIDC()) {
		deleteOIDCTransactionLocked(state)
		oidcTransactions.Unlock()
		return nil, false, errors.New("OIDC configuration changed during login")
	}
	if !(allowDesktopWithoutBinding && (transaction.Flow == oidcFlowDesktop || transaction.Flow == oidcFlowValidate)) &&
		(binding == "" || binding != transaction.Binding) {
		oidcTransactions.Unlock()
		return nil, false, errors.New("OIDC login binding does not match")
	}
	if !transaction.Claimed {
		transaction.Claimed = true
		copy := *transaction
		oidcTransactions.Unlock()
		return &copy, false, nil
	}
	done := transaction.Done
	oidcTransactions.Unlock()

	select {
	case <-ctx.Done():
		return nil, false, fmt.Errorf("wait for OIDC login transaction failed: %w", ctx.Err())
	case <-done:
	}

	oidcTransactions.Lock()
	defer oidcTransactions.Unlock()
	transaction = oidcTransactions.byState[state]
	if transaction == nil || !transaction.Completed {
		return nil, false, errors.New("OIDC login transaction was not found or has expired")
	}
	copy := *transaction
	return &copy, true, nil
}

func completeOIDCTransaction(state string, success bool, message string) {
	oidcTransactions.Lock()
	defer oidcTransactions.Unlock()
	transaction := oidcTransactions.byState[state]
	if transaction == nil {
		return
	}
	if transaction.Completed {
		return
	}
	transaction.Completed = true
	transaction.Success = success
	transaction.Message = message
	transaction.ExpiresAt = time.Now().Add(oidcCompletedTimeout)
	transaction.Nonce = ""
	transaction.CodeVerifier = ""
	transaction.Provider = nil
	if !success && transaction.Flow == oidcFlowValidate {
		transaction.Config = nil
	}
	if transaction.Done == nil {
		transaction.Done = make(chan struct{})
	}
	close(transaction.Done)
}

func pollOIDCTransaction(pollToken, binding string) (*oidcTransaction, bool) {
	oidcTransactions.Lock()
	defer oidcTransactions.Unlock()
	cleanupOIDCTransactionsLocked()
	state := oidcTransactions.byPoll[pollToken]
	transaction := oidcTransactions.byState[state]
	if transaction == nil || (transaction.Flow != oidcFlowDesktop && transaction.Flow != oidcFlowValidate) ||
		binding == "" || binding != transaction.Binding {
		return nil, false
	}
	copy := *transaction
	return &copy, true
}

func activateOIDCValidation(pollToken, binding string) (activated bool, err error) {
	oidcTransactions.Lock()
	defer oidcTransactions.Unlock()
	cleanupOIDCTransactionsLocked()
	state := oidcTransactions.byPoll[pollToken]
	transaction := oidcTransactions.byState[state]
	if transaction == nil || transaction.Flow != oidcFlowValidate || transaction.Binding == "" ||
		binding == "" || transaction.Binding != binding || !transaction.Completed || !transaction.Success {
		return false, errors.New("OIDC validation transaction was not found or has expired")
	}
	if transaction.Activated {
		return false, nil
	}
	if transaction.Config == nil {
		return false, errors.New("OIDC validation configuration is missing")
	}
	configurationChanged, swapped := Conf.CompareAndSetOIDC(transaction.ConfigVersion, transaction.Config)
	if !swapped {
		deleteOIDCTransactionLocked(state)
		return false, errors.New("OIDC configuration changed during validation")
	}
	transaction.Config = nil
	transaction.Activated = true
	return configurationChanged, nil
}

func cancelOIDCValidation(pollToken, binding string) bool {
	oidcTransactions.Lock()
	defer oidcTransactions.Unlock()
	cleanupOIDCTransactionsLocked()
	state := oidcTransactions.byPoll[pollToken]
	transaction := oidcTransactions.byState[state]
	if transaction == nil || transaction.Flow != oidcFlowValidate || transaction.Activated || transaction.Binding == "" ||
		binding == "" || transaction.Binding != binding {
		return false
	}
	deleteOIDCTransactionLocked(state)
	return true
}

func deleteOIDCTransactionLocked(state string) {
	if transaction := oidcTransactions.byState[state]; transaction != nil {
		if !transaction.Completed && transaction.Done != nil {
			close(transaction.Done)
		}
		delete(oidcTransactions.byPoll, transaction.PollToken)
	}
	delete(oidcTransactions.byState, state)
}

func respondRepeatedOIDCCallback(c *gin.Context, transaction *oidcTransaction) {
	if !transaction.Success {
		writeOIDCCallbackPage(c, false, oidcUserMessage())
		return
	}
	if transaction.Flow == oidcFlowDesktop || transaction.Flow == oidcFlowValidate {
		writeOIDCCallbackPage(c, true, oidcLanguage(367, "You can close this window and return to SiYuan"))
		return
	}
	if transaction.Flow != oidcFlowWeb {
		writeOIDCCallbackPage(c, false, oidcUserMessage())
		return
	}
	if err := authenticateOIDCSession(c, transaction.RememberMe); err != nil {
		writeOIDCCallbackPage(c, false, oidcUserMessage())
		return
	}
	c.Redirect(http.StatusFound, safeOIDCRedirectTarget(transaction.To))
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
	config := Conf.GetOIDC()
	provider := transaction.Provider
	if transaction.Flow == oidcFlowValidate {
		if transaction.Config == nil || provider == nil {
			return errors.New("OIDC validation configuration is missing")
		}
		config = transaction.Config
	} else {
		var err error
		provider, err = getOIDCProvider(c.Request.Context(), transaction.RedirectURL)
		if err != nil {
			return err
		}
	}
	exchangeContext, cancel := context.WithTimeout(c.Request.Context(), oidcExchangeTimeout)
	defer cancel()
	claims, err := provider.Exchange(exchangeContext, code, transaction.CodeVerifier, transaction.Nonce)
	if err != nil {
		return err
	}
	if transaction.ConfigVersion != oidcConfigurationVersion(Conf.GetOIDC()) {
		return errors.New("OIDC configuration changed during login")
	}
	if err = authorizeOIDCClaims(config, claims); err != nil {
		return err
	}
	return nil
}

func oidcUserMessage() string {
	return oidcLanguage(365, "OIDC login failed")
}

func oidcLanguage(number int, fallback string) string {
	if Conf != nil {
		if message := Conf.Language(number); message != "" {
			return message
		}
	}
	return fallback
}

func authorizeOIDCClaims(config *conf.OIDC, claims map[string]any) error {
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

func safeOIDCRedirectTarget(target string) string {
	parsed, err := url.Parse(target)
	if err != nil || parsed.IsAbs() || strings.HasPrefix(target, "//") || !strings.HasPrefix(target, "/") ||
		strings.Contains(target, "\\") {
		return "/"
	}
	return target
}

func writeOIDCCallbackPage(c *gin.Context, success bool, message string) {
	title := oidcUserMessage()
	if success {
		title = oidcLanguage(366, "OIDC login completed")
	}
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	lang := "en"
	if Conf != nil {
		lang = util.LangToBCP47(Conf.Lang)
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", util.RenderOAuthCallbackPage(lang, title, message, success))
}
