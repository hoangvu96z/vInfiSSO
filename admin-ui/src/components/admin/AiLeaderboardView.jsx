import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, Space, Tag, Input, Button, DatePicker, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import ModernDataTable from '../ModernDataTable';
import { authFetch, getResponseErrorMessage } from '../../utils/api';
import { collectPaginatedRows, downloadCsv } from '../../utils/csv';
import { createLatestRequestGate } from '../../utils/requestGate';

const { RangePicker } = DatePicker;
const AI_PAGE_SIZE = 20;

export default function AiLeaderboardView({ isDarkMode }) {
  const [aiUsage, setAiUsage] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSearch, setAiSearch] = useState('');
  const [aiDateRange, setAiDateRange] = useState(null);
  const [aiPage, setAiPage] = useState(1);
  const [aiTotal, setAiTotal] = useState(0);
  const [exportingAi, setExportingAi] = useState(false);
  const aiRequestGate = useRef(null);
  if (!aiRequestGate.current) aiRequestGate.current = createLatestRequestGate();

  const loadAiUsage = useCallback(async () => {
    const requestGate = aiRequestGate.current;
    const requestId = requestGate.begin();
    setAiLoading(true);
    try {
      const query = new URLSearchParams({ page: String(aiPage), limit: String(AI_PAGE_SIZE) });
      if (aiSearch) query.set('search', aiSearch);
      if (aiDateRange?.[0]) query.set('dateFrom', aiDateRange[0].startOf('day').toISOString());
      if (aiDateRange?.[1]) query.set('dateTo', aiDateRange[1].add(1, 'day').startOf('day').toISOString());
      const res = await authFetch(`/admin/ai-usage/page?${query.toString()}`);
      if (!requestGate.isCurrent(requestId)) return;
      if (!res) return;
      if (!res.ok) {
        const errorMessage = await getResponseErrorMessage(res, 'Không thể tải thống kê sử dụng AI');
        if (requestGate.isCurrent(requestId)) message.error(errorMessage);
        return;
      }
      const data = await res.json();
      if (!requestGate.isCurrent(requestId)) return;
      setAiUsage(data.userAiStats || data.data || []);
      setAiTotal(Number(data.total) || 0);
    } catch {
      if (requestGate.isCurrent(requestId)) message.error('Không thể tải thống kê sử dụng AI. Vui lòng thử lại.');
    } finally {
      if (requestGate.isCurrent(requestId)) setAiLoading(false);
    }
  }, [aiPage, aiSearch, aiDateRange]);

  useEffect(() => {
    loadAiUsage();
    return () => aiRequestGate.current?.invalidate();
  }, [loadAiUsage]);

  const exportAiUsage = async () => {
    setExportingAi(true);
    try {
      const rows = await collectPaginatedRows(async (page, limit) => {
        const query = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (aiSearch) query.set('search', aiSearch);
        if (aiDateRange?.[0]) query.set('dateFrom', aiDateRange[0].startOf('day').toISOString());
        if (aiDateRange?.[1]) query.set('dateTo', aiDateRange[1].add(1, 'day').startOf('day').toISOString());
        const res = await authFetch(`/admin/ai-usage/page?${query.toString()}`);
        if (!res) throw new Error('Phiên đăng nhập đã hết hạn.');
        if (!res.ok) throw new Error(await getResponseErrorMessage(res, 'Không thể xuất thống kê AI'));
        const data = await res.json();
        return { rows: data.userAiStats || [], total: Number(data.total) || 0 };
      }, AI_PAGE_SIZE);
      if (!downloadCsv(rows, [
        { label: 'Email', value: (row) => row.email },
        { label: 'Họ tên', value: (row) => row.displayName },
        { label: 'Lượt Kinh Dịch', value: (row) => row.ichingReadings },
        { label: 'Lượt Tarot', value: (row) => row.tarotReadings },
        { label: 'Lượt Tử Vi', value: (row) => row.tuviReadings },
        { label: 'Tổng hỏi AI', value: (row) => row.totalAiQuestions },
        { label: 'Hoạt động gần nhất', value: (row) => row.lastActive },
      ], 'ai-usage-filtered')) message.info('Không có dữ liệu phù hợp bộ lọc.');
    } catch (error) {
      message.error(error.message || 'Không thể xuất thống kê AI.');
    } finally {
      setExportingAi(false);
    }
  };

  const aiColumns = useMemo(() => [
    {
      name: 'Email',
      selector: (r) => (r.email || '').toLowerCase(),
      minWidth: '180px',
      cell: (r) => <strong>{r.email}</strong>,
    },
    {
      name: 'Họ Tên',
      selector: (r) => (r.displayName || '').toLowerCase(),
      minWidth: '150px',
      cell: (r) => r.displayName || '-',
    },
    {
      name: 'Lượt Kinh Dịch',
      selector: (r) => Number(r.ichingReadings) || 0,
      width: '150px',
      cell: (r) => <span>{r.ichingReadings || 0}</span>,
    },
    {
      name: 'Lượt Tarot',
      selector: (r) => Number(r.tarotReadings) || 0,
      width: '130px',
      cell: (r) => <span>{r.tarotReadings || 0}</span>,
    },
    {
      name: 'Lượt Tử Vi',
      selector: (r) => Number(r.tuviReadings) || 0,
      width: '130px',
      cell: (r) => <Tag color="magenta">{r.tuviReadings || 0}</Tag>,
    },
    {
      name: 'Tổng Hỏi AI',
      selector: (r) => Number(r.totalAiQuestions) || 0,
      width: '140px',
      cell: (r) => <Tag color="purple" style={{ fontWeight: 700 }}>{r.totalAiQuestions || 0}</Tag>,
    },
  ], []);

  return (
    <Card
      title={
        <Space align="center">
          <span>🤖 Leaderboard AI Usage</span>
          <Tag color="purple">{aiTotal} thành viên</Tag>
        </Space>
      }
      extra={
        <Space wrap>
          <Input.Search
            placeholder="Tìm email, họ tên..."
            allowClear
            onChange={(e) => { setAiPage(1); setAiSearch(e.target.value); }}
            style={{ width: 220 }}
          />
          <RangePicker
            allowClear
            value={aiDateRange}
            onChange={(value) => { setAiPage(1); setAiDateRange(value); }}
            placeholder={['Hoạt động từ', 'Đến ngày']}
          />
          <Button disabled={!aiTotal} loading={exportingAi} onClick={exportAiUsage}>Xuất CSV kết quả lọc</Button>
          <Button icon={<ReloadOutlined />} onClick={loadAiUsage}>Làm mới</Button>
        </Space>
      }
    >
      <ModernDataTable
        columns={aiColumns}
        data={aiUsage}
        loading={aiLoading}
        isDarkMode={isDarkMode}
        keyField="userId"
        paginationPerPage={AI_PAGE_SIZE}
        paginationServer
        paginationTotalRows={aiTotal}
        paginationPage={aiPage}
        onChangePage={setAiPage}
      />
    </Card>
  );
}
