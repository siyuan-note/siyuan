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
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupOIDCTest(t *testing.T) {
	t.Helper()
	previousConf := Conf
	Conf = NewAppConf()
	Conf.CookieKey = "oidc-test-cookie-key"
	Conf.OIDC = &conf.OIDC{
		Enabled:    true,
		Provider:   conf.OIDCProviderCustom,
		IssuerURL:  "https://issuer.example.com",
		ClientID:   "client-id",
		Scopes:     []string{"openid", "email"},
		AllowAll:   true,
		ClaimRules: []*conf.OIDCClaimRule{},
	}
	oidcTransactions.Lock()
	oidcTransactions.byState = map[string]*oidcTransaction{}
	oidcTransactions.byPoll = map[string]string{}
	oidcTransactions.Unlock()
	t.Cleanup(func() {
		Conf = previousConf
		oidcTransactions.Lock()
		oidcTransactions.byState = map[string]*oidcTransaction{}
		oidcTransactions.byPoll = map[string]string{}
		oidcTransactions.Unlock()
	})
}

func TestValidateOIDCConfigurationRequiresExplicitPolicy(t *testing.T) {
	setupOIDCTest(t)
	Conf.OIDC.AllowAll = false
	if err := ValidateOIDCConfiguration(Conf.OIDC); err == nil {
		t.Fatal("expected an error when OIDC has neither AllowAll nor claim rules")
	}
	Conf.OIDC.ClaimRules = []*conf.OIDCClaimRule{{
		Claim: "email", Operator: conf.OIDCClaimOperatorEquals, Values: []string{"user@example.com"},
	}}
	if err := ValidateOIDCConfiguration(Conf.OIDC); err != nil {
		t.Fatalf("valid OIDC configuration was rejected: %s", err)
	}
	Conf.OIDC.ClaimRules[0].Values = []string{""}
	if err := ValidateOIDCConfiguration(Conf.OIDC); err == nil {
		t.Fatal("expected an empty claim rule value to be rejected")
	}
}

func TestValidateOIDCConfigurationRejectsInsecureIssuer(t *testing.T) {
	setupOIDCTest(t)
	Conf.OIDC.IssuerURL = "http://issuer.example.com"
	if err := ValidateOIDCConfiguration(Conf.OIDC); err == nil {
		t.Fatal("expected an insecure non-loopback issuer to be rejected")
	}
	Conf.OIDC.IssuerURL = "http://127.0.0.1:5556"
	if err := ValidateOIDCConfiguration(Conf.OIDC); err != nil {
		t.Fatalf("loopback issuer was rejected: %s", err)
	}
}

func TestValidateOIDCMobileConfigurationRejectsUnsupportedProvider(t *testing.T) {
	setupOIDCTest(t)
	config := Conf.GetOIDC()
	config.Provider = conf.OIDCProviderGoogle
	config.IssuerURL = ""
	if err := ValidateOIDCMobileConfiguration(config); err == nil {
		t.Fatal("Google was accepted for the fixed mobile OIDC callback")
	}
	config.Provider = conf.OIDCProviderCustom
	config.IssuerURL = "https://issuer.example.com"
	if err := ValidateOIDCMobileConfiguration(config); err != nil {
		t.Fatalf("custom OIDC provider was rejected for mobile validation: %s", err)
	}
}

func TestValidatePublicOIDCRedirectURL(t *testing.T) {
	valid := "https://notes.example.com/api/system/oidc/callback"
	if redirect, err := validatePublicOIDCRedirectURL(valid); err != nil || redirect != valid {
		t.Fatalf("valid public redirect URL was rejected: %s", err)
	}
	for _, invalid := range []string{"", "http://notes.example.com/api/system/oidc/callback", "https://notes.example.com/other",
		"https://notes.example.com/api/system/oidc/callback?next=/"} {
		if _, err := validatePublicOIDCRedirectURL(invalid); err == nil {
			t.Fatalf("invalid public redirect URL was accepted: %s", invalid)
		}
	}
}

