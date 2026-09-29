import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Space, Tag, Input, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import ModernDataTable from '../ModernDataTable';
import { authFetch } from '../../utils/api';
import { formatTimeWithZone } from '../../utils/dateUtils';

export default function AuditLogsView({ isDarkMode, timezone }) {
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    const query = new URLSearchParams();
    if (auditSearch) query.set('search', auditSearch);
    const res = await authFetch(`/admin/audit-logs?${query.toString()}`);
    if (res) {
      const data = await res.json();
      setAuditLogs(data.logs || data.data || []);
    }
    setAuditLoading(false);
  }, [auditSearch]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const auditColumns = useMemo(() => [
    {
      name: 'Thời Gian',
      selector: (r) => new Date(r.createdAt).getTime(),
      sortable: true,
      minWidth: '160px',
      cell: (r) => formatTimeWithZone(r.createdAt, timezone),
    },
    {
      name: 'Hành Động',
      selector: (r) => r.action || '',
      sortable: true,
      minWidth: '140px',
      cell: (r) => <Tag color="indigo">{r.action}</Tag>,
    },
    {
      name: 'Email',
      selector: (r) => (r.user?.email || r.userEmail || 'Khách').toLowerCase(),
      sortable: true,
      minWidth: '180px',
      cell: (r) => r.user?.email || r.userEmail || 'Khách',
    },
    {
      name: 'Địa Chỉ IP',
      selector: (r) => r.ipAddress || '',
      sortable: true,
      width: '140px',
      cell: (r) => <Tag style={{ fontFamily: 'monospace' }}>{r.ipAddress || '127.0.0.1'}</Tag>,
    },
    {
      name: 'Vị Trí Geo',
      selector: (r) => (r.metadata?.city || r.location || 'Hồ Chí Minh, VN').toLowerCase(),
      sortable: true,
      minWidth: '160px',
      cell: (r) => r.metadata?.city || r.location || 'Hồ Chí Minh, VN',
    },
    {
      name: 'Ứng Dụng',
      selector: (r) => r.app || '',
      sortable: true,
      width: '120px',
      cell: (r) => r.app || '-',
    },
  ], [timezone]);

  return (
    <Card
      title={
        <Space align="center">
          <span>📋 Nhật Ký Traffic & IP</span>
          <Tag color="cyan">{auditLogs.length} sự kiện</Tag>
        </Space>
      }
      extra={
        <Space wrap>
          <Input.Search
            placeholder="Tìm IP, Email, hành động..."
            allowClear
            onSearch={setAuditSearch}
            onChange={(e) => setAuditSearch(e.target.value)}
            style={{ width: 260 }}
          />
          <Button icon={<ReloadOutlined />} onClick={loadAudit}>Làm mới</Button>
        </Space>
      }
    >
      <ModernDataTable
        columns={auditColumns}
        data={auditLogs}
        loading={auditLoading}
        isDarkMode={isDarkMode}
        keyField="id"
        paginationPerPage={15}
      />
    </Card>
  );
}
