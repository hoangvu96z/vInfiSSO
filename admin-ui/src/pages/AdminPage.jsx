import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Layout, Menu, Typography, Button, Card, Row, Col, Table, Tag,
  Switch, Modal, Form, Input, InputNumber, Select, message, Space,
  Statistic, Avatar, ConfigProvider, theme, Badge, Image, Popconfirm, Progress
} from 'antd';
import {
  BarChartOutlined, UserOutlined, AuditOutlined, RobotOutlined,
  CrownOutlined, TagOutlined, LogoutOutlined, SunOutlined, MoonOutlined,
  CopyOutlined, DeleteOutlined, EditOutlined, GiftOutlined, ReloadOutlined,
  CheckCircleOutlined, CloseCircleOutlined, PoweroffOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, MessageOutlined, EyeOutlined,
  PictureOutlined, CheckOutlined, GlobalOutlined, MobileOutlined, CompassOutlined,
  FilterOutlined
} from '@ant-design/icons';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title as ChartTitle, Tooltip as ChartTooltip, Legend, Filler
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import ModernDataTable from '../components/ModernDataTable';
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS, formatTimeWithZone, getTimezoneLabel } from '../utils/dateUtils';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, ChartTitle, ChartTooltip, Legend, Filler
);

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

function getAuthHeaders() {
  const token = localStorage.getItem('sso_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function authFetch(url, options = {}) {
  const headers = { ...getAuthHeaders(), ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers, credentials: 'include' });
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/ui/sso';
    return null;
  }
  return res;
}

