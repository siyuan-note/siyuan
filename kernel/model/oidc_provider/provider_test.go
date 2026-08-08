// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package oidc_provider

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"golang.org/x/oauth2"
)

func TestGitHubAuthURLUsesPKCEAndSeparateState(t *testing.T) {
	provider := newGitHub(&conf.OIDC{
		Provider: conf.OIDCProviderGitHub,
		ClientID: "client-id",
		Scopes:   []string{"openid", "profile", "email"},
	}, "siyuan:/oidc-callback")
	const verifier = "0123456789012345678901234567890123456789012"
	authURL, err := url.Parse(provider.AuthURL("state-value", "nonce-must-not-be-sent", verifier))
	if err != nil {
		t.Fatal(err)
	}
	query := authURL.Query()
	if query.Get("state") != "state-value" || query.Get("code_challenge") != oauth2.S256ChallengeFromVerifier(verifier) ||
		query.Get("code_challenge_method") != "S256" {
		t.Fatalf("GitHub authorization URL is missing state or PKCE: %s", authURL.String())
	}
	if query.Get("nonce") != "" {
		t.Fatalf("GitHub OAuth authorization URL unexpectedly contains an OIDC nonce: %s", authURL.String())
	}
	if query.Get("scope") != "read:user user:email" {
		t.Fatalf("GitHub preset scopes were not applied: %q", query.Get("scope"))
	}
}

func TestGitHubScopesPreserveCustomValues(t *testing.T) {
	provider := newGitHub(&conf.OIDC{
		Provider: conf.OIDCProviderGitHub,
		ClientID: "client-id",
		Scopes:   []string{"openid", "profile", "email", "read:org"},
	}, "siyuan:/oidc-callback")
	const verifier = "0123456789012345678901234567890123456789012"
	authURL, err := url.Parse(provider.AuthURL("state-value", "", verifier))
	if err != nil {
		t.Fatal(err)
	}
	scopes := authURL.Query().Get("scope")
	for _, expected := range []string{"read:user", "user:email", "read:org"} {
		if !strings.Contains(scopes, expected) {
			t.Fatalf("GitHub authorization URL lost scope %q: %q", expected, scopes)
		}
	}
	if strings.Contains(scopes, "openid") || strings.Contains(scopes, "profile") {
		t.Fatalf("GitHub authorization URL retained OIDC-only scopes: %q", scopes)
	}
}

func TestOIDCProviderVerifiesNonceAndPKCE(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: privateKey},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "test-key"))
	if err != nil {
		t.Fatal(err)
	}
	const verifier = "0123456789012345678901234567890123456789012"
	const nonce = "test-nonce"
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"issuer": server.URL, "authorization_endpoint": server.URL + "/authorize",
				"token_endpoint": server.URL + "/token", "jwks_uri": server.URL + "/jwks",
				"response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"},
				"id_token_signing_alg_values_supported": []string{"RS256"},
			})
		case "/jwks":
			_ = json.NewEncoder(writer).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{
				Key: &privateKey.PublicKey, KeyID: "test-key", Algorithm: string(jose.RS256), Use: "sig",
			}}})
		case "/token":
			if err := request.ParseForm(); err != nil || request.Form.Get("code_verifier") != verifier {
				http.Error(writer, "invalid PKCE verifier", http.StatusBadRequest)
				return
			}
			idToken, signErr := jwt.Signed(signer).Claims(jwt.Claims{
				Issuer: server.URL, Subject: "subject", Audience: jwt.Audience{"client-id"},
				Expiry: jwt.NewNumericDate(time.Now().Add(time.Minute)), IssuedAt: jwt.NewNumericDate(time.Now()),
			}).Claims(map[string]any{"nonce": nonce, "email": "user@example.com"}).Serialize()
			if signErr != nil {
				http.Error(writer, signErr.Error(), http.StatusInternalServerError)
				return
			}
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"access_token": "access-token", "token_type": "Bearer", "id_token": idToken,
			})
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	provider, err := New(context.Background(), &conf.OIDC{
		Provider: conf.OIDCProviderCustom, IssuerURL: server.URL, ClientID: "client-id", ClientSecret: "secret",
		Scopes: []string{"openid", "email"},
	}, "http://127.0.0.1:6806/api/system/oidc/callback")
	if err != nil {
		t.Fatalf("create test provider failed: %s", err)
	}
	authURL, err := url.Parse(provider.AuthURL("test-state", nonce, verifier))
	if err != nil {
		t.Fatal(err)
	}
	if authURL.Query().Get("state") != "test-state" || authURL.Query().Get("nonce") != nonce ||
		authURL.Query().Get("code_challenge") != oauth2.S256ChallengeFromVerifier(verifier) ||
		authURL.Query().Get("code_challenge_method") != "S256" {
		t.Fatalf("OIDC authorization URL is missing security parameters: %s", authURL.String())
	}
	claims, err := provider.Exchange(context.Background(), "authorization-code", verifier, nonce)
	if err != nil {
		t.Fatalf("OIDC exchange failed: %s", err)
	}
	if claims["email"] != "user@example.com" {
		t.Fatalf("unexpected OIDC claims: %#v", claims)
	}
	if _, err = provider.Exchange(context.Background(), "authorization-code", verifier, "wrong-nonce"); err == nil {
		t.Fatal("OIDC exchange accepted a mismatched nonce")
	}
}
