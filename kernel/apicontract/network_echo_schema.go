package apicontract

import (
	"fmt"
	"reflect"
)

func networkEchoSchema(b *schemaBuilder, t reflect.Type) (*Schema, error) {
	if _, exists := b.definitions["NetworkEchoConnectionState"]; !exists {
		extra, err := b.schema(reflect.TypeFor[JSONValue](), false)
		if err != nil {
			return nil, err
		}
		for name, schema := range networkEchoDefinitions() {
			if name != "NetworkEchoUserinfo" {
				schema.AdditionalProperties = extra
			}
			b.definitions[name] = schema
		}
	}
	switch t {
	case reflect.TypeFor[NetworkEchoTLS]():
		return networkEchoRef("ConnectionState"), nil
	case reflect.TypeFor[NetworkEchoURL]():
		return networkEchoRef("URL"), nil
	case reflect.TypeFor[NetworkEchoCookies]():
		return networkEchoArray(nullable(networkEchoRef("Cookie"))), nil
	}
	return nil, fmt.Errorf("unsupported network echo wrapper: %s", t)
}

func networkEchoRef(name string) *Schema {
	return &Schema{Ref: "#/$defs/NetworkEcho" + name}
}

func networkEchoArray(item *Schema) *Schema {
	return nullable(&Schema{Type: "array", Items: item})
}

func networkEchoObject(properties map[string]*Schema) *Schema {
	return object(properties, sortedKeys(properties)...)
}