export default function AdminPage({ user, onLogout }) {
  const [currentRoute, setCurrentRoute] = useState(() => (window.location.hash || '#analytics').replace('#', ''));
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false));
  const [collapsed, setCollapsed] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 992 : false));
  const [timezone, setTimezone] = useState(() => {
    return localStorage.getItem('admin_timezone') || DEFAULT_TIMEZONE;
  });

  const handleTimezoneChange = (tz) => {
    setTimezone(tz);
    localStorage.setItem('admin_timezone', tz);
    message.success(`Đã đổi múi giờ sang ${getTimezoneLabel(tz)}`);
  };

  // Sync hash routing & window resize
  useEffect(() => {
    const handleHash = () => {
      const hash = (window.location.hash || '#analytics').replace('#', '');
      setCurrentRoute(hash || 'analytics');
    };
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setCollapsed(true);
    };
    window.addEventListener('hashchange', handleHash);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('hashchange', handleHash);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const changeRoute = (key) => {
    window.location.hash = key;
    setCurrentRoute(key);
    if (isMobile) setCollapsed(true);
  };

  // State data
  const [stats, setStats] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);

  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');

  const [aiUsage, setAiUsage] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);

  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [formPlan] = Form.useForm();

  const [coupons, setCoupons] = useState([]);
  const [couponsLoading, setCouponsLoading] = useState(false);
  const [isCouponModalOpen, setIsCouponModalOpen] = useState(false);
  const [formCoupon] = Form.useForm();

  const [grantModalUser, setGrantModalUser] = useState(null);
  const [formGrant] = Form.useForm();

  // Contact Messages State
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // Traffic Analytics State
  const [trafficStats, setTrafficStats] = useState(null);
  const [trafficLogs, setTrafficLogs] = useState([]);
  const [trafficTotal, setTrafficTotal] = useState(0);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [trafficDays, setTrafficDays] = useState(30);
  const [trafficApp, setTrafficApp] = useState('all');
  const [trafficSearch, setTrafficSearch] = useState('');
  const [trafficPage, setTrafficPage] = useState(1);

  // Modern DataTable Selection & Search States
  const [selectedUserRows, setSelectedUserRows] = useState([]);
  const [clearUserSelected, setClearUserSelected] = useState(false);

  const [selectedCouponRows, setSelectedCouponRows] = useState([]);
  const [clearCouponSelected, setClearCouponSelected] = useState(false);
  const [couponSearch, setCouponSearch] = useState('');

  const [selectedContactRows, setSelectedContactRows] = useState([]);
  const [clearContactSelected, setClearContactSelected] = useState(false);
  const [contactFilterStatus, setContactFilterStatus] = useState('all');
  const [contactSearchText, setContactSearchText] = useState('');

  const [selectedTrafficRows, setSelectedTrafficRows] = useState([]);
  const [clearTrafficSelected, setClearTrafficSelected] = useState(false);

  const [aiSearch, setAiSearch] = useState('');

  // Load Dashboard Stats & Charts
  const loadAnalytics = useCallback(async () => {
    const [resStats, resCharts, resUnread] = await Promise.all([
      authFetch('/admin/stats'),
      authFetch('/admin/analytics'),
      authFetch('/contact/admin/unread-count'),
    ]);
    if (resStats) {
      const dataStats = await resStats.json();
      setStats(dataStats);
    }
    if (resCharts) {
      const dataCharts = await resCharts.json();
      setAnalyticsData(dataCharts);
    }
    if (resUnread) {
      const countData = await resUnread.json();
      setUnreadCount(countData.count || 0);
    }
  }, []);

  // Load Users Table
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    const query = new URLSearchParams();
    if (userSearch) query.set('search', userSearch);
    if (roleFilter) query.set('role', roleFilter);
    const res = await authFetch(`/admin/users?${query.toString()}`);
    if (res) {
      const data = await res.json();
      setUsers(data.users || data.data || []);
    }
    setUsersLoading(false);
  }, [userSearch, roleFilter]);

  // Load Audit Logs Table
  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    const query = new URLSearchParams();
    if (auditSearch) query.set('search', auditSearch);
    const res = await authFetch(`/admin/audit-logs?${query.toString()}`);
    if (res) {
      const data = await res.json();
      setAuditLogs(data.logs || data.data || []);
    }
    setAuditLoading(false);
  }, [auditSearch]);

  // Load AI Usage Table
  const loadAiUsage = useCallback(async () => {
    setAiLoading(true);
    const res = await authFetch('/admin/ai-usage');
    if (res) {
      const data = await res.json();
      setAiUsage(data.userAiStats || data.data || []);
    }
    setAiLoading(false);
  }, []);

  // Load Plans
  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    const res = await authFetch('/admin/plans');
    if (res) {
      const data = await res.json();
      setPlans(data.plans || []);
    }
    setPlansLoading(false);
  }, []);

  // Load Coupons
  const loadCoupons = useCallback(async () => {
    setCouponsLoading(true);
    const res = await authFetch('/admin/coupons');
    if (res) {
      const data = await res.json();
      setCoupons(data.coupons || []);
    }
    setCouponsLoading(false);
  }, []);

  // Load Contact Messages
  const loadContactMessages = useCallback(async () => {
    setMessagesLoading(true);
    const [resList, resCount] = await Promise.all([
      authFetch('/contact/admin/messages?limit=100'),
      authFetch('/contact/admin/unread-count'),
    ]);
    if (resList) {
      const data = await resList.json();
      setMessages(data.messages || []);
    }
    if (resCount) {
      const countData = await resCount.json();
      setUnreadCount(countData.count || 0);
    }
    setMessagesLoading(false);
  }, []);

  // Load Traffic Analytics
  const loadTraffic = useCallback(async () => {
    setTrafficLoading(true);
    const [resStats, resLogs] = await Promise.all([
      authFetch(`/analytics/admin/stats?days=${trafficDays}&app=${trafficApp}`),
      authFetch(`/analytics/admin/logs?page=${trafficPage}&limit=20&app=${trafficApp}&search=${encodeURIComponent(trafficSearch || '')}`),
    ]);
    if (resStats) {
      const data = await resStats.json();
      setTrafficStats(data);
    }
    if (resLogs) {
      const data = await resLogs.json();
      setTrafficLogs(data.logs || []);
      setTrafficTotal(data.total || 0);
    }
    setTrafficLoading(false);
  }, [trafficDays, trafficApp, trafficPage, trafficSearch]);

  // Route Initializer
  useEffect(() => {
    if (currentRoute === 'analytics') loadAnalytics();
    if (currentRoute === 'traffic') loadTraffic();
    if (currentRoute === 'users') loadUsers();
    if (currentRoute === 'audit') loadAudit();
    if (currentRoute === 'ai') loadAiUsage();
    if (currentRoute === 'plans') loadPlans();
    if (currentRoute === 'coupons') loadCoupons();
    if (currentRoute === 'contact') loadContactMessages();
  }, [currentRoute, loadAnalytics, loadTraffic, loadUsers, loadAudit, loadAiUsage, loadPlans, loadCoupons, loadContactMessages]);

  // Actions for Contact Messages
  const handleViewMessage = async (msgSummary) => {
    setDetailModalOpen(true);
    setDetailLoading(true);
    const res = await authFetch(`/contact/admin/messages/${msgSummary.id}`);
    if (res) {
      const data = await res.json();
      setSelectedMessage(data.message);
      if (!msgSummary.isRead) {
        await authFetch(`/contact/admin/messages/${msgSummary.id}/read`, { method: 'PATCH' });
        setMessages((prev) => prev.map((m) => m.id === msgSummary.id ? { ...m, isRead: true } : m));
        setUnreadCount((c) => Math.max(0, c - 1));
      }
    }
    setDetailLoading(false);
  };

  const handleMarkAllRead = async () => {
    const res = await authFetch('/contact/admin/read-all', { method: 'PATCH' });
    if (res) {
      message.success('Đã đánh dấu tất cả là đã đọc! ✅');
      setMessages((prev) => prev.map((m) => ({ ...m, isRead: true })));
      setUnreadCount(0);
    }
  };

  const handleDeleteMessage = async (id) => {
    const res = await authFetch(`/contact/admin/messages/${id}`, { method: 'DELETE' });
    if (res) {
      message.success('Đã xóa tin nhắn! 🗑️');
      setMessages((prev) => prev.filter((m) => m.id !== id));
      setUnreadCount((c) => Math.max(0, c - 1));
      if (selectedMessage?.id === id) {
        setDetailModalOpen(false);
        setSelectedMessage(null);
      }
    }
  };

  // Batch delete / mark read for Contact Messages
  const handleBatchDeleteMessages = async (ids) => {
    if (!ids || ids.length === 0) return;
    const res = await authFetch('/contact/admin/messages/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res && res.ok) {
      const data = await res.json();
      message.success(`Đã xóa ${data.count || ids.length} tin nhắn đã chọn! 🗑️`);
      setMessages(prev => prev.filter(m => !ids.includes(m.id)));
      setClearContactSelected(prev => !prev);
      setSelectedContactRows([]);
      if (selectedMessage && ids.includes(selectedMessage.id)) {
        setDetailModalOpen(false);
        setSelectedMessage(null);
      }
      loadAnalytics();
    } else {
      message.error('Lỗi khi xóa tin nhắn hàng loạt');
    }
  };

  const handleBatchMarkReadMessages = async (ids) => {
    if (!ids || ids.length === 0) return;
    const res = await authFetch('/contact/admin/messages/batch-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res && res.ok) {
      const data = await res.json();
      message.success(`Đã đánh dấu ${data.count || ids.length} tin nhắn đã đọc! ✅`);
      setMessages(prev => prev.map(m => ids.includes(m.id) ? { ...m, isRead: true } : m));
      setClearContactSelected(prev => !prev);
      setSelectedContactRows([]);
      loadAnalytics();
    } else {
      message.error('Lỗi khi đánh dấu đã đọc');
    }
  };

  // Batch revoke sessions for Users
  const handleBatchRevokeSessions = async (userIds) => {
    if (!userIds || userIds.length === 0) return;
    const res = await authFetch('/admin/users/batch-revoke-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds }),
    });
    if (res && res.ok) {
      const data = await res.json();
      message.info(data.message || `Đã hủy phiên của ${userIds.length} người dùng! ⚡`);
      setClearUserSelected(prev => !prev);
      setSelectedUserRows([]);
      loadUsers();
    } else {
      message.error('Lỗi khi hủy phiên hàng loạt');
    }
  };

  // Batch delete coupons
  const handleBatchDeleteCoupons = async (ids) => {
    if (!ids || ids.length === 0) return;
    const res = await authFetch('/admin/coupons/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res && res.ok) {
      message.info(`Đã xóa ${ids.length} mã khuyến mãi đã chọn! 🗑️`);
      setClearCouponSelected(prev => !prev);
      setSelectedCouponRows([]);
      loadCoupons();
    } else {
      message.error('Lỗi khi xóa mã khuyến mãi hàng loạt');
    }
  };

  // Batch delete traffic logs
  const handleBatchDeleteTrafficLogs = async (ids) => {
    if (!ids || ids.length === 0) return;
    const res = await authFetch('/analytics/admin/logs/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res && res.ok) {
      message.info(`Đã xóa ${ids.length} bản ghi truy cập! 🗑️`);
      setClearTrafficSelected(prev => !prev);
      setSelectedTrafficRows([]);
      loadTraffic();
    } else {
      message.error('Lỗi khi xóa bản ghi truy cập');
    }
  };

  // Actions
  const handleUpdateRole = async (userId, newRole) => {
    Modal.confirm({
      title: `Xác nhận đổi role?`,
      content: `Đổi role của người dùng thành ${newRole}?`,
      onOk: async () => {
        const res = await authFetch(`/admin/users/${userId}/role`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole }),
        });
        if (res && res.ok) {
          message.success(`Đã cập nhật role thành ${newRole} thành công! ✅`);
          loadUsers();
        }
      },
    });
  };

  const handleRevokeSessions = async (userId) => {
    Modal.confirm({
      title: `Hủy phiên đăng nhập?`,
      content: `Tất cả phiên đăng nhập của người dùng sẽ bị chấm dứt lập tức.`,
      onOk: async () => {
        const res = await authFetch(`/admin/users/${userId}/sessions`, { method: 'DELETE' });
        if (res && res.ok) {
          message.info('Đã hủy tất cả phiên đăng nhập của người dùng! ⚡');
          loadUsers();
        }
      },
    });
  };

  const handleTogglePlan = async (planName, isActive) => {
    const res = await authFetch(`/admin/plans/${planName}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive }),
    });
    if (res && res.ok) {
      message.success(`✅ Đã ${isActive ? 'bật' : 'tắt'} gói ${planName.toUpperCase()}!`);
    } else {
      message.error('❌ Không thể thay đổi trạng thái gói!');
    }
    loadPlans();
  };

  const handleTogglePlanField = async (planName, field, value, label) => {
    const res = await authFetch(`/admin/plans/${planName}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    if (res && res.ok) {
      message.success(`✅ ${label}: ${value ? 'Bật' : 'Tắt'} thành công!`);
    } else {
      message.error(`❌ Không thể cập nhật "${label}"!`);
    }
    loadPlans();
  };

  const handleSavePlan = async (values) => {
    if (!editingPlan) return;
    const res = await authFetch(`/admin/plans/${editingPlan.name}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (res && res.ok) {
      message.success(`💎 Đã lưu thay đổi gói "${editingPlan.label}" thành công!`);
      setEditingPlan(null);
      loadPlans();
    } else {
      message.error('❌ Lưu thất bại! Vui lòng thử lại.');
    }
  };

  const handleSaveCoupon = async (values) => {
    const res = await authFetch('/admin/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, code: values.code.toUpperCase(), isActive: true }),
    });
    if (res && res.ok) {
      setIsCouponModalOpen(false);
      formCoupon.resetFields();
      message.success('Tạo mã khuyến mãi mới thành công! 🎟️');
      loadCoupons();
    } else if (res) {
      const err = await res.json();
      message.error(err.message || 'Lỗi khi tạo mã');
    }
  };

  const handleToggleCoupon = async (id, isActive) => {
    await authFetch(`/admin/coupons/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive }),
    });
    message.info(`Đã ${isActive ? 'bật' : 'tắt'} mã khuyến mãi! 🔄`);
    loadCoupons();
  };

  const handleDeleteCoupon = async (id) => {
    Modal.confirm({
      title: 'Xóa mã khuyến mãi?',
      content: 'Mã này sẽ bị xóa khỏi hệ thống.',
      onOk: async () => {
        await authFetch(`/admin/coupons/${id}`, { method: 'DELETE' });
        message.info('Đã xóa mã khuyến mãi! 🗑️');
        loadCoupons();
      },
    });
  };

  const handleGrantPlan = async (values) => {
    if (!grantModalUser) return;
    const res = await authFetch(`/admin/users/${grantModalUser.id}/grant-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (res && res.ok) {
      setGrantModalUser(null);
      message.success(`Đã tặng gói ${values.planName.toUpperCase()} cho người dùng thành công! 🎁`);
      loadUsers();
    }
  };

  const safeArr = (v) => (Array.isArray(v) ? v : []);

  // Chart configs
  const trafficChartData = {
    labels: safeArr(analyticsData?.timeSeries).map(d => d.date?.slice(5) || ''),
    datasets: [
      {
        label: 'Đăng ký mới',
        data: safeArr(analyticsData?.timeSeries).map(d => d.registers || 0),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.15)',
        fill: true,
        tension: 0.4,
      },
      {
        label: 'Đăng nhập',
        data: safeArr(analyticsData?.timeSeries).map(d => d.logins || 0),
        borderColor: '#10b981',
        backgroundColor: 'transparent',
        tension: 0.4,
      },
    ],
  };

  const appShareData = {
    labels: ['IChingNow (Kinh Dịch)', 'TarotNow (Tarot)', 'TuViNow (Tử Vi)'],
    datasets: [
      {
        data: [
          analyticsData?.appDistribution?.iching || 0,
          analyticsData?.appDistribution?.tarot || 0,
          analyticsData?.appDistribution?.tuvi || 0,
        ],
        backgroundColor: ['#6366f1', '#f59e0b', '#ec4899'],
      },
    ],
  };

  const geoData = {
    labels: safeArr(analyticsData?.topLocations).map(g => g.location || 'Localhost'),
    datasets: [
      {
        label: 'Lượt truy cập',
        data: safeArr(analyticsData?.topLocations).map(g => g.count || 0),
        backgroundColor: '#3b82f6',
        borderRadius: 6,
      },
    ],
  };

  const aiDailyData = {
    labels: safeArr(analyticsData?.timeSeries).map(a => a.date?.slice(5) || ''),
    datasets: [
      {
        label: 'Số lượt hỏi AI',
        data: safeArr(analyticsData?.timeSeries).map(a => a.ai || 0),
        backgroundColor: '#8b5cf6',
        borderRadius: 6,
      },
    ],
  };

  const trafficDailyData = {
    labels: safeArr(trafficStats?.daily).map(d => d.date?.slice(5) || ''),
    datasets: [
      {
        label: 'Tổng lượt truy cập',
        data: safeArr(trafficStats?.daily).map(d => d.visits || 0),
        backgroundColor: '#38bdf8',
        borderColor: '#0284c7',
        borderRadius: 4,
      },
      {
        label: 'Khách duy nhất (IP)',
        data: safeArr(trafficStats?.daily).map(d => d.uniqueVisitors || 0),
        backgroundColor: '#10b981',
        borderColor: '#059669',
        borderRadius: 4,
      },
    ],
  };

  const trafficDeviceData = {
    labels: safeArr(trafficStats?.devices).map(d => d.name),
    datasets: [
      {
        data: safeArr(trafficStats?.devices).map(d => d.count),
        backgroundColor: ['#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#fb923c', '#fbbf24', '#34d399', '#94a3b8'],
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: isDarkMode ? '#94a3b8' : '#475569' } } },
    scales: {
      x: { ticks: { color: isDarkMode ? '#94a3b8' : '#475569' }, grid: { color: isDarkMode ? '#1e293b' : '#e2e8f0' } },
      y: {
        beginAtZero: true,
        ticks: { color: isDarkMode ? '#94a3b8' : '#475569', precision: 0 },
        grid: { color: isDarkMode ? '#1e293b' : '#e2e8f0' }
      },
    },
  };

  // ────────────────────────────────────────────────────────────────
  // Modern DataTable Filter Memos & Column Configurations
  // ────────────────────────────────────────────────────────────────

  const filteredMessages = useMemo(() => {
    return safeArr(messages).filter((m) => {
      if (contactFilterStatus === 'unread' && m.isRead) return false;
      if (contactFilterStatus === 'read' && !m.isRead) return false;
      if (contactSearchText) {
        const q = contactSearchText.toLowerCase();
        const match =
          (m.name && m.name.toLowerCase().includes(q)) ||
          (m.email && m.email.toLowerCase().includes(q)) ||
          (m.title && m.title.toLowerCase().includes(q)) ||
          (m.message && m.message.toLowerCase().includes(q)) ||
          (m.device && m.device.toLowerCase().includes(q)) ||
          (m.location && m.location.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [messages, contactFilterStatus, contactSearchText]);

  const filteredCoupons = useMemo(() => {
    if (!couponSearch) return safeArr(coupons);
    const q = couponSearch.toLowerCase();
    return safeArr(coupons).filter((c) =>
      (c.code && c.code.toLowerCase().includes(q)) ||
      (c.description && c.description.toLowerCase().includes(q)) ||
      (c.planName && c.planName.toLowerCase().includes(q))
    );
  }, [coupons, couponSearch]);

  const filteredAiUsage = useMemo(() => {
    if (!aiSearch) return safeArr(aiUsage);
    const q = aiSearch.toLowerCase();
    return safeArr(aiUsage).filter((u) =>
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.displayName && u.displayName.toLowerCase().includes(q))
    );
  }, [aiUsage, aiSearch]);

  // Users Columns & Context Actions
  const userColumns = useMemo(() => [
    {
      name: 'User Info',
      selector: (r) => (r.fullName || r.displayName || r.email || '').toLowerCase(),
      sortable: true,
      minWidth: '220px',
      grow: 2,
      cell: (r) => (
        <div style={{ padding: '6px 0' }}>
          <strong>{r.fullName || r.displayName || 'User'}</strong>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{r.email}</div>
        </div>
      ),
    },
    {
      name: 'Role',
      selector: (r) => r.role || '',
      sortable: true,
      width: '100px',
      cell: (r) => <Tag color={r.role === 'admin' ? 'purple' : 'default'}>{r.role}</Tag>,
    },
    {
      name: 'Gói Dịch Vụ',
      selector: (r) => r.planName || 'free',
      sortable: true,
      width: '130px',
      cell: (r) => (
        <Tag color={r.planName === 'premium' ? 'gold' : r.planName === 'lite' ? 'blue' : 'default'}>
          {r.planName || 'free'}
        </Tag>
      ),
    },
    {
      name: 'Email Verified',
      selector: (r) => ((r.isVerified ?? r.isEmailVerified) ? 1 : 0),
      sortable: true,
      width: '160px',
      cell: (r) => (r.isVerified ?? r.isEmailVerified) ? (
        <Tag icon={<CheckCircleOutlined />} color="success">Đã xác thực</Tag>
      ) : (
        <Tag icon={<CloseCircleOutlined />} color="error">Chưa xác thực</Tag>
      ),
    },
    {
      name: 'Lượt AI',
      selector: (r) => Number(r.aiQuestionsCount) || 0,
      sortable: true,
      width: '110px',
      cell: (r) => <strong>{r.aiQuestionsCount || 0}</strong>,
    },
    {
      name: 'Thao Tác',
      minWidth: '280px',
      cell: (r) => (
        <Space wrap>
          <Button size="small" onClick={() => handleUpdateRole(r.id, r.role === 'admin' ? 'user' : 'admin')}>
            Role: {r.role === 'admin' ? 'User' : 'Admin'}
          </Button>
          <Button size="small" type="primary" icon={<GiftOutlined />} onClick={() => setGrantModalUser(r)}>
            Tặng Gói
          </Button>
          <Popconfirm
            title="Hủy tất cả phiên của người dùng này?"
            onConfirm={() => handleRevokeSessions(r.id)}
            okText="Hủy phiên"
            cancelText="Đóng"
          >
            <Button size="small" danger>Hủy Session</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], []);

  const userContextActions = useMemo(() => {
    const userIds = selectedUserRows.map((r) => r.id);
    const count = userIds.length;
    return (
      <Popconfirm
        title={`Hủy tất cả phiên đăng nhập của ${count} người dùng đã chọn?`}
        onConfirm={() => handleBatchRevokeSessions(userIds)}
        okText="Hủy phiên"
        cancelText="Đóng"
      >
        <Button danger icon={<PoweroffOutlined />} size="small">
          Hủy phiên ({count} đã chọn)
        </Button>
      </Popconfirm>
    );
  }, [selectedUserRows]);

  // Audit Logs Columns
  const auditColumns = useMemo(() => [
    {
      name: 'Thời Gian',
      selector: (r) => new Date(r.createdAt).getTime(),
      sortable: true,
      minWidth: '160px',
      cell: (r) => formatTimeWithZone(r.createdAt, timezone),
    },
    {
      name: 'Hành Động',
      selector: (r) => r.action || '',
      sortable: true,
      minWidth: '140px',
      cell: (r) => <Tag color="indigo">{r.action}</Tag>,
    },
    {
      name: 'Email',
      selector: (r) => (r.user?.email || r.userEmail || 'Khách').toLowerCase(),
      sortable: true,
      minWidth: '180px',
      cell: (r) => r.user?.email || r.userEmail || 'Khách',
    },
    {
      name: 'Địa Chỉ IP',
      selector: (r) => r.ipAddress || '',
      sortable: true,
      width: '140px',
      cell: (r) => <Tag style={{ fontFamily: 'monospace' }}>{r.ipAddress || '127.0.0.1'}</Tag>,
    },
    {
      name: 'Vị Trí Geo',
      selector: (r) => (r.metadata?.city || r.location || 'Hồ Chí Minh, VN').toLowerCase(),
      sortable: true,
      minWidth: '160px',
      cell: (r) => r.metadata?.city || r.location || 'Hồ Chí Minh, VN',
    },
    {
      name: 'Ứng Dụng',
      selector: (r) => r.app || '',
      sortable: true,
      width: '120px',
      cell: (r) => r.app || '-',
    },
  ], [timezone]);

  // AI Leaderboard Columns
  const aiColumns = useMemo(() => [
    {
      name: 'Email',
      selector: (r) => (r.email || '').toLowerCase(),
      sortable: true,
      minWidth: '180px',
      cell: (r) => <strong>{r.email}</strong>,
    },
    {
      name: 'Họ Tên',
      selector: (r) => (r.displayName || '').toLowerCase(),
      sortable: true,
      minWidth: '150px',
      cell: (r) => r.displayName || '-',
    },
    {
      name: 'Lượt Kinh Dịch',
      selector: (r) => Number(r.ichingReadings) || 0,
      sortable: true,
      width: '150px',
      cell: (r) => <span>{r.ichingReadings || 0}</span>,
    },
    {
      name: 'Lượt Tarot',
      selector: (r) => Number(r.tarotReadings) || 0,
      sortable: true,
      width: '130px',
      cell: (r) => <span>{r.tarotReadings || 0}</span>,
    },
    {
      name: 'Lượt Tử Vi',
      selector: (r) => Number(r.tuviReadings) || 0,
      sortable: true,
      width: '130px',
      cell: (r) => <Tag color="magenta">{r.tuviReadings || 0}</Tag>,
    },
    {
      name: 'Tổng Hỏi AI',
      selector: (r) => Number(r.totalAiQuestions) || 0,
      sortable: true,
      width: '140px',
      cell: (r) => <Tag color="purple" style={{ fontWeight: 700 }}>{r.totalAiQuestions || 0}</Tag>,
    },
  ], []);

  // Coupon Columns & Context Actions
  const couponColumns = useMemo(() => [
    {
      name: 'Mã Code',
      selector: (r) => r.code,
      sortable: true,
      minWidth: '150px',
      cell: (r) => <Tag color="blue" style={{ fontSize: '0.9rem', fontWeight: 700 }}>{r.code}</Tag>,
    },
    {
      name: 'Mô Tả',
      selector: (r) => r.description || '',
      sortable: true,
      minWidth: '180px',
      cell: (r) => r.description || '-',
    },
    {
      name: 'Loại',
      selector: (r) => r.type || '',
      sortable: true,
      width: '130px',
      cell: (r) => r.type === 'grant_plan' ? '🎁 Tặng Gói' : '📅 Tặng Ngày',
    },
    {
      name: 'Gói/Ngày',
      selector: (r) => r.planName || `${r.durationDays || 0}`,
      sortable: true,
      width: '120px',
      cell: (r) => r.planName ? <Tag color="gold">{r.planName}</Tag> : `${r.durationDays}d`,
    },
    {
      name: 'Đã Dùng',
      selector: (r) => Number(r.usedCount) || 0,
      sortable: true,
      width: '120px',
      cell: (r) => `${r.usedCount} / ${r.maxUses === -1 ? '∞' : r.maxUses}`,
    },
    {
      name: 'Trạng Thái',
      selector: (r) => (r.isActive ? 1 : 0),
      sortable: true,
      width: '120px',
      cell: (r) => <Switch checked={r.isActive} onChange={(c) => handleToggleCoupon(r.id, c)} />,
    },
    {
      name: 'Thao Tác',
      width: '160px',
      cell: (r) => (
        <Space>
          <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(r.code); message.info(`Đã copy mã ${r.code}! 📋`); }}>Copy</Button>
          <Popconfirm
            title="Xóa mã khuyến mãi này?"
            onConfirm={() => handleDeleteCoupon(r.id)}
            okText="Xóa"
            cancelText="Hủy"
          >
            <Button size="small" danger icon={<DeleteOutlined />}>Xóa</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], []);

  const couponContextActions = useMemo(() => {
    const ids = selectedCouponRows.map((r) => r.id);
    const count = ids.length;
    return (
      <Popconfirm
        title={`Xóa vĩnh viễn ${count} mã khuyến mãi đã chọn?`}
        onConfirm={() => handleBatchDeleteCoupons(ids)}
        okText="Xóa"
        cancelText="Hủy"
      >
        <Button danger icon={<DeleteOutlined />} size="small">
          Xóa {count} mã đã chọn
        </Button>
      </Popconfirm>
    );
  }, [selectedCouponRows]);

  // Contact Messages Columns & Context Actions
  const contactColumns = useMemo(() => [
    {
      name: 'Trạng thái',
      selector: (r) => (r.isRead ? 1 : 0),
      sortable: true,
      width: '120px',
      cell: (r) => r.isRead ? (
        <Tag color="default">Đã đọc</Tag>
      ) : (
        <Tag color="cyan" style={{ fontWeight: 600 }}>MỚI</Tag>
      ),
    },
    {
      name: 'Người gửi',
      selector: (r) => (r.name || '').toLowerCase(),
      sortable: true,
      minWidth: '180px',
      cell: (r) => (
        <div style={{ padding: '6px 0' }}>
          <div style={{ fontWeight: 600, color: r.isRead ? undefined : '#06b6d4' }}>{r.name}</div>
          {r.email && <div style={{ fontSize: '0.78rem', opacity: 0.65 }}>{r.email}</div>}
        </div>
      ),
    },
    {
      name: 'Tiêu đề / Tin nhắn',
      selector: (r) => (r.title || r.message || '').toLowerCase(),
      sortable: true,
      minWidth: '240px',
      grow: 2,
      cell: (r) => (
        <div style={{ maxWidth: 360, padding: '6px 0' }}>
          {r.title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{r.title}</div>}
          <div style={{ fontSize: '0.85rem', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.message}
          </div>
        </div>
      ),
    },
    {
      name: 'Ảnh',
      selector: (r) => Number(r.imageCount) || (r.hasImage ? 1 : 0),
      sortable: true,
      width: '100px',
      cell: (r) => {
        const count = r.imageCount || (r.hasImage ? 1 : 0);
        if (count > 1) return <Tag icon={<PictureOutlined />} color="cyan">{count} ảnh</Tag>;
        if (count === 1) return <Tag icon={<PictureOutlined />} color="purple">1 ảnh</Tag>;
        return <span style={{ opacity: 0.4 }}>-</span>;
      },
    },
    {
      name: 'Thiết bị & Vị trí',
      selector: (r) => `${r.device || ''} ${r.location || ''}`.toLowerCase(),
      sortable: true,
      minWidth: '170px',
      cell: (r) => (
        <div style={{ fontSize: '0.82rem', padding: '6px 0' }}>
          <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>📱</span>
            <span>{r.device || r.browser || 'Không rõ'}</span>
          </div>
          {r.location && (
            <div style={{ opacity: 0.75, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <span>📍</span>
              <span>{r.location}</span>
            </div>
          )}
        </div>
      ),
    },
    {
      name: 'Thời gian',
      selector: (r) => new Date(r.createdAt).getTime(),
      sortable: true,
      width: '150px',
      cell: (r) => formatTimeWithZone(r.createdAt, timezone, 'short'),
    },
    {
      name: 'Thao tác',
      width: '130px',
      cell: (r) => (
        <Space>
          <Button size="small" type="primary" icon={<EyeOutlined />} onClick={() => handleViewMessage(r)}>
            Xem
          </Button>
          <Popconfirm title="Xóa tin nhắn này?" onConfirm={() => handleDeleteMessage(r.id)} okText="Xóa" cancelText="Hủy">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ], [timezone]);

  const contactContextActions = useMemo(() => {
    const ids = selectedContactRows.map((r) => r.id);
    const count = ids.length;
    return (
      <Space>
        <Button
          size="small"
          icon={<CheckOutlined />}
          onClick={() => handleBatchMarkReadMessages(ids)}
        >
          Đánh dấu {count} đã đọc
        </Button>
        <Popconfirm
          title={`Xóa vĩnh viễn ${count} tin nhắn đã chọn?`}
          onConfirm={() => handleBatchDeleteMessages(ids)}
          okText="Xóa"
          cancelText="Hủy"
        >
          <Button size="small" danger icon={<DeleteOutlined />}>
            Xóa {count} đã chọn
          </Button>
        </Popconfirm>
      </Space>
    );
  }, [selectedContactRows]);

  // Traffic Detailed Logs Columns & Context Actions
  const trafficColumns = useMemo(() => [
    {
      name: 'Thời gian',
      selector: (r) => new Date(r.createdAt).getTime(),
      sortable: true,
      width: '150px',
      cell: (r) => formatTimeWithZone(r.createdAt, timezone, 'full'),
    },
    {
      name: 'App',
      selector: (r) => (r.app || '').toLowerCase(),
      sortable: true,
      width: '130px',
      cell: (r) => {
        const appStr = (r.app || '').toLowerCase();
        if (appStr === 'talkwithme') return <Tag color="cyan">💬 TalkWithMe</Tag>;
        if (appStr === 'tuvi') return <Tag color="purple">🔮 TuViNow</Tag>;
        if (appStr === 'iching') return <Tag color="gold">☯️ IChing</Tag>;
        if (appStr === 'tarot') return <Tag color="magenta">🃏 Tarot</Tag>;
        return <Tag>{r.app}</Tag>;
      },
    },
    {
      name: 'Địa chỉ IP',
      selector: (r) => r.ipAddress || '',
      sortable: true,
      width: '140px',
      cell: (r) => <Tag style={{ fontFamily: 'monospace' }}>{r.ipAddress || '127.0.0.1'}</Tag>,
    },
    {
      name: 'Vị trí & Nhà mạng',
      selector: (r) => `${r.location || ''} ${r.isp || ''}`.toLowerCase(),
      sortable: true,
      minWidth: '180px',
      cell: (r) => (
        <div style={{ padding: '6px 0' }}>
          <div style={{ fontWeight: 500 }}>
            {r.location ? `📍 ${r.location}` : <span style={{ opacity: 0.6 }}>Chưa xác định</span>}
          </div>
          {r.isp && <div style={{ fontSize: '0.78rem', opacity: 0.65 }}>🏢 {r.isp}</div>}
        </div>
      ),
    },
    {
      name: 'Thiết bị & Màn hình',
      selector: (r) => `${r.device || ''} ${r.screen || ''}`.toLowerCase(),
      sortable: true,
      minWidth: '160px',
      cell: (r) => (
        <div style={{ padding: '6px 0' }}>
          <div style={{ fontWeight: 500 }}>📱 {r.device || 'Desktop'}</div>
          {r.screen && <div style={{ fontSize: '0.78rem', opacity: 0.65 }}>🖥️ {r.screen}</div>}
        </div>
      ),
    },
    {
      name: 'Trình duyệt & OS',
      selector: (r) => `${r.browser || ''} ${r.os || ''}`.toLowerCase(),
      sortable: true,
      minWidth: '160px',
      cell: (r) => (
        <div>
          <Tag color="geekblue">{r.browser || 'Browser'}</Tag>
          <span style={{ fontSize: '0.8rem', opacity: 0.75, marginLeft: 4 }}>{r.os || ''}</span>
        </div>
      ),
    },
    {
      name: 'Đường dẫn & Nguồn',
      selector: (r) => r.path || '',
      sortable: true,
      minWidth: '180px',
      cell: (r) => (
        <div style={{ fontSize: '0.82rem', padding: '6px 0' }}>
          <div><code>{r.path || '/'}</code></div>
          {r.referrer && (
            <div style={{ opacity: 0.65, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
              Từ: {r.referrer}
            </div>
          )}
        </div>
      ),
    },
    {
      name: 'Thao tác',
      width: '80px',
      cell: (r) => (
        <Popconfirm
          title="Xóa bản ghi này?"
          onConfirm={() => handleBatchDeleteTrafficLogs([r.id])}
          okText="Xóa"
          cancelText="Hủy"
        >
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ], [timezone]);

  const trafficContextActions = useMemo(() => {
    const ids = selectedTrafficRows.map((r) => r.id);
    const count = ids.length;
    return (
      <Popconfirm
        title={`Xóa vĩnh viễn ${count} bản ghi truy cập đã chọn?`}
        onConfirm={() => handleBatchDeleteTrafficLogs(ids)}
        okText="Xóa"
        cancelText="Hủy"
      >
        <Button danger icon={<DeleteOutlined />} size="small">
          Xóa {count} đã chọn
        </Button>
      </Popconfirm>
    );
  }, [selectedTrafficRows]);

  const renderTrafficMobileCard = useCallback((r) => {
    const appStr = (r.app || '').toLowerCase();
    let appBadge = <Tag>{r.app || 'Web'}</Tag>;
    if (appStr === 'talkwithme') appBadge = <Tag color="cyan">💬 TalkWithMe</Tag>;
    else if (appStr === 'tuvi') appBadge = <Tag color="purple">🔮 TuViNow</Tag>;
    else if (appStr === 'iching') appBadge = <Tag color="gold">☯️ IChing</Tag>;
    else if (appStr === 'tarot') appBadge = <Tag color="magenta">🃏 Tarot</Tag>;

    const formattedDate = formatTimeWithZone(r.createdAt, timezone, 'full');

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* TOP ROW: App badge, Date/Time, Delete Action */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {appBadge}
            <span style={{ fontSize: '0.8rem', opacity: 0.75, fontFamily: 'monospace' }}>
              🕒 {formattedDate}
            </span>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <Popconfirm
              title="Xóa bản ghi này?"
              onConfirm={() => handleBatchDeleteTrafficLogs([r.id])}
              okText="Xóa"
              cancelText="Hủy"
            >
              <Button size="small" danger icon={<DeleteOutlined />} type="text" />
            </Popconfirm>
          </div>
        </div>

        {/* MIDDLE SECTION: IP, ISP & LOCATION */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '6px 8px',
            borderRadius: 6,
            background: isDarkMode ? 'rgba(0, 0, 0, 0.25)' : '#f1f5f9',
            fontSize: '0.82rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>IP:</span>
              <Tag style={{ fontFamily: 'monospace', margin: 0, fontWeight: 600 }}>{r.ipAddress || '127.0.0.1'}</Tag>
            </div>
            {r.isp && (
              <span style={{ fontSize: '0.75rem', opacity: 0.75, color: '#38bdf8' }}>
                🏢 {r.isp}
              </span>
            )}
          </div>
          <div style={{ fontWeight: 500, marginTop: 2 }}>
            {r.location ? `📍 ${r.location}` : <span style={{ opacity: 0.5 }}>📍 Chưa xác định</span>}
          </div>
        </div>

        {/* DEVICE, SCREEN, BROWSER & OS */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, fontSize: '0.8rem' }}>
          <div>
            <span style={{ fontWeight: 500 }}>📱 {r.device || 'Desktop'}</span>
            {r.screen && <span style={{ opacity: 0.65, fontSize: '0.75rem', marginLeft: 4 }}>({r.screen})</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tag color="geekblue" style={{ margin: 0, fontSize: '0.75rem' }}>{r.browser || 'Browser'}</Tag>
            {r.os && <span style={{ fontSize: '0.75rem', opacity: 0.75 }}>{r.os}</span>}
          </div>
        </div>

        {/* PATH & REFERRER */}
        <div style={{ fontSize: '0.76rem', opacity: 0.85, wordBreak: 'break-all' }}>
          <div>
            <span style={{ opacity: 0.6, marginRight: 4 }}>🔗</span>
            <code>{r.path || '/'}</code>
          </div>
          {r.referrer && (
            <div style={{ opacity: 0.65, fontSize: '0.72rem', marginTop: 2 }}>
              ↩️ Từ: {r.referrer}
            </div>
          )}
        </div>
      </div>
    );
  }, [isDarkMode, timezone]);

  const routeTitles = {
    analytics: '📊 Dashboard & Analytics',
    traffic: '🌐 Thống Kê Truy Cập (Traffic Analytics)',
    users: '👥 Quản Lý User & Role',
    audit: '📋 Nhật Ký Traffic & IP',
    ai: '🤖 Leaderboard AI Usage',
    contact: '💬 Hộp Thư TalkWithMe',
    plans: '💎 Gói Dịch Vụ & Hạn Mức',
    coupons: '🎟️ Quản Lý Mã Khuyến Mãi',
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#6366f1',
          borderRadius: 8,
        },
      }}
    >
      <Layout style={{ width: '100vw', minHeight: '100vh', margin: 0, padding: 0 }}>
        {/* SIDEBAR NAVIGATION WITH COLLAPSIBLE TOGGLE */}
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          width={260}
          collapsedWidth={isMobile ? 0 : 80}
          theme={isDarkMode ? 'dark' : 'light'}
          style={{
            borderRight: '1px solid rgba(255,255,255,0.08)',
            position: isMobile && !collapsed ? 'fixed' : 'relative',
            zIndex: isMobile && !collapsed ? 1000 : 1,
            height: isMobile && !collapsed ? '100vh' : 'auto',
          }}
        >
          <div style={{ padding: '18px 16px', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <img src="/vlnfi_sso_favicon_option_1.svg" alt="vInfiSSO" style={{ width: 32, height: 32, flexShrink: 0 }} />
            {!collapsed && (
              <>
                <Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>vInfiSSO</Title>
                <Tag color="indigo">ADMIN</Tag>
              </>
            )}
          </div>

          <Menu
            mode="inline"
            selectedKeys={[currentRoute]}
            onClick={({ key }) => changeRoute(key)}
            style={{ padding: '16px 8px', borderRight: 0 }}
            items={[
              { key: 'analytics', icon: <BarChartOutlined />, label: 'Dashboard & Charts' },
              { key: 'traffic', icon: <GlobalOutlined />, label: 'Thống Kê Truy Cập' },
              { key: 'users', icon: <UserOutlined />, label: 'Quản Lý User & Role' },
              { key: 'audit', icon: <AuditOutlined />, label: 'Nhật Ký Traffic & IP' },
              { key: 'ai', icon: <RobotOutlined />, label: 'Leaderboard AI' },
              {
                key: 'contact',
                icon: <MessageOutlined />,
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span>Tin Nhắn Khách</span>
                    {unreadCount > 0 && (
                      <Badge count={unreadCount} style={{ backgroundColor: '#06b6d4', boxShadow: 'none' }} />
                    )}
                  </span>
                ),
              },
              { type: 'divider' },
              { key: 'plans', icon: <CrownOutlined />, label: 'Gói Dịch Vụ' },
              { key: 'coupons', icon: <TagOutlined />, label: 'Mã Khuyến Mãi' },
            ]}
          />
        </Sider>

        <Layout style={{ flex: 1, minWidth: 0 }}>
          {/* TOPBAR HEADER WITH COLLAPSE BUTTON & CLEAN TOP RIGHT PROFILE */}
          <Header style={{
            background: isDarkMode ? '#0f172a' : '#fff',
            padding: isMobile ? '0 12px' : '0 24px',
            display: 'flex',
            justify: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            height: 64,
          }}>
            <Space align="center" size={isMobile ? 'small' : 'middle'}>
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined style={{ fontSize: 18 }} /> : <MenuFoldOutlined style={{ fontSize: 18 }} />}
                onClick={() => setCollapsed(!collapsed)}
                style={{ width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              />
              <Title level={4} style={{ margin: 0, lineHeight: 1, fontSize: isMobile ? '0.95rem' : '1.25rem' }}>
                {isMobile ? (routeTitles[currentRoute] || '').split('(')[0].trim() : routeTitles[currentRoute]}
              </Title>
            </Space>

            <Space size={isMobile ? 'small' : 'middle'} align="center">
              {/* TIMEZONE SELECTOR */}
              <Select
                value={timezone}
                onChange={handleTimezoneChange}
                style={{ width: isMobile ? 120 : 190 }}
                size={isMobile ? 'small' : 'middle'}
                popupMatchSelectWidth={false}
                title="Múi giờ hiển thị dữ liệu (mặc định GMT+7)"
                options={TIMEZONE_OPTIONS.map((tz) => ({
                  value: tz.value,
                  label: (
                    <span style={{ fontSize: isMobile ? '0.78rem' : '0.84rem' }}>
                      {isMobile ? tz.shortLabel : tz.label}
                    </span>
                  ),
                }))}
              />

              <Button
                shape={isMobile ? 'circle' : 'round'}
                icon={isDarkMode ? <SunOutlined /> : <MoonOutlined />}
                onClick={() => setIsDarkMode(!isDarkMode)}
                title={isDarkMode ? 'Light Mode' : 'Dark Mode'}
              >
                {!isMobile && (isDarkMode ? 'Light Mode' : 'Dark Mode')}
              </Button>

              <Space align="center" size={isMobile ? 'small' : 'middle'}>
                <Avatar style={{ backgroundColor: '#6366f1', flexShrink: 0 }}>{(user?.fullName || user?.email || 'A')[0].toUpperCase()}</Avatar>
                {!isMobile && (
                  <div style={{ lineHeight: 1.2, textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: isDarkMode ? '#f8fafc' : '#0f172a', whiteSpace: 'nowrap' }}>
                      {user?.fullName || 'Admin'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: isDarkMode ? '#94a3b8' : '#64748b', whiteSpace: 'nowrap' }}>
                      {user?.email}
                    </div>
                  </div>
                )}
                <Button type="text" danger icon={<LogoutOutlined />} onClick={onLogout} style={{ fontWeight: 600 }}>
                  {!isMobile && 'Đăng xuất'}
                </Button>
              </Space>
            </Space>
          </Header>

          {/* MAIN CONTENT AREA */}
          <Content style={{ padding: isMobile ? '12px 8px' : 28, width: '100%', minWidth: 0, overflowX: 'hidden' }}>
            {/* ROUTE 1: DASHBOARD & CHARTS */}
            {currentRoute === 'analytics' && (
              <div>
                <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                  <Col xs={24} sm={12} lg={6}>
                    <Card><Statistic title="Tổng Người Dùng" value={stats?.totalUsers || 0} prefix={<UserOutlined />} /></Card>
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <Card><Statistic title="Session Hoạt Động" value={stats?.activeSessions || 0} prefix={<PoweroffOutlined />} /></Card>
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <Card><Statistic title="Tổng Quẻ / Trải Bài / Lá Số" value={stats?.totalReadings || 0} prefix={<AuditOutlined />} /></Card>
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <Card><Statistic title="Số Lượt Hỏi AI" value={stats?.totalAiQuestions || 0} prefix={<RobotOutlined />} /></Card>
                  </Col>
                </Row>

                {/* 3 APP BREAKDOWN CARDS */}
                <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                  <Col xs={24} sm={8}>
                    <Card size="small" style={{ borderLeft: '4px solid #6366f1', background: isDarkMode ? '#131b2e' : '#f8faff' }}>
                      <Statistic
                        title="🔮 Lượt Kinh Dịch (IChingNow)"
                        value={stats?.totalIchingReadings ?? analyticsData?.appDistribution?.iching ?? 0}
                        valueStyle={{ color: '#6366f1' }}
                      />
                    </Card>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Card size="small" style={{ borderLeft: '4px solid #f59e0b', background: isDarkMode ? '#1f1a14' : '#fffcf5' }}>
                      <Statistic
                        title="🃏 Lượt Bốc Tarot (TarotNow)"
                        value={stats?.totalTarotReadings ?? analyticsData?.appDistribution?.tarot ?? 0}
                        valueStyle={{ color: '#f59e0b' }}
                      />
                    </Card>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Card size="small" style={{ borderLeft: '4px solid #ec4899', background: isDarkMode ? '#22141f' : '#fdf5f9' }}>
                      <Statistic
                        title="🌟 Lượt Tử Vi (TuViNow)"
                        value={stats?.totalTuviReadings ?? analyticsData?.appDistribution?.tuvi ?? 0}
                        valueStyle={{ color: '#ec4899' }}
                      />
                    </Card>
                  </Col>
                </Row>

                {/* CHARTS ROW 1 */}
                <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
                  <Col xs={24} lg={16}>
                    <Card title="📈 Lưu Lượng Đăng Nhập & Traffic (14 Ngày Qua)">
                      <div style={{ height: 280 }}>
                        <Line data={trafficChartData} options={chartOptions} />
                      </div>
                    </Card>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Card title="🥧 Phân Bổ Sử Dụng App">
                      <div style={{ height: 280, display: 'flex', justifyContent: 'center' }}>
                        <Doughnut data={appShareData} options={{ responsive: true, maintainAspectRatio: false }} />
                      </div>
                    </Card>
                  </Col>
                </Row>

                {/* CHARTS ROW 2 */}
                <Row gutter={[20, 20]}>
                  <Col xs={24} lg={12}>
                    <Card title="🌍 Top Vị Trí Địa Lý / Thành Phố">
                      <div style={{ height: 260 }}>
                        <Bar data={geoData} options={{ ...chartOptions, indexAxis: 'y' }} />
                      </div>
                    </Card>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Card title="🤖 Số Lượt Hỏi AI Theo Ngày">
                      <div style={{ height: 260 }}>
                        <Bar data={aiDailyData} options={chartOptions} />
                      </div>
                    </Card>
                  </Col>
                </Row>
              </div>
            )}

            {/* ROUTE 2: USERS MANAGEMENT */}
            {currentRoute === 'users' && (
              <Card
                title={
                  <Space align="center">
                    <span>👥 Danh Sách Người Dùng</span>
                    <Tag color="blue">{users.length} người dùng</Tag>
                  </Space>
                }
                extra={
                  <Space wrap>
                    <Input.Search
                      placeholder="Tìm email, tên..."
                      allowClear
                      onSearch={setUserSearch}
                      onChange={e => setUserSearch(e.target.value)}
                      style={{ width: 220 }}
                    />
                    <Select placeholder="Role" allowClear onChange={setRoleFilter} style={{ width: 120 }}>
                      <Option value="user">User</Option>
                      <Option value="admin">Admin</Option>
                      <Option value="vip">VIP</Option>
                    </Select>
                    <Button icon={<ReloadOutlined />} onClick={loadUsers}>Làm mới</Button>
                  </Space>
                }
              >
                <ModernDataTable
                  columns={userColumns}
                  data={users}
                  loading={usersLoading}
                  isDarkMode={isDarkMode}
                  keyField="id"
                  selectableRows
                  onSelectedRowsChange={({ selectedRows }) => setSelectedUserRows(selectedRows)}
                  clearSelectedRows={clearUserSelected}
                  contextActions={userContextActions}
                  paginationPerPage={15}
                />
              </Card>
            )}

            {/* ROUTE 3: AUDIT LOGS */}
            {currentRoute === 'audit' && (
              <Card
                title={
                  <Space align="center">
                    <span>📋 Nhật Ký Traffic & IP</span>
                    <Tag color="cyan">{auditLogs.length} sự kiện</Tag>
                  </Space>
                }
                extra={
                  <Space wrap>
                    <Input.Search
                      placeholder="Tìm IP, Email, hành động..."
                      allowClear
                      onSearch={setAuditSearch}
                      onChange={e => setAuditSearch(e.target.value)}
                      style={{ width: 260 }}
                    />
                    <Button icon={<ReloadOutlined />} onClick={loadAudit}>Làm mới</Button>
                  </Space>
                }
              >
                <ModernDataTable
                  columns={auditColumns}
                  data={auditLogs}
                  loading={auditLoading}
                  isDarkMode={isDarkMode}
                  keyField="id"
                  paginationPerPage={15}
                />
              </Card>
            )}

            {/* ROUTE 4: AI LEADERBOARD */}
            {currentRoute === 'ai' && (
              <Card
                title={
                  <Space align="center">
                    <span>🤖 Leaderboard AI Usage</span>
                    <Tag color="purple">{filteredAiUsage.length} thành viên</Tag>
                  </Space>
                }
                extra={
                  <Space wrap>
                    <Input.Search
                      placeholder="Tìm email, họ tên..."
                      allowClear
                      onChange={e => setAiSearch(e.target.value)}
                      style={{ width: 220 }}
                    />
                    <Button icon={<ReloadOutlined />} onClick={loadAiUsage}>Làm mới</Button>
                  </Space>
                }
              >
                <ModernDataTable
                  columns={aiColumns}
                  data={filteredAiUsage}
                  loading={aiLoading}
                  isDarkMode={isDarkMode}
                  keyField="userId"
                  paginationPerPage={15}
                />
              </Card>
            )}

            {/* ROUTE 5: GÓI DỊCH VỤ */}
            {currentRoute === 'plans' && (
              <div>
                <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
                  {safeArr(plans).map(plan => (
                    <Col xs={24} md={8} key={plan.name}>
                      <Card
                        title={<span>{plan.name === 'premium' ? '💎' : plan.name === 'lite' ? '🌟' : '⚡'} {plan.label}</span>}
                        extra={<Switch checked={plan.isActive} onChange={checked => handleTogglePlan(plan.name, checked)} />}
                        actions={[<Button type="link" icon={<EditOutlined />} onClick={() => { setEditingPlan(plan); formPlan.setFieldsValue({ ...plan }); }}>Chỉnh Sửa</Button>]}
                      >
                        <Title level={3} style={{ margin: '0 0 12px 0', color: '#6366f1' }}>{plan.price === 0 ? 'Miễn phí' : `${Number(plan.price).toLocaleString('vi-VN')}đ/tháng`}</Title>
                        <div style={{ marginBottom: 4 }}>📅 {plan.dailyLimit === -1 ? 'Không giới hạn lượt/ngày' : `${plan.dailyLimit} lượt/ngày`}</div>
                        <div style={{ marginBottom: 4 }}>📆 {plan.monthlyLimit === -1 ? 'Không giới hạn lượt/tháng' : `${plan.monthlyLimit} lượt/tháng`}</div>
                        <div style={{ marginBottom: 12 }}>{plan.canBonus ? `✨ Hỏi thêm ${plan.bonusAmount} câu/lần` : '❌ Không có hỏi thêm'}</div>
                        {/* Free-override toggles — chỉ hiện trên gói Free */}
                        {plan.name === 'free' && (
                          <div style={{ borderTop: '1px dashed rgba(255,255,255,0.15)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Text style={{ fontSize: 12 }}>🆓 Free dùng Lite miễn phí</Text>
                              <Switch
                                size="small"
                                checked={plan.overrideFreeToLite}
                                onChange={v => handleTogglePlanField('free', 'overrideFreeToLite', v, 'Free dùng Lite miễn phí')}
                              />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Text style={{ fontSize: 12 }}>👑 Free dùng Premium miễn phí</Text>
                              <Switch
                                size="small"
                                checked={plan.overrideFreeToPremium}
                                onChange={v => handleTogglePlanField('free', 'overrideFreeToPremium', v, 'Free dùng Premium miễn phí')}
                              />
                            </div>
                          </div>
                        )}
                      </Card>
                    </Col>
                  ))}
                </Row>
              </div>
            )}

            {/* ROUTE 6: MÃ KHUYẾN MÃI */}
            {currentRoute === 'coupons' && (
              <Card
                title={
                  <Space align="center">
                    <span>🎟️ Quản Lý Mã Khuyến Mãi</span>
                    <Tag color="cyan">{coupons.length} mã</Tag>
                  </Space>
                }
                extra={
                  <Space wrap>
                    <Input.Search
                      placeholder="Tìm mã code, mô tả..."
                      allowClear
                      onChange={e => setCouponSearch(e.target.value)}
                      style={{ width: 220 }}
                    />
                    <Button type="primary" icon={<TagOutlined />} onClick={() => setIsCouponModalOpen(true)}>+ Tạo Mã Mới</Button>
                    <Button icon={<ReloadOutlined />} onClick={loadCoupons}>Làm mới</Button>
                  </Space>
                }
              >
                <ModernDataTable
                  columns={couponColumns}
                  data={filteredCoupons}
                  loading={couponsLoading}
                  isDarkMode={isDarkMode}
                  keyField="id"
                  selectableRows
                  onSelectedRowsChange={({ selectedRows }) => setSelectedCouponRows(selectedRows)}
                  clearSelectedRows={clearCouponSelected}
                  contextActions={couponContextActions}
                  paginationPerPage={15}
                />
              </Card>
            )}

            {/* ROUTE 7: TIN NHẮN TALKWITHME */}
            {currentRoute === 'contact' && (
              <Card
                title={
                  <Space align="center">
                    <span>💬 Hộp Thư TalkWithMe</span>
                    {unreadCount > 0 && <Tag color="cyan">{unreadCount} chưa đọc</Tag>}
                    <Tag color="default">Tổng {messages.length}</Tag>
                  </Space>
                }
                extra={
                  <Space wrap>
                    <Input.Search
                      placeholder="Tìm người gửi, email, tin nhắn..."
                      allowClear
                      onChange={e => setContactSearchText(e.target.value)}
                      style={{ width: 240 }}
                    />
                    <Select
                      value={contactFilterStatus}
                      onChange={setContactFilterStatus}
                      style={{ width: 130 }}
                    >
                      <Option value="all">Tất cả ({messages.length})</Option>
                      <Option value="unread">Chưa đọc ({unreadCount})</Option>
                      <Option value="read">Đã đọc ({Math.max(0, messages.length - unreadCount)})</Option>
                    </Select>
                    <Button icon={<ReloadOutlined />} onClick={loadContactMessages} loading={messagesLoading}>
                      Làm mới
                    </Button>
                    {unreadCount > 0 && (
                      <Button icon={<CheckOutlined />} onClick={handleMarkAllRead}>
                        Đánh dấu tất cả đã đọc
                      </Button>
                    )}
                  </Space>
                }
              >
                <ModernDataTable
                  columns={contactColumns}
                  data={filteredMessages}
                  loading={messagesLoading}
                  isDarkMode={isDarkMode}
                  keyField="id"
                  selectableRows
                  onSelectedRowsChange={({ selectedRows }) => setSelectedContactRows(selectedRows)}
                  clearSelectedRows={clearContactSelected}
                  contextActions={contactContextActions}
                  paginationPerPage={15}
                />
              </Card>
            )}

            {/* ROUTE 8: THỐNG KÊ TRUY CẬP (TRAFFIC ANALYTICS) */}
            {currentRoute === 'traffic' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* FILTER CONTROLS BAR */}
                <Card styles={{ body: { padding: '16px 20px' } }}>
                  <Row justify="space-between" align="middle" gutter={[16, 16]}>
                    <Col xs={24} lg={14}>
                      <Space wrap align="center">
                        <Text strong style={{ marginRight: 4 }}>Ứng dụng:</Text>
                        <Select
                          value={trafficApp}
                          onChange={(v) => { setTrafficApp(v); setTrafficPage(1); }}
                          style={{ width: 180 }}
                        >
                          <Option value="all">🌐 Tất cả ứng dụng</Option>
                          <Option value="talkwithme">💬 TalkWithMe</Option>
                          <Option value="tuvi">🔮 TuViNow</Option>
                          <Option value="iching">☯️ IChingNow</Option>
                          <Option value="tarot">🃏 TarotNow</Option>
                        </Select>

                        <Text strong style={{ marginLeft: 12, marginRight: 4 }}>Thời gian:</Text>
                        <Select
                          value={trafficDays}
                          onChange={(v) => { setTrafficDays(v); setTrafficPage(1); }}
                          style={{ width: 130 }}
                        >
                          <Option value={7}>7 ngày qua</Option>
                          <Option value={14}>14 ngày qua</Option>
                          <Option value={30}>30 ngày qua</Option>
                        </Select>
                      </Space>
                    </Col>
                    <Col xs={24} lg={10} style={{ textAlign: 'right' }}>
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={loadTraffic}
                        loading={trafficLoading}
                      >
                        Làm mới dữ liệu
                      </Button>
                    </Col>
                  </Row>
                </Card>

                {/* 4 SUMMARY STAT CARDS */}
                <Row gutter={[16, 16]}>
                  <Col xs={24} sm={12} lg={6}>
                    <Card style={{ height: '100%' }}>
                      <Statistic
                        title="👥 Lượt truy cập hôm nay"
                        value={trafficStats?.summary?.todayVisits || 0}
                        valueStyle={{ color: '#38bdf8', fontWeight: 700 }}
                        suffix={
                          <span style={{ fontSize: '0.85rem', fontWeight: 400, opacity: 0.75, marginLeft: 6 }}>
                            ({trafficStats?.summary?.todayUniqueVisitors || 0} khách IP)
                          </span>
                        }
                      />
                      <div style={{ marginTop: 8, fontSize: '0.8125rem', opacity: 0.7 }}>
                        Hôm qua: {trafficStats?.summary?.yesterdayVisits || 0} lượt ({trafficStats?.summary?.yesterdayUniqueVisitors || 0} khách)
                      </div>
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <Card style={{ height: '100%' }}>
                      <Statistic
                        title={`📈 Tổng ${trafficDays} ngày qua`}
                        value={trafficStats?.summary?.totalVisits || 0}
                        valueStyle={{ color: '#10b981', fontWeight: 700 }}
                        suffix={
                          <span style={{ fontSize: '0.85rem', fontWeight: 400, opacity: 0.75, marginLeft: 6 }}>
                            ({trafficStats?.summary?.totalUniqueVisitors || 0} khách IP)
                          </span>
                        }
                      />
                      <div style={{ marginTop: 8, fontSize: '0.8125rem', opacity: 0.7 }}>
                        Trung bình: {trafficDays > 0 ? Math.round((trafficStats?.summary?.totalVisits || 0) / trafficDays) : 0} lượt/ngày
                      </div>
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <Card style={{ height: '100%' }}>
                      <Statistic
                        title="📱 Thiết bị phổ biến nhất"
                        value={trafficStats?.devices?.[0]?.name || 'Chưa có'}
                        valueStyle={{ fontSize: '1.25rem', fontWeight: 600, color: '#f59e0b' }}
                      />
                      <div style={{ marginTop: 8, fontSize: '0.8125rem', opacity: 0.7 }}>
                        {trafficStats?.devices?.[0] ? `${trafficStats.devices[0].count} lượt (${trafficStats.devices[0].percentage}%)` : 'Đang cập nhật'}
                      </div>
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <Card style={{ height: '100%' }}>
                      <Statistic
                        title="📍 Khu vực nhiều nhất"
                        value={trafficStats?.locations?.[0]?.name || 'Chưa có'}
                        valueStyle={{ fontSize: '1.25rem', fontWeight: 600, color: '#ec4899' }}
                      />
                      <div style={{ marginTop: 8, fontSize: '0.8125rem', opacity: 0.7 }}>
                        {trafficStats?.locations?.[0] ? `${trafficStats.locations[0].count} lượt (${trafficStats.locations[0].percentage}%)` : 'Đang cập nhật'}
                      </div>
                    </Card>
                  </Col>
                </Row>

                {/* CHARTS ROW */}
                <Row gutter={[16, 16]}>
                  <Col xs={24} lg={16}>
                    <Card title="📊 Lượt truy cập theo từng ngày" style={{ height: '100%' }}>
                      <div style={{ height: 290 }}>
                        {trafficStats?.daily?.length > 0 ? (
                          <Bar
                            data={trafficDailyData}
                            options={{
                              ...chartOptions,
                              plugins: {
                                legend: { position: 'top', labels: { color: isDarkMode ? '#94a3b8' : '#475569' } },
                              },
                            }}
                          />
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
                            Chưa có dữ liệu truy cập trong khoảng thời gian này
                          </div>
                        )}
                      </div>
                    </Card>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Card title="📱 Cơ cấu Thiết bị" style={{ height: '100%' }}>
                      <div style={{ height: 290, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {trafficStats?.devices?.length > 0 ? (
                          <Doughnut
                            data={trafficDeviceData}
                            options={{
                              responsive: true,
                              maintainAspectRatio: false,
                              plugins: { legend: { position: 'bottom', labels: { color: isDarkMode ? '#94a3b8' : '#475569', boxWidth: 12 } } },
                            }}
                          />
                        ) : (
                          <span style={{ opacity: 0.5 }}>Chưa có dữ liệu</span>
                        )}
                      </div>
                    </Card>
                  </Col>
                </Row>

                {/* BREAKDOWN LISTS: BROWSERS, LOCATIONS, REFERRERS */}
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={8}>
                    <Card title="🌐 Top Trình Duyệt">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {safeArr(trafficStats?.browsers).length > 0 ? (
                          trafficStats.browsers.map((b) => (
                            <div key={b.name}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
                                <Text strong>{b.name}</Text>
                                <Text type="secondary">{b.count} ({b.percentage}%)</Text>
                              </div>
                              <Progress percent={b.percentage} showInfo={false} strokeColor="#38bdf8" size="small" />
                            </div>
                          ))
                        ) : (
                          <Text type="secondary">Chưa có dữ liệu</Text>
                        )}
                      </div>
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card title="📍 Top Địa Điểm (Tỉnh / Thành)">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {safeArr(trafficStats?.locations).length > 0 ? (
                          trafficStats.locations.map((loc) => (
                            <div key={loc.name}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
                                <Text strong>{loc.name}</Text>
                                <Text type="secondary">{loc.count} ({loc.percentage}%)</Text>
                              </div>
                              <Progress percent={loc.percentage} showInfo={false} strokeColor="#ec4899" size="small" />
                            </div>
                          ))
                        ) : (
                          <Text type="secondary">Chưa có dữ liệu</Text>
                        )}
                      </div>
                    </Card>
                  </Col>
                  <Col xs={24} md={8}>
                    <Card title="🔗 Nguồn Đến (Referrer)">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {safeArr(trafficStats?.referrers).length > 0 ? (
                          trafficStats.referrers.map((r) => (
                            <div key={r.name}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
                                <Text strong>{r.name}</Text>
                                <Text type="secondary">{r.count} ({r.percentage}%)</Text>
                              </div>
                              <Progress percent={r.percentage} showInfo={false} strokeColor="#10b981" size="small" />
                            </div>
                          ))
                        ) : (
                          <Text type="secondary">Chưa có dữ liệu</Text>
                        )}
                      </div>
                    </Card>
                  </Col>
                </Row>

                {/* DETAILED LOGS TABLE */}
                <Card
                  title={
                    <Space align="center" wrap>
                      <span>📋 Chi Tiết Lượt Truy Cập</span>
                      <Tag color="cyan">Tổng {trafficTotal} lượt</Tag>
                      <Tag color="geekblue" style={{ fontSize: '0.75rem' }}>
                        🌐 {getTimezoneLabel(timezone)}
                      </Tag>
                    </Space>
                  }
                  extra={
                    <Space wrap style={{ marginTop: isMobile ? 8 : 0 }}>
                      <Input.Search
                        placeholder="Tìm IP, vị trí..."
                        allowClear
                        onSearch={(val) => { setTrafficSearch(val); setTrafficPage(1); }}
                        style={{ width: isMobile ? 180 : 280 }}
                      />
                      <Button icon={<ReloadOutlined />} onClick={loadTraffic} title="Làm mới">
                        {!isMobile && 'Làm mới'}
                      </Button>
                    </Space>
                  }
                >
                  <ModernDataTable
                    columns={trafficColumns}
                    data={trafficLogs}
                    loading={trafficLoading}
                    isDarkMode={isDarkMode}
                    keyField="id"
                    selectableRows
                    onSelectedRowsChange={({ selectedRows }) => setSelectedTrafficRows(selectedRows)}
                    clearSelectedRows={clearTrafficSelected}
                    contextActions={trafficContextActions}
                    paginationServer
                    paginationTotalRows={trafficTotal}
                    paginationPerPage={20}
                    paginationRowsPerPageOptions={[20]}
                    onChangePage={(page) => setTrafficPage(page)}
                    renderMobileCard={renderTrafficMobileCard}
                  />
                </Card>
              </div>
            )}
          </Content>
        </Layout>

        {/* MODAL: EDIT PLAN */}
        <Modal
          title={editingPlan ? `✏️ Chỉnh Sửa Gói: ${editingPlan.label}` : '✏️ Chỉnh Sửa Gói Dịch Vụ'}
          open={!!editingPlan}
          onCancel={() => setEditingPlan(null)}
          onOk={() => formPlan.submit()}
          okText="💾 Lưu Thay Đổi"
          cancelText="Huỷ"
          width={560}
        >
          <Form form={formPlan} layout="vertical" onFinish={handleSavePlan}>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="label" label="Tên gói hiển thị" rules={[{ required: true }]}>
                  <Input placeholder="VD: Gói Lite, Gói Premium..." />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="price" label="Giá (VND, 0 = miễn phí)">
                  <InputNumber style={{ width: '100%' }} min={0} step={1000} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="description" label="Mô tả ngắn (hiển thị trên app)">
              <Input.TextArea rows={2} placeholder="Mô tả gói dịch vụ..." />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="dailyLimit" label="Giới hạn/ngày (-1 = không giới hạn)">
                  <InputNumber style={{ width: '100%' }} min={-1} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="monthlyLimit" label="Giới hạn/tháng (-1 = không giới hạn)">
                  <InputNumber style={{ width: '100%' }} min={-1} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="canBonus" valuePropName="checked" label="Cho phép hỏi thêm">
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="bonusAmount" label="Số câu bonus/lần">
                  <InputNumber style={{ width: '100%' }} min={1} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="bonusMaxPerDay" label="Tối đa lần bonus/ngày">
                  <InputNumber style={{ width: '100%' }} min={0} />
                </Form.Item>
              </Col>
            </Row>
            {editingPlan?.name === 'free' && (
              <>
                <Form.Item name="overrideFreeToLite" valuePropName="checked" label="🆓 Cho phép Free dùng Lite miễn phí">
                  <Switch />
                </Form.Item>
                <Form.Item name="overrideFreeToPremium" valuePropName="checked" label="👑 Cho phép Free dùng Premium miễn phí">
                  <Switch />
                </Form.Item>
              </>
            )}
          </Form>
        </Modal>

        {/* MODAL: CREATE COUPON */}
        <Modal title="🎟️ Tạo Mã Khuyến Mãi Mới" open={isCouponModalOpen} onCancel={() => setIsCouponModalOpen(false)} onOk={() => formCoupon.submit()}>
          <Form form={formCoupon} layout="vertical" onFinish={handleSaveCoupon} initialValues={{ type: 'grant_plan', planName: 'lite', durationDays: 30, maxUses: -1 }}>
            <Form.Item name="code" label="Mã Code" rules={[{ required: true }]}><Input placeholder="VD: TRIAL7, PROMO50" style={{ textTransform: 'uppercase' }} /></Form.Item>
            <Form.Item name="description" label="Mô tả"><Input placeholder="Mô tả mã..." /></Form.Item>
            <Form.Item name="type" label="Loại Khuyến Mãi">
              <Select>
                <Option value="grant_plan">🎁 Tặng Gói</Option>
                <Option value="trial_days">📅 Tặng Ngày</Option>
              </Select>
            </Form.Item>
            <Form.Item name="planName" label="Gói Tặng">
              <Select><Option value="lite">Lite</Option><Option value="premium">Premium</Option></Select>
            </Form.Item>
            <Form.Item name="durationDays" label="Số Ngày"><InputNumber style={{ width: '100%' }} /></Form.Item>
          </Form>
        </Modal>

        {/* MODAL: GRANT PLAN */}
        <Modal title="🎁 Tặng Gói Cho User" open={!!grantModalUser} onCancel={() => setGrantModalUser(null)} onOk={() => formGrant.submit()}>
          <Form form={formGrant} layout="vertical" onFinish={handleGrantPlan} initialValues={{ planName: 'lite', durationDays: 30 }}>
            <Form.Item name="planName" label="Gói Tặng">
              <Select><Option value="free">Free</Option><Option value="lite">Lite</Option><Option value="premium">Premium</Option></Select>
            </Form.Item>
            <Form.Item name="durationDays" label="Số Ngày (0 = vĩnh viễn)"><InputNumber style={{ width: '100%' }} /></Form.Item>
          </Form>
        </Modal>

        {/* MODAL: VIEW CONTACT MESSAGE */}
        <Modal
          title={
            <Space align="center">
              <span>💬 Chi Tiết Tin Nhắn</span>
              {selectedMessage && !selectedMessage.isRead && <Tag color="cyan">Mới</Tag>}
            </Space>
          }
          open={detailModalOpen}
          onCancel={() => { setDetailModalOpen(false); setSelectedMessage(null); }}
          footer={[
            <Button
              key="delete"
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                if (selectedMessage) handleDeleteMessage(selectedMessage.id);
              }}
            >
              Xóa tin nhắn
            </Button>,
            <Button key="close" type="primary" onClick={() => { setDetailModalOpen(false); setSelectedMessage(null); }}>
              Đóng
            </Button>,
          ]}
          width={640}
        >
          {detailLoading ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>Đang tải...</div>
          ) : selectedMessage ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
              <div style={{ background: isDarkMode ? '#1e293b' : '#f8fafc', padding: 16, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
                <Row gutter={[12, 10]}>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: '0.8rem' }}>Người gửi:</Text>
                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>{selectedMessage.name}</div>
                  </Col>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: '0.8rem' }}>Email:</Text>
                    <div>{selectedMessage.email ? <a href={`mailto:${selectedMessage.email}`}>{selectedMessage.email}</a> : <Text italic type="secondary">Không có</Text>}</div>
                  </Col>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: '0.8rem' }}>Thời gian:</Text>
                    <div>{formatTimeWithZone(selectedMessage.createdAt, timezone)}</div>
                  </Col>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: '0.8rem' }}>IP / Session:</Text>
                    <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{selectedMessage.senderIp || 'N/A'} · {selectedMessage.sessionId?.slice(0, 10)}...</div>
                  </Col>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: '0.8rem' }}>📱 Thiết bị:</Text>
                    <div style={{ fontWeight: 500 }}>{selectedMessage.device || selectedMessage.os || 'N/A'}</div>
                  </Col>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: '0.8rem' }}>🌐 Trình duyệt:</Text>
                    <div>{selectedMessage.browser || 'N/A'}</div>
                  </Col>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: '0.8rem' }}>📍 Vị trí (IP):</Text>
                    <div style={{ color: '#06b6d4', fontWeight: 600 }}>{selectedMessage.location || 'Chưa xác định'}</div>
                  </Col>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: '0.8rem' }}>📡 Nhà mạng (ISP):</Text>
                    <div>{selectedMessage.isp || 'N/A'}</div>
                  </Col>
                  {selectedMessage.metadata?.timezone && (
                    <Col span={12}>
                      <Text type="secondary" style={{ fontSize: '0.8rem' }}>⏰ Múi giờ / Ngôn ngữ:</Text>
                      <div style={{ fontSize: '0.8rem' }}>{selectedMessage.metadata.timezone} · {selectedMessage.metadata.language || 'N/A'}</div>
                    </Col>
                  )}
                  {selectedMessage.metadata?.screen && (
                    <Col span={12}>
                      <Text type="secondary" style={{ fontSize: '0.8rem' }}>🖥️ Màn hình:</Text>
                      <div style={{ fontSize: '0.8rem' }}>{selectedMessage.metadata.screen}</div>
                    </Col>
                  )}
                </Row>
              </div>

              {selectedMessage.title && (
                <div>
                  <Text type="secondary" style={{ fontSize: '0.8rem' }}>Tiêu đề:</Text>
                  <div style={{ fontSize: '1.05rem', fontWeight: 600, marginTop: 4 }}>{selectedMessage.title}</div>
                </div>
              )}

              <div>
                <Text type="secondary" style={{ fontSize: '0.8rem' }}>Nội dung:</Text>
                <div style={{
                  background: isDarkMode ? '#0f172a' : '#f1f5f9',
                  padding: 16,
                  borderRadius: 10,
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.6,
                  fontSize: '0.95rem',
                  marginTop: 6,
                  borderLeft: '4px solid #06b6d4',
                }}>
                  {selectedMessage.message}
                </div>
              </div>

              {((selectedMessage.images && selectedMessage.images.length > 0) || selectedMessage.imageData) && (
                <div>
                  <Text type="secondary" style={{ fontSize: '0.8rem', display: 'block', marginBottom: 8 }}>
                    Hình ảnh đính kèm ({selectedMessage.images?.length || 1}/3 ảnh · chuẩn 720p):
                  </Text>
                  <Image.PreviewGroup>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {(selectedMessage.images && selectedMessage.images.length > 0
                        ? selectedMessage.images
                        : [{ data: selectedMessage.imageData, mime: selectedMessage.imageMime }]
                      ).map((img, idx) => (
                        <div key={idx} style={{
                          background: isDarkMode ? 'rgba(255,255,255,0.04)' : '#f8fafc',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 8,
                          padding: 6,
                          textAlign: 'center',
                        }}>
                          <Image
                            src={`data:${img.mime || 'image/jpeg'};base64,${img.data}`}
                            alt={`Ảnh ${idx + 1}`}
                            style={{ height: 160, maxWidth: 220, borderRadius: 6, objectFit: 'cover' }}
                          />
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 4 }}>
                            {img.width && img.height ? `${img.width}×${img.height}` : '720p'}
                            {img.size ? ` · ${Math.round(img.size / 1024)} KB` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Image.PreviewGroup>
                </div>
              )}
            </div>
          ) : null}
        </Modal>
      </Layout>
    </ConfigProvider>
  );
}
