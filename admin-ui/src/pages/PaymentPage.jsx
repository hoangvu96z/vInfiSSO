import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Space, Typography } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { authFetch, getResponseErrorMessage, safeArr } from '../utils/api';

const { Title, Text } = Typography;
const PLAN_PRESENTATION = {
  lite: { emoji: '🌟', color: '#60a5fa' },
  premium: { emoji: '💎', color: '#f5d78e' },
};

const formatVnd = (price) => {
  const amount = Number(price);
  return Number.isSafeInteger(amount) && amount > 0
    ? `${new Intl.NumberFormat('vi-VN').format(amount)}đ`
    : '—';
};

function orderStatusLabel(order) {
  if (order.status === 'paid') return 'Đã được quản trị viên xác nhận';
  if (order.status === 'expired') return 'Mã thanh toán đã hết hạn';
  return 'Đang chờ quản trị viên xác nhận chuyển khoản';
}

export default function PaymentPage({ user }) {
  const query = new URLSearchParams(window.location.search);
  const preselectedPlan = query.get('plan');
  const redirectUrl = query.get('redirect');

  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(preselectedPlan || '');
  const [plansLoading, setPlansLoading] = useState(true);
  const [planLoadError, setPlanLoadError] = useState('');
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [createError, setCreateError] = useState('');
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [returnError, setReturnError] = useState('');
  const [returning, setReturning] = useState(false);

  const loadOrders = useCallback(async () => {
    if (!user) return;
    setOrdersLoading(true);
    setOrdersError('');
    try {
      const response = await authFetch('/plans/orders');
      if (!response) return;
      if (!response.ok) {
        setOrdersError(await getResponseErrorMessage(response, 'Không thể tải trạng thái thanh toán'));
        return;
      }
      setOrders(safeArr(await response.json()));
    } catch {
      setOrdersError('Không thể tải trạng thái thanh toán. Vui lòng thử lại.');
    } finally {
      setOrdersLoading(false);
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    const loadPlans = async () => {
      setPlansLoading(true);
      setPlanLoadError('');
      try {
        const response = await fetch('/plans/config');
        if (!response.ok) {
          throw new Error(await getResponseErrorMessage(response, 'Không thể tải bảng giá hiện hành'));
        }
        const data = await response.json();
        const paidPlans = safeArr(data.plans).filter((plan) =>
          plan.name !== 'free' && plan.isActive && Number.isSafeInteger(Number(plan.price)) && Number(plan.price) > 0,
        );
        if (!paidPlans.length) throw new Error('Hiện không có gói trả phí đang mở đăng ký.');
        if (!active) return;
        setPlans(paidPlans);
        const initialPlan = paidPlans.find((plan) => plan.name === preselectedPlan) || paidPlans[0];
        setSelectedPlan(initialPlan.name);
      } catch (error) {
        if (active) {
          setPlans([]);
          setPlanLoadError(error.message || 'Không thể tải bảng giá hiện hành.');
        }
      } finally {
        if (active) setPlansLoading(false);
      }
    };
    loadPlans();
    return () => {
      active = false;
    };
  }, [preselectedPlan]);

  useEffect(() => {
    if (user) loadOrders();
  }, [user, loadOrders]);

  // Require login before creating or viewing payment orders.
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

  const plan = plans.find((item) => item.name === selectedPlan) || plans[0];
  const latestOrder = orders[0] || null;

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

  const createOrder = async () => {
    if (!plan || creatingOrder) return;
    setCreatingOrder(true);
    setCreateError('');
    try {
      const response = await authFetch('/plans/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planName: plan.name }),
      });
      if (!response) return;
      if (!response.ok) {
        setCreateError(await getResponseErrorMessage(response, 'Không thể tạo đơn thanh toán'));
        return;
      }
      const created = await response.json();
      setOrders((current) => [created, ...current.filter((order) => order.id !== created.id)]);
    } catch {
      setCreateError('Không thể tạo đơn thanh toán. Vui lòng thử lại.');
    } finally {
      setCreatingOrder(false);
    }
  };

  const orderExpiresAt = latestOrder?.expiresAt
    ? new Date(latestOrder.expiresAt).toLocaleString('vi-VN')
    : '';

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: 'linear-gradient(135deg, #090d16 0%, #1e1b4b 50%, #0f172a 100%)',
    }}>
      <Card style={{ width: '100%', maxWidth: 600, borderRadius: 16, boxShadow: '0 20px 50px rgba(0,0,0,0.5)', border: '1px solid rgba(99,102,241,0.25)' }}>
        <Button type="text" onClick={goBack} style={{ padding: 0, marginBottom: 8 }}>
          <ArrowLeftOutlined /> Quay lại
        </Button>
        <Title level={3} style={{ margin: '4px 0 2px' }}>💳 Thanh toán VietQR</Title>
        <Text type="secondary" style={{ fontSize: '0.85rem' }}>
          Chọn gói, quét mã chuyển khoản đúng số tiền và nội dung bên dưới. Đơn chỉ được kích hoạt sau khi quản trị viên xác nhận giao dịch.
        </Text>

        <div style={{ marginTop: 20 }}>
          <Text strong>1. Chọn gói</Text>
          <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
            {plans.map((item) => {
              const presentation = PLAN_PRESENTATION[item.name] || { emoji: '📦', color: '#a5b4fc' };
              return (
                <button
                  type="button"
                  key={item.name}
                  aria-pressed={selectedPlan === item.name}
                  onClick={() => setSelectedPlan(item.name)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                    width: '100%', padding: '12px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', color: 'inherit',
                    border: selectedPlan === item.name ? `2px solid ${presentation.color}` : '1px solid rgba(255,255,255,0.12)',
                    background: selectedPlan === item.name ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
                  }}
                >
                  <span>
                    <span style={{ display: 'block', fontWeight: 700, color: presentation.color }}>{presentation.emoji} {item.label}</span>
                    <span style={{ display: 'block', fontSize: '0.78rem', opacity: 0.7 }}>{item.description}</span>
                  </span>
                  <span style={{ flexShrink: 0, fontWeight: 800, fontSize: '1.05rem' }}>
                    {formatVnd(item.price)}<span style={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.6 }}>/tháng</span>
                  </span>
                </button>
              );
            })}
          </Space>
          {plansLoading && <Text type="secondary">Đang tải bảng giá…</Text>}
          {planLoadError && <Alert type="error" showIcon message="Chưa thể tạo đơn thanh toán" description={planLoadError} style={{ marginTop: 12 }} />}
        </div>

        {plan && (
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text type="secondary">Số tiền theo bảng giá máy chủ</Text>
            <Text strong style={{ fontSize: '1.35rem', color: '#f5d78e' }}>{formatVnd(plan.price)}</Text>
          </div>
        )}

        <Button
          type="primary"
          block
          loading={creatingOrder}
          disabled={!plan || plansLoading || !!planLoadError}
          onClick={createOrder}
          style={{ marginTop: 16, minHeight: 44 }}
        >
          Tạo đơn và mã VietQR
        </Button>
        {createError && <Alert type="error" showIcon message={createError} style={{ marginTop: 12 }} />}

        {latestOrder && (
          <Card size="small" style={{ marginTop: 20, background: 'rgba(15,23,42,0.5)' }}>
            <Text strong>2. Đơn thanh toán gần nhất</Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
              <Text>{latestOrder.planLabel}</Text>
              <Text strong>{formatVnd(latestOrder.amount)}</Text>
            </div>
            <div style={{ marginTop: 8 }}><Text type="secondary">Trạng thái: </Text><Text strong>{orderStatusLabel(latestOrder)}</Text></div>
            {latestOrder.status === 'pending' && latestOrder.qrImageUrl && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 14 }}>
                <img
                  src={latestOrder.qrImageUrl}
                  alt={`Mã VietQR thanh toán ${formatVnd(latestOrder.amount)}`}
                  referrerPolicy="no-referrer"
                  style={{ width: 240, maxWidth: '100%', background: '#fff', borderRadius: 8, padding: 8 }}
                />
                <div style={{ width: '100%', marginTop: 12 }}>
                  <div><Text type="secondary">Ngân hàng: </Text><Text>{latestOrder.bankName}</Text></div>
                  <div><Text type="secondary">Số tài khoản: </Text><Text copyable>{latestOrder.accountNumber}</Text></div>
                  <div><Text type="secondary">Chủ tài khoản: </Text><Text>{latestOrder.accountName}</Text></div>
                  <div><Text type="secondary">Số tiền: </Text><Text strong>{formatVnd(latestOrder.amount)}</Text></div>
                  <div><Text type="secondary">Nội dung chuyển khoản: </Text><Text strong copyable>{latestOrder.reference}</Text></div>
                  {orderExpiresAt && <Text type="secondary">Mã có hiệu lực đến {orderExpiresAt}</Text>}
                </div>
              </div>
            )}
            {latestOrder.status === 'paid' && (
              <Alert type="success" showIcon message="Quản trị viên đã xác nhận khoản thanh toán này." description="Gói dịch vụ đã được kích hoạt trên tài khoản của bạn." style={{ marginTop: 12 }} />
            )}
            {latestOrder.status === 'expired' && (
              <Alert type="warning" showIcon message="Mã chuyển khoản đã hết hạn." description="Nếu bạn đã chuyển tiền, hãy liên hệ quản trị viên và cung cấp mã tham chiếu để được kiểm tra." style={{ marginTop: 12 }} />
            )}
            <Button icon={<ReloadOutlined />} loading={ordersLoading} onClick={loadOrders} style={{ marginTop: 12 }}>
              Cập nhật trạng thái
            </Button>
          </Card>
        )}
        {ordersError && <Alert type="warning" showIcon message={ordersError} style={{ marginTop: 12 }} />}
        {!latestOrder && !ordersLoading && !ordersError && (
          <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
            Chưa có đơn thanh toán. Gói chỉ được kích hoạt sau khi giao dịch được xác nhận.
          </Text>
        )}
        {returnError && <Alert type="error" showIcon message={returnError} style={{ marginTop: 12 }} />}
        <Button type="link" loading={returning} onClick={goBack} style={{ paddingInline: 0, marginTop: 8 }}>
          ← Quay về ứng dụng
        </Button>
      </Card>
    </div>
  );
}
