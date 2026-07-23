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

package model

import (
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestIsPublishServiceToken(t *testing.T) {
	tests := []struct {
		name      string
		token     *jwt.Token
		isPublish bool
	}{
		{name: "nil"},
		{
			name: "invalid",
			token: &jwt.Token{
				Claims: jwt.MapClaims{"iss": iss, "aud": publishServiceAudience},
			},
		},
		{
			name: "wrong issuer",
			token: &jwt.Token{
				Valid:  true,
				Claims: jwt.MapClaims{"iss": "other", "aud": publishServiceAudience},
			},
		},
		{
			name: "wrong audience",
			token: &jwt.Token{
				Valid:  true,
				Claims: jwt.MapClaims{"iss": iss, "aud": "siyuan-kernel-plugin"},
			},
		},
		{
			name: "publish audience",
			token: &jwt.Token{
				Valid:  true,
				Claims: jwt.MapClaims{"iss": iss, "aud": publishServiceAudience},
			},
			isPublish: true,
		},
		{
			name: "publish audience list",
			token: &jwt.Token{
				Valid:  true,
				Claims: jwt.MapClaims{"iss": iss, "aud": []string{"other", publishServiceAudience}},
			},
			isPublish: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := IsPublishServiceToken(test.token); actual != test.isPublish {
				t.Fatalf("IsPublishServiceToken() = %v, want %v", actual, test.isPublish)
			}
		})
	}
}
