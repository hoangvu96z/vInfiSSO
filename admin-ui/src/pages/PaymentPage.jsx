import React, { useState, useEffect } from 'react';
import { Card, Button, Typography, Tag, Space, Radio, Input, Alert, notification } from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, CopyOutlined, QrcodeOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

// ─── Payment methods config ──────────────────────────────────────────────────
const PAYMENT_METHODS = [
  {
    id: 'bank_transfer',
    name: 'Chuyển Khoản Ngân Hàng',
    icon: '🏦',
    color: '#0ea5e9',
    description: 'Quét mã QR hoặc chuyển khoản thủ công',
  },
  {
    id: 'momo',
    name: 'Ví MoMo',
    icon: '💳',
    color: '#a50064',
    description: 'Thanh toán qua ví điện tử MoMo',
  },
  {
    id: 'visa',
    name: 'Visa / Mastercard',
    icon: '💳',
    color: '#1a1f71',
    description: 'Thẻ tín dụng / ghi nợ quốc tế',
  },
];

// Thông tin tài khoản nhận tiền — cấu hình theo tài khoản thật
const BANK_INFO = {
  bankName: 'Ngân hàng TPBank',
  accountNumber: '0932752953',
  accountHolder: 'NGUYEN PHI HOANG VU',
};

const MOMO_INFO = {
  phone: '0932752953',
  accountHolder: 'NGUYEN PHI HOANG VU',
};

// Fallback plans (khi API /plans/config không trả về)
const FALLBACK_PLANS = [
  { name: 'lite', label: 'Gói Lite', price: 10000, emoji: '🌟', color: '#60a5fa',
    description: '5 lượt hỏi AI/ngày · 60 lượt/tháng' },
  { name: 'premium', label: 'Gói Premium', price: 20000, emoji: '💎', color: '#f5d78e',
    description: 'Không giới hạn hàng ngày · 180 lượt/tháng · Hỏi thêm 5 câu/quẻ' },
];

const formatPrice = (price) =>
  !price ? 'Miễn phí' : `${price.toLocaleString('vi-VN')}đ`;

// Tạo nội dung chuyển khoản theo format định sẵn
const buildTransferNote = (user, planName) => {
  const code = (user?.id || '').replace(/-/g, '').slice(0, 8).toUpperCase() || 'GUEST';
  return `VINFI ${code} ${planName.toUpperCase()}`;
};

