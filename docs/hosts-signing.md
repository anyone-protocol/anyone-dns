# Signed hosts document

When `HIDDEN_SERVICE_SECRET_KEY` is set, `GET /tld/anyone` returns a signed anyone-hosts
document. [`src/util/anyone-hosts-signer.ts`](../src/util/anyone-hosts-signer.ts) builds it.

## Document layout

```
anyone-hosts-version 1
anyone-hosts-status signed
published <YYYY-MM-DD hh:mm:ss>
valid-until <YYYY-MM-DD hh:mm:ss>

<domain> <hidden service address>
...

anyone-hosts-digest sha256 <hex>
anyone-hosts-signature <signer address>
-----BEGIN SIGNATURE-----
<base64, wrapped at 64 characters>
-----END SIGNATURE-----
```

| Part | Rule |
| --- | --- |
| Timestamps | UTC |
| Mapping lines | Sorted in ascending byte order |
| `anyone-hosts-digest` | SHA-256 of the mapping block, lines joined with LF |
| Signed region | From the first byte of `anyone-hosts-version` through the LF that ends the `anyone-hosts-signature` line |
| Signature | Ed25519 over `"anyone-hosts-signature" \|\| sha256(signed region)` |

The mapping lines are emitted in sorted order, so a verifier can recompute the digest from the
block as received.

## Secret key

`HIDDEN_SERVICE_SECRET_KEY` is the base64 of a Tor v3 `hs_ed25519_secret_key` file.

| Bytes | Content |
| --- | --- |
| 32 | Header: `== ed25519v1-secret: type0 ==` followed by three zero bytes |
| 32 | Scalar `a` |
| 32 | Nonce prefix |

Tor stores the expanded key and not the 32-byte seed that most Ed25519 libraries take, so the
service signs from the scalar and prefix directly.

- The stored scalar is a clamped 255-bit value and can exceed the curve order `L`. It is
  reduced modulo `L` before use. The public key and every signature are unchanged by the
  reduction.
- The nonce is `r = sha512(prefix || message) mod L`. For `r = 0` the point `R` is computed
  from `L`, which is the same group element, and `S` uses `r` unchanged.
- The signature is `R || S` with `S = (r + k * a) mod L` and `k = sha512(R || publicKey || message) mod L`.

## Signer address

The signer address is the hidden service address derived from the public key. When
`HIDDEN_SERVICE_HOSTNAME` is also set, the two must match.

## Database

`HiddenServiceRecordEntity` mirrors a table whose schema belongs to `uns-record-indexer`. The
mirror is maintained by hand. `synchronize` stays disabled for it.
