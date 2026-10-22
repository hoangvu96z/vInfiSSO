import React from 'react';
import { Modal, Form, Input, InputNumber, Select, message } from 'antd';
import { authFetch, getResponseErrorMessage } from '../../../utils/api';

const { Option } = Select;

export default function CreateCouponModal({ open, onCancel, onSaveSuccess }) {
  const [form] = Form.useForm();

  const handleFinish = async (values) => {
    try {
      const res = await authFetch('/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, code: values.code.toUpperCase(), isActive: true }),
      });
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể tạo mã khuyến mãi'));
        return;
      }
      form.resetFields();
      message.success('Tạo mã khuyến mãi mới thành công! 🎟️');
      onSaveSuccess?.();
      onCancel();
    } catch {
      message.error('Không thể tạo mã khuyến mãi. Vui lòng thử lại.');
    }
  };

  return (
    <Modal
      title="🎟️ Tạo Mã Khuyến Mãi Mới"
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="Tạo mã"
      cancelText="Hủy"
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={{ type: 'grant_plan', planName: 'lite', durationDays: 30, maxUses: -1 }}
      >
        <Form.Item name="code" label="Mã Code" rules={[{ required: true, message: 'Vui lòng nhập mã code' }]}>
          <Input placeholder="VD: TRIAL7, PROMO50" style={{ textTransform: 'uppercase' }} />
        </Form.Item>
        <Form.Item name="description" label="Mô tả">
          <Input placeholder="Mô tả mã..." />
        </Form.Item>
        <Form.Item name="type" label="Loại Khuyến Mãi">
          <Select>
            <Option value="grant_plan">🎁 Tặng Gói</Option>
            <Option value="trial_days">📅 Tặng Ngày</Option>
          </Select>
        </Form.Item>
        <Form.Item name="planName" label="Gói Tặng">
          <Select>
            <Option value="lite">Lite</Option>
            <Option value="premium">Premium</Option>
          </Select>
        </Form.Item>
        <Form.Item name="durationDays" label="Số Ngày">
          <InputNumber style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
