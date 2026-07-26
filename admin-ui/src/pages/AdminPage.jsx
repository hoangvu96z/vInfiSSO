import React, { useState, useEffect, useCallback } from 'react';
import {
  Layout, Menu, Typography, Button, Card, Row, Col, Table, Tag,
  Switch, Modal, Form, Input, InputNumber, Select, message, Space,
  Statistic, Avatar, Tooltip, ConfigProvider, theme
} from 'antd';
import {
  BarChartOutlined, UserOutlined, AuditOutlined, RobotOutlined,
  CrownOutlined, TagOutlined, LogoutOutlined, SunOutlined, MoonOutlined,
  CopyOutlined, DeleteOutlined, EditOutlined, GiftOutlined, ReloadOutlined,
  CheckCircleOutlined, CloseCircleOutlined, PoweroffOutlined
} from '@ant-design/icons';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

const SSO_BASE = '';

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

  // Sync hash routing
  useEffect(() => {
    const handleHash = () => {
      const hash = (window.location.hash || '#analytics').replace('#', '');
      setCurrentRoute(hash);
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const changeRoute = (key) => {
    window.location.hash = key;
    setCurrentRoute(key);
  };

  // State data
  const [stats, setStats] = useState(null);
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

  // Load Dashboard Stats
  const loadStats = useCallback(async () => {
    const res = await authFetch('/admin/stats');
    if (res) {
      const data = await res.json();
      setStats(data);
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
      setUsers(data.data || []);
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
      setAuditLogs(data.data || []);
    }
    setAuditLoading(false);
  }, [auditSearch]);

  // Load AI Usage Table
  const loadAiUsage = useCallback(async () => {
    setAiLoading(true);
    const res = await authFetch('/admin/ai-usage');
    if (res) {
      const data = await res.json();
      setAiUsage(data.data || []);
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

  // Route Initializer
  useEffect(() => {
    if (currentRoute === 'analytics') loadStats();
    if (currentRoute === 'users') loadUsers();
    if (currentRoute === 'audit') loadAudit();
    if (currentRoute === 'ai') loadAiUsage();
    if (currentRoute === 'plans') loadPlans();
    if (currentRoute === 'coupons') loadCoupons();
  }, [currentRoute, loadStats, loadUsers, loadAudit, loadAiUsage, loadPlans, loadCoupons]);

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
    await authFetch(`/admin/plans/${planName}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive }),
    });
    message.info(`Đã ${isActive ? 'bật' : 'tắt'} gói ${planName.toUpperCase()}! 🔄`);
    loadPlans();
  };

  const handleFreeOverride = async (freeToLite, freeToPremium) => {
    await authFetch('/admin/plans/free', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrideFreeToLite: freeToLite, overrideFreeToPremium: freeToPremium }),
    });
    message.success('Đã cập nhật chế độ khuyến mãi Override Gói Free! 🎁');
    loadPlans();
  };

  const handleSavePlan = async (values) => {
    if (!editingPlan) return;
    await authFetch(`/admin/plans/${editingPlan.name}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    setEditingPlan(null);
    message.success(`Đã lưu thay đổi gói ${editingPlan.label} thành công! 💎`);
    loadPlans();
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

  // Route Titles
  const routeTitles = {
    analytics: '📊 Dashboard & Analytics',
    users: '👥 Quản Lý User & Role',
    audit: '📋 Nhật Ký Traffic & IP',
    ai: '🤖 Leaderboard AI Usage',
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
      <Layout style={{ minHeight: '100vh' }}>
        {/* SIDEBAR NAVIGATION */}
        <Sider width={260} theme={isDarkMode ? 'dark' : 'light'} style={{ borderRight: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <img src="/vlnfi_sso_favicon_option_1.svg" alt="vInfiSSO" style={{ width: 32, height: 32 }} />
            <Title level={4} style={{ margin: 0 }}>vInfiSSO</Title>
            <Tag color="indigo">ADMIN</Tag>
          </div>

          <Menu
            mode="inline"
            selectedKeys={[currentRoute]}
            onClick={({ key }) => changeRoute(key)}
            style={{ padding: '16px 8px', borderRight: 0 }}
            items={[
              { key: 'analytics', icon: <BarChartOutlined />, label: 'Dashboard & Charts' },
              { key: 'users', icon: <UserOutlined />, label: 'Quản Lý User & Role' },
              { key: 'audit', icon: <AuditOutlined />, label: 'Nhật Ký Traffic & IP' },
              { key: 'ai', icon: <RobotOutlined />, label: 'Leaderboard AI' },
              { type: 'divider' },
              { key: 'plans', icon: <CrownOutlined />, label: 'Gói Dịch Vụ' },
              { key: 'coupons', icon: <TagOutlined />, label: 'Mã Khuyến Mãi' },
            ]}
          />
        </Sider>

        <Layout>
          {/* TOPBAR HEADER */}
          <Header style={{ background: isDarkMode ? '#0f172a' : '#fff', padding: '0 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <Title level={4} style={{ margin: 0 }}>{routeTitles[currentRoute]}</Title>

            <Space size="large">
              <Button
                shape="round"
                icon={isDarkMode ? <SunOutlined /> : <MoonOutlined />}
                onClick={() => setIsDarkMode(!isDarkMode)}
              >
                {isDarkMode ? 'Light Mode' : 'Dark Mode'}
              </Button>

              <Space>
                <Avatar style={{ backgroundColor: '#6366f1' }}>{(user?.fullName || user?.email || 'A')[0].toUpperCase()}</Avatar>
                <div>
                  <Text strong style={{ display: 'block', fontSize: '0.85rem' }}>{user?.fullName || 'Admin'}</Text>
                  <Text type="secondary" style={{ fontSize: '0.72rem' }}>{user?.email}</Text>
                </div>
                <Button type="text" danger icon={<LogoutOutlined />} onClick={onLogout}>Đăng xuất</Button>
              </Space>
            </Space>
          </Header>

          {/* MAIN CONTENT AREA */}
          <Content style={{ padding: 28 }}>
            {/* ROUTE 1: DASHBOARD & CHARTS */}
            {currentRoute === 'analytics' && (
              <div>
                <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                  <Col xs={24} sm={12} lg={6}>
                    <Card><Statistic title="Tổng Người Dùng" value={stats?.totalUsers || 0} prefix={<UserOutlined />} /></Card>
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <Card><Statistic title="Session Hoạt Động" value={stats?.activeSessions || 0} prefix={<PoweroffOutlined />} /></Card>
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <Card><Statistic title="Tổng Quẻ / Trải Bài" value={stats?.totalReadings || 0} prefix={<AuditOutlined />} /></Card>
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <Card><Statistic title="Số Lượt Hỏi AI" value={stats?.totalAiQuestions || 0} prefix={<RobotOutlined />} /></Card>
                  </Col>
                </Row>
              </div>
            )}

            {/* ROUTE 2: USERS MANAGEMENT */}
            {currentRoute === 'users' && (
              <Card
                title="👥 Danh Sách Người Dùng"
                extra={
                  <Space>
                    <Input.Search placeholder="Tìm email, tên..." onSearch={setUserSearch} onChange={e => setUserSearch(e.target.value)} style={{ width: 220 }} />
                    <Select placeholder="Role" allowClear onChange={setRoleFilter} style={{ width: 120 }}>
                      <Option value="user">User</Option>
                      <Option value="admin">Admin</Option>
                      <Option value="vip">VIP</Option>
                    </Select>
                    <Button icon={<ReloadOutlined />} onClick={loadUsers} />
                  </Space>
                }
              >
                <Table
                  dataSource={users}
                  loading={usersLoading}
                  rowKey="id"
                  columns={[
                    { title: 'User Info', dataIndex: 'email', render: (_, r) => <div><strong>{r.fullName || 'User'}</strong><div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{r.email}</div></div> },
                    { title: 'Role', dataIndex: 'role', render: role => <Tag color={role === 'admin' ? 'purple' : 'default'}>{role}</Tag> },
                    { title: 'Gói Dịch Vụ', dataIndex: 'planName', render: plan => <Tag color={plan === 'premium' ? 'gold' : plan === 'lite' ? 'blue' : 'default'}>{plan || 'free'}</Tag> },
                    { title: 'Email Verified', dataIndex: 'isEmailVerified', render: v => v ? <Tag icon={<CheckCircleOutlined />} color="success">Đã xác thực</Tag> : <Tag icon={<CloseCircleOutlined />} color="error">Chưa xác thực</Tag> },
                    { title: 'Lượt AI', dataIndex: 'aiUsageCount' },
                    { title: 'Thao Tác', render: (_, r) => (
                      <Space>
                        <Button size="small" onClick={() => handleUpdateRole(r.id, r.role === 'admin' ? 'user' : 'admin')}>Role: {r.role === 'admin' ? 'User' : 'Admin'}</Button>
                        <Button size="small" type="primary" icon={<GiftOutlined />} onClick={() => setGrantModalUser(r)}>Tặng Gói</Button>
                        <Button size="small" danger onClick={() => handleRevokeSessions(r.id)}>Hủy Session</Button>
                      </Space>
                    )},
                  ]}
                />
              </Card>
            )}

            {/* ROUTE 3: AUDIT LOGS */}
            {currentRoute === 'audit' && (
              <Card
                title="📋 Nhật Ký Traffic & IP"
                extra={<Input.Search placeholder="Tìm IP, Email..." onSearch={setAuditSearch} onChange={e => setAuditSearch(e.target.value)} style={{ width: 240 }} />}
              >
                <Table
                  dataSource={auditLogs}
                  loading={auditLoading}
                  rowKey="id"
                  columns={[
                    { title: 'Thời Gian', dataIndex: 'createdAt', render: d => new Date(d).toLocaleString('vi-VN') },
                    { title: 'Hành Động', dataIndex: 'action', render: a => <Tag color="indigo">{a}</Tag> },
                    { title: 'Email', dataIndex: 'userEmail' },
                    { title: 'Địa Chỉ IP', dataIndex: 'ipAddress', render: ip => <Tag>{ip || '127.0.0.1'}</Tag> },
                    { title: 'Vị Trí Geo', dataIndex: 'location' },
                    { title: 'Ứng Dụng', dataIndex: 'appName' },
                  ]}
                />
              </Card>
            )}

            {/* ROUTE 4: AI LEADERBOARD */}
            {currentRoute === 'ai' && (
              <Card title="🤖 Leaderboard AI Usage">
                <Table
                  dataSource={aiUsage}
                  loading={aiLoading}
                  rowKey="id"
                  columns={[
                    { title: 'Email', dataIndex: 'email' },
                    { title: 'Họ Tên', dataIndex: 'fullName' },
                    { title: 'Số Lượt Hỏi AI', dataIndex: 'aiQuestionsCount', sorter: (a, b) => a.aiQuestionsCount - b.aiQuestionsCount },
                    { title: 'Gói Dịch Vụ', dataIndex: 'planName', render: p => <Tag color={p === 'premium' ? 'gold' : 'blue'}>{p || 'free'}</Tag> },
                  ]}
                />
              </Card>
            )}

            {/* ROUTE 5: GÓI DỊCH VỤ */}
            {currentRoute === 'plans' && (
              <div>
                <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
                  {plans.map(plan => (
                    <Col xs={24} md={8} key={plan.name}>
                      <Card
                        title={<span>{plan.name === 'premium' ? '💎' : plan.name === 'lite' ? '🌟' : '⚡'} {plan.label}</span>}
                        extra={<Switch checked={plan.isActive} onChange={checked => handleTogglePlan(plan.name, checked)} />}
                        actions={[<Button type="link" icon={<EditOutlined />} onClick={() => { setEditingPlan(plan); formPlan.setFieldsValue(plan); }}>Chỉnh Sửa</Button>]}
                      >
                        <Title level={3} style={{ margin: '0 0 12px 0', color: '#6366f1' }}>{plan.price === 0 ? 'Miễn phí' : `${Number(plan.price).toLocaleString('vi-VN')}đ/tháng`}</Title>
                        <div>📅 {plan.dailyLimit === -1 ? 'Không giới hạn lượt/ngày' : `${plan.dailyLimit} lượt/ngày`}</div>
                        <div>📆 {plan.monthlyLimit === -1 ? 'Không giới hạn lượt/tháng' : `${plan.monthlyLimit} lượt/tháng`}</div>
                        <div>{plan.canBonus ? `✨ Hỏi thêm ${plan.bonusAmount} câu/lần` : '❌ Không có hỏi thêm'}</div>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </div>
            )}

            {/* ROUTE 6: MÃ KHUYẾN MÃI */}
            {currentRoute === 'coupons' && (
              <Card
                title="🎟️ Quản Lý Mã Khuyến Mãi"
                extra={<Button type="primary" icon={<TagOutlined />} onClick={() => setIsCouponModalOpen(true)}>+ Tạo Mã Mới</Button>}
              >
                <Table
                  dataSource={coupons}
                  loading={couponsLoading}
                  rowKey="id"
                  columns={[
                    { title: 'Mã Code', dataIndex: 'code', render: code => <Tag color="blue" style={{ fontSize: '0.9rem', fontWeight: 700 }}>{code}</Tag> },
                    { title: 'Mô Tả', dataIndex: 'description' },
                    { title: 'Loại', dataIndex: 'type', render: t => t === 'grant_plan' ? '🎁 Tặng Gói' : '📅 Tặng Ngày' },
                    { title: 'Gói/Ngày', render: (_, r) => r.planName ? <Tag color="gold">{r.planName}</Tag> : `${r.durationDays}d` },
                    { title: 'Đã Dùng', render: (_, r) => `${r.usedCount} / ${r.maxUses === -1 ? '∞' : r.maxUses}` },
                    { title: 'Trạng Thái', dataIndex: 'isActive', render: act => <Switch checked={act} onChange={c => handleToggleCoupon(r.id, c)} /> },
                    { title: 'Thao Tác', render: (_, r) => (
                      <Space>
                        <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(r.code); message.info(`Đã copy mã ${r.code}! 📋`); }}>Copy</Button>
                        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteCoupon(r.id)}>Xóa</Button>
                      </Space>
                    )},
                  ]}
                />
              </Card>
            )}
          </Content>
        </Layout>

        {/* MODAL: EDIT PLAN */}
        <Modal title="✏️ Chỉnh Sửa Gói Dịch Vụ" open={!!editingPlan} onCancel={() => setEditingPlan(null)} onOk={() => formPlan.submit()}>
          <Form form={formPlan} layout="vertical" onFinish={handleSavePlan}>
            <Form.Item name="dailyLimit" label="Giới hạn/ngày (-1 = không giới hạn)"><InputNumber style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="monthlyLimit" label="Giới hạn/tháng (-1 = không giới hạn)"><InputNumber style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="price" label="Giá (VND, 0 = miễn phí)"><InputNumber style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="canBonus" valuePropName="checked"><Switch /> Cho phép "Hỏi thêm câu"</Form.Item>
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
      </Layout>
    </ConfigProvider>
  );
}
