import express, { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { db, canonicalizeEmail, hashString, User, Deck, Card, UserCardState } from './server/db';
import { calculateNextSrs } from './server/srs';
import { aiProvider } from './server/ai';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '10mb' }));

// Lightweight cookie parser
function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts[0]?.trim();
    if (key) {
      list[key] = decodeURIComponent((parts.slice(1).join('=') || '').trim());
    }
  });
  return list;
}

// Authentication Middleware
export interface AuthenticatedRequest extends Request {
  user?: User;
  sessionToken?: string;
}

function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.session_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    return res.status(401).json({ error: 'Yêu cầu đăng nhập để tiếp tục.' });
  }

  const tokenHash = hashString(token);
  const session = db.getSessions().find(s => s.token_hash === tokenHash && (!s.revoked_at || s.revoked_at > Date.now()));

  if (!session || session.expires_at < Date.now()) {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
  }

  const user = db.getUsers().find(u => u.id === session.user_id);
  if (!user || user.status !== 'active') {
    return res.status(403).json({ error: 'Tài khoản chưa được kích hoạt hoặc đã bị khóa.' });
  }

  // Update session last seen
  session.last_seen_at = Date.now();
  req.user = user;
  req.sessionToken = token;
  next();
}

function adminGuard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền thực hiện thao tác này.' });
  }
  next();
}

// -------------------------------------------------------------
// AUTHENTICATION ROUTES
// -------------------------------------------------------------

// Check Current Session
app.get('/api/auth/me', (req: AuthenticatedRequest, res: Response) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.session_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    return res.json({ authenticated: false, user: null });
  }

  const tokenHash = hashString(token);
  const session = db.getSessions().find(s => s.token_hash === tokenHash && (!s.revoked_at || s.revoked_at > Date.now()));

  if (!session || session.expires_at < Date.now()) {
    return res.json({ authenticated: false, user: null });
  }

  const user = db.getUsers().find(u => u.id === session.user_id);
  if (!user || user.status !== 'active') {
    return res.json({ authenticated: false, user: null });
  }

  let settings = db.getUserSettings().find(s => s.user_id === user.id);
  if (!settings) {
    settings = {
      user_id: user.id,
      new_cards_per_day: 10,
      max_reviews_per_day: 100,
      card_direction: 'en_vi',
      auto_pronounce: false,
      ai_enabled: false,
      theme: 'system',
      updated_at: Date.now(),
    };
    db.getUserSettings().push(settings);
    db.scheduleSave();
  }

  return res.json({
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
    settings,
  });
});

// Helper to send real OTP email in server.ts
async function sendServerOtpEmail(toEmail: string, otpCode: string): Promise<{ success: boolean; provider?: string }> {
  const fromEmail = process.env.EMAIL_FROM || process.env.RESEND_FROM || 'SmartVocab.io <onboarding@resend.dev>';
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

  // 1. Resend
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: fromEmail, to: [toEmail], subject, html }),
      });
      if (res.ok) return { success: true, provider: 'resend' };
    } catch {}
  }

  // 2. Brevo
  const brevoKey = process.env.BREVO_API_KEY;
  if (brevoKey) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoKey.trim(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'SmartVocab.io', email: 'no-reply@smartvocab.io' },
          to: [{ email: toEmail }],
          subject,
          htmlContent: html,
        }),
      });
      if (res.ok) return { success: true, provider: 'brevo' };
    } catch {}
  }

  console.log(`[Email Notice] OTP generated for ${toEmail}: ${otpCode}`);
  return { success: false };
}

// Request OTP
app.post('/api/auth/request-otp', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Vui lòng cung cấp địa chỉ email hợp lệ.' });
  }

  const canonical = canonicalizeEmail(email);
  let user = db.getUsers().find(u => u.email_canonical === canonical);

  if (!user) {
    const adminEmail = process.env.ADMIN_EMAIL || 'huyhoangpham387@gmail.com';
    const isAdm = canonical === canonicalizeEmail(adminEmail);
    const userId = crypto.randomUUID();
    user = {
      id: userId,
      email_canonical: canonical,
      email_display: email.trim(),
      display_name: isAdm ? 'Quản trị viên' : email.split('@')[0],
      role: isAdm ? 'admin' : 'user',
      status: 'active',
      timezone: 'Asia/Ho_Chi_Minh',
      created_at: Date.now(),
    };
    db.getUsers().push(user);
    db.getUserSettings().push({
      user_id: userId,
      new_cards_per_day: 20,
      max_reviews_per_day: 100,
      card_direction: 'en_vi',
      auto_pronounce: true,
      ai_enabled: true,
      theme: 'system',
      updated_at: Date.now(),
    });
    db.scheduleSave();
  }

  // Generate safe 6-digit OTP
  const rawCode = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = hashString(rawCode);

  // Invalidate old OTPs for this canonical email
  const otps = db.getLoginOtps();
  for (let i = otps.length - 1; i >= 0; i--) {
    if (otps[i].email_canonical === canonical) {
      otps.splice(i, 1);
    }
  }

  otps.push({
    id: crypto.randomUUID(),
    email_canonical: canonical,
    code_hash: codeHash,
    expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes
    attempts: 0,
    created_at: Date.now(),
  });
  db.scheduleSave();

  console.log(`[OTP] Generated OTP code for ${email} (${canonical}): ${rawCode}`);

  const emailRes = await sendServerOtpEmail(user.email_display || canonical, rawCode);
  if (!emailRes.success && (process.env.RESEND_API_KEY || process.env.BREVO_API_KEY)) {
    return res.status(500).json({ error: 'Không thể gửi email OTP lúc này. Vui lòng kiểm tra lại cấu hình email.' });
  }

  return res.json({
    success: true,
    message: `Mã xác thực OTP gồm 6 chữ số đã được gửi tới email ${user.email_display}. Vui lòng mở hộp thư để lấy mã và nhập vào ô bên dưới.`,
    emailDisplay: user.email_display,
  });
});