func TestEffectiveOIDCRedirectURLForLocalAndRemoteFlows(t *testing.T) {
	setupOIDCTest(t)
	gin.SetMode(gin.TestMode)
	contextFor := func(remoteAddress, host string, headers map[string]string) *gin.Context {
		context, _ := gin.CreateTestContext(httptest.NewRecorder())
		context.Request = httptest.NewRequest(http.MethodPost, "http://"+host+"/api/system/oidc/start", nil)
		context.Request.RemoteAddr = remoteAddress
		for key, value := range headers {
			context.Request.Header.Set(key, value)
		}
		return context
	}

	local := contextFor("127.0.0.1:12345", "127.0.0.1:6806", nil)
	if redirect, err := effectiveOIDCRedirectURL(local, oidcFlowWeb); err != nil ||
		redirect != "http://127.0.0.1:6806/api/system/oidc/callback" {
		t.Fatalf("local OIDC redirect was not derived from the loopback listener: %q, %v", redirect, err)
	}
	if redirect, err := effectiveOIDCRedirectURL(local, oidcFlowMobile); err != nil || redirect != oidcMobileRedirectURL {
		t.Fatalf("mobile OIDC redirect changed: %q, %v", redirect, err)
	}
	if redirect, err := oidcValidationRedirectURL(local, Conf.GetOIDC(), true); err != nil || redirect != oidcMobileRedirectURL {
		t.Fatalf("mobile OIDC validation did not use the native callback: %q, %v", redirect, err)
	}

	Conf.OIDC.RedirectURL = "https://notes.example.com/api/system/oidc/callback"
	remote := contextFor("203.0.113.2:12345", "notes.example.com", nil)
	if redirect, err := effectiveOIDCRedirectURL(remote, oidcFlowWeb); err != nil || redirect != Conf.OIDC.RedirectURL {
		t.Fatalf("remote browser OIDC redirect was not taken from configuration: %q, %v", redirect, err)
	}
	if _, err := effectiveOIDCRedirectURL(remote, oidcFlowDesktop); err == nil {
		t.Fatal("remote desktop OIDC flow was accepted without a loopback listener")
	}

	proxiedRemote := contextFor("127.0.0.1:12345", "127.0.0.1:6806", map[string]string{
		"X-Forwarded-For": "203.0.113.3",
	})
	if redirect, err := effectiveOIDCRedirectURL(proxiedRemote, oidcFlowWeb); err != nil || redirect != Conf.OIDC.RedirectURL {
		t.Fatalf("proxied remote OIDC request was treated as local: %q, %v", redirect, err)
	}
}

func TestAuthorizeOIDCClaimsCombinesRulesWithAnd(t *testing.T) {
	setupOIDCTest(t)
	Conf.OIDC.AllowAll = false
	Conf.OIDC.ClaimRules = []*conf.OIDCClaimRule{
		{Claim: "email", Operator: conf.OIDCClaimOperatorEquals, Values: []string{"a@example.com", "b@example.com"}},
		{Claim: "groups", Operator: conf.OIDCClaimOperatorContains, Values: []string{"siyuan-admin"}},
		{Claim: "email_verified", Operator: conf.OIDCClaimOperatorEquals, Values: []string{"true"}},
	}
	claims := map[string]any{"email": "b@example.com", "groups": []any{"users", "siyuan-admins"}, "email_verified": true}
	if err := authorizeOIDCClaims(Conf.GetOIDC(), claims); err != nil {
		t.Fatalf("allowed claims were rejected: %s", err)
	}
	claims["groups"] = []any{"users"}
	if err := authorizeOIDCClaims(Conf.GetOIDC(), claims); err == nil {
		t.Fatal("expected all claim rules to be required")
	}
}

