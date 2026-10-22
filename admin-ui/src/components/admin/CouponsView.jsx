import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card, Space, Tag, Input, Button, Switch, DatePicker, message
} from 'antd';
import {
  ReloadOutlined, TagOutlined, CopyOutlined, DeleteOutlined
} from '@ant-design/icons';
import ModernDataTable from '../ModernDataTable';
import CreateCouponModal from './modals/CreateCouponModal';
import ConfirmActionButton from './ConfirmActionButton';
import { authFetch, getResponseErrorMessage } from '../../utils/api';
import { collectPaginatedRows, downloadCsv } from '../../utils/csv';
import { createLatestRequestGate } from '../../utils/requestGate';

const { RangePicker } = DatePicker;
const COUPONS_PAGE_SIZE = 20;

export default function CouponsView({ isDarkMode }) {
  const [coupons, setCoupons] = useState([]);
  const [couponsTotal, setCouponsTotal] = useState(0);
  const [couponsLoading, setCouponsLoading] = useState(false);
  const [couponSearch, setCouponSearch] = useState('');
  const [couponDateRange, setCouponDateRange] = useState(null);
  const [couponPage, setCouponPage] = useState(1);
  const [exportingCoupons, setExportingCoupons] = useState(false);
  const [isCouponModalOpen, setIsCouponModalOpen] = useState(false);
  const couponRequestGate = useRef(null);
  if (!couponRequestGate.current) couponRequestGate.current = createLatestRequestGate();

  const [selectedCouponRows, setSelectedCouponRows] = useState([]);
  const [clearCouponSelected, setClearCouponSelected] = useState(false);

  const loadCoupons = useCallback(async () => {
    const requestGate = couponRequestGate.current;
    const requestId = requestGate.begin();
    setCouponsLoading(true);
    try {
      const query = new URLSearchParams({ page: String(couponPage), limit: String(COUPONS_PAGE_SIZE) });
      if (couponSearch) query.set('search', couponSearch);
      if (couponDateRange?.[0]) query.set('dateFrom', couponDateRange[0].startOf('day').toISOString());
      if (couponDateRange?.[1]) query.set('dateTo', couponDateRange[1].add(1, 'day').startOf('day').toISOString());
      const res = await authFetch(`/admin/coupons/page?${query.toString()}`);
      if (!requestGate.isCurrent(requestId)) return;
      if (!res) return;
      if (!res.ok) {
        const errorMessage = await getResponseErrorMessage(res, 'Không thể tải mã khuyến mãi');
        if (requestGate.isCurrent(requestId)) message.error(errorMessage);
        return;
      }
      const data = await res.json();
      if (!requestGate.isCurrent(requestId)) return;
      setCoupons(data.coupons || []);
      setCouponsTotal(Number(data.total) || 0);
    } catch {
      if (requestGate.isCurrent(requestId)) message.error('Không thể tải mã khuyến mãi. Vui lòng thử lại.');
    } finally {
      if (requestGate.isCurrent(requestId)) setCouponsLoading(false);
    }
  }, [couponPage, couponSearch, couponDateRange]);

  useEffect(() => {
    loadCoupons();
    return () => couponRequestGate.current?.invalidate();
  }, [loadCoupons]);

  const handleToggleCoupon = useCallback(async (id, isActive) => {
    try {
      const res = await authFetch(`/admin/coupons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể thay đổi trạng thái mã khuyến mãi'));
        return;
      }
      message.success(`Đã ${isActive ? 'bật' : 'tắt'} mã khuyến mãi! 🔄`);
      loadCoupons();
    } catch {
      message.error('Không thể thay đổi trạng thái mã khuyến mãi. Vui lòng thử lại.');
    }
  }, [loadCoupons]);

  const handleDeleteCoupon = useCallback(async (id) => {
    try {
      const res = await authFetch(`/admin/coupons/${id}`, { method: 'DELETE' });
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể xóa mã khuyến mãi'));
        throw new Error('Coupon deletion failed');
      }
      message.success('Đã xóa mã khuyến mãi! 🗑️');
      loadCoupons();
    } catch (error) {
      if (error.message === 'Coupon deletion failed') throw error;
      message.error('Không thể xóa mã khuyến mãi. Vui lòng thử lại.');
      throw error;
    }
  }, [loadCoupons]);

  const handleBatchDeleteCoupons = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return;
    try {
      const res = await authFetch('/admin/coupons/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể xóa hàng loạt mã khuyến mãi'));
        return;
      }
      message.success(`Đã xóa ${ids.length} mã khuyến mãi đã chọn! 🗑️`);
      setClearCouponSelected((prev) => !prev);
      setSelectedCouponRows([]);
      loadCoupons();
    } catch {
      message.error('Không thể xóa hàng loạt mã khuyến mãi. Vui lòng thử lại.');
    }
  }, [loadCoupons]);

  const exportCoupons = async () => {
    setExportingCoupons(true);
    try {
      const rows = await collectPaginatedRows(async (page, limit) => {
        const query = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (couponSearch) query.set('search', couponSearch);
        if (couponDateRange?.[0]) query.set('dateFrom', couponDateRange[0].startOf('day').toISOString());
        if (couponDateRange?.[1]) query.set('dateTo', couponDateRange[1].add(1, 'day').startOf('day').toISOString());
        const res = await authFetch(`/admin/coupons/page?${query.toString()}`);
        if (!res) throw new Error('Phiên đăng nhập đã hết hạn.');
        if (!res.ok) throw new Error(await getResponseErrorMessage(res, 'Không thể xuất mã khuyến mãi'));
        const data = await res.json();
        return { rows: data.coupons || [], total: Number(data.total) || 0 };
      }, COUPONS_PAGE_SIZE);
      if (!downloadCsv(rows, [
        { label: 'Mã', value: (row) => row.code },
        { label: 'Mô tả', value: (row) => row.description },
        { label: 'Loại', value: (row) => row.type },
        { label: 'Gói', value: (row) => row.planName },
        { label: 'Số ngày', value: (row) => row.durationDays },
        { label: 'Đã dùng', value: (row) => row.usedCount },
        { label: 'Tối đa', value: (row) => row.maxUses },
        { label: 'Hoạt động', value: (row) => row.isActive },
        { label: 'Hết hạn', value: (row) => row.expiresAt },
        { label: 'Ngày tạo', value: (row) => row.createdAt },
      ], 'coupons-filtered')) message.info('Không có mã phù hợp bộ lọc.');
    } catch (error) {
      message.error(error.message || 'Không thể xuất mã khuyến mãi.');
    } finally {
      setExportingCoupons(false);
    }
  };

  const couponColumns = useMemo(() => [
    {
      name: 'Mã Code',
      selector: (r) => r.code,
      minWidth: '150px',
      cell: (r) => <Tag color="blue" style={{ fontSize: '0.9rem', fontWeight: 700 }}>{r.code}</Tag>,
    },
    {
      name: 'Mô Tả',
      selector: (r) => r.description || '',
      minWidth: '180px',
      cell: (r) => r.description || '-',
    },
    {
      name: 'Loại',
      selector: (r) => r.type || '',
      width: '130px',
      cell: (r) => (r.type === 'grant_plan' ? '🎁 Tặng Gói' : '📅 Tặng Ngày'),
    },
    {
      name: 'Gói/Ngày',
      selector: (r) => r.planName || `${r.durationDays || 0}`,
      width: '120px',
      cell: (r) => (r.planName ? <Tag color="gold">{r.planName}</Tag> : `${r.durationDays}d`),
    },
    {
      name: 'Đã Dùng',
      selector: (r) => Number(r.usedCount) || 0,
      width: '120px',
      cell: (r) => `${r.usedCount} / ${r.maxUses === -1 ? '∞' : r.maxUses}`,
    },
    {
      name: 'Trạng Thái',
      selector: (r) => (r.isActive ? 1 : 0),
      width: '120px',
      cell: (r) => <Switch checked={r.isActive} onChange={(c) => handleToggleCoupon(r.id, c)} />,
    },
    {
      name: 'Thao Tác',
      width: '160px',
      cell: (r) => (
        <Space>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => {
              navigator.clipboard.writeText(r.code);
              message.info(`Đã copy mã ${r.code}! 📋`);
            }}
          >
            Copy
          </Button>
          <ConfirmActionButton
            title="Xóa mã khuyến mãi này?"
            description="Mã này sẽ bị xóa khỏi hệ thống."
            onConfirm={() => handleDeleteCoupon(r.id)}
            confirmText="Xóa"
            cancelText="Hủy"
            buttonProps={{ size: 'small', danger: true, icon: <DeleteOutlined /> }}
          >
            Xóa
          </ConfirmActionButton>
        </Space>
      ),
    },
  ], [handleDeleteCoupon, handleToggleCoupon]);

  const couponContextActions = useMemo(() => {
    const ids = selectedCouponRows.map((r) => r.id);
    const count = ids.length;
    return (
      <ConfirmActionButton
        title={`Xóa vĩnh viễn ${count} mã khuyến mãi đã chọn?`}
        description="Các mã đã chọn sẽ bị xóa khỏi hệ thống."
        onConfirm={() => handleBatchDeleteCoupons(ids)}
        confirmText="Xóa"
        cancelText="Hủy"
        buttonProps={{ danger: true, icon: <DeleteOutlined />, size: 'small' }}
        disabled={!count}
      >
        Xóa {count} mã đã chọn
      </ConfirmActionButton>
    );
  }, [selectedCouponRows, handleBatchDeleteCoupons]);

  return (
    <>
      <Card
        title={
          <Space align="center">
            <span>🎟️ Quản Lý Mã Khuyến Mãi</span>
            <Tag color="cyan">{couponsTotal} mã</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            <Input.Search
              placeholder="Tìm mã code, mô tả..."
              allowClear
              onChange={(e) => { setCouponPage(1); setCouponSearch(e.target.value); }}
              style={{ width: 220 }}
            />
            <RangePicker
              allowClear
              value={couponDateRange}
              onChange={(value) => { setCouponPage(1); setCouponDateRange(value); }}
              placeholder={['Tạo từ ngày', 'Đến ngày']}
            />
            <Button disabled={!couponsTotal} loading={exportingCoupons} onClick={exportCoupons}>Xuất CSV kết quả lọc</Button>
            <Button type="primary" icon={<TagOutlined />} onClick={() => setIsCouponModalOpen(true)}>
              + Tạo Mã Mới
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadCoupons}>Làm mới</Button>
          </Space>
        }
      >
        <ModernDataTable
          columns={couponColumns}
          data={coupons}
          loading={couponsLoading}
          isDarkMode={isDarkMode}
          keyField="id"
          selectableRows
          onSelectedRowsChange={({ selectedRows }) => setSelectedCouponRows(selectedRows)}
          clearSelectedRows={clearCouponSelected}
          contextActions={couponContextActions}
          paginationPerPage={COUPONS_PAGE_SIZE}
          paginationServer
          paginationTotalRows={couponsTotal}
          paginationPage={couponPage}
          onChangePage={setCouponPage}
        />
      </Card>

      <CreateCouponModal
        open={isCouponModalOpen}
        onCancel={() => setIsCouponModalOpen(false)}
        onSaveSuccess={loadCoupons}
      />
    </>
  );
}
