import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Tabs, Alert, notification, Typography, Tag, Avatar, Space } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, SmileOutlined, CheckCircleOutlined, LogoutOutlined, CrownOutlined } from '@ant-design/icons';

const { Title, Text, Link } = Typography;

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
  </svg>
);

const FacebookIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

export default function SsoPage({ user, onLoginSuccess, onLogout }) {
  const initialTab = window.location.pathname.includes('register') ? 'register' : 'login';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState(null);
  const [formLogin] = Form.useForm();
  const [formRegister] = Form.useForm();
  const [formForgot] = Form.useForm();

  const setAuthToken = (token) => {
    if (token) localStorage.setItem('sso_token', token);
    else localStorage.removeItem('sso_token');
  };

  const getRedirectTargetUrl = () => {
    const queryParams = new URLSearchParams(window.location.search);
    let rawTarget =
      queryParams.get('redirect_uri') ||
      queryParams.get('redirect') ||
      queryParams.get('redirect_url') ||
      queryParams.get('app') ||
      queryParams.get('app_url') ||
      queryParams.get('return_to') ||
      '';

    if (!rawTarget) return null;

    try {
      if (rawTarget.includes('%3A') || rawTarget.includes('%2F')) {
        try {
          rawTarget = decodeURIComponent(rawTarget);
        } catch (e) {}
      }
      const targetUrl = new URL(rawTarget.startsWith('http') ? rawTarget : `https://${rawTarget}`);
      return targetUrl;
    } catch (err) {
      console.error('Invalid redirect URL:', rawTarget, err);
      return null;
    }
  };

  // 🔄 CASE B: Nếu user ĐÃ ĐĂNG NHẬP sẵn ở SSO & URL có redirect_uri -> Tự động quay lại App ngay lập tức!
  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const isLoggedOut = queryParams.get('logged_out') === 'true';
    const justLoggedOut = sessionStorage.getItem('just_logged_out') === '1';

    if (isLoggedOut || justLoggedOut) {
      // Clear all auth state and flags
      localStorage.removeItem('sso_token');
      sessionStorage.removeItem('just_logged_out');
      // Remove the logged_out param from URL so refreshing doesn't keep showing it
      if (isLoggedOut) {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('logged_out');
        newUrl.searchParams.delete('redirect');
        newUrl.searchParams.delete('redirect_uri');
        window.history.replaceState({}, '', newUrl.toString());
      }
      return;
    }

    // Only auto-redirect if user is authenticated AND there's a redirect target AND we didn't just log out
    const redirectTarget = getRedirectTargetUrl();
    const token = localStorage.getItem('sso_token');
    if (user && token && redirectTarget) {
      redirectTarget.searchParams.set('sso_token', token);
      console.log('User already authenticated at SSO. Auto-redirecting to:', redirectTarget.toString());
      window.location.href = redirectTarget.toString();
    }
  }, [user]);

  // 🔄 CASE A: Khi user vừa đăng nhập thành công -> Tự động chuyển hướng về App kèm sso_token
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

        const redirectTarget = getRedirectTargetUrl();
        if (redirectTarget) {
          redirectTarget.searchParams.set('sso_token', data.token);
          window.location.href = redirectTarget.toString();
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

  const redirectTarget = getRedirectTargetUrl();
  const redirectQueryStr = redirectTarget ? `?redirect=${encodeURIComponent(redirectTarget.toString())}` : '';

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
            <Avatar
              size={64}
              src={user.id ? `/sso/avatar/${user.id}` : undefined}
              style={{ backgroundColor: '#6366f1', marginBottom: 12 }}
            >
              {(user.displayName || user.fullName || user.email)[0].toUpperCase()}
            </Avatar>
            <Title level={4} style={{ margin: 0 }}>{user.displayName || user.fullName || 'Thành viên'}</Title>
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

            <Button type="primary" block style={{ height: 42, fontWeight: 700, marginBottom: 10, background: '#6366f1' }} onClick={() => { window.location.href = '/ui/profile'; }}>
              <UserOutlined /> Hồ Sơ Của Tôi
            </Button>

            {user.role === 'admin' && (
              <Button type="primary" block style={{ height: 42, fontWeight: 700, marginBottom: 10, background: '#7c3aed', borderColor: '#7c3aed' }} onClick={() => { window.location.href = '/ui/admin#analytics'; }}>
                <CrownOutlined /> Đến Admin Dashboard
              </Button>
            )}

            {!redirectTarget && (
              <Space direction="vertical" style={{ width: '100%', marginBottom: 10 }}>
                <Button
                  type="default"
                  block
                  style={{ height: 38, borderColor: 'rgba(255,255,255,0.2)' }}
                  onClick={() => {
                    const token = localStorage.getItem('sso_token');
                    window.location.href = token ? `http://vunph.id.vn/kinhdich?sso_token=${token}` : 'http://vunph.id.vn/kinhdich';
                  }}
                >
                  ☯️ Đến IChingNow
                </Button>
                <Button
                  type="default"
                  block
                  style={{ height: 38, borderColor: 'rgba(255,255,255,0.2)' }}
                  onClick={() => {
                    const token = localStorage.getItem('sso_token');
                    window.location.href = token ? `http://vunph.id.vn/tarot?sso_token=${token}` : 'http://vunph.id.vn/tarot';
                  }}
                >
                  🔮 Đến TarotNow
                </Button>
              </Space>
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

                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px dashed rgba(255,255,255,0.1)', textAlign: 'center' }}>
                        <Text type="secondary" style={{ fontSize: '0.8rem', display: 'block', marginBottom: 10 }}>
                          Hoặc đăng nhập nhanh bằng:
                        </Text>
                        <Space size="middle">
                          <Button
                            href={`/sso/oauth/google${redirectQueryStr}`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, borderRadius: 8, fontWeight: 600, padding: '0 16px' }}
                          >
                            <GoogleIcon /> Google
                          </Button>
                          <Button
                            href={`/sso/oauth/facebook${redirectQueryStr}`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, borderRadius: 8, fontWeight: 600, padding: '0 16px' }}
                          >
                            <FacebookIcon /> Facebook
                          </Button>
                        </Space>
                      </div>

                      <div style={{ textAlign: 'center', marginTop: 14 }}>
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

                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px dashed rgba(255,255,255,0.1)', textAlign: 'center' }}>
                        <Text type="secondary" style={{ fontSize: '0.8rem', display: 'block', marginBottom: 10 }}>
                          Hoặc đăng ký nhanh bằng:
                        </Text>
                        <Space size="middle">
                          <Button
                            href={`/sso/oauth/google${redirectQueryStr}`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, borderRadius: 8, fontWeight: 600, padding: '0 16px' }}
                          >
                            <GoogleIcon /> Google
                          </Button>
                          <Button
                            href={`/sso/oauth/facebook${redirectQueryStr}`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, borderRadius: 8, fontWeight: 600, padding: '0 16px' }}
                          >
                            <FacebookIcon /> Facebook
                          </Button>
                        </Space>
                      </div>
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