func TestOIDCTransactionUsesSeparateBoundPollToken(t *testing.T) {
	setupOIDCTest(t)
	transaction, err := newOIDCTransaction(&oidcStartInput{Flow: oidcFlowDesktop}, "binding-a", "127.0.0.1",
		"http://127.0.0.1:6806/api/system/oidc/callback")
	if err != nil {
		t.Fatalf("create transaction failed: %s", err)
	}
	if transaction.State == transaction.PollToken || transaction.State == transaction.CodeVerifier || transaction.PollToken == "" {
		t.Fatal("OIDC state, PKCE verifier, and poll token must be independent")
	}
	if err = storeOIDCTransaction(transaction); err != nil {
		t.Fatal(err)
	}
	claimed, repeated, err := claimOIDCTransaction(context.Background(), transaction.State, "", true)
	if err != nil || repeated || claimed.State != transaction.State {
		t.Fatalf("desktop callback could not claim transaction: %v", err)
	}
	completeOIDCTransaction(transaction.State, true, "")
	claimed, repeated, err = claimOIDCTransaction(context.Background(), transaction.State, "", true)
	if err != nil || !repeated || !claimed.Success {
		t.Fatalf("repeated desktop callback did not reuse the completed result: %#v, %v", claimed, err)
	}
	if _, found := pollOIDCTransaction(transaction.PollToken, "binding-b"); found {
		t.Fatal("poll token was accepted with the wrong WebView binding")
	}
	if result, found := pollOIDCTransaction(transaction.PollToken, "binding-a"); !found || !result.Success {
		t.Fatal("completed desktop transaction was not returned to its bound WebView")
	}
}

func TestOIDCTransactionCanOnlyBeClaimedOnceConcurrently(t *testing.T) {
	setupOIDCTest(t)
	transaction := &oidcTransaction{State: "concurrent", Binding: "binding", ConfigVersion: oidcConfigurationVersion(Conf.GetOIDC()),
		ExpiresAt: time.Now().Add(time.Minute)}
	if err := storeOIDCTransaction(transaction); err != nil {
		t.Fatal(err)
	}
	const workers = 16
	type claimResult struct {
		repeated bool
		err      error
	}
	results := make(chan claimResult, workers)
	var waitGroup sync.WaitGroup
	for i := 0; i < workers; i++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			_, repeated, err := claimOIDCTransaction(context.Background(), transaction.State, transaction.Binding, false)
			results <- claimResult{repeated: repeated, err: err}
		}()
	}
	first := <-results
	if first.err != nil || first.repeated {
		t.Fatalf("first OIDC transaction claim failed: %#v", first)
	}
	completeOIDCTransaction(transaction.State, true, "")
	waitGroup.Wait()
	close(results)
	repeatedClaims := 0
	for result := range results {
		if result.err != nil {
			t.Fatalf("repeated OIDC transaction claim failed: %s", result.err)
		}
		if result.repeated {
			repeatedClaims++
		}
	}
	if repeatedClaims != workers-1 {
		t.Fatalf("OIDC transaction returned %d repeated claims", repeatedClaims)
	}
}

func TestRepeatedOIDCTransactionRequiresOriginalBinding(t *testing.T) {
	setupOIDCTest(t)
	transaction := &oidcTransaction{State: "bound-repeat", Binding: "binding-a", Flow: oidcFlowWeb,
		ConfigVersion: oidcConfigurationVersion(Conf.GetOIDC()), ExpiresAt: time.Now().Add(time.Minute)}
	if err := storeOIDCTransaction(transaction); err != nil {
		t.Fatal(err)
	}
	if _, repeated, err := claimOIDCTransaction(context.Background(), transaction.State, "binding-a", false); err != nil || repeated {
		t.Fatalf("initial bound OIDC transaction claim failed: repeated=%v, err=%v", repeated, err)
	}
	completeOIDCTransaction(transaction.State, true, "")
	if _, _, err := claimOIDCTransaction(context.Background(), transaction.State, "binding-b", false); err == nil {
		t.Fatal("repeated OIDC transaction accepted a different binding")
	}
	result, repeated, err := claimOIDCTransaction(context.Background(), transaction.State, "binding-a", false)
	if err != nil || !repeated || !result.Success {
		t.Fatalf("repeated OIDC transaction rejected its original binding: %#v, %v", result, err)
	}
}

