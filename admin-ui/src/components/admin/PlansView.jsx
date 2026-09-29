import React, { useState, useEffect, useCallback } from 'react';
import { Row, Col, Card, Typography, Switch, Button, message } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import EditPlanModal from './modals/EditPlanModal';
import { authFetch, safeArr } from '../../utils/api';

const { Title, Text } = Typography;

export default function PlansView() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    const res = await authFetch('/admin/plans');
    if (res) {
      const data = await res.json();
      setPlans(data.plans || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

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

  return (
    <div>
      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        {safeArr(plans).map((plan) => (
          <Col xs={24} md={8} key={plan.name}>
            <Card
              loading={loading}
              title={
                <span>
                  {plan.name === 'premium' ? '💎' : plan.name === 'lite' ? '🌟' : '⚡'} {plan.label}
                </span>
              }
              extra={<Switch checked={plan.isActive} onChange={(checked) => handleTogglePlan(plan.name, checked)} />}
              actions={[
                <Button
                  key="edit"
                  type="link"
                  icon={<EditOutlined />}
                  onClick={() => setEditingPlan(plan)}
                >
                  Chỉnh Sửa
                </Button>,
              ]}
            >
              <Title level={3} style={{ margin: '0 0 12px 0', color: '#6366f1' }}>
                {plan.price === 0 ? 'Miễn phí' : `${Number(plan.price).toLocaleString('vi-VN')}đ/tháng`}
              </Title>
              <div style={{ marginBottom: 4 }}>
                📅 {plan.dailyLimit === -1 ? 'Không giới hạn lượt/ngày' : `${plan.dailyLimit} lượt/ngày`}
              </div>
              <div style={{ marginBottom: 4 }}>
                📆 {plan.monthlyLimit === -1 ? 'Không giới hạn lượt/tháng' : `${plan.monthlyLimit} lượt/tháng`}
              </div>
              <div style={{ marginBottom: 12 }}>
                {plan.canBonus ? `✨ Hỏi thêm ${plan.bonusAmount} câu/lần` : '❌ Không có hỏi thêm'}
              </div>

              {/* Free-override toggles — chỉ hiện trên gói Free */}
              {plan.name === 'free' && (
                <div
                  style={{
                    borderTop: '1px dashed rgba(255,255,255,0.15)',
                    paddingTop: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12 }}>🆓 Free dùng Lite miễn phí</Text>
                    <Switch
                      size="small"
                      checked={plan.overrideFreeToLite}
                      onChange={(v) => handleTogglePlanField('free', 'overrideFreeToLite', v, 'Free dùng Lite miễn phí')}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12 }}>👑 Free dùng Premium miễn phí</Text>
                    <Switch
                      size="small"
                      checked={plan.overrideFreeToPremium}
                      onChange={(v) => handleTogglePlanField('free', 'overrideFreeToPremium', v, 'Free dùng Premium miễn phí')}
                    />
                  </div>
                </div>
              )}
            </Card>
          </Col>
        ))}
      </Row>

      <EditPlanModal
        plan={editingPlan}
        open={!!editingPlan}
        onCancel={() => setEditingPlan(null)}
        onSaveSuccess={loadPlans}
      />
    </div>
  );
}
