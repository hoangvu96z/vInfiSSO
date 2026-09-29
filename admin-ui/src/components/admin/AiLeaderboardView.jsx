import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Space, Tag, Input, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import ModernDataTable from '../ModernDataTable';
import { authFetch, safeArr } from '../../utils/api';

export default function AiLeaderboardView({ isDarkMode }) {
  const [aiUsage, setAiUsage] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSearch, setAiSearch] = useState('');

  const loadAiUsage = useCallback(async () => {
    setAiLoading(true);
    const res = await authFetch('/admin/ai-usage');
    if (res) {
      const data = await res.json();
      setAiUsage(data.userAiStats || data.data || []);
    }
    setAiLoading(false);
  }, []);

  useEffect(() => {
    loadAiUsage();
  }, [loadAiUsage]);

  const filteredAiUsage = useMemo(() => {
    if (!aiSearch) return safeArr(aiUsage);
    const q = aiSearch.toLowerCase();
    return safeArr(aiUsage).filter((u) =>
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.displayName && u.displayName.toLowerCase().includes(q))
    );
  }, [aiUsage, aiSearch]);

  const aiColumns = useMemo(() => [
    {
      name: 'Email',
      selector: (r) => (r.email || '').toLowerCase(),
      sortable: true,
      minWidth: '180px',
      cell: (r) => <strong>{r.email}</strong>,
    },
    {
      name: 'Họ Tên',
      selector: (r) => (r.displayName || '').toLowerCase(),
      sortable: true,
      minWidth: '150px',
      cell: (r) => r.displayName || '-',
    },
    {
      name: 'Lượt Kinh Dịch',
      selector: (r) => Number(r.ichingReadings) || 0,
      sortable: true,
      width: '150px',
      cell: (r) => <span>{r.ichingReadings || 0}</span>,
    },
    {
      name: 'Lượt Tarot',
      selector: (r) => Number(r.tarotReadings) || 0,
      sortable: true,
      width: '130px',
      cell: (r) => <span>{r.tarotReadings || 0}</span>,
    },
    {
      name: 'Lượt Tử Vi',
      selector: (r) => Number(r.tuviReadings) || 0,
      sortable: true,
      width: '130px',
      cell: (r) => <Tag color="magenta">{r.tuviReadings || 0}</Tag>,
    },
    {
      name: 'Tổng Hỏi AI',
      selector: (r) => Number(r.totalAiQuestions) || 0,
      sortable: true,
      width: '140px',
      cell: (r) => <Tag color="purple" style={{ fontWeight: 700 }}>{r.totalAiQuestions || 0}</Tag>,
    },
  ], []);

  return (
    <Card
      title={
        <Space align="center">
          <span>🤖 Leaderboard AI Usage</span>
          <Tag color="purple">{filteredAiUsage.length} thành viên</Tag>
        </Space>
      }
      extra={
        <Space wrap>
          <Input.Search
            placeholder="Tìm email, họ tên..."
            allowClear
            onChange={(e) => setAiSearch(e.target.value)}
            style={{ width: 220 }}
          />
          <Button icon={<ReloadOutlined />} onClick={loadAiUsage}>Làm mới</Button>
        </Space>
      }
    >
      <ModernDataTable
        columns={aiColumns}
        data={filteredAiUsage}
        loading={aiLoading}
        isDarkMode={isDarkMode}
        keyField="userId"
        paginationPerPage={15}
      />
    </Card>
  );
}