// Verify OTP
app.post('/api/auth/verify-otp', (req: Request, res: Response) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Vui lòng nhập email và mã OTP 6 số.' });
  }

  const canonical = canonicalizeEmail(email);
  const otps = db.getLoginOtps();
  const otp = otps.find(o => o.email_canonical === canonical && !o.consumed_at);

  if (!otp) {
    return res.status(400).json({ error: 'Mã xác thực không tồn tại hoặc đã hết hạn. Vui lòng yêu cầu mã mới.' });
  }

  if (otp.expires_at < Date.now()) {
    return res.status(400).json({ error: 'Mã xác thực đã hết hạn hiệu lực. Vui lòng yêu cầu mã mới.' });
  }

  if (otp.attempts >= 5) {
    otp.consumed_at = Date.now();
    db.scheduleSave();
    return res.status(400).json({ error: 'Bạn đã nhập sai mã quá 5 lần. Mã đã bị hủy.' });
  }

  const codeHash = hashString(code.toString().trim());
  if (codeHash !== otp.code_hash) {
    otp.attempts += 1;
    db.scheduleSave();
    return res.status(400).json({ error: `Mã OTP không đúng. Còn ${5 - otp.attempts} lần thử.` });
  }

  // OTP verified! Mark consumed
  otp.consumed_at = Date.now();

  const user = db.getUsers().find(u => u.email_canonical === canonical);
  if (!user || user.status !== 'active') {
    return res.status(403).json({ error: 'Tài khoản chưa được kích hoạt.' });
  }

  user.last_login_at = Date.now();

  // Create session
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashString(token);
  const sessionExpiresAt = Date.now() + 30 * 86400000; // 30 days

  db.getSessions().push({
    token_hash: tokenHash,
    user_id: user.id,
    created_at: Date.now(),
    last_seen_at: Date.now(),
    expires_at: sessionExpiresAt,
    user_agent: req.headers['user-agent'],
  });
  db.scheduleSave();

  // Set cookie with sameSite: 'none' for iframe compatibility
  res.cookie('session_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 30 * 86400000,
    path: '/',
  });

  let settings = db.getUserSettings().find(s => s.user_id === user.id);
  if (!settings) {
    settings = {
      user_id: user.id,
      new_cards_per_day: 10,
      max_reviews_per_day: 100,
      card_direction: 'en_vi',
      auto_pronounce: false,
      ai_enabled: false,
      theme: 'system',
      updated_at: Date.now(),
    };
    db.getUserSettings().push(settings);
    db.scheduleSave();
  }

  return res.json({
    success: true,
    sessionToken: token,
    user: {
      id: user.id,
      email: user.email_display,
      displayName: user.display_name,
      role: user.role,
      status: user.status,
      timezone: user.timezone,
      createdAt: user.created_at,
    },
    settings,
  });
});

// Logout
app.post('/api/auth/logout', (req: Request, res: Response) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || cookies.session_token;
  if (token) {
    const tokenHash = hashString(token);
    const session = db.getSessions().find(s => s.token_hash === tokenHash);
    if (session) {
      session.revoked_at = Date.now();
      db.scheduleSave();
    }
  }
  res.clearCookie('session_token', { path: '/' });
  return res.json({ success: true });
});

// Access Request (for prospective users)
app.post('/api/access-requests', (req: Request, res: Response) => {
  const { email, displayName, note } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Vui lòng cung cấp địa chỉ email hợp lệ.' });
  }

  const canonical = canonicalizeEmail(email);
  const existing = db.getUsers().find(u => u.email_canonical === canonical);

  if (existing) {
    if (existing.status === 'active') {
      return res.json({
        success: true,
        message: 'Tài khoản của bạn đã được phê duyệt sẵn. Hãy đăng nhập ngay bằng mã OTP!',
        status: 'active',
      });
    }
    if (existing.status === 'pending') {
      return res.json({
        success: true,
        message: 'Yêu cầu của bạn đang trong danh sách chờ quản trị viên xem xét.',
        status: 'pending',
      });
    }
    if (existing.status === 'rejected') {
      return res.status(400).json({
        error: 'Yêu cầu tham gia của email này trước đây đã bị từ chối.',
      });
    }
    if (existing.status === 'suspended') {
      return res.status(400).json({
        error: 'Tài khoản này đã bị tạm khóa bởi quản trị viên.',
      });
    }
  }

  const newUser: User = {
    id: crypto.randomUUID(),
    email_canonical: canonical,
    email_display: email.trim(),
    display_name: (displayName || email.split('@')[0]).trim(),
    role: 'user',
    status: 'pending',
    timezone: 'Asia/Ho_Chi_Minh',
    request_note: (note || '').trim().slice(0, 300),
    requested_at: Date.now(),
    created_at: Date.now(),
  };

  db.getUsers().push(newUser);
  db.getUserSettings().push({
    user_id: newUser.id,
    new_cards_per_day: 10,
    max_reviews_per_day: 100,
    card_direction: 'en_vi',
    auto_pronounce: false,
    ai_enabled: false,
    theme: 'system',
    updated_at: Date.now(),
  });
  db.scheduleSave();

  return res.json({
    success: true,
    message: 'Yêu cầu truy cập của bạn đã được gửi thành công! Quản trị viên sẽ xem xét và kích hoạt.',
    status: 'pending',
  });
});

// Update User Settings
app.patch('/api/me/settings', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const settingsList = db.getUserSettings();
  let settings = settingsList.find(s => s.user_id === user.id);

  if (!settings) {
    settings = {
      user_id: user.id,
      new_cards_per_day: 10,
      max_reviews_per_day: 100,
      card_direction: 'en_vi',
      auto_pronounce: false,
      ai_enabled: false,
      theme: 'system',
      updated_at: Date.now(),
    };
    settingsList.push(settings);
  }

  const { new_cards_per_day, max_reviews_per_day, card_direction, auto_pronounce, ai_enabled, theme } = req.body;

  if (typeof new_cards_per_day === 'number') settings.new_cards_per_day = Math.max(1, Math.min(100, new_cards_per_day));
  if (typeof max_reviews_per_day === 'number') settings.max_reviews_per_day = Math.max(5, Math.min(500, max_reviews_per_day));
  if (card_direction === 'en_vi' || card_direction === 'vi_en') settings.card_direction = card_direction;
  if (typeof auto_pronounce === 'boolean') settings.auto_pronounce = auto_pronounce;
  if (typeof ai_enabled === 'boolean') {
    settings.ai_enabled = ai_enabled;
    if (ai_enabled && !settings.ai_consent_at) {
      settings.ai_consent_at = Date.now();
    }
  }
  if (['system', 'light', 'dark'].includes(theme)) settings.theme = theme;

  settings.updated_at = Date.now();
  db.scheduleSave();

  return res.json({ success: true, settings });
});

