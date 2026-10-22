import React, { useState, useEffect, useCallback } from 'react';
import { Row, Col, Card, Statistic, Table, Button, message } from 'antd';
import {
  UserOutlined, PoweroffOutlined, AuditOutlined, RobotOutlined, ReloadOutlined
} from '@ant-design/icons';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title as ChartTitle, Tooltip as ChartTooltip, Legend, Filler
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { authFetch, getResponseErrorMessage, safeArr } from '../../utils/api';
import { normalizeQuotaStats } from '../../utils/quotaStats';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, ChartTitle, ChartTooltip, Legend, Filler
);

export default function DashboardView({ isDarkMode }) {
  const [stats, setStats] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [quotaStats, setQuotaStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [resStats, resCharts, resQuotaStats] = await Promise.all([
        authFetch('/admin/stats'),
        authFetch('/admin/analytics'),
        authFetch('/admin/quota-stats'),
      ]);
      if (resStats?.ok) {
        const dataStats = await resStats.json();
        setStats(dataStats);
      } else if (resStats) {
        message.error(await getResponseErrorMessage(resStats, 'Không thể tải thống kê quản trị'));
      }
      if (resCharts?.ok) {
        const dataCharts = await resCharts.json();
        setAnalyticsData(dataCharts);
      } else if (resCharts) {
        message.error(await getResponseErrorMessage(resCharts, 'Không thể tải biểu đồ quản trị'));
      }
      if (resQuotaStats?.ok) {
        const dataQuotaStats = await resQuotaStats.json();
        setQuotaStats(normalizeQuotaStats(dataQuotaStats));
      } else if (resQuotaStats) {
        message.error(await getResponseErrorMessage(resQuotaStats, 'Không thể tải thống kê hạn mức AI'));
      }
    } catch {
      message.error('Không thể tải dữ liệu quản trị. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Chart configs
  const trafficChartData = {
    labels: safeArr(analyticsData?.timeSeries).map((d) => d.date?.slice(5) || ''),
    datasets: [
      {
        label: 'Đăng ký mới',
        data: safeArr(analyticsData?.timeSeries).map((d) => d.registers || 0),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.15)',
        fill: true,
        tension: 0.4,
      },
      {
        label: 'Đăng nhập',
        data: safeArr(analyticsData?.timeSeries).map((d) => d.logins || 0),
        borderColor: '#10b981',
        backgroundColor: 'transparent',
        tension: 0.4,
      },
    ],
  };

  const appShareData = {
    labels: ['IChingNow (Kinh Dịch)', 'TarotNow (Tarot)', 'TuViNow (Tử Vi)'],
    datasets: [
      {
        data: [
          analyticsData?.appDistribution?.iching || 0,
          analyticsData?.appDistribution?.tarot || 0,
          analyticsData?.appDistribution?.tuvi || 0,
        ],
        backgroundColor: ['#6366f1', '#f59e0b', '#ec4899'],
      },
    ],
  };

  const geoData = {
    labels: safeArr(analyticsData?.topLocations).map((g) => g.location || 'Localhost'),
    datasets: [
      {
        label: 'Lượt truy cập',
        data: safeArr(analyticsData?.topLocations).map((g) => g.count || 0),
        backgroundColor: '#3b82f6',
        borderRadius: 6,
      },
    ],
  };

  const aiDailyData = {
    labels: safeArr(analyticsData?.timeSeries).map((a) => a.date?.slice(5) || ''),
    datasets: [
      {
        label: 'Số lượt hỏi AI',
        data: safeArr(analyticsData?.timeSeries).map((a) => a.ai || 0),
        backgroundColor: '#8b5cf6',
        borderRadius: 6,
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

  const planColumns = [
    { title: 'Gói', dataIndex: 'plan', key: 'plan' },
    { title: 'Số người dùng', dataIndex: 'count', key: 'count', align: 'right' },
  ];
  const topUserColumns = [
    {
      title: 'User ID',
      dataIndex: 'userId',
      key: 'userId',
      ellipsis: true,
      render: (userId) => userId || '—',
    },
    { title: 'Lượt AI hôm nay', dataIndex: 'dailyCount', key: 'dailyCount', align: 'right' },
    { title: 'Bonus đã dùng', dataIndex: 'bonusUsedToday', key: 'bonusUsedToday', align: 'right' },
  ];

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="Tổng Người Dùng" value={stats?.totalUsers || 0} prefix={<UserOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="Session Hoạt Động" value={stats?.activeSessions || 0} prefix={<PoweroffOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="Tổng Quẻ / Trải Bài / Lá Số" value={stats?.totalReadings || 0} prefix={<AuditOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="Số Lượt Hỏi AI" value={stats?.totalAiQuestions || 0} prefix={<RobotOutlined />} />
          </Card>
        </Col>
      </Row>

      {/* 3 APP BREAKDOWN CARDS */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ borderLeft: '4px solid #6366f1', background: isDarkMode ? '#131b2e' : '#f8faff' }}>
            <Statistic
              title="🔮 Lượt Kinh Dịch (IChingNow)"
              value={stats?.totalIchingReadings ?? analyticsData?.appDistribution?.iching ?? 0}
              valueStyle={{ color: '#6366f1' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ borderLeft: '4px solid #f59e0b', background: isDarkMode ? '#1f1a14' : '#fffcf5' }}>
            <Statistic
              title="🃏 Lượt Bốc Tarot (TarotNow)"
              value={stats?.totalTarotReadings ?? analyticsData?.appDistribution?.tarot ?? 0}
              valueStyle={{ color: '#f59e0b' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ borderLeft: '4px solid #ec4899', background: isDarkMode ? '#22141f' : '#fdf5f9' }}>
            <Statistic
              title="🌟 Lượt Tử Vi (TuViNow)"
              value={stats?.totalTuviReadings ?? analyticsData?.appDistribution?.tuvi ?? 0}
              valueStyle={{ color: '#ec4899' }}
            />
          </Card>
        </Col>
      </Row>

      {/* CHARTS ROW 1 */}
      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={16}>
          <Card title="📈 Lưu Lượng Đăng Nhập & Traffic (14 Ngày Qua)">
            <div style={{ height: 280 }}>
              <Line data={trafficChartData} options={chartOptions} />
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="🥧 Phân Bổ Sử Dụng App">
            <div style={{ height: 280, display: 'flex', justifyContent: 'center' }}>
              <Doughnut data={appShareData} options={{ responsive: true, maintainAspectRatio: false }} />
            </div>
          </Card>
        </Col>
      </Row>

      {/* CHARTS ROW 2 */}
      <Row gutter={[20, 20]}>
        <Col xs={24} lg={12}>
          <Card title="🌍 Top Vị Trí Địa Lý / Thành Phố">
            <div style={{ height: 260 }}>
              <Bar data={geoData} options={{ ...chartOptions, indexAxis: 'y' }} />
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="🤖 Số Lượt Hỏi AI Theo Ngày">
            <div style={{ height: 260 }}>
              <Bar data={aiDailyData} options={chartOptions} />
            </div>
          </Card>
        </Col>
      </Row>

      <Card
        title="🤖 Thống kê hạn mức AI"
        style={{ marginTop: 24 }}
        extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={loadData}>Làm mới</Button>}
      >
        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          <Col xs={24} sm={12}>
            <Card size="small" loading={loading}>
              <Statistic title="Tổng lượt AI hôm nay" value={quotaStats?.today || 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12}>
            <Card size="small" loading={loading}>
              <Statistic title="Tổng lượt AI tháng này" value={quotaStats?.thisMonth || 0} />
            </Card>
          </Col>
        </Row>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <Card size="small" title="Phân bổ gói" loading={loading}>
              <Table
                columns={planColumns}
                dataSource={quotaStats?.planDistribution || []}
                rowKey="plan"
                pagination={false}
                size="small"
              />
            </Card>
          </Col>
          <Col xs={24} lg={16}>
            <Card size="small" title="Top người dùng AI hôm nay" loading={loading}>
              <Table
                columns={topUserColumns}
                dataSource={quotaStats?.topUsers || []}
                rowKey={(record, index) => record.userId || index}
                pagination={false}
                size="small"
                scroll={{ x: 440 }}
              />
            </Card>
          </Col>
        </Row>
      </Card>
    </div>
  );
}