func TestCompletedWebAndMobileTransactionsAreRetainedBriefly(t *testing.T) {
	setupOIDCTest(t)
	for _, flow := range []string{oidcFlowWeb, oidcFlowMobile} {
		transaction := &oidcTransaction{State: flow, Flow: flow, ConfigVersion: oidcConfigurationVersion(Conf.GetOIDC()),
			ExpiresAt: time.Now().Add(time.Minute)}
		if err := storeOIDCTransaction(transaction); err != nil {
			t.Fatal(err)
		}
		completeOIDCTransaction(transaction.State, true, "")
		oidcTransactions.Lock()
		stored := oidcTransactions.byState[transaction.State]
		if stored != nil {
			stored.ExpiresAt = time.Now().Add(-time.Second)
			cleanupOIDCTransactionsLocked()
		}
		removed := oidcTransactions.byState[transaction.State] == nil
		oidcTransactions.Unlock()
		if stored == nil || !stored.Completed || !stored.Success {
			t.Fatalf("completed %s OIDC transaction was not retained for a repeated callback", flow)
		}
		if !removed {
			t.Fatalf("expired completed %s OIDC transaction was retained", flow)
		}
	}
}

func TestActivateOIDCValidationAppliesCandidateOnce(t *testing.T) {
	setupOIDCTest(t)
	previousReadOnly := util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() { util.ReadOnly = previousReadOnly })
	candidate := Conf.GetOIDC()
	candidate.ClientID = "validated-client-id"
	transaction := &oidcTransaction{
		State:         "validation-state",
		PollToken:     "validation-poll-token",
		Binding:       "validation-binding",
		Flow:          oidcFlowValidate,
		ConfigVersion: oidcConfigurationVersion(Conf.GetOIDC()),
		Completed:     true,
		Success:       true,
		Config:        candidate,
		ExpiresAt:     time.Now().Add(time.Minute),
	}
	if err := storeOIDCTransaction(transaction); err != nil {
		t.Fatal(err)
	}
	activated, err := activateOIDCValidation(transaction.PollToken, transaction.Binding)
	if err != nil || !activated {
		t.Fatalf("validated OIDC configuration was not activated: activated=%v, err=%v", activated, err)
	}
	if Conf.GetOIDC().ClientID != candidate.ClientID {
		t.Fatal("validated OIDC configuration was not applied")
	}
	activated, err = activateOIDCValidation(transaction.PollToken, transaction.Binding)
	if err != nil || activated {
		t.Fatalf("validated OIDC configuration was applied more than once: activated=%v, err=%v", activated, err)
	}
}

func TestActivateOIDCValidationRejectsChangedConfiguration(t *testing.T) {
	setupOIDCTest(t)
	candidate := Conf.GetOIDC()
	candidate.ClientID = "validated-client-id"
	transaction := &oidcTransaction{
		State:         "stale-validation-state",
		PollToken:     "stale-validation-poll-token",
		Binding:       "validation-binding",
		Flow:          oidcFlowValidate,
		ConfigVersion: oidcConfigurationVersion(Conf.GetOIDC()),
		Completed:     true,
		Success:       true,
		Config:        candidate,
		ExpiresAt:     time.Now().Add(time.Minute),
	}
	if err := storeOIDCTransaction(transaction); err != nil {
		t.Fatal(err)
	}
	Conf.OIDC.ClientID = "concurrently-changed-client-id"
	if activated, err := activateOIDCValidation(transaction.PollToken, transaction.Binding); err == nil || activated {
		t.Fatalf("stale OIDC validation was activated: activated=%v, err=%v", activated, err)
	}
}

func TestCancelOIDCValidationPreventsActivation(t *testing.T) {
	setupOIDCTest(t)
	candidate := Conf.GetOIDC()
	candidate.ClientID = "cancelled-client-id"
	transaction := &oidcTransaction{
		State:         "cancelled-validation-state",
		PollToken:     "cancelled-validation-poll-token",
		Binding:       "validation-binding",
		Flow:          oidcFlowValidate,
		ConfigVersion: oidcConfigurationVersion(Conf.GetOIDC()),
		Completed:     true,
		Success:       true,
		Config:        candidate,
		ExpiresAt:     time.Now().Add(time.Minute),
	}
	if err := storeOIDCTransaction(transaction); err != nil {
		t.Fatal(err)
	}
	if !cancelOIDCValidation(transaction.PollToken, transaction.Binding) {
		t.Fatal("bound OIDC validation could not be cancelled")
	}
	if activated, err := activateOIDCValidation(transaction.PollToken, transaction.Binding); err == nil || activated {
		t.Fatalf("cancelled OIDC validation was activated: activated=%v, err=%v", activated, err)
	}
	if Conf.GetOIDC().ClientID == candidate.ClientID {
		t.Fatal("cancelled OIDC validation changed the active configuration")
	}
}