// Export all user data
app.get('/api/me/export', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const userDecks = db.getDecks().filter(d => d.user_id === userId);
  const userCards = db.getCards().filter(c => c.user_id === userId);
  const userSrs = db.getUserCardState().filter(s => s.user_id === userId);
  const userPassages = db.getReadingPassages().filter(p => p.user_id === userId);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="vocab-export-${Date.now()}.json"`);
  return res.json({
    exported_at: new Date().toISOString(),
    user: {
      email: req.user!.email_display,
      displayName: req.user!.display_name,
    },
    decks: userDecks,
    cards: userCards,
    srs_states: userSrs,
    reading_passages: userPassages,
  });
});

// Delete Own Account
app.delete('/api/me', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  if (req.user!.role === 'admin') {
    return res.status(400).json({ error: 'Tài khoản Quản trị viên chính không thể tự xóa qua giao diện.' });
  }

  // Delete all user related data
  const decks = db.getDecks();
  for (let i = decks.length - 1; i >= 0; i--) if (decks[i].user_id === userId) decks.splice(i, 1);

  const cards = db.getCards();
  for (let i = cards.length - 1; i >= 0; i--) if (cards[i].user_id === userId) cards.splice(i, 1);

  const srs = db.getUserCardState();
  for (let i = srs.length - 1; i >= 0; i--) if (srs[i].user_id === userId) srs.splice(i, 1);

  const reviews = db.getReviewLogs();
  for (let i = reviews.length - 1; i >= 0; i--) if (reviews[i].user_id === userId) reviews.splice(i, 1);

  const passages = db.getReadingPassages();
  for (let i = passages.length - 1; i >= 0; i--) if (passages[i].user_id === userId) passages.splice(i, 1);

  const sessions = db.getSessions();
  for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].user_id === userId) sessions.splice(i, 1);

  const users = db.getUsers();
  for (let i = users.length - 1; i >= 0; i--) if (users[i].id === userId) users.splice(i, 1);

  db.scheduleSave();
  res.clearCookie('session_token', { path: '/' });
  return res.json({ success: true, message: 'Tài khoản và toàn bộ dữ liệu của bạn đã được xóa hoàn toàn.' });
});

// -------------------------------------------------------------
// ADMIN MANAGEMENT ROUTES (Isolated: NO deck/card content exposed)
// -------------------------------------------------------------

app.get('/api/admin/users', authMiddleware, adminGuard, (req: AuthenticatedRequest, res: Response) => {
  const users = db.getUsers().map(u => {
    const deckCount = db.getDecks().filter(d => d.user_id === u.id).length;
    const cardCount = db.getCards().filter(c => c.user_id === u.id).length;
    return {
      id: u.id,
      email: u.email_display,
      displayName: u.display_name,
      role: u.role,
      status: u.status,
      timezone: u.timezone,
      requestNote: u.request_note,
      requestedAt: u.requested_at,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
      deckCount,
      cardCount,
    };
  });

  return res.json({ users });
});

// Invite a user directly as active
app.post('/api/admin/users/invite', authMiddleware, adminGuard, (req: AuthenticatedRequest, res: Response) => {
  const { email, displayName } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email không hợp lệ.' });
  }

  const canonical = canonicalizeEmail(email);
  let user = db.getUsers().find(u => u.email_canonical === canonical);

  if (user) {
    if (user.status === 'active') {
      return res.status(400).json({ error: 'Tài khoản này đã tồn tại và đang hoạt động.' });
    }
    user.status = 'active';
    user.decided_at = Date.now();
    user.decided_by = req.user!.id;
  } else {
    user = {
      id: crypto.randomUUID(),
      email_canonical: canonical,
      email_display: email.trim(),
      display_name: (displayName || email.split('@')[0]).trim(),
      role: 'user',
      status: 'active',
      timezone: 'Asia/Ho_Chi_Minh',
      decided_at: Date.now(),
      decided_by: req.user!.id,
      created_at: Date.now(),
    };
    db.getUsers().push(user);
    db.getUserSettings().push({
      user_id: user.id,
      new_cards_per_day: 10,
      max_reviews_per_day: 100,
      card_direction: 'en_vi',
      auto_pronounce: false,
      ai_enabled: false,
      theme: 'system',
      updated_at: Date.now(),
    });
  }

  db.getAuditLogs().push({
    id: crypto.randomUUID(),
    actor_id: req.user!.id,
    action: 'INVITE_USER',
    target_user_id: user.id,
    meta: { email: user.email_display },
    created_at: Date.now(),
  });
  db.scheduleSave();

  return res.json({ success: true, message: `Đã kích hoạt quyền truy cập cho ${email}. Người dùng có thể đăng nhập bằng OTP.` });
});

// Approve user
app.post('/api/admin/users/:id/approve', authMiddleware, adminGuard, (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const target = db.getUsers().find(u => u.id === id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });

  target.status = 'active';
  target.decided_at = Date.now();
  target.decided_by = req.user!.id;

  db.getAuditLogs().push({
    id: crypto.randomUUID(),
    actor_id: req.user!.id,
    action: 'APPROVE_USER',
    target_user_id: target.id,
    meta: { email: target.email_display },
    created_at: Date.now(),
  });
  db.scheduleSave();

  return res.json({ success: true, message: `Đã phê duyệt tài khoản ${target.email_display}.` });
});

// Reject user
app.post('/api/admin/users/:id/reject', authMiddleware, adminGuard, (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const target = db.getUsers().find(u => u.id === id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });

  target.status = 'rejected';
  target.decided_at = Date.now();
  target.decided_by = req.user!.id;

  db.getAuditLogs().push({
    id: crypto.randomUUID(),
    actor_id: req.user!.id,
    action: 'REJECT_USER',
    target_user_id: target.id,
    meta: { email: target.email_display },
    created_at: Date.now(),
  });
  db.scheduleSave();

  return res.json({ success: true, message: `Đã từ chối yêu cầu của ${target.email_display}.` });
});

// Suspend user
app.post('/api/admin/users/:id/suspend', authMiddleware, adminGuard, (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const target = db.getUsers().find(u => u.id === id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Không thể khóa tài khoản quản trị viên.' });

  target.status = 'suspended';
  // Revoke all active sessions immediately
  const sessions = db.getSessions();
  sessions.forEach(s => {
    if (s.user_id === target.id) s.revoked_at = Date.now();
  });

  db.getAuditLogs().push({
    id: crypto.randomUUID(),
    actor_id: req.user!.id,
    action: 'SUSPEND_USER',
    target_user_id: target.id,
    meta: { email: target.email_display },
    created_at: Date.now(),
  });
  db.scheduleSave();

  return res.json({ success: true, message: `Đã khóa tài khoản ${target.email_display}. Mọi phiên đăng nhập đã bị hủy ngay lập tức.` });
});

// Reactivate user
app.post('/api/admin/users/:id/reactivate', authMiddleware, adminGuard, (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const target = db.getUsers().find(u => u.id === id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });

  target.status = 'active';
  db.getAuditLogs().push({
    id: crypto.randomUUID(),
    actor_id: req.user!.id,
    action: 'REACTIVATE_USER',
    target_user_id: target.id,
    meta: { email: target.email_display },
    created_at: Date.now(),
  });
  db.scheduleSave();

  return res.json({ success: true, message: `Đã mở khóa tài khoản ${target.email_display}.` });
});

// Reset user to pending for testing approval flows (FR-AU-14)
app.post('/api/admin/users/:id/reset-pending', authMiddleware, adminGuard, (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const target = db.getUsers().find(u => u.id === id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Không thể chuyển tài khoản Quản trị viên về Chờ duyệt.' });

  target.status = 'pending';
  delete target.decided_at;
  delete target.decided_by;

  // Revoke active sessions for this user so they need approval again
  const sessions = db.getSessions();
  sessions.forEach(s => {
    if (s.user_id === target.id) s.revoked_at = Date.now();
  });

  db.getAuditLogs().push({
    id: crypto.randomUUID(),
    actor_id: req.user!.id,
    action: 'RESET_USER_PENDING',
    target_user_id: target.id,
    meta: { email: target.email_display },
    created_at: Date.now(),
  });
  db.scheduleSave();

  return res.json({ success: true, message: `Đã chuyển tài khoản ${target.email_display} về trạng thái Chờ duyệt để thử nghiệm.` });
});

// Admin App Settings & AI Kill Switch
app.get('/api/admin/settings', authMiddleware, adminGuard, (req: AuthenticatedRequest, res: Response) => {
  return res.json({ settings: db.getAppSettings() });
});

app.patch('/api/admin/settings', authMiddleware, adminGuard, (req: AuthenticatedRequest, res: Response) => {
  const { ai_kill_switch, ai_daily_budget, default_daily_lookup_quota, default_daily_reading_quota } = req.body;
  const settings = db.getAppSettings();

  if (typeof ai_kill_switch === 'boolean') settings.ai_kill_switch = ai_kill_switch;
  if (typeof ai_daily_budget === 'number') settings.ai_daily_budget = ai_daily_budget;
  if (typeof default_daily_lookup_quota === 'number') settings.default_daily_lookup_quota = default_daily_lookup_quota;
  if (typeof default_daily_reading_quota === 'number') settings.default_daily_reading_quota = default_daily_reading_quota;

  db.scheduleSave();
  return res.json({ success: true, settings });
});

// -------------------------------------------------------------
// DECKS & CARDS MANAGEMENT (Strictly isolated by user_id)
// -------------------------------------------------------------

// List user decks
app.get('/api/decks', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const now = Date.now();
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayEndMs = todayEnd.getTime();

  const userDecks = db.getDecks().filter(d => d.user_id === userId && !d.archived_at);
  const userCards = db.getCards().filter(c => c.user_id === userId);
  const userSrs = db.getUserCardState().filter(s => s.user_id === userId);

  const decksWithStats = userDecks.map(deck => {
    const deckCards = userCards.filter(c => c.deck_id === deck.id);
    const cardIds = new Set(deckCards.map(c => c.id));
    const deckSrs = userSrs.filter(s => cardIds.has(s.card_id));

    const totalCards = deckCards.length;
    const reviewedCards = new Set(deckSrs.filter(s => s.repetitions > 0).map(s => s.card_id)).size;
    const dueCards = deckSrs.filter(s => s.due_at <= todayEndMs).length;
    const newCards = totalCards - reviewedCards;

    return {
      ...deck,
      totalCards,
      reviewedCards,
      dueCards,
      newCards,
    };
  });

  return res.json({ decks: decksWithStats });
});

// Create Deck + Cards in a single transaction (FR-DK-09)
app.post('/api/decks', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { title, description, topic, cards } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Tiêu đề bộ thẻ không được để trống.' });
  }

  const deckId = crypto.randomUUID();
  const now = Date.now();

  const newDeck: Deck = {
    id: deckId,
    user_id: userId,
    title: title.trim().slice(0, 100),
    description: (description || '').trim().slice(0, 500),
    topic: (topic || '').trim().slice(0, 100),
    created_at: now,
    updated_at: now,
  };

  const createdCards: Card[] = [];
  const srsStates: UserCardState[] = [];

  if (Array.isArray(cards) && cards.length > 0) {
    cards.forEach((c: any, index: number) => {
      const term = (c.term || '').trim();
      const meaning_vi = (c.meaning_vi || '').trim();
      if (!term || !meaning_vi) return; // Skip invalid entries

      const cardId = crypto.randomUUID();
      const card: Card = {
        id: cardId,
        deck_id: deckId,
        user_id: userId,
        position: index,
        term,
        term_normalized: term.toLowerCase(),
        meaning_vi,
        definition_en: (c.definition_en || '').trim(),
        phonetic: (c.phonetic || '').trim(),
        part_of_speech: (c.part_of_speech || '').trim(),
        synonyms: Array.isArray(c.synonyms) ? c.synonyms : (typeof c.synonyms === 'string' ? c.synonyms.split(';').map((s: string) => s.trim()).filter(Boolean) : []),
        antonyms: Array.isArray(c.antonyms) ? c.antonyms : (typeof c.antonyms === 'string' ? c.antonyms.split(';').map((s: string) => s.trim()).filter(Boolean) : []),
        example: (c.example || '').trim(),
        group_name: (c.group_name || '').trim(),
        field_sources: c.field_sources || { term: 'manual', meaning_vi: 'manual' },
        flagged_hard: false,
        created_at: now,
        updated_at: now,
      };

      createdCards.push(card);

      // Initialize SRS state for en_vi and vi_en
      ['en_vi', 'vi_en'].forEach((direction: any) => {
        srsStates.push({
          user_id: userId,
          card_id: cardId,
          direction,
          ease_factor: 2.5,
          interval_days: 0,
          repetitions: 0,
          lapses: 0,
          due_at: now,
          suspended: false,
        });
      });
    });
  }

  db.getDecks().push(newDeck);
  db.getCards().push(...createdCards);
  db.getUserCardState().push(...srsStates);
  db.scheduleSave();

  return res.json({ success: true, deck: newDeck, cardCount: createdCards.length });
});

// Get Deck Detail
app.get('/api/decks/:id', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const deck = db.getDecks().find(d => d.id === id && d.user_id === userId);
  if (!deck) return res.status(404).json({ error: 'Không tìm thấy bộ thẻ.' });

  const cards = db.getCards().filter(c => c.deck_id === id && c.user_id === userId).sort((a, b) => a.position - b.position);
  const srs = db.getUserCardState().filter(s => s.user_id === userId);
  const srsMap = new Map<string, UserCardState>();
  srs.forEach(s => {
    srsMap.set(`${s.card_id}:${s.direction}`, s);
  });

  const cardsWithSrs = cards.map(c => ({
    ...c,
    srs_en_vi: srsMap.get(`${c.id}:en_vi`) || null,
    srs_vi_en: srsMap.get(`${c.id}:vi_en`) || null,
  }));

  return res.json({ deck, cards: cardsWithSrs });
});

// Update Deck
app.patch('/api/decks/:id', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const { title, description, topic } = req.body;

  const deck = db.getDecks().find(d => d.id === id && d.user_id === userId);
  if (!deck) return res.status(404).json({ error: 'Không tìm thấy bộ thẻ.' });

  if (title && typeof title === 'string') deck.title = title.trim().slice(0, 100);
  if (typeof description === 'string') deck.description = description.trim().slice(0, 500);
  if (typeof topic === 'string') deck.topic = topic.trim().slice(0, 100);
  deck.updated_at = Date.now();

  db.scheduleSave();
  return res.json({ success: true, deck });
});

// Delete Deck
app.delete('/api/decks/:id', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const deckIdx = db.getDecks().findIndex(d => d.id === id && d.user_id === userId);
  if (deckIdx === -1) return res.status(404).json({ error: 'Không tìm thấy bộ thẻ.' });

  db.getDecks().splice(deckIdx, 1);

  // Remove deck cards and SRS
  const cards = db.getCards();
  const removedCardIds = new Set<string>();
  for (let i = cards.length - 1; i >= 0; i--) {
    if (cards[i].deck_id === id && cards[i].user_id === userId) {
      removedCardIds.add(cards[i].id);
      cards.splice(i, 1);
    }
  }

  const srs = db.getUserCardState();
  for (let i = srs.length - 1; i >= 0; i--) {
    if (removedCardIds.has(srs[i].card_id) && srs[i].user_id === userId) {
      srs.splice(i, 1);
    }
  }

  db.scheduleSave();
  return res.json({ success: true });
});

// Delete all cards in a deck (keep the deck)
app.delete('/api/decks/:id/cards', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const deck = db.getDecks().find(d => d.id === id && d.user_id === userId);
  if (!deck) return res.status(404).json({ error: 'Không tìm thấy bộ thẻ.' });

  const cards = db.getCards();
  const removedCardIds = new Set<string>();
  let removedCount = 0;
  for (let i = cards.length - 1; i >= 0; i--) {
    if (cards[i].deck_id === id && cards[i].user_id === userId) {
      removedCardIds.add(cards[i].id);
      cards.splice(i, 1);
      removedCount++;
    }
  }

  const srs = db.getUserCardState();
  for (let i = srs.length - 1; i >= 0; i--) {
    if (removedCardIds.has(srs[i].card_id) && srs[i].user_id === userId) {
      srs.splice(i, 1);
    }
  }

  deck.updated_at = Date.now();
  db.scheduleSave();
  return res.json({ success: true, removedCount, message: `Đã xóa toàn bộ ${removedCount} thẻ từ vựng trong bộ thẻ.` });
});

// Batch Cards Import / Upsert (FR-IM-09)
app.post('/api/decks/:id/cards/batch', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const { cards, mode } = req.body; // mode: 'append' | 'replace'

  const deck = db.getDecks().find(d => d.id === id && d.user_id === userId);
  if (!deck) return res.status(404).json({ error: 'Không tìm thấy bộ thẻ.' });

  if (!Array.isArray(cards)) {
    return res.status(400).json({ error: 'Danh sách thẻ không hợp lệ.' });
  }

  if (cards.length === 0 && mode !== 'replace') {
    return res.status(400).json({ error: 'Danh sách thẻ không được để trống.' });
  }

  const now = Date.now();

  if (mode === 'replace') {
    // Delete existing cards
    const existingCards = db.getCards();
    const removedIds = new Set<string>();
    for (let i = existingCards.length - 1; i >= 0; i--) {
      if (existingCards[i].deck_id === id && existingCards[i].user_id === userId) {
        removedIds.add(existingCards[i].id);
        existingCards.splice(i, 1);
      }
    }
    const srs = db.getUserCardState();
    for (let i = srs.length - 1; i >= 0; i--) {
      if (removedIds.has(srs[i].card_id)) srs.splice(i, 1);
    }
  }

  const currentCards = db.getCards().filter(c => c.deck_id === id && c.user_id === userId);
  let startPos = currentCards.length;

  const newCards: Card[] = [];
  const newSrs: UserCardState[] = [];

  cards.forEach((c: any) => {
    const term = (c.term || '').trim();
    const meaning_vi = (c.meaning_vi || '').trim();
    if (!term || !meaning_vi) return;

    const cardId = crypto.randomUUID();
    const card: Card = {
      id: cardId,
      deck_id: id,
      user_id: userId,
      position: startPos++,
      term,
      term_normalized: term.toLowerCase(),
      meaning_vi,
      definition_en: (c.definition_en || '').trim(),
      phonetic: (c.phonetic || '').trim(),
      part_of_speech: (c.part_of_speech || '').trim(),
      synonyms: Array.isArray(c.synonyms) ? c.synonyms : (typeof c.synonyms === 'string' ? c.synonyms.split(';').map((s: string) => s.trim()).filter(Boolean) : []),
      antonyms: Array.isArray(c.antonyms) ? c.antonyms : (typeof c.antonyms === 'string' ? c.antonyms.split(';').map((s: string) => s.trim()).filter(Boolean) : []),
      example: (c.example || '').trim(),
      group_name: (c.group_name || '').trim(),
      field_sources: c.field_sources || { term: 'manual', meaning_vi: 'manual' },
      flagged_hard: false,
      created_at: now,
      updated_at: now,
    };
    newCards.push(card);

    ['en_vi', 'vi_en'].forEach((direction: any) => {
      newSrs.push({
        user_id: userId,
        card_id: cardId,
        direction,
        ease_factor: 2.5,
        interval_days: 0,
        repetitions: 0,
        lapses: 0,
        due_at: now,
        suspended: false,
      });
    });
  });

  db.getCards().push(...newCards);
  db.getUserCardState().push(...newSrs);
  deck.updated_at = now;
  db.scheduleSave();

  return res.json({ success: true, addedCount: newCards.length });
});

// Single Card CRUD
app.post('/api/decks/:id/cards', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const deck = db.getDecks().find(d => d.id === id && d.user_id === userId);
  if (!deck) return res.status(404).json({ error: 'Không tìm thấy bộ thẻ.' });

  const { term, meaning_vi, definition_en, phonetic, part_of_speech, synonyms, antonyms, example, group_name } = req.body;
  if (!term || !meaning_vi) {
    return res.status(400).json({ error: 'Thuật ngữ và Nghĩa tiếng Việt là bắt buộc.' });
  }

  const existingCount = db.getCards().filter(c => c.deck_id === id && c.user_id === userId).length;
  const cardId = crypto.randomUUID();
  const now = Date.now();

  const card: Card = {
    id: cardId,
    deck_id: id,
    user_id: userId,
    position: existingCount,
    term: term.trim(),
    term_normalized: term.trim().toLowerCase(),
    meaning_vi: meaning_vi.trim(),
    definition_en: (definition_en || '').trim(),
    phonetic: (phonetic || '').trim(),
    part_of_speech: (part_of_speech || '').trim(),
    synonyms: Array.isArray(synonyms) ? synonyms : (typeof synonyms === 'string' ? synonyms.split(';').map((s: string) => s.trim()).filter(Boolean) : []),
    antonyms: Array.isArray(antonyms) ? antonyms : (typeof antonyms === 'string' ? antonyms.split(';').map((s: string) => s.trim()).filter(Boolean) : []),
    example: (example || '').trim(),
    group_name: (group_name || '').trim(),
    field_sources: { term: 'manual', meaning_vi: 'manual' },
    flagged_hard: false,
    created_at: now,
    updated_at: now,
  };

  db.getCards().push(card);
  ['en_vi', 'vi_en'].forEach((direction: any) => {
    db.getUserCardState().push({
      user_id: userId,
      card_id: cardId,
      direction,
      ease_factor: 2.5,
      interval_days: 0,
      repetitions: 0,
      lapses: 0,
      due_at: now,
      suspended: false,
    });
  });

  deck.updated_at = now;
  db.scheduleSave();

  return res.json({ success: true, card });
});

// Update single card
app.patch('/api/decks/:id/cards/:cardId', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { id, cardId } = req.params;
  const card = db.getCards().find(c => c.id === cardId && c.deck_id === id && c.user_id === userId);
  if (!card) return res.status(404).json({ error: 'Không tìm thấy thẻ.' });

  const { term, meaning_vi, definition_en, phonetic, part_of_speech, synonyms, antonyms, example, group_name, flagged_hard } = req.body;
  if (term) {
    card.term = term.trim();
    card.term_normalized = term.trim().toLowerCase();
  }
  if (meaning_vi) card.meaning_vi = meaning_vi.trim();
  if (typeof definition_en === 'string') card.definition_en = definition_en.trim();
  if (typeof phonetic === 'string') card.phonetic = phonetic.trim();
  if (typeof part_of_speech === 'string') card.part_of_speech = part_of_speech.trim();
  if (Array.isArray(synonyms)) card.synonyms = synonyms;
  if (Array.isArray(antonyms)) card.antonyms = antonyms;
  if (typeof example === 'string') card.example = example.trim();
  if (typeof group_name === 'string') card.group_name = group_name.trim();
  if (typeof flagged_hard === 'boolean') card.flagged_hard = flagged_hard;
  card.updated_at = Date.now();

  db.scheduleSave();
  return res.json({ success: true, card });
});

// Delete single card
app.delete('/api/decks/:id/cards/:cardId', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { id, cardId } = req.params;
  const cardIdx = db.getCards().findIndex(c => c.id === cardId && c.deck_id === id && c.user_id === userId);
  if (cardIdx === -1) return res.status(404).json({ error: 'Không tìm thấy thẻ.' });

  db.getCards().splice(cardIdx, 1);

  const srs = db.getUserCardState();
  for (let i = srs.length - 1; i >= 0; i--) {
    if (srs[i].card_id === cardId && srs[i].user_id === userId) {
      srs.splice(i, 1);
    }
  }

  db.scheduleSave();
  return res.json({ success: true });
});

// Export Deck (CSV / JSON)
app.get('/api/decks/:id/export', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const format = req.query.format === 'csv' ? 'csv' : 'json';

  const deck = db.getDecks().find(d => d.id === id && d.user_id === userId);
  if (!deck) return res.status(404).json({ error: 'Không tìm thấy bộ thẻ.' });

  const cards = db.getCards().filter(c => c.deck_id === id && c.user_id === userId).sort((a, b) => a.position - b.position);

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(deck.title)}.csv"`);
    let csv = 'Thuật ngữ,Nghĩa tiếng Việt,Định nghĩa tiếng Anh,Phát âm,Loại từ,Từ đồng nghĩa,Từ trái nghĩa,Ví dụ,Nhóm\r\n';
    cards.forEach(c => {
      const escape = (val: string) => {
        let v = (val || '').replace(/"/g, '""');
        // Prevent CSV injection: if starting with = + - @, prefix with '
        if (/^[=+\-@]/.test(v)) v = `'${v}`;
        return `"${v}"`;
      };
      csv += [
        escape(c.term),
        escape(c.meaning_vi),
        escape(c.definition_en),
        escape(c.phonetic),
        escape(c.part_of_speech),
        escape(c.synonyms.join('; ')),
        escape(c.antonyms.join('; ')),
        escape(c.example),
        escape(c.group_name),
      ].join(',') + '\r\n';
    });
    return res.send(csv);
  }

  res.setHeader('Content-Type', 'application/json');
  return res.json({ deck, cards });
});

