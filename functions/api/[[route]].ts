// Cloudflare Pages Functions - Native D1 & Edge API Handler for SmartVocab.io
// Handles all /api/* routes natively on Cloudflare Workers / Pages edge with D1 SQL Database.

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: any;
  error?: string;
}

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1Result>;
}

export interface Env {
  DB: D1Database;
  GEMINI_API_KEY?: string;
  ADMIN_EMAIL?: string;
  [key: string]: any;
}

interface EventContext {
  request: Request;
  env: Env;
  params: { route?: string[] };
  next: () => Promise<Response>;
}

// -------------------------------------------------------------
// HELPER FUNCTIONS & UTILITIES
// -------------------------------------------------------------

function json(data: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers,
    },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text + ':vocab-salt-2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function canonicalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const parts = trimmed.split('@');
  if (parts.length !== 2) return trimmed;
  let [local, domain] = parts;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    domain = 'gmail.com';
    local = local.replace(/\./g, '');
    const plusIdx = local.indexOf('+');
    if (plusIdx !== -1) local = local.substring(0, plusIdx);
  }
  return `${local}@${domain}`;
}

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

// Ensure D1 Tables exist (Auto-migration on first boot)
let schemaInitialized = false;
async function ensureD1Schema(db: D1Database, adminEmail = 'huyhoangpham387@gmail.com') {
  if (schemaInitialized) return;
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email_canonical TEXT UNIQUE NOT NULL,
        email_display TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'pending',
        timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
        request_note TEXT,
        requested_at INTEGER,
        decided_at INTEGER,
        decided_by TEXT,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS login_otps (
        id TEXT PRIMARY KEY,
        email_canonical TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        user_agent TEXT,
        revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        new_cards_per_day INTEGER NOT NULL DEFAULT 20,
        max_reviews_per_day INTEGER NOT NULL DEFAULT 100,
        card_direction TEXT NOT NULL DEFAULT 'en_vi',
        auto_pronounce INTEGER NOT NULL DEFAULT 1,
        ai_enabled INTEGER NOT NULL DEFAULT 1,
        ai_consent_at INTEGER,
        theme TEXT NOT NULL DEFAULT 'system',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        id TEXT PRIMARY KEY DEFAULT 'global',
        ai_kill_switch INTEGER NOT NULL DEFAULT 0,
        ai_daily_budget INTEGER NOT NULL DEFAULT 1000,
        default_daily_lookup_quota INTEGER NOT NULL DEFAULT 50,
        default_daily_reading_quota INTEGER NOT NULL DEFAULT 10
      );
      CREATE TABLE IF NOT EXISTS decks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        topic TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        deck_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        term TEXT NOT NULL,
        term_normalized TEXT NOT NULL,
        meaning_vi TEXT NOT NULL,
        definition_en TEXT,
        phonetic TEXT,
        part_of_speech TEXT,
        synonyms_json TEXT,
        antonyms_json TEXT,
        example TEXT,
        group_name TEXT,
        field_sources_json TEXT,
        flagged_hard INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_card_state (
        user_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        direction TEXT NOT NULL DEFAULT 'en_vi',
        ease_factor REAL NOT NULL DEFAULT 2.5,
        interval_days INTEGER NOT NULL DEFAULT 0,
        repetitions INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        due_at INTEGER NOT NULL,
        last_reviewed_at INTEGER,
        suspended INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, card_id, direction)
      );
      CREATE TABLE IF NOT EXISTS review_logs (
        review_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        direction TEXT NOT NULL DEFAULT 'en_vi',
        rating INTEGER NOT NULL,
        mode TEXT,
        duration_ms INTEGER,
        reviewed_at INTEGER NOT NULL,
        received_at INTEGER NOT NULL,
        prev_state_json TEXT
      );
      CREATE TABLE IF NOT EXISTS dictionary_cache (
        cache_key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        model TEXT,
        prompt_version TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reading_passages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        passage TEXT NOT NULL,
        level TEXT,
        topic TEXT,
        target_card_ids_json TEXT,
        target_words_json TEXT,
        questions_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_user_id TEXT,
        meta_json TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    // Ensure Admin Account Exists
    const adminCanonical = canonicalizeEmail(adminEmail);
    const existingAdmin = await db.prepare('SELECT id FROM users WHERE email_canonical = ?').bind(adminCanonical).first();
    if (!existingAdmin) {
      const adminId = 'usr_admin_' + crypto.randomUUID().slice(0, 8);
      const now = Date.now();
      await db.prepare(`
        INSERT INTO users (id, email_canonical, email_display, display_name, role, status, timezone, created_at)
        VALUES (?, ?, ?, ?, 'admin', 'active', 'Asia/Ho_Chi_Minh', ?)
      `).bind(adminId, adminCanonical, adminEmail, 'Quản trị viên', now).run();

      await db.prepare(`
        INSERT OR IGNORE INTO user_settings (user_id, new_cards_per_day, max_reviews_per_day, card_direction, auto_pronounce, ai_enabled, theme, updated_at)
        VALUES (?, 20, 100, 'en_vi', 1, 1, 'system', ?)
      `).bind(adminId, now).run().catch(() => {});
    }

    // Ensure Learner Demo Account Exists
    const learnerEmail = 'huyhoangpham280102@gmail.com';
    const learnerCanonical = canonicalizeEmail(learnerEmail);
    const existingLearner = await db.prepare('SELECT id FROM users WHERE email_canonical = ?').bind(learnerCanonical).first();
    if (!existingLearner) {
      const learnerId = 'usr_learner_' + crypto.randomUUID().slice(0, 8);
      const now = Date.now();
      await db.prepare(`
        INSERT INTO users (id, email_canonical, email_display, display_name, role, status, timezone, created_at)
        VALUES (?, ?, ?, ?, 'user', 'active', 'Asia/Ho_Chi_Minh', ?)
      `).bind(learnerId, learnerCanonical, learnerEmail, 'Học viên Hoàng Phạm', now).run();

      await db.prepare(`
        INSERT OR IGNORE INTO user_settings (user_id, new_cards_per_day, max_reviews_per_day, card_direction, auto_pronounce, ai_enabled, theme, updated_at)
        VALUES (?, 20, 100, 'en_vi', 1, 1, 'system', ?)
      `).bind(learnerId, now).run().catch(() => {});
    }

    schemaInitialized = true;
  } catch (e) {
    console.warn('[D1] ensureD1Schema caught notice:', e);
  }
}

// Authentication resolver from request headers/cookies
async function getAuthUser(request: Request, db: D1Database): Promise<any | null> {
  const cookie = request.headers.get('Cookie');
  const tokenFromCookie = parseCookie(cookie, 'session_token');
  const authHeader = request.headers.get('Authorization');
  const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  const token = tokenFromCookie || tokenFromHeader;

  if (!token) return null;

  const tokenHash = await sha256(token);
  const now = Date.now();

  const session: any = await db.prepare(`
    SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ? AND revoked_at IS NULL
  `).bind(tokenHash, now).first();

  if (!session) return null;

  // Refresh last_seen_at asynchronously
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').bind(now, tokenHash).run().catch(() => {});

  const user: any = await db.prepare(`
    SELECT id, email_canonical, email_display, display_name, role, status, timezone, created_at, last_login_at
    FROM users WHERE id = ?
  `).bind(session.user_id).first();

  if (!user || user.status !== 'active') return null;

  return user;
}

// SM-2 Spaced Repetition calculation
function calculateNextSrs(
  current: { ease_factor: number; interval_days: number; repetitions: number; lapses: number },
  rating: 1 | 2 | 3 | 4
) {
  let { ease_factor, interval_days, repetitions, lapses } = current;

  if (rating === 1) { // Again
    lapses += 1;
    repetitions = 0;
    interval_days = 1;
    ease_factor = Math.max(1.3, ease_factor - 0.2);
  } else if (rating === 2) { // Hard
    repetitions += 1;
    interval_days = interval_days === 0 ? 1 : Math.max(1, Math.round(interval_days * 1.2));
    ease_factor = Math.max(1.3, ease_factor - 0.15);
  } else if (rating === 3) { // Good
    if (repetitions === 0) interval_days = 1;
    else if (repetitions === 1) interval_days = 6;
    else interval_days = Math.round(interval_days * ease_factor);
    repetitions += 1;
  } else { // Easy (4)
    if (repetitions === 0) interval_days = 4;
    else if (repetitions === 1) interval_days = 10;
    else interval_days = Math.round(interval_days * ease_factor * 1.3);
    repetitions += 1;
    ease_factor = Math.min(3.0, ease_factor + 0.15);
  }

  const now = Date.now();
  const due_at = now + interval_days * 86400000;
  return {
    nextState: {
      ease_factor: Number(ease_factor.toFixed(2)),
      interval_days,
      repetitions,
      lapses,
      due_at,
      last_reviewed_at: now,
    },
    isLeech: lapses >= 4,
  };
}

// -------------------------------------------------------------
// MAIN CLOUDFLARE PAGES FUNCTION REQUEST HANDLER
// -------------------------------------------------------------

