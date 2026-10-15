import React, { useState, useEffect } from 'react';
import { Shield, UserCheck, UserX, UserPlus, Lock, Unlock, AlertCircle, CheckCircle2, RotateCw, Power, Settings, Search } from 'lucide-react';
import { AdminUserRecord } from '../types';
import { apiRequest } from '../lib/api';

export const AdminPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'users' | 'settings'>('users');
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');

  // AI App Settings state
  const [aiKillSwitch, setAiKillSwitch] = useState(false);
  const [aiBudget, setAiBudget] = useState(1000);
  const [defaultLookupQuota, setDefaultLookupQuota] = useState(50);
  const [defaultReadingQuota, setDefaultReadingQuota] = useState(10);

  useEffect(() => {
    loadUsers();
    loadSettings();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ users: AdminUserRecord[] }>('/api/admin/users');
      setUsers(res.users || []);
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Không thể tải danh sách người dùng.' });
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await apiRequest<{ settings: any }>('/api/admin/settings');
      if (res.settings) {
        setAiKillSwitch(res.settings.ai_kill_switch);
        setAiBudget(res.settings.ai_daily_budget);
        setDefaultLookupQuota(res.settings.default_daily_lookup_quota);
        setDefaultReadingQuota(res.settings.default_daily_reading_quota);
      }
    } catch {
      // ignore
    }
  };

  const handleApprove = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/users/${id}/approve`, { method: 'POST' });
      setFeedbackMsg({ type: 'success', text: res.message });
      loadUsers();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/users/${id}/reject`, { method: 'POST' });
      setFeedbackMsg({ type: 'success', text: res.message });
      loadUsers();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuspend = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/users/${id}/suspend`, { method: 'POST' });
      setFeedbackMsg({ type: 'success', text: res.message });
      loadUsers();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReactivate = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/users/${id}/reactivate`, { method: 'POST' });
      setFeedbackMsg({ type: 'success', text: res.message });
      loadUsers();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPending = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await apiRequest<{ message: string }>(`/api/admin/users/${id}/reset-pending`, { method: 'POST' });
      setFeedbackMsg({ type: 'success', text: res.message });
      loadUsers();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setActionLoading(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/admin/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), displayName: inviteName.trim() }),
      });
      setFeedbackMsg({ type: 'success', text: res.message });
      setShowInviteModal(false);
      setInviteEmail('');
      setInviteName('');
      loadUsers();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setActionLoading(true);
    try {
      await apiRequest('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          ai_kill_switch: aiKillSwitch,
          ai_daily_budget: aiBudget,
          default_daily_lookup_quota: defaultLookupQuota,
          default_daily_reading_quota: defaultReadingQuota,
        }),
      });
      setFeedbackMsg({ type: 'success', text: 'Đã lưu cấu hình quản trị thành công!' });
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const filteredUsers = users.filter(u => {
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    if (search.trim()) {
      const term = (search || '').toLowerCase();
      return (u.email || '').toLowerCase().includes(term) || (u.displayName || '').toLowerCase().includes(term);
    }
    return true;
  });

  const pendingCount = users.filter(u => u.status === 'pending').length;

  return (
    <div className="space-y-6">
      {/* Admin Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 rounded-full text-xs font-semibold mb-2">
            <Shield className="w-3.5 h-3.5" />
            <span>Khu vực Quản trị Hệ thống</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
            Phê duyệt & Quản trị Quyền Truy cập
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Chỉ những tài khoản được bạn kích hoạt mới có thể đăng nhập. Quyền riêng tư: Không hiển thị nội dung học tập của học viên.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span>Mời người dùng mới</span>
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-center justify-between gap-2 ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/30 border-red-200 text-red-800 dark:text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedbackMsg.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Admin Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition-colors flex items-center gap-2 ${
            activeTab === 'users'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <span>Danh sách Tài khoản</span>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full">
              {pendingCount} chờ duyệt
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition-colors flex items-center gap-2 ${
            activeTab === 'settings'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Cấu hình AI & Ngân sách</span>
        </button>

        <div className="ml-auto">
          <button
            onClick={() => loadUsers()}
            disabled={loading}
            title="Làm mới danh sách"
            className="p-2 text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors flex items-center gap-1.5 text-xs font-semibold"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            <span className="hidden sm:inline">Làm mới</span>
          </button>
        </div>
      </div>

      {pendingCount > 0 && activeTab === 'users' && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-2xl flex items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="font-semibold">
              Có {pendingCount} tài khoản đang gửi yêu cầu và chờ bạn phê duyệt!
            </span>
          </div>
          <button
            onClick={() => setStatusFilter('pending')}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg text-xs transition-colors shadow-xs"
          >
            Xem danh sách chờ duyệt
          </button>
        </div>
      )}

      {activeTab === 'users' ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          {/* Filters & Search */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl overflow-x-auto text-xs font-semibold">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  statusFilter === 'all'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Tất cả ({users.length})
              </button>
              <button
                onClick={() => setStatusFilter('pending')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  statusFilter === 'pending'
                    ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Chờ duyệt ({users.filter(u => u.status === 'pending').length})
              </button>
              <button
                onClick={() => setStatusFilter('active')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  statusFilter === 'active'
                    ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Đã duyệt ({users.filter(u => u.status === 'active').length})
              </button>
              <button
                onClick={() => setStatusFilter('suspended')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  statusFilter === 'suspended'
                    ? 'bg-white dark:bg-slate-700 text-red-600 dark:text-red-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Bị khóa ({users.filter(u => u.status === 'suspended').length})
              </button>
            </div>

            <div className="relative max-w-xs w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm email, tên..."
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Users Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3">Người dùng</th>
                  <th className="p-3">Trạng thái</th>
                  <th className="p-3">Vai trò</th>
                  <th className="p-3">Số liệu tổng</th>
                  <th className="p-3">Lời nhắn xin vào</th>
                  <th className="p-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredUsers.map(u => {
                  let statusBadge = (
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded font-medium">
                      {u.status}
                    </span>
                  );

                  if (u.status === 'pending') {
                    statusBadge = (
                      <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 rounded font-semibold">
                        Chờ duyệt
                      </span>
                    );
                  } else if (u.status === 'active') {
                    statusBadge = (
                      <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 rounded font-semibold">
                        Hoạt động
                      </span>
                    );
                  } else if (u.status === 'suspended') {
                    statusBadge = (
                      <span className="px-2 py-0.5 bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 rounded font-semibold">
                        Bị khóa
                      </span>
                    );
                  }

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="p-3">
                        <span className="font-bold text-slate-900 dark:text-white block">
                          {u.displayName}
                        </span>
                        <span className="text-slate-400 text-[11px] font-mono">
                          {u.email}
                        </span>
                      </td>

                      <td className="p-3">{statusBadge}</td>

                      <td className="p-3 text-slate-600 dark:text-slate-300">
                        {u.role === 'admin' ? (
                          <span className="font-bold text-blue-600 dark:text-blue-400">Admin</span>
                        ) : (
                          'Học viên'
                        )}
                      </td>

                      <td className="p-3 text-slate-500">
                        <span>{u.deckCount} bộ</span> · <span>{u.cardCount} từ</span>
                      </td>

                      <td className="p-3 text-slate-500 max-w-xs truncate" title={u.requestNote}>
                        {u.requestNote || '—'}
                      </td>

                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {u.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleApprove(u.id)}
                                disabled={actionLoading}
                                title="Phê duyệt truy cập"
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-xs"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                <span>Duyệt</span>
                              </button>
                              <button
                                onClick={() => handleReject(u.id)}
                                disabled={actionLoading}
                                title="Từ chối yêu cầu"
                                className="px-2.5 py-1 bg-slate-100 hover:bg-red-50 text-red-600 rounded-lg text-xs font-semibold flex items-center gap-1"
                              >
                                <UserX className="w-3.5 h-3.5" />
                                <span>Từ chối</span>
                              </button>
                            </>
                          )}

                          {u.status === 'active' && u.role !== 'admin' && (
                            <button
                              onClick={() => handleSuspend(u.id)}
                              disabled={actionLoading}
                              title="Khóa tài khoản"
                              className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 text-red-600 rounded-lg text-xs font-medium flex items-center gap-1"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              <span>Khóa</span>
                            </button>
                          )}

                          {(u.status === 'suspended' || u.status === 'rejected') && (
                            <button
                              onClick={() => handleReactivate(u.id)}
                              disabled={actionLoading}
                              title="Mở khóa tài khoản"
                              className="px-2.5 py-1 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 rounded-lg text-xs font-semibold flex items-center gap-1"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                              <span>Mở khóa</span>
                            </button>
                          )}

                          {u.role !== 'admin' && u.status !== 'pending' && (
                            <button
                              onClick={() => handleResetPending(u.id)}
                              disabled={actionLoading}
                              title="Chuyển về trạng thái Chờ duyệt để thử nghiệm tính năng Duyệt"
                              className="px-2 py-1 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-medium flex items-center gap-1"
                            >
                              <RotateCw className="w-3 h-3" />
                              <span>Về Chờ duyệt</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Settings Tab */
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6 max-w-2xl">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            <span>Cấu hình Trợ lý AI Toàn Cục</span>
          </h3>

          {/* Kill switch */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-between gap-4">
            <div>
              <span className="font-bold text-sm text-slate-900 dark:text-white block">
                Công tắc ngắt AI khẩn cấp (Kill-Switch)
              </span>
              <span className="text-xs text-slate-500 mt-0.5 block">
                Khi bật, toàn bộ tính năng tra từ AI và tạo bài đọc sẽ bị tạm dừng để tiết kiệm hạn ngạch.
              </span>
            </div>

            <button
              onClick={() => setAiKillSwitch(!aiKillSwitch)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs ${
                aiKillSwitch
                  ? 'bg-red-600 text-white'
                  : 'bg-emerald-600 text-white'
              }`}
            >
              <Power className="w-4 h-4" />
              <span>{aiKillSwitch ? 'AI Đang Tắt' : 'AI Đang Bật'}</span>
            </button>
          </div>

          {/* Quotas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Hạn ngạch tra từ AI / người dùng / ngày:
              </label>
              <input
                type="number"
                value={defaultLookupQuota}
                onChange={e => setDefaultLookupQuota(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Hạn ngạch bài đọc AI / người dùng / ngày:
              </label>
              <input
                type="number"
                value={defaultReadingQuota}
                onChange={e => setDefaultReadingQuota(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <button
            onClick={handleSaveSettings}
            disabled={actionLoading}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-all disabled:opacity-40"
          >
            Lưu thay đổi cấu hình
          </button>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Mời người dùng mới
            </h3>
            <p className="text-xs text-slate-500">
              Người được mời sẽ được chuyển ngay sang trạng thái Hoạt động và có thể đăng nhập bằng mã OTP.
            </p>

            <form onSubmit={handleInviteUser} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Email Gmail người nhận *
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="hocvien@gmail.com"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tên hiển thị (Tùy chọn)
                </label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  placeholder="Ví dụ: Minh Tuấn"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !inviteEmail.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs disabled:opacity-40"
                >
                  Kích hoạt & Mời
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