// CSV Sample Template Download
app.get('/api/import/template', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mau_nhap_tu_vung.csv"');
  const template = `Thuật ngữ,Nghĩa tiếng Việt,Định nghĩa tiếng Anh,Phát âm,Loại từ,Từ đồng nghĩa,Từ trái nghĩa,Ví dụ,Nhóm
accept,chấp nhận,to receive something willingly,/ækˈsɛpt/,verb,receive; agree,reject,She accepted the job offer.,accept
acceptable,có thể chấp nhận được,satisfactory or adequate,/ækˈsɛptəbl/,adj,satisfactory; tolerable,unacceptable,The quality is quite acceptable.,accept
persist,kiên trì bền bỉ,to continue firmly in an opinion or course of action,/pərˈsɪst/,verb,persevere; endure,quit; surrender,He persisted despite the difficulties.,persist
persistence,sự kiên trì,firm continuance in a course of action,/pərˈsɪstəns/,noun,perseverance; determination,hesitation,Her persistence paid off in the end.,persist
`;
  return res.send(template);
});

// -------------------------------------------------------------
// STUDY & SRS ENGINE ROUTES
// -------------------------------------------------------------

// Get Study Queue (FR-ST-02)
app.get('/api/study/queue', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { deck_id } = req.query;
  const settings = db.getUserSettings().find(s => s.user_id === userId) || {
    new_cards_per_day: 10,
    max_reviews_per_day: 100,
    card_direction: 'en_vi',
  };

  const direction = (req.query.direction as string) || settings.card_direction || 'en_vi';
  const now = Date.now();
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayEndMs = todayEnd.getTime();

  let userCards = db.getCards().filter(c => c.user_id === userId);
  if (deck_id && typeof deck_id === 'string') {
    userCards = userCards.filter(c => c.deck_id === deck_id);
  }

  const cardMap = new Map<string, Card>();
  userCards.forEach(c => cardMap.set(c.id, c));

  const allSrs = db.getUserCardState().filter(s => s.user_id === userId && s.direction === direction && !s.suspended);

  // Group into Due (already reviewed at least once, due_at <= end of today) and New (repetitions == 0)
  const dueStates: UserCardState[] = [];
  const newStates: UserCardState[] = [];

  allSrs.forEach(s => {
    if (!cardMap.has(s.card_id)) return;
    if (s.repetitions === 0) {
      newStates.push(s);
    } else if (s.due_at <= todayEndMs) {
      dueStates.push(s);
    }
  });

  // Sort due states by due_at ascending (most overdue first)
  dueStates.sort((a, b) => a.due_at - b.due_at);

  // Apply user limits: max_reviews_per_day, new_cards_per_day
  const limitedDue = dueStates.slice(0, settings.max_reviews_per_day);
  const remainingReviewCapacity = Math.max(0, settings.max_reviews_per_day - limitedDue.length);
  const newLimit = Math.min(settings.new_cards_per_day, remainingReviewCapacity);
  const limitedNew = newStates.slice(0, newLimit);

  // Map back to card with SRS metadata
  const queueCards = [...limitedDue, ...limitedNew].map(srsState => {
    const card = cardMap.get(srsState.card_id)!;
    // Find related cards in same deck
    const relatedCards = userCards
      .filter(other => other.id !== card.id && other.deck_id === card.deck_id)
      .filter(other => (card.group_name && other.group_name === card.group_name) ||
        card.synonyms.includes(other.term_normalized) ||
        other.synonyms.includes(card.term_normalized))
      .map(r => ({ id: r.id, term: r.term, meaning_vi: r.meaning_vi, part_of_speech: r.part_of_speech }));

    return {
      ...card,
      srsState,
      relatedCards,
    };
  });

  return res.json({
    direction,
    queue: queueCards,
    stats: {
      dueCount: dueStates.length,
      newCount: newStates.length,
      totalQueue: queueCards.length,
    },
  });
});