func TestCompareAndSetOIDCRejectsStaleVersion(t *testing.T) {
	setupOIDCTest(t)
	previousReadOnly := util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() { util.ReadOnly = previousReadOnly })
	expectedVersion := oidcConfigurationVersion(Conf.GetOIDC())
	first := Conf.GetOIDC()
	first.ClientID = "first-client-id"
	if changed, swapped := Conf.CompareAndSetOIDC(expectedVersion, first); !changed || !swapped {
		t.Fatalf("current OIDC configuration was not swapped: changed=%v, swapped=%v", changed, swapped)
	}
	stale := Conf.GetOIDC()
	stale.ClientID = "stale-client-id"
	if changed, swapped := Conf.CompareAndSetOIDC(expectedVersion, stale); changed || swapped {
		t.Fatalf("stale OIDC configuration was swapped: changed=%v, swapped=%v", changed, swapped)
	}
	if Conf.GetOIDC().ClientID != first.ClientID {
		t.Fatal("stale OIDC configuration overwrote the current configuration")
	}
}

func TestApplyOIDCEnvironmentOverridesStoredConfiguration(t *testing.T) {
	t.Setenv("SIYUAN_OIDC_ENABLED", "true")
	t.Setenv("SIYUAN_OIDC_PROVIDER", conf.OIDCProviderGitHub)
	t.Setenv("SIYUAN_OIDC_CLIENT_ID", "environment-client")
	t.Setenv("SIYUAN_OIDC_SCOPES", "read:user, repo")
	t.Setenv("SIYUAN_OIDC_ALLOW_ALL", "true")
	t.Setenv("SIYUAN_OIDC_CLAIM_RULES", `[{"claim":"login","operator":"equals","values":["alice"]}]`)
	config := &conf.OIDC{Provider: conf.OIDCProviderCustom, ClientID: "stored-client"}
	applyOIDCEnvironment(config)
	if !config.Enabled || config.Provider != conf.OIDCProviderGitHub || config.ClientID != "environment-client" ||
		!config.AllowAll || len(config.Scopes) != 2 || len(config.ClaimRules) != 1 || config.ClaimRules[0].Claim != "login" {
		t.Fatalf("OIDC environment did not override stored configuration: %#v", config)
	}
}

func TestOIDCTransactionExpiryAndSafeRedirect(t *testing.T) {
	setupOIDCTest(t)
	transaction := &oidcTransaction{
		State: "expired", Binding: "binding", ConfigVersion: oidcConfigurationVersion(Conf.GetOIDC()), ExpiresAt: time.Now().Add(-time.Second),
	}
	if err := storeOIDCTransaction(transaction); err != nil {
		t.Fatal(err)
	}
	if _, _, err := claimOIDCTransaction(context.Background(), transaction.State, "binding", false); err == nil {
		t.Fatal("expired OIDC transaction was accepted")
	}
	for _, unsafe := range []string{"https://example.com", "//example.com", "/\\example.com", "javascript:alert(1)", ""} {
		if target := safeOIDCRedirectTarget(unsafe); target != "/" {
			t.Fatalf("unsafe redirect target [%s] was accepted as [%s]", unsafe, target)
		}
	}
	if target := safeOIDCRedirectTarget("/stage/build/mobile/"); target != "/stage/build/mobile/" {
		t.Fatalf("safe redirect target was changed: %s", target)
	}
}

func TestWriteOIDCCallbackPageUsesSharedOAuthStyle(t *testing.T) {
	setupOIDCTest(t)
	Conf.Lang = "zh_CN"
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)

	writeOIDCCallbackPage(context, false, "登录失败<script>")

	page := recorder.Body.String()
	for _, expected := range []string{`lang="zh-CN"`, `class="brand">SiYuan</div>`, `class="mark mark--error"`, "登录失败&lt;script&gt;"} {
		if !strings.Contains(page, expected) {
			t.Fatalf("OIDC callback page does not contain %q: %s", expected, page)
		}
	}
	if !strings.Contains(recorder.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatalf("OIDC callback page has an incomplete content security policy: %s",
			recorder.Header().Get("Content-Security-Policy"))
	}
}

