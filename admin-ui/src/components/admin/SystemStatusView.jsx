import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Row, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { authFetch } from '../../utils/api';

const { Text, Title } = Typography;

const backupLabels = {
  running: ['Đang chạy', 'processing'],
  failed: ['Backup lỗi', 'error'],
  offsite_failed: ['Lỗi sao lưu offsite', 'error'],
  local_only: ['Chỉ có bản local', 'warning'],
  offsite_ok: ['Đã xác minh offsite', 'success'],
  unknown: ['Chưa xác định', 'default'],
};

const freshnessLabels = {
  fresh: ['Mới', 'success'],
  stale: ['Đã cũ', 'warning'],
  missing: ['Chưa có dữ liệu', 'default'],
  invalid: ['Không đọc được', 'error'],
};

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function statusTag(status, labels, fallback = ['Chưa xác định', 'default']) {
  const [label, color] = labels[status] || fallback;
  return <Tag color={color}>{label}</Tag>;
}

function ReadinessCard({ title, status, labels, description }) {
  return (
    <Card title={title} size="small" style={{ height: '100%' }}>
      <Space direction="vertical" size={8}>
        {statusTag(status, labels)}
        <Text type="secondary">{description}</Text>
      </Space>
    </Card>
  );
}

export default function SystemStatusView() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authFetch('/admin/system-status');
      if (!response) return;
      if (!response.ok) {
        setError(`Không thể tải trạng thái hệ thống (HTTP ${response.status}).`);
        return;
      }
      setStatus(await response.json());
    } catch {
      setError('Không thể tải trạng thái hệ thống. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const backup = status?.backup;
  const backupIsProblem =
    backup?.freshness !== 'fresh' ||
    backup?.status !== 'offsite_ok';
  const backupWarning = (() => {
    if (backup?.freshness === 'stale') return 'Thông tin sao lưu đã cũ';
    if (backup?.freshness === 'missing') return 'Chưa có thông tin sao lưu';
    if (backup?.freshness === 'invalid') return 'Không xác minh được thông tin sao lưu';
    if (backup?.status === 'local_only') return 'Bản sao lưu gần nhất chỉ có trên máy chủ';
    if (backup?.status === 'offsite_failed') return 'Tác vụ sao lưu offsite chưa hoàn tất';
    if (backup?.status === 'failed') return 'Tác vụ sao lưu gần nhất gặp lỗi';
    if (backup?.status === 'running') return 'Tác vụ sao lưu đang chạy';
    return 'Chưa xác minh được trạng thái sao lưu';
  })();

  return (
    <Space orientation="vertical" size="large" style={{ display: 'flex' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>Trạng thái hệ thống</Title>
          <Text type="secondary">Tình trạng ứng dụng, cơ sở dữ liệu và bản sao lưu gần nhất.</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
          Làm mới
        </Button>
      </div>

      {error && <Alert type="error" showIcon message={error} />}
      {backupIsProblem && backup && (
        <Alert
          type={backup.freshness === 'invalid' || backup.status === 'failed' ? 'error' : 'warning'}
          showIcon
          message={backupWarning}
          description="Hãy kiểm tra tác vụ backup trên máy chủ nếu trạng thái này không mong muốn."
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <ReadinessCard
            title="Ứng dụng"
            status={status?.app?.status}
            labels={{ ready: ['Đang hoạt động', 'success'] }}
            description="API quản trị đang phản hồi."
          />
        </Col>
        <Col xs={24} md={8}>
          <ReadinessCard
            title="Cơ sở dữ liệu"
            status={status?.database?.status}
            labels={{ available: ['Kết nối được', 'success'], unavailable: ['Không kết nối được', 'error'] }}
            description="Kiểm tra kết nối chỉ đọc SELECT 1."
          />
        </Col>
        <Col xs={24} md={8}>
          <ReadinessCard
            title="Sao lưu"
            status={backup?.status}
            labels={backupLabels}
            description={backup?.freshness ? `Thông tin: ${freshnessLabels[backup.freshness]?.[0] || 'Chưa xác định'}` : 'Đang tải trạng thái.'}
          />
        </Col>
      </Row>

      <Card title="Bản sao lưu gần nhất" size="small">
        <Row gutter={[16, 12]}>
          <Col xs={24} sm={12}>
            <Text type="secondary">Cập nhật lúc</Text>
            <div>{formatDate(backup?.updatedAtUtc)}</div>
          </Col>
          <Col xs={24} sm={12}>
            <Text type="secondary">Độ mới</Text>
            <div>{statusTag(backup?.freshness, freshnessLabels)}</div>
          </Col>
          <Col xs={24} sm={12}>
            <Text type="secondary">Bản mã hóa trên máy chủ</Text>
            <div>{statusTag(backup?.localBackupReady ? 'ready' : 'unknown', { ready: ['Có', 'success'], unknown: ['Chưa xác minh', 'default'] })}</div>
          </Col>
          <Col xs={24} sm={12}>
            <Text type="secondary">Bản offsite</Text>
            <div>{statusTag(backup?.offsiteBackupReady ? 'ready' : 'unknown', { ready: ['Đã xác minh', 'success'], unknown: ['Chưa xác minh', 'default'] })}</div>
          </Col>
        </Row>
      </Card>

      <Text type="secondary">
        Theo dõi chi phí AI chưa có nguồn đo lường đáng tin cậy nên chưa được hiển thị.
      </Text>
      {status?.app?.checkedAtUtc && (
        <Text type="secondary">Kiểm tra API lúc {formatDate(status.app.checkedAtUtc)}</Text>
      )}
    </Space>
  );
}
