import React, { useEffect } from 'react';
import { Modal, Form, Select, InputNumber, message } from 'antd';
import { authFetch, getResponseErrorMessage } from '../../../utils/api';

const { Option } = Select;

export default function GrantPlanModal({ user, open, onCancel, onSaveSuccess }) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (open) {
      form.setFieldsValue({ planName: 'lite', durationDays: 30 });
    }
  }, [open, form]);

  const handleFinish = async (values) => {
    if (!user) return;
    try {
      const res = await authFetch(`/admin/users/${user.id}/grant-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể tặng gói cho người dùng'));
        return;
      }
      message.success(`Đã tặng gói ${values.planName.toUpperCase()} cho người dùng thành công! 🎁`);
      onSaveSuccess?.();
      onCancel();
    } catch {
      message.error('Không thể tặng gói cho người dùng. Vui lòng thử lại.');
    }
  };

  return (
    <Modal
      title={user ? `🎁 Tặng Gói Cho User: ${user.fullName || user.email}` : '🎁 Tặng Gói Cho User'}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="Tặng gói"
      cancelText="Hủy"
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={{ planName: 'lite', durationDays: 30 }}
      >
        <Form.Item name="planName" label="Gói Tặng">
          <Select>
            <Option value="free">Free</Option>
            <Option value="lite">Lite</Option>
            <Option value="premium">Premium</Option>
          </Select>
        </Form.Item>
        <Form.Item name="durationDays" label="Số Ngày (0 = vĩnh viễn)">
          <InputNumber style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
