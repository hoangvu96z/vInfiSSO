import React, { useState, useEffect } from 'react';
import { Card, Button, Typography, Space, Alert } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { getResponseErrorMessage } from '../utils/api';

const { Title, Text } = Typography;

// Fallback plans (khi API /plans/config không trả về)
const FALLBACK_PLANS = [
  { name: 'lite', label: 'Gói Lite', price: 10000, emoji: '🌟', color: '#60a5fa',
    description: '5 lượt hỏi AI/ngày · 60 lượt/tháng' },
  { name: 'premium', label: 'Gói Premium', price: 20000, emoji: '💎', color: '#f5d78e',
    description: 'Không giới hạn hàng ngày · 180 lượt/tháng · Hỏi thêm 5 câu/quẻ' },
];

// Format thủ công để chắc chắn luôn ra "20.000đ" (toLocaleString không nhất quán giữa môi trường)
const formatPrice = (price) => {
  if (!price) return 'Miễn phí';
  return `${String(price).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
};

export default function PaymentPage({ user }) {
  const query = new URLSearchParams(window.location.search);
  const preselectedPlan = query.get('plan');
  const redirectUrl = query.get('redirect');

  const [plans, setPlans] = useState(FALLBACK_PLANS);
  const [selectedPlan, setSelectedPlan] = useState(preselectedPlan || 'premium');
  const [planLoadError, setPlanLoadError] = useState('');
  const [returnError, setReturnError] = useState('');
  const [returning, setReturning] = useState(false);

  // Fetch bảng giá từ server (có cấu hình động từ admin)
  useEffect(() => {
    let active = true;
    const loadPlans = async () => {
      try {
        const res = await fetch('/plans/config');
        if (!res.ok) {
          const detail = await getResponseErrorMessage(res, 'Không thể tải bảng giá hiện hành');
          if (active) setPlanLoadError(`${detail}. Đang hiển thị bảng giá dự phòng.`);
          return;
        }
        const data = await res.json();
        if (!Array.isArray(data.plans) || data.plans.length === 0) {
          if (active) setPlanLoadError('Bảng giá hiện hành không có sẵn. Đang hiển thị bảng giá dự phòng.');
          return;
        }
        const paid = data.plans
          .filter((p) => p.name !== 'free' && p.price > 0)
          .map((p) => {
            const meta = FALLBACK_PLANS.find((f) => f.name === p.name) || {};
            return { ...meta, ...p, emoji: meta.emoji || '📦', color: meta.color || '#a5b4fc' };
          });
        if (paid.length > 0) {
          if (active) setPlans(paid);
        } else if (active) {
          setPlanLoadError('Không có gói trả phí trong bảng giá hiện hành. Đang hiển thị bảng giá dự phòng.');
        }
      } catch {
        if (active) setPlanLoadError('Không thể tải bảng giá hiện hành. Đang hiển thị bảng giá dự phòng.');
      }
    };
    loadPlans();
    return () => {
      active = false;
    };
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

  const goBack = async () => {
    if (redirectUrl) {
      setReturnError('');
      setReturning(true);
      try {
        const token = localStorage.getItem('sso_token');
        const response = await fetch('/sso/issue-code', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({ redirectUri: redirectUrl }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.redirectUrl) {
          throw new Error(data.message || 'Không thể tạo phiên đăng nhập an toàn.');
        }
        window.location.href = data.redirectUrl;
      } catch (error) {
        setReturnError(error.message || 'Không thể quay lại ứng dụng.');
      } finally {
        setReturning(false);
      }
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
          Tham khảo các gói dịch vụ và mức giá hiện hành
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

        {/* ── Payment is disabled until a server-side order flow is available ── */}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Text type="secondary" style={{ fontSize: '0.8rem' }}>Giá gói được chọn</Text>
            <div style={{ fontWeight: 800, fontSize: '1.35rem', color: '#f5d78e' }}>{formatPrice(plan.price)}</div>
          </div>
        </div>
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
          message="Thanh toán hiện chưa được hỗ trợ"
          description="Chưa có quy trình tạo và xác nhận đơn thanh toán an toàn. Vui lòng chưa chuyển tiền hoặc nhập thông tin thẻ."
        />
        {planLoadError && <Alert type="warning" showIcon message={planLoadError} style={{ marginTop: 12 }} />}
        {returnError && <Alert type="error" showIcon message={returnError} style={{ marginTop: 12 }} />}
        <Button type="link" loading={returning} onClick={goBack} style={{ paddingInline: 0, marginTop: 8 }}>
          ← Quay về ứng dụng
        </Button>
      </Card>
    </div>
  );
}
