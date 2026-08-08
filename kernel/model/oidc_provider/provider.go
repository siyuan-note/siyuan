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
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"golang.org/x/oauth2"
)

const (
	googleIssuer = "https://accounts.google.com"
)

type Provider struct {
	kind         string
	oauth2Config *oauth2.Config
	verifier     *oidc.IDTokenVerifier
}

func New(ctx context.Context, config *conf.OIDC, redirectURL string) (*Provider, error) {
	if config == nil {
		return nil, errors.New("OIDC configuration is missing")
	}
	if config.ClientID == "" {
		return nil, errors.New("OIDC client ID is required")
	}
	if redirectURL == "" {
		return nil, errors.New("OIDC redirect URL is required")
	}
	if config.Provider == conf.OIDCProviderGitHub && config.ClientSecret == "" {
		return nil, errors.New("GitHub OAuth client secret is required")
	}
	issuerURL := strings.TrimSpace(config.IssuerURL)
	switch config.Provider {
	case conf.OIDCProviderGoogle:
		issuerURL = googleIssuer
	case conf.OIDCProviderMicrosoft:
		// Microsoft 多租户端点的 issuer 会随租户变化，必须使用租户专属 issuer。
	case conf.OIDCProviderCustom:
	case conf.OIDCProviderGitHub:
		return newGitHub(config, redirectURL), nil
	default:
		return nil, fmt.Errorf("unsupported OIDC provider [%s]", config.Provider)
	}
	if issuerURL == "" {
		return nil, errors.New("OIDC issuer URL is required")
	}
	discovered, err := oidc.NewProvider(ctx, issuerURL)
	if err != nil {
		return nil, fmt.Errorf("discover OIDC provider failed: %w", err)
	}
	scopes := append([]string{}, config.Scopes...)
	if !contains(scopes, oidc.ScopeOpenID) {
		scopes = append([]string{oidc.ScopeOpenID}, scopes...)
	}
	return &Provider{
		kind: conf.OIDCProviderCustom,
		oauth2Config: &oauth2.Config{
			ClientID:     config.ClientID,
			ClientSecret: config.ClientSecret,
			Endpoint:     discovered.Endpoint(),
			RedirectURL:  redirectURL,
			Scopes:       scopes,
		},
		verifier: discovered.Verifier(&oidc.Config{ClientID: config.ClientID}),
	}, nil
}

func (p *Provider) AuthURL(state, nonce, codeVerifier string) string {
	if p.kind == conf.OIDCProviderGitHub {
		return p.oauth2Config.AuthCodeURL(state, oauth2.S256ChallengeOption(codeVerifier))
	}
	return p.oauth2Config.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(codeVerifier))
}

func (p *Provider) Exchange(ctx context.Context, code, codeVerifier, nonce string) (map[string]any, error) {
	token, err := p.oauth2Config.Exchange(ctx, code, oauth2.VerifierOption(codeVerifier))
	if err != nil {
		return nil, fmt.Errorf("exchange OIDC authorization code failed: %w", err)
	}
	if p.kind == conf.OIDCProviderGitHub {
		return exchangeGitHubClaims(ctx, token)
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		return nil, errors.New("OIDC response does not contain an ID token")
	}
	idToken, err := p.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return nil, fmt.Errorf("verify OIDC ID token failed: %w", err)
	}
	if idToken.Nonce != nonce {
		return nil, errors.New("OIDC nonce does not match")
	}
	claims := map[string]any{}
	if err = idToken.Claims(&claims); err != nil {
		return nil, fmt.Errorf("decode OIDC claims failed: %w", err)
	}
	return claims, nil
}

func newGitHub(config *conf.OIDC, redirectURL string) *Provider {
	scopes := append([]string{}, config.Scopes...)
	if len(scopes) == 0 || isDefaultOIDCScopes(scopes) {
		scopes = []string{"read:user", "user:email"}
	} else {
		filtered := scopes[:0]
		for _, scope := range scopes {
			if scope != oidc.ScopeOpenID && scope != "profile" && scope != "email" {
				filtered = append(filtered, scope)
			}
		}
		scopes = filtered
		if !contains(scopes, "read:user") {
			scopes = append([]string{"read:user"}, scopes...)
		}
		if !contains(scopes, "user:email") {
			scopes = append(scopes, "user:email")
		}
	}
	return &Provider{
		kind: conf.OIDCProviderGitHub,
		oauth2Config: &oauth2.Config{
			ClientID:     config.ClientID,
			ClientSecret: config.ClientSecret,
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://github.com/login/oauth/authorize",
				TokenURL: "https://github.com/login/oauth/access_token",
			},
			RedirectURL: redirectURL,
			Scopes:      scopes,
		},
	}
}

func isDefaultOIDCScopes(scopes []string) bool {
	if len(scopes) != 3 {
		return false
	}
	return contains(scopes, oidc.ScopeOpenID) && contains(scopes, "profile") && contains(scopes, "email")
}

func exchangeGitHubClaims(ctx context.Context, token *oauth2.Token) (map[string]any, error) {
	client := oauth2.NewClient(ctx, oauth2.StaticTokenSource(token))
	user := map[string]any{}
	if err := getGitHubJSON(ctx, client, "https://api.github.com/user", &user); err != nil {
		return nil, fmt.Errorf("load GitHub user failed: %w", err)
	}
	delete(user, "email")
	if id, ok := user["id"]; ok {
		user["sub"] = fmt.Sprint(id)
	}
	emails := []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}{}
	if err := getGitHubJSON(ctx, client, "https://api.github.com/user/emails", &emails); err == nil {
		all := make([]string, 0, len(emails))
		for _, email := range emails {
			if !email.Verified {
				continue
			}
			all = append(all, email.Email)
			if email.Primary {
				user["email"] = email.Email
				user["email_verified"] = true
			}
		}
		user["emails"] = all
	}
	return user, nil
}

func getGitHubJSON(ctx context.Context, client *http.Client, endpoint string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	request.Header.Set("User-Agent", "SiYuan")
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("GitHub API returned status %d", response.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1024*1024))
	decoder.UseNumber()
	return decoder.Decode(target)
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
