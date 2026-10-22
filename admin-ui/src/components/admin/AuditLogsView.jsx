import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, Space, Tag, Input, Button, DatePicker, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import ModernDataTable from '../ModernDataTable';
import { authFetch, getResponseErrorMessage } from '../../utils/api';
import { formatTimeWithZone } from '../../utils/dateUtils';
import { collectPaginatedRows, downloadCsv } from '../../utils/csv';
import { createLatestRequestGate } from '../../utils/requestGate';

const { RangePicker } = DatePicker;
const AUDIT_PAGE_SIZE = 30;

export default function AuditLogsView({ isDarkMode, timezone }) {
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditDateRange, setAuditDateRange] = useState(null);
  const [exportingAudit, setExportingAudit] = useState(false);
  const auditRequestGate = useRef(null);
  if (!auditRequestGate.current) auditRequestGate.current = createLatestRequestGate();
  const auditMounted = useRef(false);

  const loadAudit = useCallback(async () => {
    if (!auditMounted.current) return;
    const requestGate = auditRequestGate.current;
    const requestId = requestGate.begin();
    setAuditLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('page', String(auditPage));
      query.set('limit', String(AUDIT_PAGE_SIZE));
      if (auditSearch) query.set('search', auditSearch);
      if (auditDateRange?.[0]) query.set('dateFrom', auditDateRange[0].startOf('day').toISOString());
      if (auditDateRange?.[1]) query.set('dateTo', auditDateRange[1].add(1, 'day').startOf('day').toISOString());
      const res = await authFetch(`/admin/audit-logs?${query.toString()}`);
      if (!requestGate.isCurrent(requestId)) return;
      if (!res) return;
      if (!res.ok) {
        const errorMessage = await getResponseErrorMessage(res, 'Không thể tải nhật ký quản trị');
        if (requestGate.isCurrent(requestId)) message.error(errorMessage);
        return;
      }
      const data = await res.json();
      if (!requestGate.isCurrent(requestId)) return;
      setAuditLogs(data.logs || data.data || []);
      setAuditTotal(data.total || 0);
    } catch {
      if (requestGate.isCurrent(requestId)) message.error('Không thể tải nhật ký quản trị. Vui lòng thử lại.');
    } finally {
      if (requestGate.isCurrent(requestId)) setAuditLoading(false);
    }
  }, [auditSearch, auditPage, auditDateRange]);

  useEffect(() => {
    auditMounted.current = true;
    loadAudit();
    return () => {
      auditMounted.current = false;
      auditRequestGate.current?.invalidate();
    };
  }, [loadAudit]);

  const exportAudit = async () => {
    setExportingAudit(true);
    try {
      const rows = await collectPaginatedRows(async (page, limit) => {
        const query = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (auditSearch) query.set('search', auditSearch);
        if (auditDateRange?.[0]) query.set('dateFrom', auditDateRange[0].startOf('day').toISOString());
        if (auditDateRange?.[1]) query.set('dateTo', auditDateRange[1].add(1, 'day').startOf('day').toISOString());
        const res = await authFetch(`/admin/audit-logs?${query.toString()}`);
        if (!res) throw new Error('Phiên đăng nhập đã hết hạn.');
        if (!res.ok) throw new Error(await getResponseErrorMessage(res, 'Không thể xuất nhật ký quản trị'));
        const data = await res.json();
        return { rows: data.logs || [], total: Number(data.total) || 0 };
      }, 100);
      if (!downloadCsv(rows, [
        { label: 'Thời gian', value: (log) => log.createdAt },
        { label: 'Hành động', value: (log) => log.action },
        { label: 'Email', value: (log) => log.user?.email || log.userEmail },
        { label: 'IP', value: (log) => log.ipAddress },
        { label: 'Ứng dụng', value: (log) => log.app },
      ], 'audit-logs-filtered')) message.info('Không có nhật ký phù hợp bộ lọc.');
    } catch (error) {
      message.error(error.message || 'Không thể xuất nhật ký quản trị.');
    } finally {
      setExportingAudit(false);
    }
  };

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
            disabled={!auditTotal}
            loading={exportingAudit}
            onClick={exportAudit}
          >Xuất CSV kết quả lọc</Button>
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
