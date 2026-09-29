import React, { useState, useEffect } from 'react';
import {
  Layout, Menu, Typography, Button, Space, Avatar, ConfigProvider, theme, Badge, Select, message
} from 'antd';
import {
  BarChartOutlined, UserOutlined, AuditOutlined, RobotOutlined,
  CrownOutlined, TagOutlined, LogoutOutlined, SunOutlined, MoonOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, MessageOutlined, GlobalOutlined
} from '@ant-design/icons';

// Child View Components
import DashboardView from '../components/admin/DashboardView';
import TrafficView from '../components/admin/TrafficView';
import UsersView from '../components/admin/UsersView';
import AuditLogsView from '../components/admin/AuditLogsView';
import AiLeaderboardView from '../components/admin/AiLeaderboardView';
import PlansView from '../components/admin/PlansView';
import CouponsView from '../components/admin/CouponsView';
import ContactMessagesView from '../components/admin/ContactMessagesView';

// Utilities
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS, getTimezoneLabel } from '../utils/dateUtils';
import { authFetch } from '../utils/api';

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

export default function AdminPage({ user, onLogout }) {
  const [currentRoute, setCurrentRoute] = useState(() => (window.location.hash || '#analytics').replace('#', ''));
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false));
  const [collapsed, setCollapsed] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 992 : false));
  const [unreadCount, setUnreadCount] = useState(0);

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

  // Fetch initial unread count for sidebar badge
  useEffect(() => {
    async function fetchUnread() {
      const res = await authFetch('/contact/admin/unread-count');
      if (res) {
        const data = await res.json();
        setUnreadCount(data.count || 0);
      }
    }
    fetchUnread();
  }, []);

  const changeRoute = (key) => {
    window.location.hash = key;
    setCurrentRoute(key);
    if (isMobile) setCollapsed(true);
  };

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
          <div
            style={{
              padding: '18px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 12,
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              overflow: 'hidden',
            }}
          >
            <img src="/vlnfi_sso_favicon_option_1.svg" alt="vInfiSSO" style={{ width: 32, height: 32, flexShrink: 0 }} />
            {!collapsed && (
              <>
                <Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>vInfiSSO</Title>
                <span
                  style={{
                    backgroundColor: '#4f46e5',
                    color: '#fff',
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                  }}
                >
                  ADMIN
                </span>
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
          <Header
            style={{
              background: isDarkMode ? '#0f172a' : '#fff',
              padding: isMobile ? '0 12px' : '0 24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              height: 64,
            }}
          >
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
                <Avatar style={{ backgroundColor: '#6366f1', flexShrink: 0 }}>
                  {(user?.fullName || user?.email || 'A')[0].toUpperCase()}
                </Avatar>
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
            {currentRoute === 'analytics' && <DashboardView isDarkMode={isDarkMode} />}
            {currentRoute === 'traffic' && <TrafficView isDarkMode={isDarkMode} timezone={timezone} isMobile={isMobile} />}
            {currentRoute === 'users' && <UsersView isDarkMode={isDarkMode} />}
            {currentRoute === 'audit' && <AuditLogsView isDarkMode={isDarkMode} timezone={timezone} />}
            {currentRoute === 'ai' && <AiLeaderboardView isDarkMode={isDarkMode} />}
            {currentRoute === 'plans' && <PlansView isDarkMode={isDarkMode} />}
            {currentRoute === 'coupons' && <CouponsView isDarkMode={isDarkMode} />}
            {currentRoute === 'contact' && (
              <ContactMessagesView
                isDarkMode={isDarkMode}
                timezone={timezone}
                unreadCount={unreadCount}
                onUnreadCountChange={setUnreadCount}
              />
            )}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
