import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Space, Tag, Input, Button, DatePicker, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import ModernDataTable from '../ModernDataTable';
import { authFetch, getResponseErrorMessage } from '../../utils/api';
import { formatTimeWithZone } from '../../utils/dateUtils';
import { downloadCsv } from '../../utils/csv';

const { RangePicker } = DatePicker;
const AUDIT_PAGE_SIZE = 30;

export default function AuditLogsView({ isDarkMode, timezone }) {
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditDateRange, setAuditDateRange] = useState(null);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('page', String(auditPage));
      query.set('limit', String(AUDIT_PAGE_SIZE));
      if (auditSearch) query.set('search', auditSearch);
      if (auditDateRange?.[0]) query.set('dateFrom', auditDateRange[0].startOf('day').toISOString());
      if (auditDateRange?.[1]) query.set('dateTo', auditDateRange[1].add(1, 'day').startOf('day').toISOString());
      const res = await authFetch(`/admin/audit-logs?${query.toString()}`);
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể tải nhật ký quản trị'));
        return;
      }
      const data = await res.json();
      setAuditLogs(data.logs || data.data || []);
      setAuditTotal(data.total || 0);
    } catch {
      message.error('Không thể tải nhật ký quản trị. Vui lòng thử lại.');
    } finally {
      setAuditLoading(false);
    }
  }, [auditSearch, auditPage, auditDateRange]);

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
          <Tag color="cyan">{auditTotal} sự kiện</Tag>
        </Space>
      }
      extra={
        <Space wrap>
          <Input.Search
            placeholder="Tìm IP, Email, hành động..."
            allowClear
            onSearch={(value) => { setAuditPage(1); setAuditSearch(value); }}
            onChange={(e) => { setAuditPage(1); setAuditSearch(e.target.value); }}
            style={{ width: 260 }}
          />
          <RangePicker
            allowClear
            value={auditDateRange}
            onChange={(value) => { setAuditPage(1); setAuditDateRange(value); }}
            placeholder={['Từ ngày', 'Đến ngày']}
          />
          <Button
            disabled={!auditLogs.length}
            onClick={() => downloadCsv(auditLogs, [
              { label: 'Thời gian', value: (log) => log.createdAt },
              { label: 'Hành động', value: (log) => log.action },
              { label: 'Email', value: (log) => log.user?.email || log.userEmail },
              { label: 'IP', value: (log) => log.ipAddress },
              { label: 'Ứng dụng', value: (log) => log.app },
            ], `audit-logs-page-${auditPage}`)}
          >Xuất CSV trang này</Button>
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
        paginationPerPage={AUDIT_PAGE_SIZE}
        paginationServer
        paginationTotalRows={auditTotal}
        paginationPage={auditPage}
        onChangePage={setAuditPage}
      />
    </Card>
  );
}