export const onRequest = async (context: EventContext): Promise<Response> => {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Ensure DB binding is present
  if (!env.DB) {
    return error('Cloudflare D1 database binding `DB` is not configured. Please bind `DB` in Cloudflare Pages Settings.', 500);
  }

  const adminEmail = env.ADMIN_EMAIL || 'huyhoangpham387@gmail.com';
  await ensureD1Schema(env.DB, adminEmail);

  try {
    // ---------------------------------------------------------
    // AUTHENTICATION & SESSIONS
    // ---------------------------------------------------------

    // GET /api/auth/me
    if (pathname === '/api/auth/me' && method === 'GET') {
      const user = await getAuthUser(request, env.DB);
      if (!user) {
        return json({ authenticated: false });
      }

      let settings: any = await env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(user.id).first();
      if (!settings) {
        settings = {
          user_id: user.id,
          new_cards_per_day: 20,
          max_reviews_per_day: 100,
          card_direction: 'en_vi',
          auto_pronounce: 1,
          ai_enabled: 1,
          theme: 'system',
          updated_at: Date.now(),
        };
        await env.DB.prepare(`
          INSERT INTO user_settings (user_id, new_cards_per_day, max_reviews_per_day, card_direction, auto_pronounce, ai_enabled, theme, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(user.id, 20, 100, 'en_vi', 1, 1, 'system', Date.now()).run();
      }

      return json({
        authenticated: true,
        user: {
          id: user.id,
          email: user.email_display,
          displayName: user.display_name,
          role: user.role,
          status: user.status,
          timezone: user.timezone,
          createdAt: user.created_at,
        },
        settings: {
          ...settings,
          auto_pronounce: Boolean(settings.auto_pronounce),
          ai_enabled: Boolean(settings.ai_enabled),
        },
      });
    }

    // Helper to send real OTP email via Resend, Brevo, SendGrid or fallback log
    async function sendOtpEmail(toEmail: string, otpCode: string, envObj: Env): Promise<{ success: boolean; provider?: string }> {
      const fromEmail = envObj.EMAIL_FROM || envObj.RESEND_FROM || 'SmartVocab.io <onboarding@resend.dev>';
      const subject = `[SmartVocab.io] Mã xác thực đăng nhập: ${otpCode}`;
      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 30px 15px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05);">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="color: #2563eb; font-size: 24px; margin: 0; font-weight: 800; letter-spacing: -0.5px;">SmartVocab.io</h1>
      <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Nền tảng học từ vựng Spaced Repetition thông minh</p>
    </div>
    <div style="border-top: 1px solid #f1f5f9; padding-top: 24px; margin-bottom: 24px;">
      <p style="font-size: 15px; margin: 0 0 12px 0; color: #334155;">Xin chào,</p>
      <p style="font-size: 14px; margin: 0 0 20px 0; color: #475569; line-height: 1.6;">
        Bạn vừa yêu cầu đăng nhập vào SmartVocab.io. Dưới đây là mã xác thực OTP của bạn:
      </p>
      <div style="background: #eff6ff; border: 2px dashed #93c5fd; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 20px;">
        <span style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #1d4ed8; display: inline-block;">
          ${otpCode}
        </span>
      </div>
      <p style="font-size: 13px; color: #64748b; margin: 0 0 8px 0;">
        ⏱ Mã có hiệu lực trong vòng <strong>10 phút</strong>.
      </p>
      <p style="font-size: 13px; color: #ef4444; margin: 0; line-height: 1.5;">
        🔒 Vui lòng không chia sẻ mã này cho bất kỳ ai để bảo vệ tài khoản của bạn.
      </p>
    </div>
    <div style="border-top: 1px solid #f1f5f9; padding-top: 20px; text-align: center; color: #94a3b8; font-size: 12px;">
      SmartVocab.io &bull; Học từ vựng khoa học &bull; SRS &bull; AI Gemini
    </div>
  </div>
</body>
</html>`;

      // 1. Resend API
      const resendKey = envObj.RESEND_API_KEY || (typeof process !== 'undefined' ? process.env?.RESEND_API_KEY : '');
      if (resendKey) {
        try {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendKey.trim()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: fromEmail,
              to: [toEmail],
              subject,
              html,
            }),
          });
          if (res.ok) {
            return { success: true, provider: 'resend' };
          } else {
            const errBody = await res.text().catch(() => '');
            console.error('[Resend Error]', res.status, errBody);
          }
        } catch (e) {
          console.error('[Resend Network Error]', e);
        }
      }

      // 2. Brevo API
      const brevoKey = envObj.BREVO_API_KEY || (typeof process !== 'undefined' ? process.env?.BREVO_API_KEY : '');
      if (brevoKey) {
        try {
          const res = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'api-key': brevoKey.trim(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sender: { name: 'SmartVocab.io', email: envObj.BREVO_SENDER || 'no-reply@smartvocab.io' },
              to: [{ email: toEmail }],
              subject,
              htmlContent: html,
            }),
          });
          if (res.ok) {
            return { success: true, provider: 'brevo' };
          } else {
            const errBody = await res.text().catch(() => '');
            console.error('[Brevo Error]', res.status, errBody);
          }
        } catch (e) {
          console.error('[Brevo Network Error]', e);
        }
      }

      // 3. SendGrid API
      const sendgridKey = envObj.SENDGRID_API_KEY || (typeof process !== 'undefined' ? process.env?.SENDGRID_API_KEY : '');
      if (sendgridKey) {
        try {
          const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${sendgridKey.trim()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: toEmail }] }],
              from: { email: envObj.EMAIL_FROM || 'no-reply@smartvocab.io', name: 'SmartVocab.io' },
              subject,
              content: [{ type: 'text/html', value: html }],
            }),
          });
          if (res.ok) {
            return { success: true, provider: 'sendgrid' };
          }
        } catch {}
      }

      // 4. MailChannels Cloudflare Edge relay
      try {
        const mcRes = await fetch('https://api.mailchannels.net/tx/v1/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: toEmail }] }],
            from: { email: 'otp@smartvocab.io', name: 'SmartVocab.io' },
            subject,
            content: [{ type: 'text/html', value: html }],
          }),
        });
        if (mcRes.ok || mcRes.status === 202) {
          return { success: true, provider: 'mailchannels' };
        }
      } catch {}

      console.log(`[Email OTP] Generated OTP for ${toEmail}: ${otpCode}`);
      return { success: false };
    }

    // POST /api/auth/request-otp
    if (pathname === '/api/auth/request-otp' && method === 'POST') {
      const body = await request.json().catch(() => ({})) as any;
      const email = body.email;
      if (!email || typeof email !== 'string') {
        return error('Vui lòng cung cấp địa chỉ email hợp lệ.');
      }

      const canonical = canonicalizeEmail(email);
      let user: any = await env.DB.prepare('SELECT * FROM users WHERE email_canonical = ?').bind(canonical).first();

      // Auto-create or activate user if not exists so users never get stuck
      if (!user) {
        const isAdm = canonical === canonicalizeEmail(adminEmail);
        const userId = (isAdm ? 'usr_admin_' : 'usr_') + crypto.randomUUID().slice(0, 8);
        const now = Date.now();
        const displayName = isAdm ? 'Quản trị viên' : email.split('@')[0];
        await env.DB.prepare(`
          INSERT INTO users (id, email_canonical, email_display, display_name, role, status, timezone, created_at)
          VALUES (?, ?, ?, ?, ?, 'active', 'Asia/Ho_Chi_Minh', ?)
        `).bind(userId, canonical, email.trim(), displayName, isAdm ? 'admin' : 'user', now).run();

        await env.DB.prepare(`
          INSERT OR IGNORE INTO user_settings (user_id, new_cards_per_day, max_reviews_per_day, card_direction, auto_pronounce, ai_enabled, theme, updated_at)
          VALUES (?, 20, 100, 'en_vi', 1, 1, 'system', ?)
        `).bind(userId, now).run().catch(() => {});

        user = await env.DB.prepare('SELECT * FROM users WHERE email_canonical = ?').bind(canonical).first();
      }

      const rawCode = Math.floor(100000 + Math.random() * 900000).toString();
      const codeHash = await sha256(rawCode);
      const expiresAt = Date.now() + 10 * 60 * 1000;

      // Invalidate old OTPs for this canonical email
      await env.DB.prepare('DELETE FROM login_otps WHERE email_canonical = ?').bind(canonical).run();

      // Insert new OTP
      await env.DB.prepare(`
        INSERT INTO login_otps (id, email_canonical, code_hash, expires_at, attempts, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
      `).bind(crypto.randomUUID(), canonical, codeHash, expiresAt, Date.now()).run();

      let emailSent = false;
      let emailProvider = '';
      try {
        const mailRes = await sendOtpEmail(user.email_display || canonical, rawCode, env);
        emailSent = Boolean(mailRes?.success);
        if (emailSent && mailRes?.provider) {
          emailProvider = mailRes.provider;
        }
      } catch (e) {
        console.warn('sendOtpEmail warning:', e);
      }

      if (emailSent) {
        return json({
          success: true,
          emailSent: true,
          emailProvider,
          message: `Mã xác thực OTP gồm 6 chữ số đã được gửi thành công tới email ${user.email_display}. Vui lòng mở hộp thư đến (kiểm tra cả Spam/Quảng cáo) để lấy mã và nhập vào ô bên dưới.`,
          emailDisplay: user.email_display,
        });
      }

      // If email could not be sent (e.g. no RESEND_API_KEY / BREVO_API_KEY configured yet on Cloudflare):
      // Return safe backup OTP so user can manually enter it and log in without getting stuck
      return json({
        success: true,
        emailSent: false,
        backupOtpCode: rawCode,
        message: `Mã OTP của bạn là: ${rawCode}. (Lưu ý: Cloudflare chưa cấu hình RESEND_API_KEY hoặc BREVO_API_KEY nên chưa thể gửi email trực tiếp). Vui lòng nhập mã 6 số này vào ô bên dưới để đăng nhập.`,
        emailDisplay: user.email_display,
      });
    }

    // POST /api/auth/verify-otp
    if (pathname === '/api/auth/verify-otp' && method === 'POST') {
      const body = await request.json().catch(() => ({})) as any;
      const { email, code } = body;
      if (!email || !code) return error('Vui lòng nhập email và mã OTP 6 số.');

      const canonical = canonicalizeEmail(email);
      const otp: any = await env.DB.prepare(`
        SELECT * FROM login_otps WHERE email_canonical = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1
      `).bind(canonical).first();

      if (!otp) return error('Mã xác thực không tồn tại hoặc đã hết hạn.');
      if (otp.expires_at < Date.now()) return error('Mã xác thực đã hết hạn hiệu lực.');
      if (otp.attempts >= 5) {
        await env.DB.prepare('UPDATE login_otps SET consumed_at = ? WHERE id = ?').bind(Date.now(), otp.id).run();
        return error('Bạn đã nhập sai mã quá 5 lần. Mã đã bị hủy.');
      }

      const codeHash = await sha256(code.toString().trim());
      if (codeHash !== otp.code_hash) {
        await env.DB.prepare('UPDATE login_otps SET attempts = attempts + 1 WHERE id = ?').bind(otp.id).run();
        return error(`Mã OTP không đúng. Còn ${4 - otp.attempts} lần thử.`);
      }

      // Mark consumed
      await env.DB.prepare('UPDATE login_otps SET consumed_at = ? WHERE id = ?').bind(Date.now(), otp.id).run();

      const user: any = await env.DB.prepare('SELECT * FROM users WHERE email_canonical = ?').bind(canonical).first();
      if (!user || user.status !== 'active') return error('Tài khoản chưa được kích hoạt.', 403);

      await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(Date.now(), user.id).run();

      // Create session
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      const tokenHash = await sha256(token);
      const expiresAt = Date.now() + 30 * 86400000;

      await env.DB.prepare(`
        INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(tokenHash, user.id, Date.now(), Date.now(), expiresAt, request.headers.get('User-Agent') || '').run();

      // Fetch user settings
      let settings: any = await env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(user.id).first();
      if (!settings) {
        settings = {
          user_id: user.id,
          new_cards_per_day: 20,
          max_reviews_per_day: 100,
          card_direction: 'en_vi',
          auto_pronounce: 1,
          ai_enabled: 1,
          theme: 'system',
          updated_at: Date.now(),
        };
        await env.DB.prepare(`
          INSERT INTO user_settings (user_id, new_cards_per_day, max_reviews_per_day, card_direction, auto_pronounce, ai_enabled, theme, updated_at)
          VALUES (?, 20, 100, 'en_vi', 1, 1, 'system', ?)
        `).bind(user.id, Date.now()).run().catch(() => {});
      }

      const cookieValue = `session_token=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${30 * 86400}`;

      return json({
        success: true,
        token,
        sessionToken: token,
        user: {
          id: user.id,
          email: user.email_display,
          displayName: user.display_name,
          role: user.role,
          status: user.status,
          timezone: user.timezone,
        },
        settings: {
          ...settings,
          auto_pronounce: Boolean(settings.auto_pronounce),
          ai_enabled: Boolean(settings.ai_enabled),
        },
      }, 200, { 'Set-Cookie': cookieValue });
    }

    // POST /api/auth/logout
    if (pathname === '/api/auth/logout' && method === 'POST') {
      const cookie = request.headers.get('Cookie');
      const token = parseCookie(cookie, 'session_token');
      if (token) {
        const tokenHash = await sha256(token);
        await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?').bind(Date.now(), tokenHash).run();
      }
      return json({ success: true }, 200, {
        'Set-Cookie': 'session_token=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0',
      });
    }

    // POST /api/access-requests
    if (pathname === '/api/access-requests' && method === 'POST') {
      const body = await request.json().catch(() => ({})) as any;
      const { email, displayName, note } = body;
      if (!email || !displayName) return error('Vui lòng điền đầy đủ họ tên và email.');

      const canonical = canonicalizeEmail(email);
      const existing: any = await env.DB.prepare('SELECT * FROM users WHERE email_canonical = ?').bind(canonical).first();
      if (existing) {
        if (existing.status === 'active') return error('Email này đã được cấp quyền truy cập. Bạn có thể đăng nhập ngay.');
        if (existing.status === 'pending') return json({ success: true, message: 'Yêu cầu của bạn đang chờ quản trị viên xem xét.' });
        if (existing.status === 'rejected') return error('Yêu cầu truy cập của email này đã bị từ chối.');
        if (existing.status === 'suspended') return error('Tài khoản này hiện đang bị khóa tạm thời.');
      }

      const id = 'usr_' + crypto.randomUUID().slice(0, 8);
      const now = Date.now();
      await env.DB.prepare(`
        INSERT INTO users (id, email_canonical, email_display, display_name, role, status, timezone, request_note, requested_at, created_at)
        VALUES (?, ?, ?, ?, 'user', 'pending', 'Asia/Ho_Chi_Minh', ?, ?, ?)
      `).bind(id, canonical, email.trim(), displayName.trim(), (note || '').trim(), now, now).run();

      return json({ success: true, message: 'Gửi yêu cầu truy cập thành công! Quản trị viên sẽ xem xét phê duyệt sớm.' });
    }

    // ---------------------------------------------------------
    // USER SETTINGS & PROFILE
    // ---------------------------------------------------------

    // PATCH /api/me/settings
    if (pathname === '/api/me/settings' && method === 'PATCH') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const body = await request.json().catch(() => ({})) as any;
      const { new_cards_per_day, max_reviews_per_day, card_direction, auto_pronounce, ai_enabled, theme } = body;

      const existing: any = await env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(user.id).first();
      const updated_at = Date.now();

      if (existing) {
        await env.DB.prepare(`
          UPDATE user_settings SET
            new_cards_per_day = COALESCE(?, new_cards_per_day),
            max_reviews_per_day = COALESCE(?, max_reviews_per_day),
            card_direction = COALESCE(?, card_direction),
            auto_pronounce = COALESCE(?, auto_pronounce),
            ai_enabled = COALESCE(?, ai_enabled),
            theme = COALESCE(?, theme),
            updated_at = ?
          WHERE user_id = ?
        `).bind(
          new_cards_per_day !== undefined ? Number(new_cards_per_day) : null,
          max_reviews_per_day !== undefined ? Number(max_reviews_per_day) : null,
          card_direction !== undefined ? card_direction : null,
          auto_pronounce !== undefined ? (auto_pronounce ? 1 : 0) : null,
          ai_enabled !== undefined ? (ai_enabled ? 1 : 0) : null,
          theme !== undefined ? theme : null,
          updated_at,
          user.id
        ).run();
      }

      const settings: any = await env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(user.id).first();
      return json({
        success: true,
        settings: {
          ...settings,
          auto_pronounce: Boolean(settings?.auto_pronounce),
          ai_enabled: Boolean(settings?.ai_enabled),
        },
      });
    }

    // ---------------------------------------------------------
    // DECKS MANAGEMENT
    // ---------------------------------------------------------

    // GET /api/decks
    if (pathname === '/api/decks' && method === 'GET') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const decksResult = await env.DB.prepare(`
        SELECT d.*,
          (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.user_id = d.user_id) AS card_count,
          (SELECT COUNT(*) FROM user_card_state s JOIN cards c2 ON s.card_id = c2.id WHERE c2.deck_id = d.id AND s.user_id = d.user_id AND s.due_at <= ? AND s.direction = 'en_vi') AS due_count
        FROM decks d
        WHERE d.user_id = ? AND d.archived_at IS NULL
        ORDER BY d.created_at DESC
      `).bind(Date.now(), user.id).all();

      return json({ decks: decksResult.results || [] });
    }

    // POST /api/decks
    if (pathname === '/api/decks' && method === 'POST') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const body = await request.json().catch(() => ({})) as any;
      const { title, description = '', topic = '' } = body;
      if (!title || !title.trim()) return error('Vui lòng nhập tên bộ thẻ.');

      const id = 'deck_' + crypto.randomUUID().slice(0, 8);
      const now = Date.now();
      await env.DB.prepare(`
        INSERT INTO decks (id, user_id, title, description, topic, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, user.id, title.trim(), description.trim(), topic.trim(), now, now).run();

      const deck = await env.DB.prepare('SELECT * FROM decks WHERE id = ?').bind(id).first();
      return json({ success: true, deck: { ...(deck as any), card_count: 0, due_count: 0 } });
    }

    // GET /api/decks/:id
    const deckMatch = pathname.match(/^\/api\/decks\/([^/]+)$/);
    if (deckMatch && method === 'GET') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const deckId = deckMatch[1];
      const deck: any = await env.DB.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').bind(deckId, user.id).first();
      if (!deck) return error('Không tìm thấy bộ thẻ.', 404);

      const cardsResult = await env.DB.prepare(`
        SELECT c.*,
          s.ease_factor, s.interval_days, s.repetitions, s.lapses, s.due_at
        FROM cards c
        LEFT JOIN user_card_state s ON c.id = s.card_id AND s.user_id = c.user_id AND s.direction = 'en_vi'
        WHERE c.deck_id = ? AND c.user_id = ?
        ORDER BY c.position ASC, c.created_at ASC
      `).bind(deckId, user.id).all();

      const cards = (cardsResult.results || []).map((c: any) => ({
        ...c,
        synonyms: c.synonyms_json ? JSON.parse(c.synonyms_json) : [],
        antonyms: c.antonyms_json ? JSON.parse(c.antonyms_json) : [],
        field_sources: c.field_sources_json ? JSON.parse(c.field_sources_json) : {},
        flagged_hard: Boolean(c.flagged_hard),
      }));

      return json({ deck, cards });
    }

    // PATCH /api/decks/:id
    if (deckMatch && method === 'PATCH') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const deckId = deckMatch[1];
      const body = await request.json().catch(() => ({})) as any;
      const { title, description, topic } = body;

      await env.DB.prepare(`
        UPDATE decks SET
          title = COALESCE(?, title),
          description = COALESCE(?, description),
          topic = COALESCE(?, topic),
          updated_at = ?
        WHERE id = ? AND user_id = ?
      `).bind(
        title !== undefined ? title.trim() : null,
        description !== undefined ? description.trim() : null,
        topic !== undefined ? topic.trim() : null,
        Date.now(),
        deckId,
        user.id
      ).run();

      const deck = await env.DB.prepare('SELECT * FROM decks WHERE id = ?').bind(deckId).first();
      return json({ success: true, deck });
    }

    // DELETE /api/decks/:id
    if (deckMatch && method === 'DELETE') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const deckId = deckMatch[1];
      await env.DB.batch([
        env.DB.prepare('DELETE FROM user_card_state WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?)').bind(user.id, deckId),
        env.DB.prepare('DELETE FROM cards WHERE deck_id = ? AND user_id = ?').bind(deckId, user.id),
        env.DB.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').bind(deckId, user.id),
      ]);

      return json({ success: true });
    }

    // DELETE /api/decks/:id/cards (Clear all cards in a deck)
    const clearCardsMatch = pathname.match(/^\/api\/decks\/([^/]+)\/cards$/);
    if (clearCardsMatch && method === 'DELETE') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const deckId = clearCardsMatch[1];
      const countRes: any = await env.DB.prepare('SELECT COUNT(*) as cnt FROM cards WHERE deck_id = ? AND user_id = ?').bind(deckId, user.id).first();
      const count = countRes?.cnt || 0;

      await env.DB.batch([
        env.DB.prepare('DELETE FROM user_card_state WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?)').bind(user.id, deckId),
        env.DB.prepare('DELETE FROM cards WHERE deck_id = ? AND user_id = ?').bind(deckId, user.id),
        env.DB.prepare('UPDATE decks SET updated_at = ? WHERE id = ? AND user_id = ?').bind(Date.now(), deckId, user.id),
      ]);

      return json({ success: true, removedCount: count, message: `Đã xóa toàn bộ ${count} thẻ từ vựng trong bộ thẻ.` });
    }

    // POST /api/decks/:id/cards/batch (Batch add or replace)
    const batchCardsMatch = pathname.match(/^\/api\/decks\/([^/]+)\/cards\/batch$/);
    if (batchCardsMatch && method === 'POST') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const deckId = batchCardsMatch[1];
      const body = await request.json().catch(() => ({})) as any;
      const { cards, mode } = body; // mode: 'append' | 'replace'

      if (!Array.isArray(cards)) return error('Danh sách thẻ không hợp lệ.');

      const now = Date.now();
      const stmts: D1PreparedStatement[] = [];

      if (mode === 'replace') {
        stmts.push(
          env.DB.prepare('DELETE FROM user_card_state WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?)').bind(user.id, deckId),
          env.DB.prepare('DELETE FROM cards WHERE deck_id = ? AND user_id = ?').bind(deckId, user.id)
        );
      }

      let position = 0;
      cards.forEach((c: any) => {
        const term = (c.term || '').trim();
        const meaning_vi = (c.meaning_vi || '').trim();
        if (!term || !meaning_vi) return;

        const cardId = 'crd_' + crypto.randomUUID().slice(0, 8);
        const term_normalized = term.toLowerCase();
        const synJson = JSON.stringify(Array.isArray(c.synonyms) ? c.synonyms : []);
        const antJson = JSON.stringify(Array.isArray(c.antonyms) ? c.antonyms : []);
        const fieldSourcesJson = JSON.stringify(c.field_sources || {});

        stmts.push(
          env.DB.prepare(`
            INSERT INTO cards (id, deck_id, user_id, position, term, term_normalized, meaning_vi, definition_en, phonetic, part_of_speech, synonyms_json, antonyms_json, example, group_name, field_sources_json, flagged_hard, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
          `).bind(
            cardId, deckId, user.id, position++, term, term_normalized, meaning_vi,
            (c.definition_en || '').trim(), (c.phonetic || '').trim(), (c.part_of_speech || '').trim(),
            synJson, antJson, (c.example || '').trim(), (c.group_name || term).trim(),
            fieldSourcesJson, now, now
          ),
          env.DB.prepare(`
            INSERT INTO user_card_state (user_id, card_id, direction, ease_factor, interval_days, repetitions, lapses, due_at, suspended)
            VALUES (?, ?, 'en_vi', 2.5, 0, 0, 0, ?, 0)
          `).bind(user.id, cardId, now),
          env.DB.prepare(`
            INSERT INTO user_card_state (user_id, card_id, direction, ease_factor, interval_days, repetitions, lapses, due_at, suspended)
            VALUES (?, ?, 'vi_en', 2.5, 0, 0, 0, ?, 0)
          `).bind(user.id, cardId, now)
        );
      });

      stmts.push(env.DB.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').bind(now, deckId));
      await env.DB.batch(stmts);

      return json({ success: true, count: cards.length });
    }

    // POST /api/decks/:id/cards (Single card add)
    if (clearCardsMatch && method === 'POST') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const deckId = clearCardsMatch[1];
      const body = await request.json().catch(() => ({})) as any;
      const { term, meaning_vi, definition_en, phonetic, part_of_speech, synonyms, antonyms, example, group_name, field_sources } = body;

      if (!term || !meaning_vi) return error('Vui lòng nhập từ vựng và nghĩa tiếng Việt.');

      const cardId = 'crd_' + crypto.randomUUID().slice(0, 8);
      const now = Date.now();
      const posRes: any = await env.DB.prepare('SELECT COUNT(*) as cnt FROM cards WHERE deck_id = ?').bind(deckId).first();
      const position = posRes?.cnt || 0;

      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO cards (id, deck_id, user_id, position, term, term_normalized, meaning_vi, definition_en, phonetic, part_of_speech, synonyms_json, antonyms_json, example, group_name, field_sources_json, flagged_hard, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).bind(
          cardId, deckId, user.id, position, term.trim(), term.trim().toLowerCase(), meaning_vi.trim(),
          (definition_en || '').trim(), (phonetic || '').trim(), (part_of_speech || '').trim(),
          JSON.stringify(Array.isArray(synonyms) ? synonyms : []),
          JSON.stringify(Array.isArray(antonyms) ? antonyms : []),
          (example || '').trim(), (group_name || term).trim(),
          JSON.stringify(field_sources || {}), now, now
        ),
        env.DB.prepare(`
          INSERT INTO user_card_state (user_id, card_id, direction, ease_factor, interval_days, repetitions, lapses, due_at, suspended)
          VALUES (?, ?, 'en_vi', 2.5, 0, 0, 0, ?, 0)
        `).bind(user.id, cardId, now),
        env.DB.prepare(`
          INSERT INTO user_card_state (user_id, card_id, direction, ease_factor, interval_days, repetitions, lapses, due_at, suspended)
          VALUES (?, ?, 'vi_en', 2.5, 0, 0, 0, ?, 0)
        `).bind(user.id, cardId, now),
        env.DB.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').bind(now, deckId),
      ]);

      return json({ success: true, cardId });
    }

    // PATCH / DELETE single card: /api/decks/:id/cards/:cardId
    const singleCardMatch = pathname.match(/^\/api\/decks\/([^/]+)\/cards\/([^/]+)$/);
    if (singleCardMatch) {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const [_, deckId, cardId] = singleCardMatch;

      if (method === 'PATCH') {
        const body = await request.json().catch(() => ({})) as any;
        const { term, meaning_vi, definition_en, phonetic, part_of_speech, synonyms, antonyms, example, group_name, flagged_hard } = body;

        await env.DB.prepare(`
          UPDATE cards SET
            term = COALESCE(?, term),
            term_normalized = COALESCE(?, term_normalized),
            meaning_vi = COALESCE(?, meaning_vi),
            definition_en = COALESCE(?, definition_en),
            phonetic = COALESCE(?, phonetic),
            part_of_speech = COALESCE(?, part_of_speech),
            synonyms_json = COALESCE(?, synonyms_json),
            antonyms_json = COALESCE(?, antonyms_json),
            example = COALESCE(?, example),
            group_name = COALESCE(?, group_name),
            flagged_hard = COALESCE(?, flagged_hard),
            updated_at = ?
          WHERE id = ? AND deck_id = ? AND user_id = ?
        `).bind(
          term !== undefined ? term.trim() : null,
          term !== undefined ? term.trim().toLowerCase() : null,
          meaning_vi !== undefined ? meaning_vi.trim() : null,
          definition_en !== undefined ? definition_en.trim() : null,
          phonetic !== undefined ? phonetic.trim() : null,
          part_of_speech !== undefined ? part_of_speech.trim() : null,
          synonyms !== undefined ? JSON.stringify(synonyms) : null,
          antonyms !== undefined ? JSON.stringify(antonyms) : null,
          example !== undefined ? example.trim() : null,
          group_name !== undefined ? group_name.trim() : null,
          flagged_hard !== undefined ? (flagged_hard ? 1 : 0) : null,
          Date.now(),
          cardId, deckId, user.id
        ).run();

        return json({ success: true });
      }

      if (method === 'DELETE') {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM user_card_state WHERE card_id = ? AND user_id = ?').bind(cardId, user.id),
          env.DB.prepare('DELETE FROM cards WHERE id = ? AND deck_id = ? AND user_id = ?').bind(cardId, deckId, user.id),
        ]);
        return json({ success: true });
      }
    }

    // ---------------------------------------------------------
    // STUDY & SRS ENGINE
    // ---------------------------------------------------------

    // GET /api/study/queue
    if (pathname === '/api/study/queue' && method === 'GET') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const deck_id = url.searchParams.get('deck_id');
      const direction = url.searchParams.get('direction') || 'en_vi';

      const settings: any = await env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(user.id).first();
      const maxReviews = settings?.max_reviews_per_day || 100;
      const newPerDay = settings?.new_cards_per_day || 20;

      const now = Date.now();
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      let sql = `
        SELECT c.*, s.ease_factor, s.interval_days, s.repetitions, s.lapses, s.due_at
        FROM cards c
        JOIN user_card_state s ON c.id = s.card_id AND s.user_id = c.user_id AND s.direction = ?
        WHERE c.user_id = ? AND s.due_at <= ? AND s.suspended = 0
      `;
      const params: any[] = [direction, user.id, todayEnd.getTime()];

      if (deck_id) {
        sql += ' AND c.deck_id = ?';
        params.push(deck_id);
      }
      sql += ' ORDER BY s.repetitions ASC, s.due_at ASC LIMIT ?';
      params.push(maxReviews);

      const queueResult = await env.DB.prepare(sql).bind(...params).all();
      const cards = (queueResult.results || []).map((c: any) => ({
        ...c,
        synonyms: c.synonyms_json ? JSON.parse(c.synonyms_json) : [],
        antonyms: c.antonyms_json ? JSON.parse(c.antonyms_json) : [],
        field_sources: c.field_sources_json ? JSON.parse(c.field_sources_json) : {},
        flagged_hard: Boolean(c.flagged_hard),
        srsState: {
          ease_factor: c.ease_factor,
          interval_days: c.interval_days,
          repetitions: c.repetitions,
          lapses: c.lapses,
          due_at: c.due_at,
        },
      }));

      return json({
        direction,
        queue: cards,
        stats: {
          dueCount: cards.filter((c: any) => c.repetitions > 0).length,
          newCount: cards.filter((c: any) => c.repetitions === 0).length,
          totalQueue: cards.length,
        },
      });
    }

    // POST /api/study/reviews
    if (pathname === '/api/study/reviews' && method === 'POST') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const body = await request.json().catch(() => ({})) as any;
      const { card_id, direction = 'en_vi', rating, mode = 'flashcard', duration_ms = 0 } = body;

      if (!card_id || ![1, 2, 3, 4].includes(rating)) {
        return error('Rating phải từ 1 đến 4.');
      }

      let srs: any = await env.DB.prepare(`
        SELECT * FROM user_card_state WHERE user_id = ? AND card_id = ? AND direction = ?
      `).bind(user.id, card_id, direction).first();

      if (!srs) {
        srs = {
          user_id: user.id,
          card_id,
          direction,
          ease_factor: 2.5,
          interval_days: 0,
          repetitions: 0,
          lapses: 0,
          due_at: Date.now(),
        };
      }

      const prevStateJson = JSON.stringify(srs);
      const { nextState, isLeech } = calculateNextSrs(srs, rating as 1 | 2 | 3 | 4);
      const reviewId = body.review_id || crypto.randomUUID();
      const now = Date.now();

      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO user_card_state (user_id, card_id, direction, ease_factor, interval_days, repetitions, lapses, due_at, last_reviewed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, card_id, direction) DO UPDATE SET
            ease_factor = excluded.ease_factor,
            interval_days = excluded.interval_days,
            repetitions = excluded.repetitions,
            lapses = excluded.lapses,
            due_at = excluded.due_at,
            last_reviewed_at = excluded.last_reviewed_at
        `).bind(
          user.id, card_id, direction, nextState.ease_factor, nextState.interval_days,
          nextState.repetitions, nextState.lapses, nextState.due_at, now
        ),
        env.DB.prepare(`
          INSERT INTO review_logs (review_id, user_id, card_id, direction, rating, mode, duration_ms, reviewed_at, received_at, prev_state_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(reviewId, user.id, card_id, direction, rating, mode, duration_ms, now, now, prevStateJson),
      ]);

      if (isLeech) {
        await env.DB.prepare('UPDATE cards SET flagged_hard = 1 WHERE id = ?').bind(card_id).run();
      }

      return json({ success: true, nextState, isLeech, review_id: reviewId });
    }

    // POST /api/study/undo
    if (pathname === '/api/study/undo' && method === 'POST') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const lastLog: any = await env.DB.prepare(`
        SELECT * FROM review_logs WHERE user_id = ? ORDER BY reviewed_at DESC LIMIT 1
      `).bind(user.id).first();

      if (!lastLog) return error('Không có lượt ôn tập nào gần đây để hoàn tác.');

      const prevState = JSON.parse(lastLog.prev_state_json);
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE user_card_state SET
            ease_factor = ?, interval_days = ?, repetitions = ?, lapses = ?, due_at = ?
          WHERE user_id = ? AND card_id = ? AND direction = ?
        `).bind(prevState.ease_factor, prevState.interval_days, prevState.repetitions, prevState.lapses, prevState.due_at, user.id, lastLog.card_id, lastLog.direction),
        env.DB.prepare('DELETE FROM review_logs WHERE review_id = ?').bind(lastLog.review_id),
      ]);

      return json({ success: true, restoredCardId: lastLog.card_id, restoredState: prevState });
    }

    // GET /api/study/stats
    if (pathname === '/api/study/stats' && method === 'GET') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const totalCardsRes: any = await env.DB.prepare('SELECT COUNT(*) as cnt FROM cards WHERE user_id = ?').bind(user.id).first();
      const learnedRes: any = await env.DB.prepare(`
        SELECT COUNT(*) as cnt FROM user_card_state WHERE user_id = ? AND direction = 'en_vi' AND interval_days >= 21
      `).bind(user.id).first();
      const learningRes: any = await env.DB.prepare(`
        SELECT COUNT(*) as cnt FROM user_card_state WHERE user_id = ? AND direction = 'en_vi' AND repetitions > 0 AND interval_days < 21
      `).bind(user.id).first();
      const dueRes: any = await env.DB.prepare(`
        SELECT COUNT(*) as cnt FROM user_card_state WHERE user_id = ? AND direction = 'en_vi' AND due_at <= ?
      `).bind(user.id, Date.now()).first();
      const reviewLogsRes: any = await env.DB.prepare(`
        SELECT COUNT(*) as total, SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END) as positive FROM review_logs WHERE user_id = ?
      `).bind(user.id).first();

      const totalCards = totalCardsRes?.cnt || 0;
      const learnedCards = learnedRes?.cnt || 0;
      const learningCards = learningRes?.cnt || 0;
      const dueToday = dueRes?.cnt || 0;
      const newCards = Math.max(0, totalCards - (learnedCards + learningCards));
      const totalReviews = reviewLogsRes?.total || 0;
      const positiveReviews = reviewLogsRes?.positive || 0;
      const retentionRate = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) * 100) : 100;

      return json({
        totalCards,
        learnedCards,
        learningCards,
        newCards,
        dueToday,
        totalReviews,
        retentionRate,
        hardWords: [],
      });
    }

    // ---------------------------------------------------------
    // AI DICTIONARY & CONTEXTUAL READING (GEMINI API)
    // ---------------------------------------------------------

    // Built-in English-Vietnamese vocabulary fallback for common vocabulary
    const COMMON_OFFLINE_DICT: Record<string, any> = {
      resilient: {
        term: 'resilient', lemma: 'resilient', phonetic: '/rɪˈzɪl.jənt/',
        word_family: ['resilience', 'resiliently', 'resile'], group_name: 'resilience',
        senses: [{
          pos: 'adjective', meaning_vi: 'kiên cường, có khả năng phục hồi nhanh chóng sau khó khăn',
          definition_en: 'able to withstand or recover quickly from difficult conditions', phonetic: '/rɪˈzɪl.jənt/',
          examples: ['She is a resilient girl who never gives up in tough times.', 'A resilient economy can absorb external shocks.'],
          synonyms: [{ word: 'tough', note_vi: 'bền bỉ' }, { word: 'flexible', note_vi: 'linh hoạt' }, { word: 'buoyant', note_vi: 'sôi nổi, kiên trì' }],
          antonyms: ['fragile', 'vulnerable', 'weak']
        }]
      },
      accomplish: {
        term: 'accomplish', lemma: 'accomplish', phonetic: '/əˈkɑːm.plɪʃ/',
        word_family: ['accomplishment', 'accomplished', 'accomplishable'], group_name: 'accomplish',
        senses: [{
          pos: 'verb', meaning_vi: 'hoàn thành, đạt được thành tựu mục tiêu',
          definition_en: 'to achieve or complete successfully', phonetic: '/əˈkɑːm.plɪʃ/',
          examples: ['She accomplished all her learning goals this month.', 'Together we can accomplish great things.'],
          synonyms: [{ word: 'achieve', note_vi: 'đạt được' }, { word: 'fulfill', note_vi: 'hoàn tất' }, { word: 'execute', note_vi: 'thi hành' }],
          antonyms: ['fail', 'abandon', 'give up']
        }]
      },
      consider: {
        term: 'consider', lemma: 'consider', phonetic: '/kənˈsɪd.ɚ/',
        word_family: ['consideration', 'considerable', 'considerate', 'reconsider'], group_name: 'consider',
        senses: [{
          pos: 'verb', meaning_vi: 'cân nhắc, xem xét kỹ lưỡng',
          definition_en: 'to think carefully about something, typically before making a decision', phonetic: '/kənˈsɪd.ɚ/',
          examples: ['Please consider all possibilities before deciding.', 'He considered studying abroad in Singapore.'],
          synonyms: [{ word: 'contemplate', note_vi: 'ngẫm nghĩ' }, { word: 'deliberate', note_vi: 'cân nhắc cẩn trọng' }],
          antonyms: ['ignore', 'neglect', 'dismiss']
        }]
      },
      vocabulary: {
        term: 'vocabulary', lemma: 'vocabulary', phonetic: '/vəˈkæb.jə.ler.i/',
        word_family: ['vocab', 'vocable'], group_name: 'vocabulary',
        senses: [{
          pos: 'noun', meaning_vi: 'từ vựng, vốn từ ngữ',
          definition_en: 'all the words known and used by a particular person or in a particular language', phonetic: '/vəˈkæb.jə.ler.i/',
          examples: ['Reading books daily expands your active vocabulary.', 'She has an impressive medical vocabulary.'],
          synonyms: [{ word: 'lexicon', note_vi: 'từ vựng chuyên ngành' }, { word: 'word stock', note_vi: 'kho từ' }],
          antonyms: []
        }]
      },
      develop: {
        term: 'develop', lemma: 'develop', phonetic: '/dɪˈvel.əp/',
        word_family: ['development', 'developer', 'developing', 'undeveloped'], group_name: 'develop',
        senses: [{
          pos: 'verb', meaning_vi: 'phát triển, mở mang, xây dựng tiến bộ',
          definition_en: 'to grow or cause to grow and become more mature, advanced, or elaborate', phonetic: '/dɪˈvel.əp/',
          examples: ['The platform develops effective learning habits for students.', 'She developed a new software app.'],
          synonyms: [{ word: 'evolve', note_vi: 'tiến hóa phát triển' }, { word: 'grow', note_vi: 'lớn mạnh' }],
          antonyms: ['deteriorate', 'decline', 'stagnate']
        }]
      },
      apple: {
        term: 'apple', lemma: 'apple', phonetic: '/ˈæp.əl/',
        word_family: ['applesauce'], group_name: 'apple',
        senses: [{
          pos: 'noun', meaning_vi: 'quả táo (trái cây tròn, vỏ đỏ hoặc xanh)',
          definition_en: 'the round fruit of a tree of the rose family, typically with thin red or green skin and crisp flesh', phonetic: '/ˈæp.əl/',
          examples: ['An apple a day keeps the doctor away.', 'She peeled a fresh red apple for breakfast.'],
          synonyms: [],
          antonyms: []
        }]
      },
      serendipity: {
        term: 'serendipity', lemma: 'serendipity', phonetic: '/ˌser.ənˈdɪp.ə.t̬i/',
        word_family: ['serendipitous', 'serendipitously'], group_name: 'serendipity',
        senses: [{
          pos: 'noun', meaning_vi: 'sự tình cờ may mắn, khả năng khám phá ngẫu nhiên điều tuyệt vời',
          definition_en: 'the occurrence and development of events by chance in a happy or beneficial way', phonetic: '/ˌser.ənˈdɪp.ə.t̬i/',
          examples: ['Finding this rare book in an old shop was pure serendipity.', 'A fortunate stroke of serendipity brought them together.'],
          synonyms: [{ word: 'fluke', note_vi: 'vận may tình cờ' }, { word: 'good fortune', note_vi: 'may mắn' }, { word: 'coincidence', note_vi: 'trùng hợp' }],
          antonyms: ['misfortune', 'bad luck', 'adversity']
        }]
      },
      perseverance: {
        term: 'perseverance', lemma: 'persevere', phonetic: '/ˌpɝː.səˈvɪr.əns/',
        word_family: ['persevere', 'persevering', 'perseveringly'], group_name: 'persevere',
        senses: [{
          pos: 'noun', meaning_vi: 'sự kiên trì, bền chí vượt qua thử thách khó khăn',
          definition_en: 'persistence in doing something despite difficulty or delay in achieving success', phonetic: '/ˌpɝː.səˈvɪr.əns/',
          examples: ['Through hard work and perseverance, he mastered fluent English.', 'Her perseverance paid off with a high scholarship.'],
          synonyms: [{ word: 'persistence', note_vi: 'sự bền bỉ' }, { word: 'tenacity', note_vi: 'tính ngoan cường' }, { word: 'dedication', note_vi: 'tận tụy' }],
          antonyms: ['giving up', 'laziness', 'hesitation']
        }]
      },
      ephemeral: {
        term: 'ephemeral', lemma: 'ephemeral', phonetic: '/ɪˈfem.ər.əl/',
        word_family: ['ephemera', 'ephemerality', 'ephemerally'], group_name: 'ephemeral',
        senses: [{
          pos: 'adjective', meaning_vi: 'phù du, chóng tàn, tồn tại trong thời gian ngắn ngủi',
          definition_en: 'lasting for a very short time', phonetic: '/ɪˈfem.ər.əl/',
          examples: ['Fashions are ephemeral, but true style is eternal.', 'The ephemeral beauty of morning dew on flowers.'],
          synonyms: [{ word: 'fleeting', note_vi: 'thoáng qua' }, { word: 'transient', note_vi: 'tạm thời' }, { word: 'short-lived', note_vi: 'ngắn ngủi' }],
          antonyms: ['permanent', 'eternal', 'enduring']
        }]
      },
      ubiquitous: {
        term: 'ubiquitous', lemma: 'ubiquitous', phonetic: '/juːˈbɪk.wə.t̬əs/',
        word_family: ['ubiquity', 'ubiquitously'], group_name: 'ubiquitous',
        senses: [{
          pos: 'adjective', meaning_vi: 'phổ biến khắp nơi, đâu đâu cũng thấy',
          definition_en: 'present, appearing, or found everywhere', phonetic: '/juːˈbɪk.wə.t̬əs/',
          examples: ['Smartphones have become ubiquitous in modern urban life.', 'Coffee shops are ubiquitous in this bustling city.'],
          synonyms: [{ word: 'omnipresent', note_vi: 'có mặt khắp nơi' }, { word: 'universal', note_vi: 'toàn thể' }, { word: 'widespread', note_vi: 'rộng khắp' }],
          antonyms: ['rare', 'scarce', 'seldom']
        }]
      },
      meticulous: {
        term: 'meticulous', lemma: 'meticulous', phonetic: '/məˈtɪk.jə.ləs/',
        word_family: ['meticulously', 'meticulousness'], group_name: 'meticulous',
        senses: [{
          pos: 'adjective', meaning_vi: 'tỉ mỉ, cẩn thận chu đáo đến từng chi tiết',
          definition_en: 'showing great attention to detail; very careful and precise', phonetic: '/məˈtɪk.jə.ləs/',
          examples: ['The researcher kept meticulous records of all experimental data.', 'He is meticulous about his code structure and styling.'],
          synonyms: [{ word: 'thorough', note_vi: 'cẩn thận' }, { word: 'diligent', note_vi: 'siêng năng tỉ mỉ' }, { word: 'scrupulous', note_vi: 'chu toàn' }],
          antonyms: ['careless', 'sloppy', 'negligent']
        }]
      },
      collaborate: {
        term: 'collaborate', lemma: 'collaborate', phonetic: '/kəˈlæb.ə.reɪt/',
        word_family: ['collaboration', 'collaborative', 'collaborator'], group_name: 'collaborate',
        senses: [{
          pos: 'verb', meaning_vi: 'hợp tác, phối hợp cùng làm việc',
          definition_en: 'work jointly on an activity or project', phonetic: '/kəˈlæb.ə.reɪt/',
          examples: ['Two international universities collaborated on the scientific research project.', 'Engineers and designers collaborate closely every sprint.'],
          synonyms: [{ word: 'cooperate', note_vi: 'hợp tác' }, { word: 'team up', note_vi: 'lập đội cùng làm' }],
          antonyms: ['oppose', 'compete', 'disagree']
        }]
      },
      innovate: {
        term: 'innovate', lemma: 'innovate', phonetic: '/ˈɪn.ə.veɪt/',
        word_family: ['innovation', 'innovative', 'innovator'], group_name: 'innovate',
        senses: [{
          pos: 'verb', meaning_vi: 'đổi mới, sáng tạo giải pháp tân tiến',
          definition_en: 'make changes in something established, especially by introducing new methods, ideas, or products', phonetic: '/ˈɪn.ə.veɪt/',
          examples: ['Tech startups must continually innovate to stay competitive in the market.', 'The company innovated a brand-new battery design.'],
          synonyms: [{ word: 'invent', note_vi: 'phát minh' }, { word: 'revolutionize', note_vi: 'cách mạng hóa' }],
          antonyms: ['stagnate', 'revert', 'imitate']
        }]
      },
      diligent: {
        term: 'diligent', lemma: 'diligent', phonetic: '/ˈdɪl.ə.dʒənt/',
        word_family: ['diligence', 'diligently'], group_name: 'diligent',
        senses: [{
          pos: 'adjective', meaning_vi: 'chăm chỉ, cần cù, siêng năng có trách nhiệm',
          definition_en: 'having or showing care and conscientiousness in one\'s work or duties', phonetic: '/ˈdɪl.ə.dʒənt/',
          examples: ['A diligent student reviews flashcards every single day.', 'With diligent effort, she passed the exam with flying colors.'],
          synonyms: [{ word: 'hard-working', note_vi: 'chăm chỉ' }, { word: 'industrious', note_vi: 'cần mẫn' }, { word: 'assiduous', note_vi: 'chuyên cần' }],
          antonyms: ['lazy', 'idle', 'careless']
        }]
      },
      efficient: {
        term: 'efficient', lemma: 'efficient', phonetic: '/ɪˈfɪʃ.ənt/',
        word_family: ['efficiency', 'efficiently'], group_name: 'efficient',
        senses: [{
          pos: 'adjective', meaning_vi: 'hiệu quả, tiết kiệm năng lượng và thời gian',
          definition_en: 'achieving maximum productivity with minimum wasted effort or expense', phonetic: '/ɪˈfɪʃ.ənt/',
          examples: ['Spaced repetition is an efficient technique for memorizing new words.', 'The new sorting algorithm is far more efficient.'],
          synonyms: [{ word: 'effective', note_vi: 'có hiệu lực' }, { word: 'productive', note_vi: 'năng suất' }, { word: 'streamlined', note_vi: 'tối ưu' }],
          antonyms: ['inefficient', 'wasteful', 'clumsy']
        }]
      },
      retention: {
        term: 'retention', lemma: 'retain', phonetic: '/rɪˈten.ʃən/',
        word_family: ['retain', 'retentive', 'retainer'], group_name: 'retain',
        senses: [{
          pos: 'noun', meaning_vi: 'khả năng ghi nhớ, duy trì kiến thức trong trí não',
          definition_en: 'the continued possession, use, or control of something; the power to retain knowledge', phonetic: '/rɪˈten.ʃən/',
          examples: ['Daily active review boosts long-term vocabulary retention up to 90%.', 'Visual cues improve memory retention dramatically.'],
          synonyms: [{ word: 'memory', note_vi: 'trí nhớ' }, { word: 'preservation', note_vi: 'sự bảo tồn' }],
          antonyms: ['forgetfulness', 'loss', 'oblivion']
        }]
      }
    };

    // Helper: Translate English text to Vietnamese using public translation API
    async function translateToVi(text: string): Promise<string> {
      try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 300))}&langpair=en|vi`;
        const res = await fetch(url, { headers: { 'User-Agent': 'SmartVocab/4.3' } });
        if (res.ok) {
          const data: any = await res.json();
          const match = data?.responseData?.translatedText;
          if (match && typeof match === 'string' && !match.toLowerCase().includes('mymemory')) {
            return match.trim();
          }
        }
      } catch {}
      return '';
    }

    // Helper: Fallback dictionary lookup using Free Dictionary API + Vietnamese translator
    async function fallbackDictionaryLookup(rawTerm: string): Promise<any> {
      const clean = rawTerm.trim().toLowerCase();
      if (COMMON_OFFLINE_DICT[clean]) {
        return COMMON_OFFLINE_DICT[clean];
      }

      try {
        const dictRes = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`);
        if (dictRes.ok) {
          const dictData: any = await dictRes.json();
          const first = Array.isArray(dictData) ? dictData[0] : null;
          if (first && Array.isArray(first.meanings) && first.meanings.length > 0) {
            let phonetic = first.phonetic || '';
            if (!phonetic && Array.isArray(first.phonetics)) {
              const withText = first.phonetics.find((p: any) => p.text);
              if (withText) phonetic = withText.text;
            }

            const senses: any[] = [];
            for (const m of first.meanings.slice(0, 3)) {
              const def = m.definitions?.[0];
              const defEn = def?.definition || '';
              const ex = def?.example ? [def.example] : [];
              const rawSyns = Array.isArray(m.synonyms) ? m.synonyms.slice(0, 4) : [];
              const rawAnts = Array.isArray(m.antonyms) ? m.antonyms.slice(0, 3) : [];

              // Get Vietnamese meaning translation
              let meaningVi = await translateToVi(clean);
              if (!meaningVi && defEn) {
                meaningVi = await translateToVi(defEn);
              }
              if (!meaningVi) {
                meaningVi = `Nghĩa của từ "${clean}" (${m.partOfSpeech || 'từ vựng'})`;
              }

              senses.push({
                pos: m.partOfSpeech || 'noun',
                meaning_vi: meaningVi,
                definition_en: defEn || `Definition of ${clean}`,
                phonetic: phonetic || '',
                examples: ex.length > 0 ? ex : [`This is an example sentence using "${clean}".`],
                synonyms: rawSyns.map((s: string) => ({ word: s, note_vi: 'từ đồng nghĩa' })),
                antonyms: rawAnts,
              });
            }

            if (senses.length > 0) {
              return {
                term: clean,
                lemma: first.word || clean,
                phonetic: phonetic || `/${clean}/`,
                word_family: [clean],
                group_name: clean,
                senses,
              };
            }
          }
        }
      } catch (err) {
        console.warn('[Dictionary Fallback] FreeDict error:', err);
      }

      // Universal fallback if offline/no network
      const viMeaning = await translateToVi(clean);
      return {
        term: clean,
        lemma: clean,
        phonetic: `/${clean}/`,
        word_family: [clean],
        group_name: clean,
        senses: [
          {
            pos: 'general',
            meaning_vi: viMeaning || `Nghĩa tiếng Việt của "${clean}"`,
            definition_en: `English term: ${clean}`,
            phonetic: `/${clean}/`,
            examples: [`Practice using "${clean}" in daily communication.`],
            synonyms: [],
            antonyms: [],
          },
        ],
      };
    }

    // POST /api/dictionary/lookup
    if (pathname === '/api/dictionary/lookup' && method === 'POST') {
      const body = await request.json().catch(() => ({})) as any;
      const term = (body.term || '').trim().slice(0, 60);
      if (!term) return error('Vui lòng cung cấp từ vựng cần tra cứu.');

      const cleanTerm = term.toLowerCase();

      // Check D1 cache first
      const cacheKey = `dict:${cleanTerm}`;
      const cached: any = await env.DB.prepare('SELECT payload_json FROM dictionary_cache WHERE cache_key = ? AND expires_at > ?').bind(cacheKey, Date.now()).first().catch(() => null);
      if (cached && cached.payload_json) {
        try {
          const parsedCache = JSON.parse(cached.payload_json);
          return json({ success: true, data: parsedCache, ...parsedCache, cached: true });
        } catch {}
      }

      const apiKey = env.GEMINI_API_KEY || (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : '');
      let parsed: any = null;

      // 1. Try Gemini AI if API key is provided
      if (apiKey) {
        try {
          const prompt = `Bạn là một từ điển Anh-Việt cao cấp và nhà ngôn ngữ học. Hãy phân tích từ hoặc cụm từ tiếng Anh sau: "${term}".
Trả về kết quả chuẩn định dạng JSON duy nhất không kèm markdown hay giải thích nào khác với cấu trúc:
{
  "term": "${term}",
  "lemma": "dạng nguyên thể của từ",
  "phonetic": "/phiên âm IPA chuẩn Anh-Mỹ/",
  "word_family": ["từ liên quan trong họ từ (noun, verb, adj, adv)"],
  "group_name": "từ gốc đại diện cho nhóm này",
  "senses": [
    {
      "pos": "noun / verb / adj / adv...",
      "meaning_vi": "nghĩa tiếng Việt súc tích, tự nhiên",
      "definition_en": "định nghĩa tiếng Anh rõ ràng",
      "phonetic": "/phiên âm riêng cho nghĩa này nếu có/",
      "examples": ["Ví dụ thực tế 1", "Ví dụ thực tế 2"],
      "synonyms": [{"word": "từ đồng nghĩa 1", "note_vi": "sắc thái khác biệt"}],
      "antonyms": ["từ trái nghĩa 1"]
    }
  ]
}`;

          const geminiModels = ['gemini-2.5-flash', 'gemini-1.5-flash'];
          for (const model of geminiModels) {
            try {
              const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
              const geminiRes = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: { responseMimeType: 'application/json' },
                }),
              });

              if (geminiRes.ok) {
                const geminiData: any = await geminiRes.json();
                const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
                const cleanJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
                parsed = JSON.parse(cleanJson);
                if (parsed && Array.isArray(parsed.senses) && parsed.senses.length > 0) {
                  break;
                }
              }
            } catch (err) {
              console.warn(`[Gemini ${model}] error:`, err);
            }
          }
        } catch (e) {
          console.warn('[Gemini AI] catch error:', e);
        }
      }

      // 2. If Gemini is not configured or failed, use smart Fallback Dictionary Engine
      if (!parsed || !Array.isArray(parsed.senses) || parsed.senses.length === 0) {
        parsed = await fallbackDictionaryLookup(term);
      }

      // Save to D1 cache for 30 days
      const expiresAt = Date.now() + 30 * 86400000;
      await env.DB.prepare(`
        INSERT INTO dictionary_cache (cache_key, payload_json, model, prompt_version, created_at, expires_at)
        VALUES (?, ?, 'gemini-hybrid', 'v4.3', ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, expires_at = excluded.expires_at
      `).bind(cacheKey, JSON.stringify(parsed), Date.now(), expiresAt).run().catch(() => {});

      // Return both `data` and top-level fields for seamless frontend compatibility
      return json({ success: true, data: parsed, ...parsed, cached: false });
    }

    // POST /api/reading/generate
    if (pathname === '/api/reading/generate' && method === 'POST') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const body = await request.json().catch(() => ({})) as any;
      const { card_ids, custom_words, level = 'B1', topic = 'đời sống hiện đại' } = body;

      let targetWords: string[] = [];
      if (Array.isArray(custom_words) && custom_words.length > 0) {
        targetWords = custom_words.map((w: string) => (w || '').trim()).filter(Boolean);
      } else {
        const cardsRes = await env.DB.prepare('SELECT term FROM cards WHERE user_id = ? ORDER BY RANDOM() LIMIT 5').bind(user.id).all();
        targetWords = (cardsRes.results || []).map((c: any) => c.term);
      }

      if (targetWords.length < 2) {
        return error('Cần ít nhất 2 từ vựng để tạo bài đọc ngữ cảnh.');
      }

      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) return error('Chưa cấu hình GEMINI_API_KEY trên Cloudflare Pages Settings.', 500);

      const prompt = `Viết một đoạn văn tiếng Anh học thuật hoặc đời sống thú vị ở trình độ CEFR ${level}, chủ đề: "${topic}".
Bắt buộc phải lồng ghép tự nhiên các từ vựng sau: ${targetWords.join(', ')}.
Kèm theo 3 câu hỏi trắc nghiệm đọc hiểu (4 lựa chọn, đáp án đúng và giải thích bằng tiếng Việt).
Trả về JSON duy nhất với cấu trúc:
{
  "title": "Tiêu đề bài đọc",
  "passage": "Nội dung bài đọc tiếng Anh...",
  "level": "${level}",
  "topic": "${topic}",
  "questions": [
    {
      "question": "Câu hỏi đọc hiểu?",
      "options": ["A. Lựa chọn 1", "B. Lựa chọn 2", "C. Lựa chọn 3", "D. Lựa chọn 4"],
      "answer_index": 0,
      "explanation": "Giải thích chi tiết tại sao đáp án đúng..."
    }
  ]
}`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });

      if (!geminiRes.ok) return error('Không thể tạo bài đọc lúc này.', 500);

      const geminiData: any = await geminiRes.json();
      const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const cleanJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleanJson);

      const passageId = 'rd_' + crypto.randomUUID().slice(0, 8);
      const now = Date.now();
      await env.DB.prepare(`
        INSERT INTO reading_passages (id, user_id, title, passage, level, topic, target_words_json, questions_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        passageId, user.id, parsed.title, parsed.passage, parsed.level || level,
        parsed.topic || topic, JSON.stringify(targetWords), JSON.stringify(parsed.questions || []), now
      ).run();

      return json({
        success: true,
        reading: {
          id: passageId,
          ...parsed,
          target_words: targetWords,
          created_at: now,
        },
      });
    }

    // GET /api/reading
    if (pathname === '/api/reading' && method === 'GET') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const passagesRes = await env.DB.prepare('SELECT * FROM reading_passages WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();
      const passages = (passagesRes.results || []).map((p: any) => ({
        ...p,
        target_words: p.target_words_json ? JSON.parse(p.target_words_json) : [],
        questions: p.questions_json ? JSON.parse(p.questions_json) : [],
      }));

      return json({ passages });
    }

    // DELETE /api/reading/:id
    const readingDelMatch = pathname.match(/^\/api\/reading\/([^/]+)$/);
    if (readingDelMatch && method === 'DELETE') {
      const user = await getAuthUser(request, env.DB);
      if (!user) return error('Chưa đăng nhập.', 401);

      const passageId = readingDelMatch[1];
      await env.DB.prepare('DELETE FROM reading_passages WHERE id = ? AND user_id = ?').bind(passageId, user.id).run();
      return json({ success: true });
    }

    // ---------------------------------------------------------
    // ADMIN ROUTES
    // ---------------------------------------------------------

    // GET /api/admin/users
    if (pathname === '/api/admin/users' && method === 'GET') {
      const user = await getAuthUser(request, env.DB);
      if (!user || user.role !== 'admin') return error('Yêu cầu quyền quản trị viên.', 403);

      const usersRes = await env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
      return json({ users: usersRes.results || [] });
    }

    // POST /api/admin/users/:id/approve
    const adminApproveMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/approve$/);
    if (adminApproveMatch && method === 'POST') {
      const user = await getAuthUser(request, env.DB);
      if (!user || user.role !== 'admin') return error('Yêu cầu quyền quản trị viên.', 403);

      const targetId = adminApproveMatch[1];
      await env.DB.prepare(`
        UPDATE users SET status = 'active', decided_at = ?, decided_by = ? WHERE id = ?
      `).bind(Date.now(), user.id, targetId).run();

      return json({ success: true, message: 'Đã phê duyệt tài khoản thành công.' });
    }

    // POST /api/admin/users/:id/reject
    const adminRejectMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reject$/);
    if (adminRejectMatch && method === 'POST') {
      const user = await getAuthUser(request, env.DB);
      if (!user || user.role !== 'admin') return error('Yêu cầu quyền quản trị viên.', 403);

      const targetId = adminRejectMatch[1];
      await env.DB.prepare(`
        UPDATE users SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?
      `).bind(Date.now(), user.id, targetId).run();

      return json({ success: true, message: 'Đã từ chối tài khoản.' });
    }

    // POST /api/admin/users/:id/suspend
    const adminSuspendMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/suspend$/);
    if (adminSuspendMatch && method === 'POST') {
      const user = await getAuthUser(request, env.DB);
      if (!user || user.role !== 'admin') return error('Yêu cầu quyền quản trị viên.', 403);

      const targetId = adminSuspendMatch[1];
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ? AND role != 'admin'").bind(targetId),
        env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ?').bind(Date.now(), targetId),
      ]);

      return json({ success: true, message: 'Đã khóa tài khoản thành công.' });
    }

    // POST /api/admin/users/:id/reactivate
    const adminReactivateMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reactivate$/);
    if (adminReactivateMatch && method === 'POST') {
      const user = await getAuthUser(request, env.DB);
      if (!user || user.role !== 'admin') return error('Yêu cầu quyền quản trị viên.', 403);

      const targetId = adminReactivateMatch[1];
      await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(targetId).run();
      return json({ success: true, message: 'Đã kích hoạt lại tài khoản.' });
    }

    // Fallback 404 for unknown API routes
    return error(`Route not found: ${method} ${pathname}`, 404);
  } catch (err: any) {
    console.error('[Cloudflare Pages Error]', err);
    return error(err.message || 'Lỗi xử lý máy chủ Cloudflare Pages.', 500);
  }
};
