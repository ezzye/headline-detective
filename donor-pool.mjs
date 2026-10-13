import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, chmodSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DONOR_CONSENT_VERSION = 'public-provider-pool-v1';
export const PROVIDERS = Object.freeze({
  deepseek: Object.freeze({ unit: 'tokens', endpoint: 'https://api.deepseek.com/chat/completions', maxRequestUnits: 65536 }),
  elevenlabs: Object.freeze({ unit: 'characters', endpoint: 'https://api.elevenlabs.io/v1/text-to-speech/', maxRequestUnits: 5000 })
});
const DEFAULT_CAPS = Object.freeze({
  deepseek: { dailyCalls: 100, monthlyCalls: 1000, dailyUnits: 100000, monthlyUnits: 1000000 },
  elevenlabs: { dailyCalls: 100, monthlyCalls: 1000, dailyUnits: 30000, monthlyUnits: 300000 }
});
const HERE = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const problem = code => Object.assign(new Error(code), { code });
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw problem(label);
  return value;
}
function providerInfo(provider) {
  if (!Object.hasOwn(PROVIDERS, provider)) throw problem('invalid_provider');
  return PROVIDERS[provider];
}
function strictFields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw problem('invalid_schema');
}
function masterBytes(value) {
  if (Buffer.isBuffer(value) && value.length === 32) return Buffer.from(value);
  if (typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value)) return Buffer.from(value, 'hex');
  if (typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value)) return Buffer.from(value, 'base64');
  throw problem('invalid_master_key');
}
function nonceHash(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{16,160}$/.test(value)) throw problem('invalid_nonce');
  return hash(value);
}
function vaultFile(storagePath) {
  if (typeof storagePath !== 'string' || !path.isAbsolute(storagePath)) throw problem('invalid_storage_path');
  const absolute = path.resolve(storagePath);
  if (absolute === HERE || absolute.startsWith(HERE + path.sep)) throw problem('vault_must_be_outside_app');
  let ancestor = path.dirname(absolute);
  while (true) {
    if (existsSync(path.join(ancestor, '.git'))) throw problem('vault_must_be_outside_git');
    if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) throw problem('vault_symlink_rejected');
    const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
  }
  mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  // /tmp itself may be a platform alias. The final file must not be a symlink.
  const resolved = path.join(realpathSync(path.dirname(absolute)), path.basename(absolute));
  if (existsSync(resolved) && (lstatSync(resolved).isSymbolicLink() || !lstatSync(resolved).isFile())) throw problem('invalid_vault_file');
  if (!existsSync(resolved)) closeSync(openSync(resolved, 'wx', 0o600));
  chmodSync(resolved, 0o600);
  return resolved;
}

/** Private server module. Never serialize a credential callback, log its arguments,
 * or expose this object to browser code. SQLite requires a single durable local
 * filesystem shared by workers on ONE host, not independent Lambda replicas. */