// 诊断字段以 Go 1.26 的已发布 JSON 结构为基线，变更契约时同步维护这些声明和兼容性用例。
func networkEchoDefinitions() map[string]*Schema {
	integer := &Schema{Type: "integer"}
	text := &Schema{Type: "string"}
	boolean := &Schema{Type: "boolean"}
	bytes := nullable(text)
	texts := networkEchoArray(text)
	oid := networkEchoArray(integer)
	bigInt := nullable(integer)
	publicKey := &Schema{AnyOf: []*Schema{{Type: "null"}, text, networkEchoRef("RSAPublicKey"), networkEchoRef("ECDSAPublicKey"), networkEchoRef("DSAPublicKey")}}
	asn1Value := &Schema{AnyOf: []*Schema{{Type: "null"}, text, integer, boolean, {Type: "array", Items: integer}, networkEchoRef("RawValue"), networkEchoRef("BitString")}}
	return map[string]*Schema{
		"NetworkEchoConnectionState": networkEchoObject(map[string]*Schema{
			"Version": integer, "HandshakeComplete": boolean, "DidResume": boolean, "CipherSuite": integer,
			"CurveID": integer, "HelloRetryRequest": boolean, "NegotiatedProtocol": text,
			"NegotiatedProtocolIsMutual": boolean, "ServerName": text, "ECHAccepted": boolean,
			"PeerCertificates":            networkEchoArray(nullable(networkEchoRef("Certificate"))),
			"VerifiedChains":              networkEchoArray(networkEchoArray(nullable(networkEchoRef("Certificate")))),
			"SignedCertificateTimestamps": networkEchoArray(bytes), "OCSPResponse": bytes, "TLSUnique": bytes,
		}),
		"NetworkEchoCertificate": networkEchoObject(map[string]*Schema{
			"Raw": bytes, "RawTBSCertificate": bytes, "RawSubjectPublicKeyInfo": bytes,
			"RawSubject": bytes, "RawIssuer": bytes, "Signature": bytes, "SignatureAlgorithm": integer,
			"PublicKeyAlgorithm": integer, "PublicKey": publicKey, "Version": integer, "SerialNumber": bigInt,
			"Issuer": networkEchoRef("Name"), "Subject": networkEchoRef("Name"), "NotBefore": text, "NotAfter": text,
			"KeyUsage": integer, "Extensions": networkEchoArray(networkEchoRef("Extension")),
			"ExtraExtensions":             networkEchoArray(networkEchoRef("Extension")),
			"UnhandledCriticalExtensions": networkEchoArray(oid), "ExtKeyUsage": networkEchoArray(integer),
			"UnknownExtKeyUsage": networkEchoArray(oid), "BasicConstraintsValid": boolean, "IsCA": boolean,
			"MaxPathLen": integer, "MaxPathLenZero": boolean, "SubjectKeyId": bytes, "AuthorityKeyId": bytes,
			"OCSPServer": texts, "IssuingCertificateURL": texts, "DNSNames": texts, "EmailAddresses": texts,
			"IPAddresses": texts, "URIs": networkEchoArray(nullable(networkEchoRef("URL"))),
			"PermittedDNSDomainsCritical": boolean, "PermittedDNSDomains": texts, "ExcludedDNSDomains": texts,
			"PermittedIPRanges":       networkEchoArray(nullable(networkEchoRef("IPNet"))),
			"ExcludedIPRanges":        networkEchoArray(nullable(networkEchoRef("IPNet"))),
			"PermittedEmailAddresses": texts, "ExcludedEmailAddresses": texts,
			"PermittedURIDomains": texts, "ExcludedURIDomains": texts, "CRLDistributionPoints": texts,
			"PolicyIdentifiers": networkEchoArray(oid), "Policies": texts,
			"InhibitAnyPolicy": integer, "InhibitAnyPolicyZero": boolean,
			"InhibitPolicyMapping": integer, "InhibitPolicyMappingZero": boolean,
			"RequireExplicitPolicy": integer, "RequireExplicitPolicyZero": boolean,
			"PolicyMappings": networkEchoArray(networkEchoRef("PolicyMapping")),
		}),
		"NetworkEchoURL": networkEchoObject(map[string]*Schema{
			"Scheme": text, "Opaque": text, "User": nullable(networkEchoRef("Userinfo")), "Host": text,
			"Path": text, "RawPath": text, "OmitHost": boolean, "ForceQuery": boolean,
			"RawQuery": text, "Fragment": text, "RawFragment": text,
		}),
		"NetworkEchoUserinfo": networkEchoObject(map[string]*Schema{}),
		"NetworkEchoCookie": networkEchoObject(map[string]*Schema{
			"Name": text, "Value": text, "Quoted": boolean, "Path": text, "Domain": text, "Expires": text,
			"RawExpires": text, "MaxAge": integer, "Secure": boolean, "HttpOnly": boolean,
			"SameSite": integer, "Partitioned": boolean, "Raw": text, "Unparsed": texts,
		}),
		"NetworkEchoName": networkEchoObject(map[string]*Schema{
			"Country": texts, "Organization": texts, "OrganizationalUnit": texts, "Locality": texts,
			"Province": texts, "StreetAddress": texts, "PostalCode": texts, "SerialNumber": text, "CommonName": text,
			"Names":      networkEchoArray(networkEchoRef("AttributeTypeAndValue")),
			"ExtraNames": networkEchoArray(networkEchoRef("AttributeTypeAndValue")),
		}),
		"NetworkEchoAttributeTypeAndValue": networkEchoObject(map[string]*Schema{"Type": oid, "Value": asn1Value}),
		"NetworkEchoExtension":             networkEchoObject(map[string]*Schema{"Id": oid, "Critical": boolean, "Value": bytes}),
		"NetworkEchoIPNet":                 networkEchoObject(map[string]*Schema{"IP": text, "Mask": bytes}),
		"NetworkEchoPolicyMapping":         networkEchoObject(map[string]*Schema{"IssuerDomainPolicy": text, "SubjectDomainPolicy": text}),
		"NetworkEchoRSAPublicKey":          networkEchoObject(map[string]*Schema{"N": bigInt, "E": integer}),
		"NetworkEchoECDSAPublicKey": networkEchoObject(map[string]*Schema{
			"X": bigInt, "Y": bigInt,
			"Curve": nullable(&Schema{AnyOf: []*Schema{networkEchoObject(map[string]*Schema{}), networkEchoRef("CurveParams")}}),
		}),
		"NetworkEchoDSAPublicKey": networkEchoObject(map[string]*Schema{"P": bigInt, "Q": bigInt, "G": bigInt, "Y": bigInt}),
		"NetworkEchoParameters":   networkEchoObject(map[string]*Schema{"P": bigInt, "Q": bigInt, "G": bigInt}),
		"NetworkEchoCurveParams": networkEchoObject(map[string]*Schema{
			"P": bigInt, "N": bigInt, "B": bigInt, "Gx": bigInt, "Gy": bigInt, "BitSize": integer, "Name": text,
		}),
		"NetworkEchoRawValue": networkEchoObject(map[string]*Schema{
			"Class": integer, "Tag": integer, "IsCompound": boolean, "Bytes": bytes, "FullBytes": bytes,
		}),
		"NetworkEchoBitString": networkEchoObject(map[string]*Schema{"Bytes": bytes, "BitLength": integer}),
	}
}
