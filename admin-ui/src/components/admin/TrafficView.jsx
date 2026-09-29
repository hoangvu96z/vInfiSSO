import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Row, Col, Space, Button, Typography, Tag, Select, Input,
  Progress, Statistic, Popconfirm, message
} from 'antd';
import { ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { Bar, Doughnut } from 'react-chartjs-2';
import ModernDataTable from '../ModernDataTable';
import { authFetch, safeArr } from '../../utils/api';
import { formatTimeWithZone, getTimezoneLabel } from '../../utils/dateUtils';

const { Text } = Typography;
const { Option } = Select;

export default function TrafficView({ isDarkMode, timezone, isMobile }) {
  const [trafficStats, setTrafficStats] = useState(null);
  const [trafficLogs, setTrafficLogs] = useState([]);
  const [trafficTotal, setTrafficTotal] = useState(0);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [trafficDays, setTrafficDays] = useState(30);
  const [trafficApp, setTrafficApp] = useState('all');
  const [trafficSearch, setTrafficSearch] = useState('');
  const [trafficPage, setTrafficPage] = useState(1);

  const [selectedTrafficRows, setSelectedTrafficRows] = useState([]);
  const [clearTrafficSelected, setClearTrafficSelected] = useState(false);

  const loadTraffic = useCallback(async () => {
    setTrafficLoading(true);
    const [resStats, resLogs] = await Promise.all([
      authFetch(`/analytics/admin/stats?days=${trafficDays}&app=${trafficApp}`),
      authFetch(`/analytics/admin/logs?page=${trafficPage}&limit=20&app=${trafficApp}&search=${encodeURIComponent(trafficSearch || '')}`),
    ]);
    if (resStats) {
      const data = await resStats.json();
      setTrafficStats(data);
    }
    if (resLogs) {
      const data = await resLogs.json();
      setTrafficLogs(data.logs || []);
      setTrafficTotal(data.total || 0);
    }
    setTrafficLoading(false);
  }, [trafficDays, trafficApp, trafficPage, trafficSearch]);

  useEffect(() => {
    loadTraffic();
  }, [loadTraffic]);

  const handleBatchDeleteTrafficLogs = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return;
    const res = await authFetch('/analytics/admin/logs/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res && res.ok) {
      message.info(`Đã xóa ${ids.length} bản ghi truy cập! 🗑️`);
      setClearTrafficSelected((prev) => !prev);
      setSelectedTrafficRows([]);
      loadTraffic();
    } else {
      message.error('Lỗi khi xóa bản ghi truy cập');
    }
  }, [loadTraffic]);

  // Charts data
  const trafficDailyData = {
    labels: safeArr(trafficStats?.daily).map((d) => d.date?.slice(5) || ''),
    datasets: [
      {
        label: 'Tổng lượt truy cập',
        data: safeArr(trafficStats?.daily).map((d) => d.visits || 0),
        backgroundColor: '#38bdf8',
        borderColor: '#0284c7',
        borderRadius: 4,
      },
      {
        label: 'Khách duy nhất (IP)',
        data: safeArr(trafficStats?.daily).map((d) => d.uniqueVisitors || 0),
        backgroundColor: '#10b981',
        borderColor: '#059669',
        borderRadius: 4,
      },
    ],
  };

  const trafficDeviceData = {
    labels: safeArr(trafficStats?.devices).map((d) => d.name),
    datasets: [
      {
        data: safeArr(trafficStats?.devices).map((d) => d.count),
        backgroundColor: ['#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#fb923c', '#fbbf24', '#34d399', '#94a3b8'],
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: isDarkMode ? '#94a3b8' : '#475569' } } },
    scales: {
      x: { ticks: { color: isDarkMode ? '#94a3b8' : '#475569' }, grid: { color: isDarkMode ? '#1e293b' : '#e2e8f0' } },
      y: {
        beginAtZero: true,
        ticks: { color: isDarkMode ? '#94a3b8' : '#475569', precision: 0 },
        grid: { color: isDarkMode ? '#1e293b' : '#e2e8f0' },
      },
    },
  };

  // Table Columns
  const trafficColumns = useMemo(() => [
    {
      name: 'Thời gian',
      selector: (r) => new Date(r.createdAt).getTime(),
      sortable: true,
      width: '150px',
      cell: (r) => formatTimeWithZone(r.createdAt, timezone, 'full'),
    },
    {
      name: 'App',
      selector: (r) => (r.app || '').toLowerCase(),
      sortable: true,
      width: '130px',
      cell: (r) => {
        const appStr = (r.app || '').toLowerCase();
        if (appStr === 'talkwithme') return <Tag color="cyan">💬 TalkWithMe</Tag>;
        if (appStr === 'tuvi') return <Tag color="purple">🔮 TuViNow</Tag>;
        if (appStr === 'iching') return <Tag color="gold">☯️ IChing</Tag>;
        if (appStr === 'tarot') return <Tag color="magenta">🃏 Tarot</Tag>;
        return <Tag>{r.app}</Tag>;
      },
    },
    {
      name: 'Địa chỉ IP',
      selector: (r) => r.ipAddress || '',
      sortable: true,
      width: '140px',
      cell: (r) => <Tag style={{ fontFamily: 'monospace' }}>{r.ipAddress || '127.0.0.1'}</Tag>,
    },
    {
      name: 'Vị trí & Nhà mạng',
      selector: (r) => `${r.location || ''} ${r.isp || ''}`.toLowerCase(),
      sortable: true,
      minWidth: '180px',
      cell: (r) => (
        <div style={{ padding: '6px 0' }}>
          <div style={{ fontWeight: 500 }}>
            {r.location ? `📍 ${r.location}` : <span style={{ opacity: 0.6 }}>Chưa xác định</span>}
          </div>
          {r.isp && <div style={{ fontSize: '0.78rem', opacity: 0.65 }}>🏢 {r.isp}</div>}
        </div>
      ),
    },
    {
      name: 'Thiết bị & Màn hình',
      selector: (r) => `${r.device || ''} ${r.screen || ''}`.toLowerCase(),
      sortable: true,
      minWidth: '160px',
      cell: (r) => (
        <div style={{ padding: '6px 0' }}>
          <div style={{ fontWeight: 500 }}>📱 {r.device || 'Desktop'}</div>
          {r.screen && <div style={{ fontSize: '0.78rem', opacity: 0.65 }}>🖥️ {r.screen}</div>}
        </div>
      ),
    },
    {
      name: 'Trình duyệt & OS',
      selector: (r) => `${r.browser || ''} ${r.os || ''}`.toLowerCase(),
      sortable: true,
      minWidth: '160px',
      cell: (r) => (
        <div>
          <Tag color="geekblue">{r.browser || 'Browser'}</Tag>
          <span style={{ fontSize: '0.8rem', opacity: 0.75, marginLeft: 4 }}>{r.os || ''}</span>
        </div>
      ),
    },
    {
      name: 'Đường dẫn & Nguồn',
      selector: (r) => r.path || '',
      sortable: true,
      minWidth: '180px',
      cell: (r) => (
        <div style={{ fontSize: '0.82rem', padding: '6px 0' }}>
          <div><code>{r.path || '/'}</code></div>
          {r.referrer && (
            <div style={{ opacity: 0.65, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
              Từ: {r.referrer}
            </div>
          )}
        </div>
      ),
    },
    {
      name: 'Thao tác',
      width: '80px',
      cell: (r) => (
        <Popconfirm
          title="Xóa bản ghi này?"
          onConfirm={() => handleBatchDeleteTrafficLogs([r.id])}
          okText="Xóa"
          cancelText="Hủy"
        >
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ], [timezone, handleBatchDeleteTrafficLogs]);

  const trafficContextActions = useMemo(() => {
    const ids = selectedTrafficRows.map((r) => r.id);
    const count = ids.length;
    return (
      <Popconfirm
        title={`Xóa vĩnh viễn ${count} bản ghi truy cập đã chọn?`}
        onConfirm={() => handleBatchDeleteTrafficLogs(ids)}
        okText="Xóa"
        cancelText="Hủy"
      >
        <Button danger icon={<DeleteOutlined />} size="small">
          Xóa {count} đã chọn
        </Button>
      </Popconfirm>
    );
  }, [selectedTrafficRows, handleBatchDeleteTrafficLogs]);

  const renderTrafficMobileCard = useCallback((r) => {
    const appStr = (r.app || '').toLowerCase();
    let appBadge = <Tag>{r.app || 'Web'}</Tag>;
    if (appStr === 'talkwithme') appBadge = <Tag color="cyan">💬 TalkWithMe</Tag>;
    else if (appStr === 'tuvi') appBadge = <Tag color="purple">🔮 TuViNow</Tag>;
    else if (appStr === 'iching') appBadge = <Tag color="gold">☯️ IChing</Tag>;
    else if (appStr === 'tarot') appBadge = <Tag color="magenta">🃏 Tarot</Tag>;

    const formattedDate = formatTimeWithZone(r.createdAt, timezone, 'full');

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {appBadge}
            <span style={{ fontSize: '0.8rem', opacity: 0.75, fontFamily: 'monospace' }}>
              🕒 {formattedDate}
            </span>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <Popconfirm
              title="Xóa bản ghi này?"
              onConfirm={() => handleBatchDeleteTrafficLogs([r.id])}
              okText="Xóa"
              cancelText="Hủy"
            >
              <Button size="small" danger icon={<DeleteOutlined />} type="text" />
            </Popconfirm>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '6px 8px',
            borderRadius: 6,
            background: isDarkMode ? 'rgba(0, 0, 0, 0.25)' : '#f1f5f9',
            fontSize: '0.82rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>IP:</span>
              <Tag style={{ fontFamily: 'monospace', margin: 0, fontWeight: 600 }}>{r.ipAddress || '127.0.0.1'}</Tag>
            </div>
            {r.isp && (
              <span style={{ fontSize: '0.75rem', opacity: 0.75, color: '#38bdf8' }}>
                🏢 {r.isp}
              </span>
            )}
          </div>
          <div style={{ fontWeight: 500, marginTop: 2 }}>
            {r.location ? `📍 ${r.location}` : <span style={{ opacity: 0.5 }}>📍 Chưa xác định</span>}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, fontSize: '0.8rem' }}>
          <div>
            <span style={{ fontWeight: 500 }}>📱 {r.device || 'Desktop'}</span>
            {r.screen && <span style={{ opacity: 0.65, fontSize: '0.75rem', marginLeft: 4 }}>({r.screen})</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tag color="geekblue" style={{ margin: 0, fontSize: '0.75rem' }}>{r.browser || 'Browser'}</Tag>
            {r.os && <span style={{ fontSize: '0.75rem', opacity: 0.75 }}>{r.os}</span>}
          </div>
        </div>

        <div style={{ fontSize: '0.76rem', opacity: 0.85, wordBreak: 'break-all' }}>
          <div>
            <span style={{ opacity: 0.6, marginRight: 4 }}>🔗</span>
            <code>{r.path || '/'}</code>
          </div>
          {r.referrer && (
            <div style={{ opacity: 0.65, fontSize: '0.72rem', marginTop: 2 }}>
              ↩️ Từ: {r.referrer}
            </div>
          )}
        </div>
      </div>
    );
  }, [isDarkMode, timezone, handleBatchDeleteTrafficLogs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* FILTER CONTROLS BAR */}
      <Card styles={{ body: { padding: '16px 20px' } }}>
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Space wrap align="center">
              <Text strong style={{ marginRight: 4 }}>Ứng dụng:</Text>
              <Select
                value={trafficApp}
                onChange={(v) => { setTrafficApp(v); setTrafficPage(1); }}
                style={{ width: 180 }}
              >
                <Option value="all">🌐 Tất cả ứng dụng</Option>
                <Option value="talkwithme">💬 TalkWithMe</Option>
                <Option value="tuvi">🔮 TuViNow</Option>
                <Option value="iching">☯️ IChingNow</Option>
                <Option value="tarot">🃏 TarotNow</Option>
              </Select>

              <Text strong style={{ marginLeft: 12, marginRight: 4 }}>Thời gian:</Text>
              <Select
                value={trafficDays}
                onChange={(v) => { setTrafficDays(v); setTrafficPage(1); }}
                style={{ width: 130 }}
              >
                <Option value={7}>7 ngày qua</Option>
                <Option value={14}>14 ngày qua</Option>
                <Option value={30}>30 ngày qua</Option>
              </Select>
            </Space>
          </Col>
          <Col xs={24} lg={10} style={{ textAlign: isMobile ? 'left' : 'right' }}>
            <Button
              icon={<ReloadOutlined />}
              onClick={loadTraffic}
              loading={trafficLoading}
            >
              Làm mới dữ liệu
            </Button>
          </Col>
        </Row>
      </Card>

      {/* 4 SUMMARY STAT CARDS */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ height: '100%' }}>
            <Statistic
              title="👥 Lượt truy cập hôm nay"
              value={trafficStats?.summary?.todayVisits || 0}
              valueStyle={{ color: '#38bdf8', fontWeight: 700 }}
              suffix={
                <span style={{ fontSize: '0.85rem', fontWeight: 400, opacity: 0.75, marginLeft: 6 }}>
                  ({trafficStats?.summary?.todayUniqueVisitors || 0} khách IP)
                </span>
              }
            />
            <div style={{ marginTop: 8, fontSize: '0.8125rem', opacity: 0.7 }}>
              Hôm qua: {trafficStats?.summary?.yesterdayVisits || 0} lượt ({trafficStats?.summary?.yesterdayUniqueVisitors || 0} khách)
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ height: '100%' }}>
            <Statistic
              title={`📈 Tổng ${trafficDays} ngày qua`}
              value={trafficStats?.summary?.totalVisits || 0}
              valueStyle={{ color: '#10b981', fontWeight: 700 }}
              suffix={
                <span style={{ fontSize: '0.85rem', fontWeight: 400, opacity: 0.75, marginLeft: 6 }}>
                  ({trafficStats?.summary?.totalUniqueVisitors || 0} khách IP)
                </span>
              }
            />
            <div style={{ marginTop: 8, fontSize: '0.8125rem', opacity: 0.7 }}>
              Trung bình: {trafficDays > 0 ? Math.round((trafficStats?.summary?.totalVisits || 0) / trafficDays) : 0} lượt/ngày
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ height: '100%' }}>
            <Statistic
              title="📱 Thiết bị phổ biến nhất"
              value={trafficStats?.devices?.[0]?.name || 'Chưa có'}
              valueStyle={{ fontSize: '1.25rem', fontWeight: 600, color: '#f59e0b' }}
            />
            <div style={{ marginTop: 8, fontSize: '0.8125rem', opacity: 0.7 }}>
              {trafficStats?.devices?.[0] ? `${trafficStats.devices[0].count} lượt (${trafficStats.devices[0].percentage}%)` : 'Đang cập nhật'}
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ height: '100%' }}>
            <Statistic
              title="📍 Khu vực nhiều nhất"
              value={trafficStats?.locations?.[0]?.name || 'Chưa có'}
              valueStyle={{ fontSize: '1.25rem', fontWeight: 600, color: '#ec4899' }}
            />
            <div style={{ marginTop: 8, fontSize: '0.8125rem', opacity: 0.7 }}>
              {trafficStats?.locations?.[0] ? `${trafficStats.locations[0].count} lượt (${trafficStats.locations[0].percentage}%)` : 'Đang cập nhật'}
            </div>
          </Card>
        </Col>
      </Row>

      {/* CHARTS ROW */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title="📊 Lượt truy cập theo từng ngày" style={{ height: '100%' }}>
            <div style={{ height: 290 }}>
              {trafficStats?.daily?.length > 0 ? (
                <Bar
                  data={trafficDailyData}
                  options={{
                    ...chartOptions,
                    plugins: {
                      legend: { position: 'top', labels: { color: isDarkMode ? '#94a3b8' : '#475569' } },
                    },
                  }}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
                  Chưa có dữ liệu truy cập trong khoảng thời gian này
                </div>
              )}
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="📱 Cơ cấu Thiết bị" style={{ height: '100%' }}>
            <div style={{ height: 290, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {trafficStats?.devices?.length > 0 ? (
                <Doughnut
                  data={trafficDeviceData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom', labels: { color: isDarkMode ? '#94a3b8' : '#475569', boxWidth: 12 } } },
                  }}
                />
              ) : (
                <span style={{ opacity: 0.5 }}>Chưa có dữ liệu</span>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* BREAKDOWN LISTS: BROWSERS, LOCATIONS, REFERRERS */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card title="🌐 Top Trình Duyệt">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {safeArr(trafficStats?.browsers).length > 0 ? (
                trafficStats.browsers.map((b) => (
                  <div key={b.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
                      <Text strong>{b.name}</Text>
                      <Text type="secondary">{b.count} ({b.percentage}%)</Text>
                    </div>
                    <Progress percent={b.percentage} showInfo={false} strokeColor="#38bdf8" size="small" />
                  </div>
                ))
              ) : (
                <Text type="secondary">Chưa có dữ liệu</Text>
              )}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="📍 Top Địa Điểm (Tỉnh / Thành)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {safeArr(trafficStats?.locations).length > 0 ? (
                trafficStats.locations.map((loc) => (
                  <div key={loc.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
                      <Text strong>{loc.name}</Text>
                      <Text type="secondary">{loc.count} ({loc.percentage}%)</Text>
                    </div>
                    <Progress percent={loc.percentage} showInfo={false} strokeColor="#ec4899" size="small" />
                  </div>
                ))
              ) : (
                <Text type="secondary">Chưa có dữ liệu</Text>
              )}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="🔗 Nguồn Đến (Referrer)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {safeArr(trafficStats?.referrers).length > 0 ? (
                trafficStats.referrers.map((r) => (
                  <div key={r.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
                      <Text strong>{r.name}</Text>
                      <Text type="secondary">{r.count} ({r.percentage}%)</Text>
                    </div>
                    <Progress percent={r.percentage} showInfo={false} strokeColor="#10b981" size="small" />
                  </div>
                ))
              ) : (
                <Text type="secondary">Chưa có dữ liệu</Text>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* DETAILED LOGS TABLE */}
      <Card
        title={
          <Space align="center" wrap>
            <span>📋 Chi Tiết Lượt Truy Cập</span>
            <Tag color="cyan">Tổng {trafficTotal} lượt</Tag>
            <Tag color="geekblue" style={{ fontSize: '0.75rem' }}>
              🌐 {getTimezoneLabel(timezone)}
            </Tag>
          </Space>
        }
        extra={
          <Space wrap style={{ marginTop: isMobile ? 8 : 0 }}>
            <Input.Search
              placeholder="Tìm IP, vị trí..."
              allowClear
              onSearch={(val) => { setTrafficSearch(val); setTrafficPage(1); }}
              style={{ width: isMobile ? 180 : 280 }}
            />
            <Button icon={<ReloadOutlined />} onClick={loadTraffic} title="Làm mới">
              {!isMobile && 'Làm mới'}
            </Button>
          </Space>
        }
      >
        <ModernDataTable
          columns={trafficColumns}
          data={trafficLogs}
          loading={trafficLoading}
          isDarkMode={isDarkMode}
          keyField="id"
          selectableRows
          onSelectedRowsChange={({ selectedRows }) => setSelectedTrafficRows(selectedRows)}
          clearSelectedRows={clearTrafficSelected}
          contextActions={trafficContextActions}
          paginationServer
          paginationTotalRows={trafficTotal}
          paginationPerPage={20}
          paginationRowsPerPageOptions={[20]}
          onChangePage={(page) => setTrafficPage(page)}
          renderMobileCard={renderTrafficMobileCard}
        />
      </Card>
    </div>
  );
}