export function createDonorPool({ enabled = false, storagePath, masterKey, clock = Date.now, caps = DEFAULT_CAPS, onReserved, onSettled } = {}) {
  if (!enabled) {
    const disabled = () => { throw problem('pool_disabled'); };
    return Object.freeze({ enabled: false, addDonation: disabled, revoke: disabled, reserve: disabled, settle: disabled, fail: disabled, cooldown: disabled, credentialLease: disabled, withProvider: disabled, status: () => ({ enabled: false, providers: [] }), flush: disabled, close() {} });
  }
  const master = masterBytes(masterKey);
  const limits = {};
  for (const provider of Object.keys(PROVIDERS)) {
    const candidate = caps[provider]; strictFields(candidate, ['dailyCalls', 'monthlyCalls', 'dailyUnits', 'monthlyUnits']);
    limits[provider] = Object.fromEntries(['dailyCalls','monthlyCalls','dailyUnits','monthlyUnits'].map(k => [k, integer(candidate[k], 0, 1000000000, 'invalid_app_caps')]));
  }
  const filename = vaultFile(storagePath);
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS donations (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, secret TEXT NOT NULL, key_hash TEXT NOT NULL, revoke_hash TEXT UNIQUE NOT NULL,
      nonce_hash TEXT UNIQUE NOT NULL, mode TEXT NOT NULL, max_calls INTEGER NOT NULL, max_units INTEGER NOT NULL,
      expires INTEGER NOT NULL, state TEXT NOT NULL, cooldown_until INTEGER NOT NULL DEFAULT 0,
      consent_version TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS leases (
      id TEXT PRIMARY KEY, nonce_hash TEXT UNIQUE NOT NULL, donor_id TEXT NOT NULL, provider TEXT NOT NULL,
      day TEXT NOT NULL, month TEXT NOT NULL, max_units INTEGER NOT NULL, actual_units INTEGER,
      state TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS leases_donor_month ON leases(donor_id,month);
    CREATE INDEX IF NOT EXISTS leases_provider_period ON leases(provider,day,month);`);
  const verify = hash(Buffer.concat([Buffer.from('donor-vault-master-verification-v1'), master]));
  const stored = db.prepare('SELECT value FROM metadata WHERE name=?').get('master_verification');
  if (stored && stored.value !== verify) { db.close(); master.fill(0); throw problem('wrong_master_key'); }
  db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('master_verification', verify);
  // A concurrent first opener must also verify the winning insert.
  if (db.prepare('SELECT value FROM metadata WHERE name=?').get('master_verification').value !== verify) { db.close(); master.fill(0); throw problem('wrong_master_key'); }
  const capsFingerprint = hash(JSON.stringify(limits));
  const storedCaps = db.prepare('SELECT value FROM metadata WHERE name=?').get('app_caps');
  if (storedCaps && storedCaps.value !== capsFingerprint) { db.close(); master.fill(0); throw problem('app_caps_mismatch'); }
  db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('app_caps', capsFingerprint);
  if (db.prepare('SELECT value FROM metadata WHERE name=?').get('app_caps').value !== capsFingerprint) { db.close(); master.fill(0); throw problem('app_caps_mismatch'); }
  const now = () => { const n = Number(clock()); if (!Number.isSafeInteger(n) || n < 0) throw problem('invalid_clock'); return n; };
  const periods = n => { const iso = new Date(n).toISOString(); return { day: iso.slice(0,10), month: iso.slice(0,7) }; };
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const totals = (where, ...args) => db.prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(CASE WHEN state='settled' THEN actual_units ELSE max_units END),0) AS units,
    COALESCE(SUM(CASE WHEN state IN ('reserved','inflight') THEN max_units ELSE 0 END),0) AS reservedUnits,
    SUM(CASE WHEN state IN ('reserved','inflight') THEN 1 ELSE 0 END) AS reservedCalls FROM leases WHERE ${where}`).get(...args);
  const donorTotals = (d, month) => d.mode === 'prepaid_remaining' ? totals('donor_id=?',d.id) : totals('donor_id=? AND month=?',d.id,month);
  const redact = d => { const n = now(), p = periods(n), t = donorTotals(d,p.month);
    return { provider: d.provider, unit: PROVIDERS[d.provider].unit, mode: d.mode, budgetPeriod: d.mode === 'prepaid_remaining' ? 'lifetime' : 'month', maxCalls: d.max_calls, maxUnits: d.max_units, remainingUnits: Math.max(0,d.max_units-t.units),
      ...(d.mode === 'prepaid_remaining' ? {} : {maxCallsPerMonth:d.max_calls,maxUnitsPerMonth:d.max_units}),
      expiresAt: new Date(d.expires).toISOString(), status: d.state !== 'active' ? d.state : d.expires <= n ? 'expired' : d.cooldown_until > n ? 'cooldown' : t.calls >= d.max_calls || t.units >= d.max_units ? 'exhausted' : 'active',
      calls: t.calls, units: t.units, reservedCalls: t.reservedCalls || 0, reservedUnits: t.reservedUnits }; };
  function encrypt(key, id) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', master, iv); cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
    return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
  }
  function decrypt(d) {
    try { const s = JSON.parse(d.secret), decipher = createDecipheriv('aes-256-gcm',master,Buffer.from(s.iv,'base64')); decipher.setAAD(Buffer.from(d.id)); decipher.setAuthTag(Buffer.from(s.tag,'base64')); return Buffer.concat([decipher.update(Buffer.from(s.data,'base64')),decipher.final()]).toString('utf8'); }
    catch { throw problem('vault_decryption_failed'); }
  }
  function tokenDonor(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw problem('invalid_revocation_token');
    const d = db.prepare('SELECT * FROM donations WHERE revoke_hash=?').get(hash(token));
    if (!d) throw problem('invalid_revocation_token'); return d;
  }
  function addDonation(input) {
    strictFields(input, ['provider','key','consent','mode','maxCallsPerMonth','maxUnitsPerMonth','remainingUnits','maxCalls','expiresAt','nonce']);
    const info = providerInfo(input.provider); strictFields(input.consent,['version','publicVisitorUse','ownKey','providerBilling','noEditorialControl']);
    if (input.consent.version !== DONOR_CONSENT_VERSION || ['publicVisitorUse','ownKey','providerBilling','noEditorialControl'].some(k => input.consent[k] !== true)) throw problem('consent_required');
    if (!['capped','pay_as_you_go','prepaid_remaining'].includes(input.mode)) throw problem('invalid_mode');
    // Shape checks do not prove provider validity. The first bounded provider call does.
    if (typeof input.key !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(input.key) || (input.provider === 'deepseek' && !input.key.startsWith('sk-'))) throw problem('invalid_key');
    const prepaid = input.mode === 'prepaid_remaining';
    if (prepaid ? input.maxCallsPerMonth !== undefined || input.maxUnitsPerMonth !== undefined : input.remainingUnits !== undefined || input.maxCalls !== undefined) throw problem('invalid_donor_caps');
    const calls = integer(prepaid ? input.maxCalls : input.maxCallsPerMonth,1,100000,'invalid_donor_caps'), units = integer(prepaid ? input.remainingUnits : input.maxUnitsPerMonth,1,100000000,'invalid_donor_caps');
    if (typeof input.expiresAt !== 'string') throw problem('invalid_expiry');
    const expires = Date.parse(input.expiresAt), n = now(); if (!Number.isSafeInteger(expires) || expires <= n || expires > n + 366 * 86400000) throw problem('invalid_expiry');
    const nonce = nonceHash(input.nonce), id = randomUUID(), token = randomBytes(32).toString('base64url');
    return transaction(() => {
      if (db.prepare('SELECT id FROM donations WHERE nonce_hash=?').get(nonce)) throw problem('donation_replayed');
      const fingerprint = createHmac('sha256',master).update(input.provider + ':' + input.key).digest('hex');
      const previous = db.prepare('SELECT id,state,expires FROM donations WHERE key_hash=?').all(fingerprint);
      if (previous.some(d => (d.state === 'active' && d.expires > n) || db.prepare("SELECT id FROM leases WHERE donor_id=? AND state IN ('reserved','inflight') LIMIT 1").get(d.id))) throw problem('key_already_donated');
      if (db.prepare('SELECT COUNT(*) AS count FROM donations').get().count >= 1000) throw problem('donor_storage_full');
      db.prepare('INSERT INTO donations VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)').run(id,input.provider,encrypt(input.key,id),fingerprint,hash(token),nonce,input.mode,calls,units,expires,'active',DONOR_CONSENT_VERSION,n);
      return { revocationToken: token, ...redact(db.prepare('SELECT * FROM donations WHERE id=?').get(id)), unit: info.unit };
    });
  }
  function revoke(token) { return transaction(() => { const d = tokenDonor(token); db.prepare("UPDATE donations SET state='revoked' WHERE id=?").run(d.id); return { revoked: true }; }); }
  function reserve(input) {
    strictFields(input,['provider','maxUnits','nonce','excludeDonorIds']);
    const info = providerInfo(input.provider), units = integer(input.maxUnits,1,info.maxRequestUnits,'invalid_request_units'), nonce = nonceHash(input.nonce);
    const exclude = input.excludeDonorIds || []; if (!Array.isArray(exclude) || exclude.length > 2 || exclude.some(x => typeof x !== 'string')) throw problem('invalid_exclusions');
    return transaction(() => {
      if (db.prepare('SELECT id FROM leases WHERE nonce_hash=?').get(nonce)) throw problem('request_replayed');
      const n = now(), p = periods(n), cap = limits[input.provider], day = totals('provider=? AND day=?',input.provider,p.day), month = totals('provider=? AND month=?',input.provider,p.month);
      if (day.calls + 1 > cap.dailyCalls || month.calls + 1 > cap.monthlyCalls || day.units + units > cap.dailyUnits || month.units + units > cap.monthlyUnits) throw problem('app_budget_exhausted');
      const donors = db.prepare("SELECT * FROM donations WHERE provider=? AND state='active' AND expires>? AND cooldown_until<=? ORDER BY created,id").all(input.provider,n,n);
      const donor = donors.find(d => { const used = donorTotals(d,p.month); return !exclude.includes(d.id) && used.calls + 1 <= d.max_calls && used.units + units <= d.max_units; });
      if (!donor) throw problem('pool_unavailable');
      const id = randomUUID(); db.prepare('INSERT INTO leases VALUES (?,?,?,?,?,?,?,NULL,?,?)').run(id,nonce,donor.id,input.provider,p.day,p.month,units,'reserved',n);
      return Object.freeze({ id, provider: input.provider, maxUnits: units });
    });
  }
  const lease = id => { if (typeof id !== 'string') throw problem('invalid_lease'); const l = db.prepare('SELECT * FROM leases WHERE id=?').get(id); if (!l) throw problem('invalid_lease'); return l; };
  async function credentialLease(id, callback) {
    if (typeof callback !== 'function') throw problem('invalid_callback');
    const d = transaction(() => { const l = lease(id); if (l.state !== 'reserved') throw problem('lease_already_dispatched'); const donor = db.prepare('SELECT * FROM donations WHERE id=?').get(l.donor_id);
      // Revocation stops dispatch as well as new reservations. Already-dispatched calls may finish.
      const dispatchTime = now(), dispatchPeriods = periods(dispatchTime);
      if (donor.state !== 'active' || donor.expires <= dispatchTime || donor.cooldown_until > dispatchTime || dispatchTime - l.created > 60000 || l.day !== dispatchPeriods.day || l.month !== dispatchPeriods.month) { db.prepare("UPDATE leases SET state='failed',actual_units=max_units WHERE id=?").run(id); return null; }
      db.prepare("UPDATE leases SET state='inflight' WHERE id=?").run(id); return donor; });
    if (!d) throw problem('donor_unavailable');
    let key; try { key = decrypt(d); return await callback(key, PROVIDERS[d.provider]); } finally { key = undefined; }
  }
  function settle(id, actualUnits) { return transaction(() => { const l = lease(id); integer(actualUnits,0,l.max_units,'invalid_actual_units'); if (l.state !== 'inflight') throw problem('lease_not_inflight'); db.prepare("UPDATE leases SET state='settled',actual_units=? WHERE id=?").run(actualUnits,id); return { settled: true, chargedUnits: actualUnits }; }); }
  function fail(id, { kind = 'uncertain', cooldownMs = 60000 } = {}) { return transaction(() => { const l = lease(id); if (!['uncertain','invalid_credentials','rate_limited'].includes(kind)) throw problem('invalid_failure'); integer(cooldownMs,1000,3600000,'invalid_cooldown');
    if (!['reserved','inflight'].includes(l.state)) return { chargedUnits: l.actual_units ?? l.max_units, alreadyFinal: true };
    db.prepare("UPDATE leases SET state='failed',actual_units=max_units WHERE id=?").run(id);
    if (kind === 'invalid_credentials') db.prepare("UPDATE donations SET state='paused' WHERE id=? AND state='active'").run(l.donor_id);
    if (kind === 'rate_limited') db.prepare('UPDATE donations SET cooldown_until=? WHERE id=?').run(now()+cooldownMs,l.donor_id);
    return { chargedUnits: l.max_units }; }); }
  function cooldown(id, milliseconds = 60000) { return fail(id,{kind:'rate_limited',cooldownMs:milliseconds}); }
  async function flush() {
    const row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (row.busy !== 0) throw problem('vault_checkpoint_busy');
    return { checkpointed: true };
  }
  async function withProvider(input, invoke, hooks = {}) {
    strictFields(input,['provider','maxUnits','nonce']); strictFields(hooks,['onReserved','onSettled']);
    if (typeof invoke !== 'function') throw problem('invalid_callback'); nonceHash(input.nonce);
    const reservedHook = hooks.onReserved ?? onReserved, settledHook = hooks.onSettled ?? onSettled;
    if ((reservedHook !== undefined && typeof reservedHook !== 'function') || (settledHook !== undefined && typeof settledHook !== 'function')) throw problem('invalid_callback');
    const persistFinal = async data => { if (settledHook) { try { await settledHook(data); } catch { throw problem('durability_unavailable'); } } };
    const excluded = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const reservation = reserve({ ...input, nonce: attempt ? input.nonce + ':retry1' : input.nonce, excludeDonorIds: excluded });
      excluded.push(lease(reservation.id).donor_id);
      // A remote snapshot ledger MUST save this committed reservation before any fetch.
      if (reservedHook) { try { await reservedHook(reservation); } catch {
        const charge = fail(reservation.id); try { await persistFinal({...reservation,state:'failed',...charge}); } catch {}
        throw problem('durability_unavailable');
      } }
      let result;
      try {
        result = await credentialLease(reservation.id, (key, info) => invoke({ key, info, attempt, maxUnits: reservation.maxUnits }));
      } catch (error) {
        const kind = error?.status === 401 || error?.status === 403 ? 'invalid_credentials' : error?.status === 429 ? 'rate_limited' : 'uncertain';
        const charge = fail(reservation.id,{kind});
        await persistFinal({...reservation,state:'failed',...charge});
        // Only explicit credential rejection / rate limiting permit one different key.
        if (kind === 'uncertain' || attempt === 1) throw problem('provider_unavailable');
        continue;
      }
      // The server validates measured provider usage. Missing/invalid usage is never a refund.
      const validated = result && Number.isSafeInteger(result.actualUnits) && result.actualUnits >= 0 && result.actualUnits <= reservation.maxUnits;
      const charge = validated ? settle(reservation.id,result.actualUnits) : fail(reservation.id);
      await persistFinal({...reservation,state:validated ? 'settled' : 'failed',...charge});
      return result?.value;
    }
    throw problem('provider_unavailable');
  }
  function status(token) {
    if (token !== undefined) return redact(tokenDonor(token));
    const n = now(), p = periods(n); return { enabled: true, providers: Object.keys(PROVIDERS).map(provider => {
      const month = totals('provider=? AND month=?',provider,p.month), day = totals('provider=? AND day=?',provider,p.day);
      const donors = db.prepare('SELECT * FROM donations WHERE provider=?').all(provider);
      return { provider, unit: PROVIDERS[provider].unit, activeDonors: donors.filter(d => redact(d).status === 'active').length,
        monthlyCalls: month.calls, monthlyUnits: month.units, reservedCalls: month.reservedCalls || 0, reservedUnits: month.reservedUnits,
        dailyCalls: day.calls, dailyUnits: day.units, limits: { ...limits[provider] } };
    }) };
  }
  return Object.freeze({ enabled: true, addDonation, revoke, reserve, credentialLease, settle, fail, cooldown, withProvider, status, flush, close() { db.close(); master.fill(0); } });
}