func TestOIDCTransactionLimitsRejectWithoutEviction(t *testing.T) {
	setupOIDCTest(t)
	newTransaction := func(state, binding, clientIP string) *oidcTransaction {
		return &oidcTransaction{State: state, Binding: binding, ClientIP: clientIP,
			ConfigVersion: oidcConfigurationVersion(Conf.GetOIDC()), ExpiresAt: time.Now().Add(time.Minute)}
	}
	for i := 0; i < oidcTransactionPerBind; i++ {
		if err := storeOIDCTransaction(newTransaction(fmt.Sprintf("binding-%d", i), "same-binding", "")); err != nil {
			t.Fatal(err)
		}
	}
	if err := storeOIDCTransaction(newTransaction("binding-overflow", "same-binding", "")); err == nil {
		t.Fatal("expected the per-binding transaction limit to reject a new transaction")
	}
	if len(oidcTransactions.byState) != oidcTransactionPerBind {
		t.Fatal("rejected transaction evicted an existing transaction")
	}

	oidcTransactions.Lock()
	oidcTransactions.byState = map[string]*oidcTransaction{}
	oidcTransactions.byPoll = map[string]string{}
	oidcTransactions.Unlock()
	for i := 0; i < oidcTransactionPerIP; i++ {
		if err := storeOIDCTransaction(newTransaction(fmt.Sprintf("ip-%d", i), fmt.Sprintf("binding-%d", i), "192.0.2.1")); err != nil {
			t.Fatal(err)
		}
	}
	if err := storeOIDCTransaction(newTransaction("ip-overflow", "another-binding", "192.0.2.1")); err == nil {
		t.Fatal("expected the per-IP transaction limit to reject a new transaction")
	}

	oidcTransactions.Lock()
	oidcTransactions.byState = map[string]*oidcTransaction{}
	oidcTransactions.byPoll = map[string]string{}
	oidcTransactions.Unlock()
	for i := 0; i < oidcTransactionMax; i++ {
		if err := storeOIDCTransaction(newTransaction(fmt.Sprintf("capacity-%d", i), "", "")); err != nil {
			t.Fatal(err)
		}
	}
	if err := storeOIDCTransaction(newTransaction("capacity-overflow", "", "")); err == nil {
		t.Fatal("expected the global transaction capacity to reject a new transaction")
	}
	if oidcTransactions.byState["capacity-0"] == nil || len(oidcTransactions.byState) != oidcTransactionMax {
		t.Fatal("reaching transaction capacity evicted an active transaction")
	}
}

func TestValidateOIDCConfigurationChangePreventsRemoteLockout(t *testing.T) {
	setupOIDCTest(t)
	disabled := conf.NewOIDC()
	if err := ValidateOIDCConfigurationChange(context.Background(), disabled, true, false, false); err == nil {
		t.Fatal("expected disabling the last remote authentication method to be rejected")
	}
	if err := ValidateOIDCConfigurationChange(context.Background(), disabled, true, true, false); err != nil {
		t.Fatalf("alternative access authentication was rejected: %s", err)
	}
	if err := ValidateOIDCConfigurationChange(context.Background(), disabled, true, false, true); err != nil {
		t.Fatalf("explicit authentication bypass was rejected: %s", err)
	}
	if err := ValidateOIDCConfigurationChange(context.Background(), disabled, false, false, false); err != nil {
		t.Fatalf("disabling authentication for local access was rejected: %s", err)
	}
}

