import React, { useState, useEffect } from 'react';
import { Mail, KeyRound, UserCheck, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiRequest, setStoredSessionToken } from '../lib/api';
import { User, UserSettings } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: User, settings: UserSettings) => void;
  initialEmail?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  initialEmail = '',
}) => {
  const [tab, setTab] = useState<'login' | 'request'>('login');
  const [email, setEmail] = useState(initialEmail);
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [backupOtp, setBackupOtp] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<boolean>(true);

  // Request form state
  const [reqName, setReqName] = useState('');
  const [reqNote, setReqNote] = useState('');

  // Countdown for resend
  const [resendTimer, setResendTimer] = useState(0);

  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessMsg(null);
      setOtpCode('');
      setBackupOtp(null);
      setEmailSent(true);
      if (initialEmail) setEmail(initialEmail);
    }
  }, [isOpen, initialEmail]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Vui lòng nhập địa chỉ email.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const data = await apiRequest<{
        success: boolean;
        message: string;
        emailSent?: boolean;
        backupOtpCode?: string;
        emailDisplay?: string;
      }>('/api/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });

      setSuccessMsg(data.message);
      setStep('otp');
      setOtpCode('');
      setResendTimer(60);
      setBackupOtp(data.backupOtpCode || null);
      setEmailSent(data.emailSent ?? true);
    } catch (err: any) {
      setError(err.message || 'Không thể gửi mã OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectQuickEmail = (targetEmail: string) => {
    setEmail(targetEmail);
    setError(null);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim() || otpCode.trim().length !== 6) {
      setError('Mã OTP gồm đúng 6 chữ số từ email của bạn.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest<{ success: boolean; user: User; settings: UserSettings; sessionToken?: string; token?: string }>('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), code: otpCode.trim() }),
      });

      if (data.success && data.user) {
        const token = data.sessionToken || data.token;
        if (token) {
          setStoredSessionToken(token);
        }
        onLoginSuccess(data.user, data.settings);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Xác thực OTP thất bại. Vui lòng kiểm tra lại mã đã nhận.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendAccessRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Vui lòng nhập email của bạn.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const data = await apiRequest<{ success: boolean; message: string }>('/api/access-requests', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          displayName: reqName.trim(),
          note: reqNote.trim(),
        }),
      });

      setSuccessMsg(data.message);
    } catch (err: any) {
      setError(err.message || 'Không thể gửi yêu cầu truy cập.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Modal Header */}
        <div className="p-6 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {tab === 'login' ? 'Đăng nhập vào SmartVocab.io' : 'Gửi yêu cầu tham gia SmartVocab.io'}
            </h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
            >
              ✕
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Học từ vựng khoa học với Spaced Repetition (SRS) và trợ lý AI Gemini
          </p>

          {/* Mode Switcher Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mt-4">
            <button
              onClick={() => {
                setTab('login');
                setError(null);
                setSuccessMsg(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                tab === 'login'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Đăng nhập OTP
            </button>
            <button
              onClick={() => {
                setTab('request');
                setError(null);
                setSuccessMsg(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                tab === 'request'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Xin cấp quyền truy cập
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl text-red-700 dark:text-red-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {tab === 'login' ? (
            step === 'email' ? (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                {/* Quick Fill Email Helper */}
                <div className="p-3 bg-blue-50/70 dark:bg-blue-950/40 rounded-xl border border-blue-100 dark:border-blue-900/50 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-blue-800 dark:text-blue-300">
                    <span>⚡ Điền nhanh địa chỉ email:</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleSelectQuickEmail('huyhoangpham387@gmail.com')}
                      className="px-2.5 py-1.5 bg-white dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-slate-700 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-left font-medium flex items-center justify-between transition-colors shadow-2xs"
                    >
                      <span>🔑 <strong>Admin:</strong> huyhoangpham387@gmail.com</span>
                      <span className="text-[10px] text-blue-500 font-semibold">Bấm để điền →</span>
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleSelectQuickEmail('huyhoangpham280102@gmail.com')}
                      className="px-2.5 py-1.5 bg-white dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-left font-medium flex items-center justify-between transition-colors shadow-2xs"
                    >
                      <span>👤 <strong>Học viên:</strong> huyhoangpham280102@gmail.com</span>
                      <span className="text-[10px] text-slate-500 font-semibold">Bấm để điền →</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Địa chỉ Email nhận mã OTP
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="ban@gmail.com"
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Hệ thống sẽ gửi mã OTP gồm 6 chữ số vào hòm thư email này.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>{loading ? 'Đang gửi mã tới email...' : 'Gửi mã OTP về email'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                {emailSent ? (
                  <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-900/50 flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-emerald-950 dark:text-emerald-200">
                      <div>Mã xác thực OTP gồm 6 chữ số đã được gửi tới email:</div>
                      <div className="font-bold text-emerald-700 dark:text-emerald-300 text-sm mt-0.5">{email}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        Vui lòng mở hộp thư email của bạn (kiểm tra cả mục <strong>Hộp thư đến</strong> và <strong>Thư rác/Spam</strong>), sau đó nhập mã OTP 6 số vào ô bên dưới.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-900/50 space-y-2">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-950 dark:text-amber-200">
                        <div className="font-semibold text-amber-900 dark:text-amber-100">
                          Chưa kích hoạt Mail Server Cloudflare (Thiếu API Key gửi email)
                        </div>
                        <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5 leading-relaxed">
                          Do tài khoản Cloudflare chưa cài đặt biến môi trường <code>RESEND_API_KEY</code> hoặc <code>BREVO_API_KEY</code>, email chưa thể gửi tới Gmail.
                        </p>
                        {backupOtp && (
                          <div className="mt-2 p-2.5 bg-amber-100/80 dark:bg-amber-900/50 rounded-lg border border-amber-300 dark:border-amber-800 flex items-center justify-between">
                            <div>
                              <span className="text-[11px] text-amber-800 dark:text-amber-300 block font-medium">Mã OTP của bạn:</span>
                              <span className="font-mono text-xl font-black tracking-[0.25em] text-amber-900 dark:text-amber-100">{backupOtp}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setOtpCode(backupOtp)}
                              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-[11px] font-semibold transition-colors"
                            >
                              Điền mã này
                            </button>
                          </div>
                        )}
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                          👉 Hãy nhập mã 6 số này vào ô bên dưới để đăng nhập.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Nhập mã OTP 6 chữ số từ email
                    </label>
                    <button
                      type="button"
                      onClick={() => setStep('email')}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Đổi email khác
                    </button>
                  </div>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      maxLength={6}
                      autoFocus
                      required
                      value={otpCode}
                      onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="______"
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-center text-xl tracking-[0.4em] font-mono font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Mã xác thực có hiệu lực trong vòng 10 phút.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>{loading ? 'Đang xác thực...' : 'Xác thực & Đăng nhập'}</span>
                  <CheckCircle2 className="w-4 h-4" />
                </button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    disabled={resendTimer > 0 || loading}
                    onClick={handleRequestOtp}
                    className="text-xs text-slate-500 hover:text-blue-600 disabled:opacity-50"
                  >
                    {resendTimer > 0
                      ? `Gửi lại mã sau ${resendTimer}s`
                      : 'Chưa nhận được mã? Gửi lại mã'}
                  </button>
                </div>
              </form>
            )
          ) : (
            <form onSubmit={handleSendAccessRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Địa chỉ Email của bạn
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="ban@gmail.com"
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Tên hiển thị
                </label>
                <input
                  type="text"
                  value={reqName}
                  onChange={e => setReqName(e.target.value)}
                  placeholder="Ví dụ: Hoàng Phạm"
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Lời nhắn gửi Quản trị viên (≤300 ký tự)
                </label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={reqNote}
                  onChange={e => setReqNote(e.target.value)}
                  placeholder="Mục đích học tập, lớp học hoặc lý do muốn tham gia..."
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <UserCheck className="w-4 h-4" />
                <span>{loading ? 'Đang gửi...' : 'Gửi yêu cầu truy cập'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
