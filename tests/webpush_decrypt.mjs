// Independent check of the PHP web push code using Node's crypto: decrypts an aes128gcm message
// (RFC 8291) and verifies a VAPID ES256 token (RFC 8292). Reads JSON on stdin from webpush_test.php.
import crypto from 'node:crypto';

const input = JSON.parse(await new Promise(r => { let s = ''; process.stdin.on('data', d => (s += d)); process.stdin.on('end', () => r(s)); }));
const b64u = (s) => Buffer.from(s, 'base64url');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const out = {};

// Decrypt as the browser would.
const body = b64u(input.body);
const salt = body.subarray(0, 16);
const rs = body.readUInt32BE(16);
const idlen = body[20];
const asPublic = body.subarray(21, 21 + idlen);
const ct = body.subarray(21 + idlen);
const ecdh = crypto.createECDH('prime256v1');
ecdh.setPrivateKey(b64u(input.ua_private));
const uaPublic = ecdh.getPublicKey();
const secret = ecdh.computeSecret(asPublic);
const prkKey = hmac(b64u(input.auth), secret);
const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
const prk = hmac(salt, ikm);
const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
const dec = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
dec.setAuthTag(ct.subarray(ct.length - 16));
const plain = Buffer.concat([dec.update(ct.subarray(0, ct.length - 16)), dec.final()]);
out.rs = rs;
out.delimiter = plain[plain.length - 1];
out.plaintext = plain.subarray(0, plain.length - 1).toString('utf8');

// Verify the VAPID token with the public key the server advertises.
const [h, p, sig] = input.jwt.split('.');
const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(input.vapid_public).subarray(1, 33).toString('base64url'), y: b64u(input.vapid_public).subarray(33).toString('base64url') }, format: 'jwk' });
out.jwt_valid = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, b64u(sig));
out.claims = JSON.parse(b64u(p).toString());
process.stdout.write(JSON.stringify(out));