func TestValidateOIDCProviderConfigurationDiscoversProvider(t *testing.T) {
	setupOIDCTest(t)
	var providerURL string
	provider := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(writer, `{"issuer":%q,"authorization_endpoint":%q,"token_endpoint":%q,"jwks_uri":%q}`,
			providerURL, providerURL+"/authorize", providerURL+"/token", providerURL+"/keys")
	}))
	defer provider.Close()
	providerURL = provider.URL
	config := Conf.GetOIDC()
	config.IssuerURL = provider.URL
	if err := ValidateOIDCProviderConfiguration(context.Background(), config); err != nil {
		t.Fatalf("valid OIDC provider discovery was rejected: %s", err)
	}

	unavailable := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Error(writer, "unavailable", http.StatusServiceUnavailable)
	}))
	unavailable.Close()
	config.IssuerURL = unavailable.URL
	if err := ValidateOIDCProviderConfiguration(context.Background(), config); err == nil {
		t.Fatal("unavailable OIDC provider was accepted")
	}
}

func TestSecureRandomToken(t *testing.T) {
	first, err := secureRandomToken(32)
	if err != nil {
		t.Fatal(err)
	}
	second, err := secureRandomToken(32)
	if err != nil {
		t.Fatal(err)
	}
	if first == second || strings.ContainsAny(first, "+/=") || len(first) < 43 {
		t.Fatal("secure random token is not URL-safe or sufficiently random")
	}
}

func TestOIDCSessionVersionInvalidatesOnConfigurationChange(t *testing.T) {
	setupOIDCTest(t)
	workspaceSession := &util.WorkspaceSession{OIDCSessionVersion: oidcSessionVersion()}
	if !IsWorkspaceSessionAuthenticated(workspaceSession) {
		t.Fatal("current OIDC session version was rejected")
	}
	if !IsOIDCSessionVersionCurrent(workspaceSession.OIDCSessionVersion) {
		t.Fatal("current OIDC WebSocket session version was rejected")
	}
	Conf.OIDC.ClientID = "changed-client-id"
	if IsWorkspaceSessionAuthenticated(workspaceSession) {
		t.Fatal("OIDC session survived an authentication configuration change")
	}
	if IsOIDCSessionVersionCurrent(workspaceSession.OIDCSessionVersion) {
		t.Fatal("OIDC WebSocket session survived an authentication configuration change")
	}
	Conf.AccessAuthCode = "access-code"
	workspaceSession.AccessAuthCode = "access-code"
	if !IsWorkspaceSessionAuthenticated(workspaceSession) {
		t.Fatal("valid access-code session should remain available as an independent login method")
	}
}

func TestApplyAuthenticatedSessionRememberMeCookie(t *testing.T) {
	setupOIDCTest(t)
	gin.SetMode(gin.TestMode)
	renderCookie := func(rememberMe bool) string {
		engine := gin.New()
		store := cookie.NewStore([]byte("oidc-remember-me-test-key"))
		engine.Use(ginSessions.Sessions("siyuan", store))
		engine.POST("/login", func(c *gin.Context) {
			session := util.GetSession(c)
			workspaceSession := util.GetWorkspaceSession(session)
			applyAuthenticatedSession(c, workspaceSession, rememberMe)
			if err := session.Save(c); err != nil {
				c.Status(http.StatusInternalServerError)
				return
			}
			c.Status(http.StatusNoContent)
		})
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/login", nil)
		engine.ServeHTTP(recorder, request)
		return recorder.Header().Get("Set-Cookie")
	}
	if remembered := renderCookie(true); !strings.Contains(remembered, "Max-Age=2592000") {
		t.Fatalf("remembered OIDC session cookie has no 30-day lifetime: %s", remembered)
	}
	if sessionOnly := renderCookie(false); strings.Contains(sessionOnly, "Max-Age=") {
		t.Fatalf("session-only OIDC cookie unexpectedly has a persistent lifetime: %s", sessionOnly)
	}
}

func TestOIDCConfigurationVersionTracksDisabledConfiguration(t *testing.T) {
	setupOIDCTest(t)
	Conf.OIDC.Enabled = false
	first := oidcConfigurationVersion(Conf.GetOIDC())
	if first == "" || oidcSessionVersion() != "" {
		t.Fatal("disabled OIDC configuration did not retain an internal configuration version")
	}
	Conf.OIDC.ClientID = "changed-disabled-client-id"
	if second := oidcConfigurationVersion(Conf.GetOIDC()); second == first {
		t.Fatal("disabled OIDC configuration change did not invalidate pending validation")
	}
}
