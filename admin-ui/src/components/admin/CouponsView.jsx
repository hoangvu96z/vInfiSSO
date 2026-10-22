import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Space, Tag, Input, Button, Switch, message
} from 'antd';
import {
  ReloadOutlined, TagOutlined, CopyOutlined, DeleteOutlined
} from '@ant-design/icons';
import ModernDataTable from '../ModernDataTable';
import CreateCouponModal from './modals/CreateCouponModal';
import ConfirmActionButton from './ConfirmActionButton';
import { authFetch, getResponseErrorMessage, safeArr } from '../../utils/api';

export default function CouponsView({ isDarkMode }) {
  const [coupons, setCoupons] = useState([]);
  const [couponsLoading, setCouponsLoading] = useState(false);
  const [couponSearch, setCouponSearch] = useState('');
  const [isCouponModalOpen, setIsCouponModalOpen] = useState(false);

  const [selectedCouponRows, setSelectedCouponRows] = useState([]);
  const [clearCouponSelected, setClearCouponSelected] = useState(false);

  const loadCoupons = useCallback(async () => {
    setCouponsLoading(true);
    try {
      const res = await authFetch('/admin/coupons');
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể tải mã khuyến mãi'));
        return;
      }
      const data = await res.json();
      setCoupons(data.coupons || []);
    } catch {
      message.error('Không thể tải mã khuyến mãi. Vui lòng thử lại.');
    } finally {
      setCouponsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCoupons();
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

  const filteredCoupons = useMemo(() => {
    if (!couponSearch) return safeArr(coupons);
    const q = couponSearch.toLowerCase();
    return safeArr(coupons).filter((c) =>
      (c.code && c.code.toLowerCase().includes(q)) ||
      (c.description && c.description.toLowerCase().includes(q)) ||
      (c.planName && c.planName.toLowerCase().includes(q))
    );
  }, [coupons, couponSearch]);

  const couponColumns = useMemo(() => [
    {
      name: 'Mã Code',
      selector: (r) => r.code,
      sortable: true,
      minWidth: '150px',
      cell: (r) => <Tag color="blue" style={{ fontSize: '0.9rem', fontWeight: 700 }}>{r.code}</Tag>,
    },
    {
      name: 'Mô Tả',
      selector: (r) => r.description || '',
      sortable: true,
      minWidth: '180px',
      cell: (r) => r.description || '-',
    },
    {
      name: 'Loại',
      selector: (r) => r.type || '',
      sortable: true,
      width: '130px',
      cell: (r) => (r.type === 'grant_plan' ? '🎁 Tặng Gói' : '📅 Tặng Ngày'),
    },
    {
      name: 'Gói/Ngày',
      selector: (r) => r.planName || `${r.durationDays || 0}`,
      sortable: true,
      width: '120px',
      cell: (r) => (r.planName ? <Tag color="gold">{r.planName}</Tag> : `${r.durationDays}d`),
    },
    {
      name: 'Đã Dùng',
      selector: (r) => Number(r.usedCount) || 0,
      sortable: true,
      width: '120px',
      cell: (r) => `${r.usedCount} / ${r.maxUses === -1 ? '∞' : r.maxUses}`,
    },
    {
      name: 'Trạng Thái',
      selector: (r) => (r.isActive ? 1 : 0),
      sortable: true,
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
            <Tag color="cyan">{coupons.length} mã</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            <Input.Search
              placeholder="Tìm mã code, mô tả..."
              allowClear
              onChange={(e) => setCouponSearch(e.target.value)}
              style={{ width: 220 }}
            />
            <Button type="primary" icon={<TagOutlined />} onClick={() => setIsCouponModalOpen(true)}>
              + Tạo Mã Mới
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadCoupons}>Làm mới</Button>
          </Space>
        }
      >
        <ModernDataTable
          columns={couponColumns}
          data={filteredCoupons}
          loading={couponsLoading}
          isDarkMode={isDarkMode}
          keyField="id"
          selectableRows
          onSelectedRowsChange={({ selectedRows }) => setSelectedCouponRows(selectedRows)}
          clearSelectedRows={clearCouponSelected}
          contextActions={couponContextActions}
          paginationPerPage={15}
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
