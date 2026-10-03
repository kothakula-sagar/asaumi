// ONE TIME ONLY: creates the permanent Android signing key (needs only Node, no Java).
// Every APK signed with this key installs over the previous one, so updates never need an uninstall.
//   node scripts/make-signing-key.js
// The key is written OUTSIDE the project folder. Paste the two .txt files into GitHub secrets
// (ANDROID_SIGNING_KEY and ANDROID_SIGNING_CERT). Never upload them to the repository. Keep a backup:
// if the key is lost, the next update needs one more uninstall.
const crypto = require("crypto"), fs = require("fs"), path = require("path");

const outDir = process.argv[2] || path.join(__dirname, "..", "..", "asaumi-signing-key");
if (fs.existsSync(path.join(outDir, "ANDROID_SIGNING_KEY.txt"))) {
  console.error(`A key already exists in ${outDir}. Not overwriting it.`);
  process.exit(1);
}

/* --- minimal DER encoding, enough for one self-signed X.509 certificate --- */
const len = n => {
  if (n < 128) return Buffer.from([n]);
  const b = [];
  while (n) { b.unshift(n & 255); n = Math.floor(n / 256); }
  return Buffer.from([0x80 | b.length, ...b]);
};
const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const seq = (...p) => tlv(0x30, ...p);
const set = (...p) => tlv(0x31, ...p);
const int = buf => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const oid = s => {
  const a = s.split(".").map(Number);
  const out = [a[0] * 40 + a[1]];
  for (let v of a.slice(2)) {
    const bytes = [v & 127];
    while ((v = Math.floor(v / 128))) bytes.unshift((v & 127) | 128);
    out.push(...bytes);
  }
  return tlv(0x06, Buffer.from(out));
};
const utf8 = s => tlv(0x0c, Buffer.from(s, "utf8"));
const stamp = d => d.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
const utcTime = d => tlv(0x17, Buffer.from(stamp(d).slice(2)));   // years before 2050
const genTime = d => tlv(0x18, Buffer.from(stamp(d)));            // years from 2050

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 3072 });
const algo = seq(oid("1.2.840.113549.1.1.11"), tlv(0x05)); // sha256WithRSAEncryption
const name = seq(set(seq(oid("2.5.4.3"), utf8("Asaumi"))), set(seq(oid("2.5.4.10"), utf8("Asaumi"))));
const serial = crypto.randomBytes(16);
serial[0] = (serial[0] & 0x7f) | 0x01; // positive, no leading zero
const from = new Date(), to = new Date(from.getTime() + 50 * 365.25 * 864e5);

const tbs = seq(
  tlv(0xa0, int(Buffer.from([2]))),   // X.509 v3
  int(serial),
  algo,
  name,
  seq(utcTime(from), genTime(to)),
  name,
  publicKey.export({ type: "spki", format: "der" })
);
const cert = seq(tbs, algo, tlv(0x03, Buffer.concat([Buffer.from([0]), crypto.sign("sha256", tbs, privateKey)])));

// sanity check: the certificate parses and its signature is valid
const x = new crypto.X509Certificate(cert);
if (!x.verify(publicKey)) throw new Error("certificate self-check failed");

const pk8 = privateKey.export({ type: "pkcs8", format: "der" });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "ANDROID_SIGNING_KEY.txt"), pk8.toString("base64"));
fs.writeFileSync(path.join(outDir, "ANDROID_SIGNING_CERT.txt"), cert.toString("base64"));
fs.writeFileSync(path.join(outDir, "KEEP-THIS-FOLDER-SAFE.txt"),
  `Permanent signing key for the Asaumi Android app (created ${from.toISOString().slice(0, 10)}).

GitHub repository -> Settings -> Secrets and variables -> Actions -> New repository secret:
  Name ANDROID_SIGNING_KEY   value = the whole text of ANDROID_SIGNING_KEY.txt
  Name ANDROID_SIGNING_CERT  value = the whole text of ANDROID_SIGNING_CERT.txt

Never upload these files to GitHub as files. Keep a copy of this folder (e.g. on a pen drive):
if the key is lost, the next update needs one more uninstall.
Certificate SHA-256: ${x.fingerprint256}
`);
console.log(`Signing key created in ${outDir}`);
console.log(`Certificate SHA-256: ${x.fingerprint256}`);