// Submit Review (Anki SRS 4 Buttons) (FR-ST-05, FR-FC-03)
app.post('/api/study/reviews', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { card_id, direction = 'en_vi', rating, mode = 'flashcard', duration_ms = 0 } = req.body;

  if (!card_id || ![1, 2, 3, 4].includes(rating)) {
    return res.status(400).json({ error: 'Dữ liệu đánh giá không hợp lệ. Rating phải từ 1 đến 4.' });
  }

  const srsList = db.getUserCardState();
  let srs = srsList.find(s => s.user_id === userId && s.card_id === card_id && s.direction === direction);

  if (!srs) {
    srs = {
      user_id: userId,
      card_id,
      direction,
      ease_factor: 2.5,
      interval_days: 0,
      repetitions: 0,
      lapses: 0,
      due_at: Date.now(),
      suspended: false,
    };
    srsList.push(srs);
  }

  const prevStateJson = JSON.stringify(srs);
  const { nextState, isLeech } = calculateNextSrs(srs, rating as 1 | 2 | 3 | 4);

  // Update in place
  Object.assign(srs, nextState);

  // Flag as hard card if leech
  if (isLeech) {
    const card = db.getCards().find(c => c.id === card_id && c.user_id === userId);
    if (card) card.flagged_hard = true;
  }

  // Idempotent review log
  const reviewId = req.body.review_id || crypto.randomUUID();
  db.getReviewLogs().push({
    review_id: reviewId,
    user_id: userId,
    card_id,
    direction,
    rating,
    mode,
    duration_ms,
    reviewed_at: Date.now(),
    received_at: Date.now(),
    prev_state_json: prevStateJson,
  });

  db.scheduleSave();
  return res.json({ success: true, nextState: srs, isLeech, review_id: reviewId });
});

