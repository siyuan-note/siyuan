package model

import (
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"strings"
	"testing"

	"github.com/88250/gulu"
	"github.com/lestrrat-go/jwx/jwa"
	"github.com/lestrrat-go/jwx/jws"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	// PUBKEY used for JWS signature verification (only for testing purposes)
	PUBKEY = `
-----BEGIN RSA PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu/TwSPImYo/YsDmjhKK+
kPcm9gfxNRqZH8pzE3HxAeN5UIQoWu8VYOCAI26IN+e7rSa0utirREV8j9rhZt8U
QOLqyaP6UMddw+R/yQUrQ0wYOsQH2bS+GARJ8JX1s7SOF1eM/dVp49efT5BQKANE
GEw6zETEpEgcyeDSJ8seFmDUKdmymFuzDH31c+uJd20IQom4ZlzFsneayHn0kOhJ
C4mswjv9JNltoZ28soEdqbfuAP5dxmlTnjWu2YflLfZbtu1x8y906kTDJE1I+ccD
9VjOAzO6HbzoULYr487h+K0Wbnm62s2Jc0wah0hZG9HRDqzgPE3Hfbb83f51jmwX
tQIDAQAB
-----END RSA PUBLIC KEY-----`

	// PRIVKEY created here (only for testing purposes)
	PRIVKEY = `
-----BEGIN RSA PRIVATE KEY-----
MIIEpQIBAAKCAQEAu/TwSPImYo/YsDmjhKK+kPcm9gfxNRqZH8pzE3HxAeN5UIQo
Wu8VYOCAI26IN+e7rSa0utirREV8j9rhZt8UQOLqyaP6UMddw+R/yQUrQ0wYOsQH
2bS+GARJ8JX1s7SOF1eM/dVp49efT5BQKANEGEw6zETEpEgcyeDSJ8seFmDUKdmy
mFuzDH31c+uJd20IQom4ZlzFsneayHn0kOhJC4mswjv9JNltoZ28soEdqbfuAP5d
xmlTnjWu2YflLfZbtu1x8y906kTDJE1I+ccD9VjOAzO6HbzoULYr487h+K0Wbnm6
2s2Jc0wah0hZG9HRDqzgPE3Hfbb83f51jmwXtQIDAQABAoIBACsz6edagag2GECp
fwSFw/feV35F5ROnwXqlNj5J+nPMrZ3sQrpkKi3SbKG4TmdLRMBQHUq1cuiGcFNA
pH7Y1/byMbWXk3nt2YelhhnWrlMRsqAPXx6ThP5QPg6m6Ysc/WwwG6Bc5bIRZfUL
3uDTn1tWak15oRmB2dwtaSDsd0X9Ju3CeJtEiTrKIL0LUnrkPQqp3gcHfgSNELyv
ECPahib96wXjnZPELczFNz7ONB7d+xnGSpxPk1PQPSco3c3STo1IYyGTMxOzSrwg
E/y70uXCaDV1G91SqIUAvqDyEfrysJOVq2xlyRibK2NvJJXzVlvr/Bo9S6UbVOq+
FnBsOiECgYEA2IouqVNKcX1EzlhdbyO2btoGYYr/bcZHiu1flWS5XV9B0zPCtjou
26i69CBtXBVV7vSQD1/3Fgm30Jq8GDnDIWN2NRwCdWpQTgTIM1FrJDxt2rPjgA3r
t1n1OvE34fQYcFyjPmQppt+rIZJUdbw/GtzTVzBKzUaDQIc1YGyr1LMCgYEA3jVU
MJlFYr5Xi9zylJRQF3ShpSaWxBKcMNzfsaWLVbDVepixgLUSI9V8nUTmKX9pCEwr
V7yafSYJeck67Q+pKTPxURBwwnm6kWlLcEG3pg0eYBMhtVR/p+3CX/4iTW0MorM+
gd3O445BDrusYF0gktwF/dxne5oxhquRur+MJfcCgYEAjxEdKzqgoMMHRt4TPW73
Bd5/AMt5X+n1MtEKqgXWgt6A+y3jo8plUzPz8X/LQV/HWw2ycLYS5jidffH9/HON
fO3eF9Ddvv3y+Nkn/N/6TgKvAiSAVwbbilShNcRSC7Pewb4zDPHYoyx8QL4Rl4g8
mV71M1Hw2heQeH3cwkyKawkCgYEAwM/ffMgSWAs35gnTiC9li+TNOoPQgNRxKUkO
5ZPy4mkt5FJIe5ki42sk1UZqvQlsdyG43kmud/egc0e0VO2o6DLFK4UrguSjifem
2QJ9O53YhJ81OaXXmzyI1EitNSfxtd/41jFEi1ntg74/ZeKJGEXJAS3VsX/rh6Kq
MjRxhKMCgYEArS+VYpq+CwpNpO1oI4QxyLp7g+3LakxJCM0CRuyxOLbVvoztkgA3
oPc4Ne1pfvzdIxGr+pEqa1QHK7hTw9Llla9aBLLovZZ6RVHg7JlIEx1fgzD39Y8R
mFGDSNogjXLC/fOXuju9All0KvD5ou8G85ZYzlsGQRFNK7IL9jASKyo=
-----END RSA PRIVATE KEY-----
	`
)

