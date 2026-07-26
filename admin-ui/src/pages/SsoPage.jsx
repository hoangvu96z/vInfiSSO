import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Tabs, Alert, notification, Typography, Tag, Avatar, Space } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, SmileOutlined, CheckCircleOutlined, LogoutOutlined, CrownOutlined } from '@ant-design/icons';

const { Title, Text, Link } = Typography;

export default function SsoPage({ user, onLoginSuccess, onLogout }) {
  const [activeTab, setActiveTab] = useState('login');
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState(null);
  const [formLogin] = Form.useForm();
  const [formRegister] = Form.useForm();
  const [formForgot] = Form.useForm();

  const setAuthToken = (token) => {
    if (token) localStorage.setItem('sso_token', token);
    else localStorage.removeItem('sso_token');
  };

  const queryParams = new URLSearchParams(window.location.search);
  const appParam = queryParams.get('app') || queryParams.get('redirect_url') || '';

  const handleLogin = async (values) => {
    setLoading(true);
    setAlertInfo(null);
    try {
      const res = await fetch('/sso/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setAuthToken(data.token);
        notification.success({
          message: 'Đăng nhập thành công!',
          description: `Chào mừng ${data.user?.fullName || data.user?.email}`,
          placement: 'topRight',
        });
        if (appParam) {
          const url = new URL(appParam.startsWith('http') ? appParam : `https://${appParam}`);
          url.searchParams.set('sso_token', data.token);
          window.location.href = url.toString();
          return;
        }
        if (data.user?.role === 'admin') {
          window.location.href = '/ui/admin#analytics';
          return;
        }
        if (onLoginSuccess) {
          onLoginSuccess(data.user);
        }
      } else {
        setAlertInfo({ type: 'error', message: data.message || 'Đăng nhập thất bại' });
      }
    } catch (e) {
      setAlertInfo({ type: 'error', message: 'Lỗi kết nối server' });
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values) => {
    setLoading(true);
    setAlertInfo(null);
    try {
      const res = await fetch('/sso/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (res.ok) {
        setAlertInfo({
          type: 'success',
          message: 'Đăng ký tài khoản thành công! Vui lòng kiểm tra email để xác thực tài khoản.',
        });
        formRegister.resetFields();
      } else {
        setAlertInfo({ type: 'error', message: data.message || 'Đăng ký thất bại' });
      }
    } catch (e) {
      setAlertInfo({ type: 'error', message: 'Lỗi kết nối server' });
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (values) => {
    setLoading(true);
    setAlertInfo(null);
    try {
      const res = await fetch('/sso/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (res.ok) {
        setAlertInfo({
          type: 'success',
          message: 'Đã gửi hướng dẫn đặt lại mật khẩu vào email của bạn.',
        });
        formForgot.resetFields();
      } else {
        setAlertInfo({ type: 'error', message: data.message || 'Yêu cầu thất bại' });
      }
    } catch (e) {
      setAlertInfo({ type: 'error', message: 'Lỗi kết nối server' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: 'linear-gradient(135deg, #090d16 0%, #1e1b4b 50%, #0f172a 100%)',
    }}>
      <Card
        style={{
          width: '100%',
          maxWidth: 440,
          borderRadius: 16,
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          border: '1px solid rgba(99,102,241,0.25)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/vlnfi_sso_favicon_option_1.svg" alt="vInfiSSO" style={{ width: 44, height: 44, marginBottom: 8 }} />
          <Title level={3} style={{ margin: 0 }}>vInfiSSO Identity</Title>
          <Text type="secondary" style={{ fontSize: '0.85rem' }}>Hệ thống đăng nhập tập trung SSO</Text>
        </div>

        {/* IF USER IS ALREADY LOGGED IN */}
        {user ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <Avatar size={64} style={{ backgroundColor: '#6366f1', marginBottom: 12 }}>
              {(user.fullName || user.email)[0].toUpperCase()}
            </Avatar>
            <Title level={4} style={{ margin: 0 }}>{user.fullName || 'Thành viên'}</Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>{user.email}</Text>

            <Space direction="vertical" style={{ width: '100%', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
                <Text type="secondary">Role:</Text>
                <Tag color={user.role === 'admin' ? 'purple' : 'blue'}>{user.role.toUpperCase()}</Tag>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
                <Text type="secondary">Email:</Text>
                <Tag color={(user.isVerified ?? user.isEmailVerified) ? 'success' : 'warning'}>
                  {(user.isVerified ?? user.isEmailVerified) ? '✓ Đã xác thực' : 'Chưa xác thực'}
                </Tag>
              </div>
            </Space>

            {user.role === 'admin' && (
              <Button type="primary" block style={{ height: 42, fontWeight: 700, marginBottom: 10, background: '#6366f1' }} onClick={() => { window.location.href = '/ui/admin#analytics'; }}>
                <CrownOutlined /> Đến Admin Dashboard
              </Button>
            )}

            <Button type="default" danger block icon={<LogoutOutlined />} onClick={onLogout} style={{ height: 42 }}>
              Đăng Xuất
            </Button>
          </div>
        ) : (
          <>
            {alertInfo && (
              <Alert
                type={alertInfo.type}
                message={alertInfo.message}
                showIcon
                closable
                onClose={() => setAlertInfo(null)}
                style={{ marginBottom: 20 }}
              />
            )}

            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              centered
              items={[
                {
                  key: 'login',
                  label: '🔑 Đăng Nhập',
                  children: (
                    <Form form={formLogin} layout="vertical" onFinish={handleLogin} style={{ marginTop: 12 }}>
                      <Form.Item name="email" rules={[{ required: true, message: 'Vui lòng nhập Email' }, { type: 'email', message: 'Email không hợp lệ' }]}>
                        <Input prefix={<MailOutlined />} placeholder="Email của bạn" size="large" />
                      </Form.Item>
                      <Form.Item name="password" rules={[{ required: true, message: 'Vui lòng nhập mật khẩu' }]}>
                        <Input.Password prefix={<LockOutlined />} placeholder="Mật khẩu" size="large" />
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" htmlType="submit" size="large" block loading={loading} style={{ background: '#6366f1', height: 44, fontWeight: 700 }}>
                          Đăng Nhập
                        </Button>
                      </Form.Item>
                      <div style={{ textAlign: 'center' }}>
                        <Link onClick={() => setActiveTab('forgot')}>Quên mật khẩu?</Link>
                      </div>
                    </Form>
                  ),
                },
                {
                  key: 'register',
                  label: '✨ Đăng Ký',
                  children: (
                    <Form form={formRegister} layout="vertical" onFinish={handleRegister} style={{ marginTop: 12 }}>
                      <Form.Item name="displayName">
                        <Input prefix={<SmileOutlined />} placeholder="Họ và tên / Biệt danh" size="large" />
                      </Form.Item>
                      <Form.Item name="email" rules={[{ required: true, message: 'Vui lòng nhập Email' }, { type: 'email', message: 'Email không hợp lệ' }]}>
                        <Input prefix={<MailOutlined />} placeholder="Email của bạn" size="large" />
                      </Form.Item>
                      <Form.Item name="password" rules={[{ required: true, message: 'Vui lòng nhập mật khẩu' }, { min: 6, message: 'Mật khẩu tối thiểu 6 ký tự' }]}>
                        <Input.Password prefix={<LockOutlined />} placeholder="Tạo mật khẩu" size="large" />
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" htmlType="submit" size="large" block loading={loading} style={{ background: '#10b981', borderColor: '#10b981', height: 44, fontWeight: 700 }}>
                          Đăng Ký Tài Khoản
                        </Button>
                      </Form.Item>
                    </Form>
                  ),
                },
                {
                  key: 'forgot',
                  label: '🔒 Quên Mật Khẩu',
                  children: (
                    <Form form={formForgot} layout="vertical" onFinish={handleForgot} style={{ marginTop: 12 }}>
                      <Form.Item name="email" rules={[{ required: true, message: 'Vui lòng nhập Email' }, { type: 'email', message: 'Email không hợp lệ' }]}>
                        <Input prefix={<MailOutlined />} placeholder="Email đã đăng ký" size="large" />
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" htmlType="submit" size="large" block loading={loading} style={{ height: 44, fontWeight: 700 }}>
                          Gửi Link Đặt Lại Mật Khẩu
                        </Button>
                      </Form.Item>
                    </Form>
                  ),
                },
              ]}
            />
          </>
        )}
      </Card>
    </div>
  );
}