// Undo Last Review (FR-FC-04)
app.post('/api/study/undo', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const reviewLogs = db.getReviewLogs();

  // Find last review log for this user
  let lastLogIdx = -1;
  for (let i = reviewLogs.length - 1; i >= 0; i--) {
    if (reviewLogs[i].user_id === userId) {
      lastLogIdx = i;
      break;
    }
  }

  if (lastLogIdx === -1) {
    return res.status(400).json({ error: 'Không có lượt ôn tập nào gần đây để hoàn tác.' });
  }

  const lastLog = reviewLogs[lastLogIdx];
  const prevState: UserCardState = JSON.parse(lastLog.prev_state_json);

  // Restore SRS state
  const srsList = db.getUserCardState();
  const currentSrs = srsList.find(s => s.user_id === userId && s.card_id === lastLog.card_id && s.direction === lastLog.direction);
  if (currentSrs) {
    Object.assign(currentSrs, prevState);
  }

  // Remove the log entry
  reviewLogs.splice(lastLogIdx, 1);
  db.scheduleSave();

  return res.json({ success: true, restoredCardId: lastLog.card_id, restoredState: prevState });
});

// Overall Study Stats
app.get('/api/study/stats', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const userCards = db.getCards().filter(c => c.user_id === userId);
  const userSrs = db.getUserCardState().filter(s => s.user_id === userId && s.direction === 'en_vi');
  const userLogs = db.getReviewLogs().filter(l => l.user_id === userId);

  const totalCards = userCards.length;
  const learnedCards = userSrs.filter(s => s.interval_days >= 21).length;
  const learningCards = userSrs.filter(s => s.repetitions > 0 && s.interval_days < 21).length;
  const newCards = totalCards - (learnedCards + learningCards);

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const dueToday = userSrs.filter(s => s.due_at <= todayEnd.getTime()).length;

  // Retention rate: % of reviews rated Good (3) or Easy (4)
  const totalReviews = userLogs.length;
  const positiveReviews = userLogs.filter(l => l.rating >= 3).length;
  const retentionRate = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) * 100) : 100;

  // Hard words (flagged or lapses >= 4)
  const hardCardIds = new Set(userSrs.filter(s => s.lapses >= 4).map(s => s.card_id));
  userCards.filter(c => c.flagged_hard).forEach(c => hardCardIds.add(c.id));
  const hardWords = userCards.filter(c => hardCardIds.has(c.id)).slice(0, 20);

  return res.json({
    totalCards,
    learnedCards,
    learningCards,
    newCards: Math.max(0, newCards),
    dueToday,
    totalReviews,
    retentionRate,
    hardWords,
  });
});

