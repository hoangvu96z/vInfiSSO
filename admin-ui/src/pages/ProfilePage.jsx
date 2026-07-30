import React, { useState } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  Avatar,
  Typography,
  Tag,
  Space,
  Descriptions,
  Upload,
  Alert,
  App as AntApp,
} from 'antd';
import {
  UserOutlined,
  CameraOutlined,
  SaveOutlined,
  ArrowLeftOutlined,
  LogoutOutlined,
  CrownOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

const formatDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
};

export default function ProfilePage({ user: initialUser, onLogout, onUserUpdated }) {
  const [user, setUser] = useState(initialUser);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [alertInfo, setAlertInfo] = useState(null);
  const [form] = Form.useForm();

  const authHeaders = () => {
    const token = localStorage.getItem('sso_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const applyUpdatedUser = (updated) => {
    if (!updated) return;
    setUser(updated);
    if (onUserUpdated) onUserUpdated(updated);
  };

  const avatarSrc = user?.id ? `/sso/avatar/${user.id}` : null;

  const handleSaveProfile = async (values) => {
    setSaving(true);
    setAlertInfo(null);
    try {
      const res = await fetch('/sso/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify({ displayName: values.displayName }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        applyUpdatedUser(data.user);
        setAlertInfo({ type: 'success', message: 'Cập nhật hồ sơ thành công!' });
      } else {
        setAlertInfo({ type: 'error', message: data.message || 'Cập nhật thất bại' });
      }
    } catch {
      setAlertInfo({ type: 'error', message: 'Lỗi kết nối server' });
    } finally {
      setSaving(false);
    }
  };

  const handleUploadAvatar = async ({ file, onSuccess, onError }) => {
    setUploading(true);
    setAlertInfo(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/sso/avatar', {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.user) {
        applyUpdatedUser(data.user);
        setAlertInfo({ type: 'success', message: 'Đổi ảnh đại diện thành công!' });
        onSuccess(data, file);
      } else {
        setAlertInfo({ type: 'error', message: data.message || 'Tải ảnh lên thất bại' });
        onError(new Error(data.message || 'Upload failed'));
      }
    } catch (e) {
      setAlertInfo({ type: 'error', message: 'Lỗi kết nối server' });
      onError(e);
    } finally {
      setUploading(false);
    }
  };

  const beforeUpload = (file) => {
    const isImage = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type);
    if (!isImage) {
      setAlertInfo({ type: 'error', message: 'Chỉ chấp nhận ảnh JPEG, PNG, GIF hoặc WebP' });
      return Upload.LIST_IGNORE;
    }
    if (file.size / 1024 / 1024 >= 5) {
      setAlertInfo({ type: 'error', message: 'Ảnh phải nhỏ hơn 5MB' });
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const initials = (user?.displayName || user?.fullName || user?.email || '?')[0].toUpperCase();

  return (
    <AntApp>
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'linear-gradient(135deg, #090d16 0%, #1e1b4b 50%, #0f172a 100%)',
        }}
      >
        <Card
          style={{
            width: '100%',
            maxWidth: 560,
            borderRadius: 16,
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            border: '1px solid rgba(99,102,241,0.25)',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Title level={3} style={{ margin: 0 }}>
              👤 Hồ Sơ Của Tôi
            </Title>
            <Text type="secondary" style={{ fontSize: '0.85rem' }}>
              Quản lý thông tin tài khoản vInfiSSO
            </Text>
          </div>

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

          {/* ─── Avatar ─── */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Upload
              accept="image/jpeg,image/png,image/gif,image/webp"
              showUploadList={false}
              beforeUpload={beforeUpload}
              customRequest={handleUploadAvatar}
            >
              <div style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}>
                <Avatar
                  size={104}
                  src={avatarSrc}
                  style={{ backgroundColor: '#6366f1', fontSize: 40 }}
                  icon={!avatarSrc ? <UserOutlined /> : undefined}
                >
                  {!avatarSrc && initials}
                </Avatar>
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    bottom: 0,
                    background: '#6366f1',
                    borderRadius: '50%',
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px solid #fff',
                  }}
                >
                  <CameraOutlined style={{ color: '#fff', fontSize: 15 }} />
                </div>
              </div>
            </Upload>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: '0.8rem' }}>
                {uploading ? 'Đang tải ảnh lên...' : 'Nhấn vào ảnh để đổi avatar (tối đa 5MB)'}
              </Text>
            </div>
          </div>

          {/* ─── Display name form ─── */}
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSaveProfile}
            initialValues={{ displayName: user?.displayName || '' }}
            key={user?.id}
          >
            <Form.Item
              name="displayName"
              label="Tên hiển thị"
              rules={[
                { required: true, message: 'Vui lòng nhập tên hiển thị' },
                { max: 100, message: 'Tên hiển thị tối đa 100 ký tự' },
              ]}
            >
              <Input prefix={<UserOutlined />} placeholder="Tên hiển thị của bạn" size="large" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 16 }}>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={saving}
                icon={<SaveOutlined />}
                style={{ background: '#6366f1', height: 44, fontWeight: 700 }}
              >
                Lưu Thay Đổi
              </Button>
            </Form.Item>
          </Form>

          {/* ─── Account info ─── */}
          <Descriptions
            column={1}
            bordered
            size="small"
            style={{ marginBottom: 20 }}
            items={[
              {
                key: 'email',
                label: 'Email',
                children: user?.email,
              },
              {
                key: 'createdAt',
                label: 'Ngày tạo tài khoản',
                children: formatDate(user?.createdAt),
              },
              {
                key: 'role',
                label: 'Vai trò',
                children: (
                  <Tag color={user?.role === 'admin' ? 'purple' : 'blue'}>
                    {(user?.role || 'user').toUpperCase()}
                  </Tag>
                ),
              },
              {
                key: 'verified',
                label: 'Trạng thái email',
                children: (
                  <Tag color={user?.isVerified ? 'success' : 'warning'}>
                    {user?.isVerified ? '✓ Đã xác thực' : 'Chưa xác thực'}
                  </Tag>
                ),
              },
              {
                key: 'plan',
                label: 'Gói',
                children: <Tag color="gold">{(user?.planName || 'free').toUpperCase()}</Tag>,
              },
            ]}
          />

          {/* ─── Navigation ─── */}
          <Space direction="vertical" style={{ width: '100%' }}>
            {user?.role === 'admin' && (
              <Button
                type="default"
                block
                icon={<CrownOutlined />}
                style={{ height: 40 }}
                onClick={() => {
                  window.location.href = '/ui/admin#analytics';
                }}
              >
                Admin Dashboard
              </Button>
            )}
            <Button
              type="default"
              block
              icon={<ArrowLeftOutlined />}
              style={{ height: 40 }}
              onClick={() => {
                window.location.href = '/ui/sso';
              }}
            >
              Quay lại trang SSO
            </Button>
            <Button
              type="default"
              danger
              block
              icon={<LogoutOutlined />}
              onClick={onLogout}
              style={{ height: 40 }}
            >
              Đăng Xuất
            </Button>
          </Space>
        </Card>
      </div>
    </AntApp>
  );
}
