// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import (
	"strings"
	"testing"
	"time"

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

func TestAuthorizeOIDCClaimsCombinesRulesWithAnd(t *testing.T) {
	setupOIDCTest(t)
	Conf.OIDC.AllowAll = false
	Conf.OIDC.ClaimRules = []*conf.OIDCClaimRule{
		{Claim: "email", Operator: conf.OIDCClaimOperatorEquals, Values: []string{"a@example.com", "b@example.com"}},
		{Claim: "groups", Operator: conf.OIDCClaimOperatorContains, Values: []string{"siyuan-admin"}},
		{Claim: "email_verified", Operator: conf.OIDCClaimOperatorEquals, Values: []string{"true"}},
	}
	claims := map[string]any{"email": "b@example.com", "groups": []any{"users", "siyuan-admins"}, "email_verified": true}
	if err := authorizeOIDCClaims(claims); err != nil {
		t.Fatalf("allowed claims were rejected: %s", err)
	}
	claims["groups"] = []any{"users"}
	if err := authorizeOIDCClaims(claims); err == nil {
		t.Fatal("expected all claim rules to be required")
	}
}

func TestOIDCTransactionUsesSeparateBoundPollToken(t *testing.T) {
	setupOIDCTest(t)
	transaction, err := newOIDCTransaction(&oidcStartInput{Flow: oidcFlowDesktop}, "binding-a", "http://127.0.0.1:6806/api/system/oidc/callback")
	if err != nil {
		t.Fatalf("create transaction failed: %s", err)
	}
	if transaction.State == transaction.PollToken || transaction.State == transaction.CodeVerifier || transaction.PollToken == "" {
		t.Fatal("OIDC state, PKCE verifier, and poll token must be independent")
	}
	storeOIDCTransaction(transaction)
	claimed, err := claimOIDCTransaction(transaction.State, "", true)
	if err != nil || claimed.State != transaction.State {
		t.Fatalf("desktop callback could not claim transaction: %v", err)
	}
	if _, err = claimOIDCTransaction(transaction.State, "", true); err == nil {
		t.Fatal("OIDC state was accepted more than once")
	}
	completeOIDCTransaction(transaction.State, true, "")
	if _, found := pollOIDCTransaction(transaction.PollToken, "binding-b"); found {
		t.Fatal("poll token was accepted with the wrong WebView binding")
	}
	if result, found := pollOIDCTransaction(transaction.PollToken, "binding-a"); !found || !result.Success {
		t.Fatal("completed desktop transaction was not returned to its bound WebView")
	}
}

func TestOIDCTransactionExpiryAndSafeRedirect(t *testing.T) {
	setupOIDCTest(t)
	transaction := &oidcTransaction{
		State: "expired", Binding: "binding", ConfigVersion: oidcSessionVersion(), ExpiresAt: time.Now().Add(-time.Second),
	}
	storeOIDCTransaction(transaction)
	if _, err := claimOIDCTransaction(transaction.State, "binding", false); err == nil {
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
	Conf.OIDC.ClientID = "changed-client-id"
	if IsWorkspaceSessionAuthenticated(workspaceSession) {
		t.Fatal("OIDC session survived an authentication configuration change")
	}
	Conf.AccessAuthCode = "access-code"
	workspaceSession.AccessAuthCode = "access-code"
	if !IsWorkspaceSessionAuthenticated(workspaceSession) {
		t.Fatal("valid access-code session should remain available as an independent login method")
	}
}
