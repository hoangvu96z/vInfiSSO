import React, { useEffect } from 'react';
import { Modal, Form, Input, InputNumber, Switch, Row, Col, message } from 'antd';
import { authFetch } from '../../../utils/api';

export default function EditPlanModal({ plan, open, onCancel, onSaveSuccess }) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (plan && open) {
      form.setFieldsValue({ ...plan });
    }
  }, [plan, open, form]);

  const handleFinish = async (values) => {
    if (!plan) return;
    const res = await authFetch(`/admin/plans/${plan.name}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (res && res.ok) {
      message.success(`💎 Đã lưu thay đổi gói "${plan.label}" thành công!`);
      onSaveSuccess?.();
      onCancel();
    } else {
      message.error('❌ Lưu thất bại! Vui lòng thử lại.');
    }
  };

  return (
    <Modal
      title={plan ? `✏️ Chỉnh Sửa Gói: ${plan.label}` : '✏️ Chỉnh Sửa Gói Dịch Vụ'}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="💾 Lưu Thay Đổi"
      cancelText="Huỷ"
      width={560}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="label" label="Tên gói hiển thị" rules={[{ required: true }]}>
              <Input placeholder="VD: Gói Lite, Gói Premium..." />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="price" label="Giá (VND, 0 = miễn phí)">
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                step={1000}
                formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              />
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
        {plan?.name === 'free' && (
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
  );
}
