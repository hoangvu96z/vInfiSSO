import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { CheckOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { authFetch, getResponseErrorMessage, safeArr } from '../../utils/api';

const { Text, Title } = Typography;

function formatVnd(amount) {
  const value = Number(amount);
  return Number.isSafeInteger(value) && value > 0
    ? `${new Intl.NumberFormat('vi-VN').format(value)}đ`
    : '—';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN');
}

function statusTag(order) {
  if (order.status === 'paid') return <Tag color="green">Đã xác nhận</Tag>;
  if (order.status === 'expired') return <Tag color="orange">Hết hạn, cần kiểm tra</Tag>;
  return <Tag color="blue">Đang chờ</Tag>;
}

export default function PaymentsView() {
  const [form] = Form.useForm();
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState('');
  const [loadError, setLoadError] = useState('');

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const response = await authFetch('/admin/payment-settings');
      if (!response) return;
      if (!response.ok) {
        setLoadError(await getResponseErrorMessage(response, 'Không thể tải cấu hình thanh toán'));
        return;
      }
      const data = await response.json();
      setConfigured(!!data.configured);
      form.setFieldsValue(data.settings || {
        bankBin: '', bankName: '', accountNumber: '', accountName: '',
      });
      setLoadError('');
    } catch {
      setLoadError('Không thể tải cấu hình thanh toán. Vui lòng thử lại.');
    } finally {
      setSettingsLoading(false);
    }
  }, [form]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const response = await authFetch('/admin/payment-orders');
      if (!response) return;
      if (!response.ok) {
        message.error(await getResponseErrorMessage(response, 'Không thể tải đơn thanh toán'));
        return;
      }
      setOrders(safeArr(await response.json()));
    } catch {
      message.error('Không thể tải đơn thanh toán. Vui lòng thử lại.');
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadOrders();
  }, [loadSettings, loadOrders]);

  const saveSettings = async (values) => {
    setSavingSettings(true);
    try {
      const response = await authFetch('/admin/payment-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response) return;
      if (!response.ok) {
        message.error(await getResponseErrorMessage(response, 'Không thể lưu thông tin ngân hàng'));
        return;
      }
      const data = await response.json();
      setConfigured(!!data.configured);
      form.setFieldsValue(data.settings);
      message.success('Đã lưu cấu hình tài khoản nhận VietQR.');
    } catch {
      message.error('Không thể lưu cấu hình tài khoản nhận. Vui lòng thử lại.');
    } finally {
      setSavingSettings(false);
    }
  };

  const markPaid = async (orderId) => {
    setReviewingId(orderId);
    try {
      const response = await authFetch(`/admin/payment-orders/${orderId}/mark-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response) return;
      if (!response.ok) {
        message.error(await getResponseErrorMessage(response, 'Không thể cập nhật đơn thanh toán'));
        return;
      }
      const result = await response.json();
      message.success(result.alreadyPaid ? 'Đơn này đã được xác nhận trước đó.' : 'Đã xác nhận và kích hoạt gói dịch vụ.');
      await loadOrders();
    } catch {
      message.error('Không thể cập nhật đơn thanh toán. Vui lòng thử lại.');
    } finally {
      setReviewingId('');
    }
  };

  const columns = [
    {
      title: 'Người dùng',
      key: 'user',
      render: (_, order) => (
        <div>
          <Text strong>{order.displayName || 'Người dùng'}</Text>
          <br />
          <Text type="secondary">{order.email}</Text>
        </div>
      ),
    },
    {
      title: 'Gói / số tiền',
      key: 'plan',
      render: (_, order) => <span>{order.planLabel}<br /><Text strong>{formatVnd(order.amount)}</Text></span>,
    },
    {
      title: 'Nội dung chuyển khoản',
      dataIndex: 'reference',
      key: 'reference',
      render: (reference) => <Text code copyable>{reference}</Text>,
    },
    { title: 'Trạng thái', dataIndex: 'status', key: 'status', render: (_, order) => statusTag(order) },
    {
      title: 'Tạo lúc / hết hạn',
      key: 'dates',
      render: (_, order) => <Text type="secondary">{formatDate(order.createdAt)}<br />Hết hạn: {formatDate(order.expiresAt)}</Text>,
    },
    {
      title: 'Đã xác nhận lúc',
      dataIndex: 'paidAt',
      key: 'paidAt',
      render: formatDate,
    },
    {
      title: 'Thao tác',
      key: 'action',
      render: (_, order) => order.status === 'paid' ? (
        <Text type="secondary">Đã duyệt</Text>
      ) : (
        <Popconfirm
          title="Xác nhận đã nhận tiền?"
          description={`Chỉ xác nhận sau khi đối chiếu đúng số tiền ${formatVnd(order.amount)} và nội dung ${order.reference} trên sao kê ngân hàng.`}
          okText="Đã đối chiếu"
          cancelText="Hủy"
          onConfirm={() => markPaid(order.id)}
        >
          <Button type="primary" size="small" icon={<CheckOutlined />} loading={reviewingId === order.id}>
            Xác nhận đã nhận tiền
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <Card loading={settingsLoading}>
        <Title level={4} style={{ marginTop: 0 }}>Tài khoản nhận VietQR</Title>
        <Alert
          type={configured ? 'info' : 'warning'}
          showIcon
          message={configured ? 'Đang dùng thông tin đã lưu trong cơ sở dữ liệu.' : 'Chưa cấu hình tài khoản nhận. Người dùng chưa thể tạo đơn.'}
          description={<>Nhập tài khoản nhận do bạn quản lý. Thông tin sẽ được lưu và chỉ quản trị viên được xem/sửa. Mã QR dùng định dạng Quick Link của <a href="https://www.vietqr.io/qr-dong" target="_blank" rel="noreferrer">VietQR Kit</a>.</>}
          style={{ marginBottom: 20 }}
        />
        {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} />}
        <Form form={form} layout="vertical" onFinish={saveSettings} requiredMark="optional">
          <Form.Item
            name="bankBin"
            label="Mã BIN ngân hàng"
            extra="Nhập BIN 6 chữ số theo danh sách ngân hàng VietQR."
            rules={[{ required: true, pattern: /^\d{6}$/, message: 'BIN gồm đúng 6 chữ số.' }]}
          >
            <Input maxLength={6} inputMode="numeric" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="bankName"
            label="Tên ngân hàng"
            rules={[{ required: true, min: 2, max: 100, message: 'Nhập tên ngân hàng (2–100 ký tự).' }]}
          >
            <Input maxLength={100} autoComplete="organization" />
          </Form.Item>
          <Form.Item
            name="accountNumber"
            label="Số tài khoản"
            rules={[{ required: true, pattern: /^[A-Za-z0-9]{6,19}$/, message: 'Số tài khoản gồm 6–19 ký tự chữ hoặc số.' }]}
          >
            <Input maxLength={19} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="accountName"
            label="Tên chủ tài khoản"
            rules={[{ required: true, min: 2, max: 100, message: 'Nhập tên chủ tài khoản (2–100 ký tự).' }]}
          >
            <Input maxLength={100} autoComplete="name" />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={savingSettings}>
            Lưu cấu hình
          </Button>
        </Form>
      </Card>

      <Card
        title={<Title level={4} style={{ margin: 0 }}>Đơn thanh toán chờ đối chiếu</Title>}
        extra={<Button icon={<ReloadOutlined />} onClick={loadOrders} loading={ordersLoading}>Tải lại</Button>}
      >
        <Alert
          type="warning"
          showIcon
          message="Kiểm tra sao kê ngân hàng trước khi xác nhận."
          description="Không có webhook ở Sprint 1; chỉ thao tác sau khi số tiền và mã tham chiếu khớp với giao dịch thực tế. Đơn hết hạn vẫn có thể xác nhận nếu tiền đã đến và đối chiếu đúng."
          style={{ marginBottom: 16 }}
        />
        <Table
          rowKey="id"
          loading={ordersLoading}
          columns={columns}
          dataSource={orders}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 1100 }}
          locale={{ emptyText: 'Chưa có đơn thanh toán.' }}
        />
      </Card>
    </Space>
  );
}