func TestLoadUserData(t *testing.T) {
	// rewrite SiYuans public key with test key
	util.JWSPubKey = PUBKEY
	// create test userdata
	ud := &conf.User{
		UserId:                     "1234",
		UserName:                   "siyuan",
		UserSiYuanOneTimePayStatus: 0,
	}
	data, _ := gulu.JSON.MarshalJSON(ud)
	Conf = &AppConf{
		UserData: util.AESEncrypt(string(data)),
	}
	// test unmarshaling of legacy userdata
	// this should return the user struct based on the unsigned userdata JSON string
	userLegacy := loadUserFromConf()
	if userLegacy == nil {
		t.Fatalf("nil user struct returned from legacy JSON")
	}
	if userLegacy.UserId != "1234" ||
		userLegacy.UserName != "siyuan" ||
		userLegacy.UserSiYuanOneTimePayStatus != 0 {
		t.Fatalf("wrong userdata returned")
	}

	/*
		prepare signed userdata from legacy user data
		private key and public key PEM data can be created like this

			privkey, err := rsa.GenerateKey(rand.Reader, 2048)
			if err != nil {
				log.Printf("failed to create private key: %s", err)
				return
			}
			privkey_bytes := x509.MarshalPKCS1PrivateKey(privkey)
			privkey_pem := pem.EncodeToMemory(
				&pem.Block{
					Type:  "RSA PRIVATE KEY",
					Bytes: privkey_bytes,
				},
			)
			fmt.Println(string(privkey_pem))

			pubkey_bytes, err := x509.MarshalPKIXPublicKey(&privkey.PublicKey)
			pubkey_pem := pem.EncodeToMemory(
				&pem.Block{
					Type:  "RSA PUBLIC KEY",
					Bytes: pubkey_bytes,
				},
			)
			fmt.Println(string(pubkey_pem))
	*/
	pkpem, _ := pem.Decode([]byte(PRIVKEY))
	if pkpem == nil {
		t.Fatalf("unable to decode private key")
	}
	priv, err := x509.ParsePKCS1PrivateKey(pkpem.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	data, _ = gulu.JSON.MarshalJSON(userLegacy)
	// create our signed userdata JWS
	signed, err := jws.Sign(data, jwa.RS256, priv)
	if err != nil {
		t.Fatal(err)
	}
	Conf.UserData = util.AESEncrypt(string(signed))

	// test loading of valid signed user data
	// this should return the user struct of the legacy user
	userSigned := loadUserFromConf()
	if userSigned == nil {
		t.Fatalf("nil user struct returned from signed JWS payload")
	}
	if userSigned.UserId != "1234" ||
		userSigned.UserName != "siyuan" ||
		userSigned.UserSiYuanOneTimePayStatus != 0 {
		t.Fatalf("wrong user struct returned")
	}

	// test loading of forged (invalid) signed userdata
	// in this case the userdata had been manipulated to enable one time payment
	// since the signature verification failed an empty nil user struct will be returned
	jwsdata := strings.Split(string(signed), ".")
	userLegacy.UserSiYuanOneTimePayStatus = 1
	data, _ = gulu.JSON.MarshalJSON(userLegacy)
	// the second index of the JWS contains the base64 encoded payload, i.e. the userdata JSON string
	jwsdata[1] = base64.StdEncoding.EncodeToString(data)
	Conf.UserData = util.AESEncrypt(strings.Join(jwsdata, "."))
	userForged := loadUserFromConf()
	if userForged != nil {
		t.Fatalf("forged user data should return nil user struct")
	}
}