// -------------------------------------------------------------
// AI DICTIONARY & CONTEXTUAL READING ROUTES
// -------------------------------------------------------------

// Tra từ AI (Gemini + Shared Cache) (FR-DC)
app.post('/api/dictionary/lookup', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { term } = req.body;
  if (!term || typeof term !== 'string' || !term.trim()) {
    return res.status(400).json({ error: 'Vui lòng cung cấp từ vựng cần tra cứu.' });
  }

  const cleanTerm = term.trim().slice(0, 60);

  try {
    const result = await aiProvider.lookup(cleanTerm);
    return res.json({ success: true, ...result, data: result.data });
  } catch (err: any) {
    return res.status(500).json({
      error: err.message || 'Không thể tra từ với AI lúc này. Bạn vẫn có thể điền thông tin thủ công.',
    });
  }
});

// Sinh Bài đọc Ngữ cảnh (FR-RD)
app.post('/api/reading/generate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { card_ids, custom_words, level = 'B1', topic } = req.body;

  let targetWords: string[] = [];
  let targetIds: string[] = [];

  if (Array.isArray(card_ids) && card_ids.length > 0) {
    const userCards = db.getCards().filter(c => c.user_id === userId && card_ids.includes(c.id));
    targetWords = userCards.map(c => c.term);
    targetIds = userCards.map(c => c.id);
  } else if (Array.isArray(custom_words) && custom_words.length > 0) {
    targetWords = custom_words.map((w: string) => (w || '').trim()).filter(Boolean);
  } else if (typeof custom_words === 'string' && custom_words.trim()) {
    targetWords = custom_words.split(/[,;\n]/).map((w: string) => w.trim()).filter(Boolean);
  } else {
    // Pick 5-8 cards automatically from user's deck
    const userCards = db.getCards().filter(c => c.user_id === userId);
    if (userCards.length > 0) {
      const sample = [...userCards].sort(() => 0.5 - Math.random()).slice(0, 6);
      targetWords = sample.map(c => c.term);
      targetIds = sample.map(c => c.id);
    }
  }

  if (targetWords.length < 2) {
    return res.status(400).json({ error: 'Cần ít nhất 2-3 từ vựng (chọn từ bộ thẻ hoặc nhập trực tiếp) để tạo bài đọc.' });
  }

  try {
    const reading = await aiProvider.generateReading(targetWords, level, topic);
    const passageRecord: any = {
      id: crypto.randomUUID(),
      user_id: userId,
      title: reading.title,
      passage: reading.passage,
      level: reading.level,
      topic: reading.topic,
      target_card_ids: targetIds,
      target_words: targetWords,
      questions: reading.questions,
      created_at: Date.now(),
    };

    db.getReadingPassages().unshift(passageRecord);
    // Keep max 50 passages per user (FR-RD-07)
    const userPassages = db.getReadingPassages().filter(p => p.user_id === userId);
    if (userPassages.length > 50) {
      const excess = userPassages.slice(50);
      const excessIds = new Set(excess.map(e => e.id));
      const passages = db.getReadingPassages();
      for (let i = passages.length - 1; i >= 0; i--) {
        if (excessIds.has(passages[i].id)) passages.splice(i, 1);
      }
    }

    db.scheduleSave();
    return res.json({ success: true, reading: passageRecord });
  } catch (err: any) {
    return res.status(500).json({
      error: err.message || 'Không thể tạo bài đọc lúc này. Vui lòng thử lại.',
    });
  }
});

// List User's Reading Passages
app.get('/api/reading', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const passages = db.getReadingPassages().filter(p => p.user_id === userId).sort((a, b) => b.created_at - a.created_at);
  return res.json({ passages });
});

// Delete Reading Passage
app.delete('/api/reading/:id', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const passages = db.getReadingPassages();
  const idx = passages.findIndex(p => p.id === id && p.user_id === userId);
  if (idx !== -1) {
    passages.splice(idx, 1);
    db.scheduleSave();
  }
  return res.json({ success: true });
});

// -------------------------------------------------------------
// VITE MIDDLEWARE SETUP (Full-Stack Dev & Prod Mode)
// -------------------------------------------------------------

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SmartVocab.io] Server listening on http://0.0.0.0:${PORT}`);
  });
}

// In standard Node/dev environment, run startServer()
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  startServer();
}

export default app;
export { app };
