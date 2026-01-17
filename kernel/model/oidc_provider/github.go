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

package oidcprovider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
)

type oidcProviderGitHub struct {
	providerLabel string
	scopes       []string
	clientID     string
	clientSecret string
	redirectURL  string
}

func NewGitHub(cfg *conf.OIDCProviderConf) (Provider, error) {
	clientID := strings.TrimSpace(cfg.ClientID)
	if "" == clientID {
		return nil, errors.New("GitHub clientID is required")
	}

	clientSecret := strings.TrimSpace(cfg.ClientSecret)
	if "" == clientSecret {
		return nil, errors.New("GitHub clientSecret is required")
	}

	label := strings.TrimSpace(cfg.ProviderLabel)
	if label == "" {
		label = "Login with GitHub"
	}

	return &oidcProviderGitHub{
		providerLabel: label,
		scopes:       cfg.Scopes,
		clientID:     clientID,
		clientSecret: clientSecret,
		redirectURL:  strings.TrimSpace(cfg.RedirectURL),
	}, nil
}

func (p *oidcProviderGitHub) ID() string {
	return "github"
}

func (p *oidcProviderGitHub) Label() string {
	return p.providerLabel
}

func (p *oidcProviderGitHub) AuthURL(state, nonce string) string {
	conf := p.oauthConfig()
	// GitHub does not support nonce in the standard way OIDC does, so we just use state
	return conf.AuthCodeURL(state)
}

func (p *oidcProviderGitHub) HandleCallback(ctx context.Context, code, nonce string) (*OIDCClaims, error) {
	conf := p.oauthConfig()
	token, err := conf.Exchange(ctx, code)
	if err != nil {
		return nil, err
	}

	client := conf.Client(ctx, token)
	rawUser, err := fetchUser(ctx, client)
	if err != nil {
		return nil, err
	}

	// GitHub user ID is unique per account, we use it as the subject
	// user ID is an integer
	subject := ""
	if id, ok := rawUser["id"].(float64); ok {
		subject = strconv.FormatFloat(id, 'f', 0, 64)
	}

	email := claimString(rawUser, "email")
	var emailVerified *bool
	// fetchUser only exposes the public email, same as in your github profile.
	// fetchPrimaryEmail includes the primary email even when it's private.
	if primaryEmail, verified, err := fetchPrimaryEmail(ctx, client); err != nil {
		logging.LogWarnf("failed to fetch GitHub primary email: %s", err)
	} else if primaryEmail != "" {
		email = primaryEmail
		emailVerified = verified
	}

	claims := &OIDCClaims{
		Provider:          "github",
		Subject:           subject,
		Issuer:            "https://github.com",
		Email:             email,
		EmailVerified:     emailVerified,
		PreferredUsername: claimString(rawUser, "login"),
		Name:              claimString(rawUser, "name"),
	}
	return claims, nil
}

func (p *oidcProviderGitHub) oauthConfig() *oauth2.Config {
	scopes := p.scopes
	if len(scopes) == 0 {
		scopes = []string{"read:user", "user:email"}
	}
	return &oauth2.Config{
		ClientID:     p.clientID,
		ClientSecret: p.clientSecret,
		RedirectURL:  p.redirectURL,
		Scopes:       scopes,
		Endpoint:     github.Endpoint,
	}
}

type githubEmailEntry struct {
	Email    string `json:"email"`
	Primary  bool   `json:"primary"`
	Verified bool   `json:"verified"`
}

func fetchUser(ctx context.Context, client *http.Client) (map[string]any, error) {
	var user map[string]any
	const userURL = "https://api.github.com/user"
	if err := fetchGithubJSON(ctx, client, userURL, &user); err != nil {
		return nil, err
	}
	return user, nil
}

func fetchPrimaryEmail(ctx context.Context, client *http.Client) (string, *bool, error) {
	var entries []githubEmailEntry
	const emailURL = "https://api.github.com/user/emails"
	if err := fetchGithubJSON(ctx, client, emailURL, &entries); err != nil {
		return "", nil, err
	}

	for _, entry := range entries {
		if entry.Primary && entry.Email != "" {
			verified := entry.Verified
			return entry.Email, &verified, nil
		}
	}
	for _, entry := range entries {
		if entry.Email != "" {
			verified := entry.Verified
			return entry.Email, &verified, nil
		}
	}
	return "", nil, nil
}

func fetchGithubJSON(ctx context.Context, client *http.Client, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return errors.New("GitHub API returned " + resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