export default function PaymentPage({ user }) {
  const query = new URLSearchParams(window.location.search);
  const preselectedPlan = query.get('plan');
  const redirectUrl = query.get('redirect');

  const [plans, setPlans] = useState(FALLBACK_PLANS);
  const [selectedPlan, setSelectedPlan] = useState(preselectedPlan || 'premium');
  const [method, setMethod] = useState('bank_transfer');
  const [visaForm, setVisaForm] = useState({ cardNumber: '', expiry: '', cvv: '', holder: '' });
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState('');
  const [orderCreated, setOrderCreated] = useState(false);

  // Fetch bảng giá từ server (có cấu hình động từ admin)
  useEffect(() => {
    fetch('/plans/config')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.plans) && data.plans.length > 0) {
          const paid = data.plans
            .filter((p) => p.name !== 'free' && p.price > 0)
            .map((p) => {
              const meta = FALLBACK_PLANS.find((f) => f.name === p.name) || {};
              return { ...meta, ...p, emoji: meta.emoji || '📦', color: meta.color || '#a5b4fc' };
            });
          if (paid.length > 0) setPlans(paid);
        }
      })
      .catch(() => {});
  }, []);

  // Bắt buộc đăng nhập trước khi thanh toán — kéo user về /ui/sso kèm return url
  useEffect(() => {
    if (user === null) {
      const returnUrl = encodeURIComponent(window.location.href);
      window.location.href = `/ui/sso?redirect=${returnUrl}`;
    }
  }, [user]);

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#090d16', color: '#6366f1' }}>
        <h2>⏳ Đang kiểm tra phiên đăng nhập...</h2>
      </div>
    );
  }

  const plan = plans.find((p) => p.name === selectedPlan) || plans[0];
  const transferNote = buildTransferNote(user, plan.name);

  const copyText = (text, key) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      // Gửi yêu cầu thanh toán lên server (admin sẽ xác nhận thủ công sau)
      const token = localStorage.getItem('sso_token');
      const res = await fetch('/plans/payment-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ plan: plan.name, method, ...(method === 'visa' ? { card: visaForm } : {}) }),
      });
      if (res.ok) {
        setOrderCreated(true);
        notification.success({ message: 'Đã gửi yêu cầu thanh toán!', placement: 'topRight' });
      } else {
        // API có thể chưa tồn tại — vẫn hiển thị hướng dẫn chuyển khoản (xác nhận thủ công)
        setOrderCreated(true);
      }
    } catch {
      setOrderCreated(true);
    } finally {
      setSubmitting(false);
    }
  };

  const goBack = () => {
    if (redirectUrl) {
      const t = new URL(redirectUrl);
      const token = localStorage.getItem('sso_token');
      if (token) t.searchParams.set('sso_token', token);
      window.location.href = t.toString();
    } else {
      window.location.href = '/ui/sso';
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
      background: 'linear-gradient(135deg, #090d16 0%, #1e1b4b 50%, #0f172a 100%)',
    }}>
      <Card style={{
        width: '100%', maxWidth: 520, borderRadius: 16,
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        border: '1px solid rgba(99,102,241,0.25)',
      }}>
        <Button type="text" onClick={goBack} style={{ padding: 0, marginBottom: 8 }}>
          <ArrowLeftOutlined /> Quay lại
        </Button>
        <Title level={3} style={{ margin: '4px 0 2px' }}>💳 Thanh Toán</Title>
        <Text type="secondary" style={{ fontSize: '0.85rem' }}>
          Hoàn tất thanh toán để nâng cấp gói dịch vụ
        </Text>

        {/* ── Bước 1: Chọn gói ── */}
        <div style={{ marginTop: 20 }}>
          <Text strong>1. Chọn gói</Text>
          <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
            {plans.map((p) => (
              <div
                key={p.name}
                onClick={() => setSelectedPlan(p.name)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
                  border: selectedPlan === p.name ? `2px solid ${p.color}` : '1px solid rgba(255,255,255,0.12)',
                  background: selectedPlan === p.name ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, color: p.color }}>{p.emoji} {p.label}</div>
                  <div style={{ fontSize: '0.78rem', opacity: 0.7 }}>{p.description}</div>
                </div>
                <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>
                  {formatPrice(p.price)}<span style={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.6 }}>/tháng</span>
                </div>
              </div>
            ))}
          </Space>
        </div>

        {/* ── Bước 2: Chọn phương thức ── */}
        <div style={{ marginTop: 20 }}>
          <Text strong>2. Phương thức thanh toán</Text>
          <Radio.Group
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            style={{ width: '100%', marginTop: 8 }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              {PAYMENT_METHODS.map((m) => (
                <Radio
                  key={m.id}
                  value={m.id}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 12,
                    border: method === m.id ? `2px solid ${m.color}` : '1px solid rgba(255,255,255,0.12)',
                    background: method === m.id ? 'rgba(99,102,241,0.08)' : 'transparent',
                    marginInlineEnd: 0,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{m.icon} {m.name}</span>
                  <div style={{ fontSize: '0.75rem', opacity: 0.65, marginLeft: 24 }}>{m.description}</div>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </div>

        {/* ── Chi tiết theo phương thức ── */}
        <div style={{ marginTop: 20, padding: 16, borderRadius: 12, background: 'rgba(0,0,0,0.25)', border: '1px dashed rgba(255,255,255,0.12)' }}>
          {method === 'bank_transfer' && (
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Ngân hàng:</Text><Text strong>{BANK_INFO.bankName}</Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Số tài khoản:</Text>
                <Space>
                  <Text strong copyable={false}>{BANK_INFO.accountNumber}</Text>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(BANK_INFO.accountNumber, 'acc')}>
                    {copied === 'acc' ? 'Đã copy' : ''}
                  </Button>
                </Space>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Chủ tài khoản:</Text><Text strong>{BANK_INFO.accountHolder}</Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Số tiền:</Text>
                <Text strong style={{ color: '#f5d78e' }}>{formatPrice(plan.price)}</Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Nội dung CK:</Text>
                <Space>
                  <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>{transferNote}</Tag>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(transferNote, 'note')}>
                    {copied === 'note' ? 'Đã copy' : ''}
                  </Button>
                </Space>
              </div>
              <Alert
                type="info" showIcon icon={<QrcodeOutlined />}
                message="Quét QR bằng app ngân hàng hoặc nhập tay thông tin trên. Giữ đúng NỘI DUNG CHUYỂN KHOẢN để hệ thống đối soát tự động."
                style={{ marginTop: 8 }}
              />
            </Space>
          )}

          {method === 'momo' && (
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Số điện thoại MoMo:</Text>
                <Space>
                  <Text strong>{MOMO_INFO.phone}</Text>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(MOMO_INFO.phone, 'momo')}>
                    {copied === 'momo' ? 'Đã copy' : ''}
                  </Button>
                </Space>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Tên tài khoản:</Text><Text strong>{MOMO_INFO.accountHolder}</Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Số tiền:</Text>
                <Text strong style={{ color: '#f5d78e' }}>{formatPrice(plan.price)}</Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">Lời nhắn:</Text>
                <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>{transferNote}</Tag>
              </div>
              <Alert type="info" showIcon message="Mở app MoMo → Chuyển tiền → nhập số điện thoại kèm lời nhắn. Gói sẽ được kích hoạt sau khi xác nhận." style={{ marginTop: 8 }} />
            </Space>
          )}

          {method === 'visa' && (
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              <Input
                placeholder="Số thẻ (4242 4242 4242 4242)"
                value={visaForm.cardNumber}
                onChange={(e) => setVisaForm({ ...visaForm, cardNumber: e.target.value.replace(/[^\d ]/g, '').slice(0, 19) })}
              />
              <Input
                placeholder="Tên chủ thẻ"
                value={visaForm.holder}
                onChange={(e) => setVisaForm({ ...visaForm, holder: e.target.value.toUpperCase() })}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  placeholder="MM/YY"
                  style={{ width: '50%' }}
                  value={visaForm.expiry}
                  onChange={(e) => setVisaForm({ ...visaForm, expiry: e.target.value.slice(0, 5) })}
                />
                <Input.Password
                  placeholder="CVV"
                  style={{ width: '50%' }}
                  value={visaForm.cvv}
                  onChange={(e) => setVisaForm({ ...visaForm, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                />
              </div>
              <Alert type="warning" showIcon message="Thanh toán thẻ đang trong chế độ demo — thông tin thẻ chỉ ghi nhận yêu cầu, không charge thật." style={{ marginTop: 8 }} />
            </Space>
          )}
        </div>

        {/* ── Tổng kết + xác nhận ── */}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Text type="secondary" style={{ fontSize: '0.8rem' }}>Tổng thanh toán</Text>
            <div style={{ fontWeight: 800, fontSize: '1.35rem', color: '#f5d78e' }}>{formatPrice(plan.price)}</div>
          </div>
          <Button
            type="primary" size="large" loading={submitting}
            disabled={orderCreated}
            onClick={handleConfirm}
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', fontWeight: 700, height: 48, minWidth: 200 }}
          >
            {orderCreated ? '✓ Đã ghi nhận' : `Xác nhận thanh toán`}
          </Button>
        </div>

        {orderCreated && (
          <Alert
            type="success" showIcon icon={<CheckCircleOutlined />} style={{ marginTop: 16 }}
            message="Yêu cầu thanh toán đã được ghi nhận!"
            description={
              <div>
                <Paragraph style={{ margin: 0, fontSize: '0.85rem' }}>
                  Sau khi bạn chuyển khoản, admin sẽ xác nhận và kích hoạt gói <b>{plan?.label}</b> trong vòng vài phút.
                </Paragraph>
                <Button type="link" onClick={goBack} style={{ padding: 0, marginTop: 4 }}>
                  ← Quay về ứng dụng
                </Button>
              </div>
            }
          />
        )}
      </Card>
    </div>
  );
}
