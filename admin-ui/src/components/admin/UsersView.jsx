import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card, Space, Tag, Input, Select, Button, DatePicker, message
} from 'antd';
import {
  ReloadOutlined, PoweroffOutlined, CheckCircleOutlined,
  CloseCircleOutlined, GiftOutlined
} from '@ant-design/icons';
import ModernDataTable from '../ModernDataTable';
import GrantPlanModal from './modals/GrantPlanModal';
import ConfirmActionButton from './ConfirmActionButton';
import { authFetch, getResponseErrorMessage } from '../../utils/api';
import { collectPaginatedRows, downloadCsv } from '../../utils/csv';
import { createLatestRequestGate } from '../../utils/requestGate';

const { Option } = Select;
const { RangePicker } = DatePicker;
const USERS_PAGE_SIZE = 20;

export default function UsersView({ isDarkMode }) {
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersPage, setUsersPage] = useState(1);
  const usersLimit = USERS_PAGE_SIZE;
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [userDateRange, setUserDateRange] = useState(null);
  const [exportingUsers, setExportingUsers] = useState(false);

  const [selectedUserRows, setSelectedUserRows] = useState([]);
  const [clearUserSelected, setClearUserSelected] = useState(false);
  const [grantModalUser, setGrantModalUser] = useState(null);
  const usersRequestGate = useRef(null);
  if (!usersRequestGate.current) usersRequestGate.current = createLatestRequestGate();
  const usersMounted = useRef(false);

  const loadUsers = useCallback(async () => {
    if (!usersMounted.current) return;
    const requestGate = usersRequestGate.current;
    const requestId = requestGate.begin();
    setUsersLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('page', String(usersPage));
      query.set('limit', String(usersLimit));
      if (userSearch) query.set('search', userSearch);
      if (roleFilter) query.set('role', roleFilter);
      if (userDateRange?.[0]) query.set('dateFrom', userDateRange[0].startOf('day').toISOString());
      if (userDateRange?.[1]) query.set('dateTo', userDateRange[1].add(1, 'day').startOf('day').toISOString());
      const res = await authFetch(`/admin/users?${query.toString()}`);
      if (!requestGate.isCurrent(requestId)) return;
      if (!res) return;
      if (!res.ok) {
        const errorMessage = await getResponseErrorMessage(res, 'Không thể tải danh sách người dùng');
        if (requestGate.isCurrent(requestId)) message.error(errorMessage);
        return;
      }
      const data = await res.json();
      if (!requestGate.isCurrent(requestId)) return;
      setUsers(data.users || data.data || []);
      setUsersTotal(data.total || 0);
    } catch {
      if (requestGate.isCurrent(requestId)) message.error('Không thể tải danh sách người dùng. Vui lòng thử lại.');
    } finally {
      if (requestGate.isCurrent(requestId)) setUsersLoading(false);
    }
  }, [userSearch, roleFilter, usersPage, userDateRange, usersLimit]);

  useEffect(() => {
    usersMounted.current = true;
    loadUsers();
    return () => {
      usersMounted.current = false;
      usersRequestGate.current?.invalidate();
    };
  }, [loadUsers]);

  const exportUsers = async () => {
    setExportingUsers(true);
    try {
      const rows = await collectPaginatedRows(async (page, limit) => {
        const query = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (userSearch) query.set('search', userSearch);
        if (roleFilter) query.set('role', roleFilter);
        if (userDateRange?.[0]) query.set('dateFrom', userDateRange[0].startOf('day').toISOString());
        if (userDateRange?.[1]) query.set('dateTo', userDateRange[1].add(1, 'day').startOf('day').toISOString());
        const res = await authFetch(`/admin/users?${query.toString()}`);
        if (!res) throw new Error('Phiên đăng nhập đã hết hạn.');
        if (!res.ok) throw new Error(await getResponseErrorMessage(res, 'Không thể xuất danh sách người dùng'));
        const data = await res.json();
        return { rows: data.users || data.data || [], total: Number(data.total) || 0 };
      }, usersLimit);
      if (!downloadCsv(rows, [
        { label: 'Email', value: (user) => user.email },
        { label: 'Tên', value: (user) => user.fullName || user.displayName || user.username },
        { label: 'Vai trò', value: (user) => user.role },
        { label: 'Gói', value: (user) => user.planName },
        { label: 'Ngày tạo', value: (user) => user.createdAt },
      ], 'users-filtered')) message.info('Không có người dùng phù hợp bộ lọc.');
    } catch (error) {
      message.error(error.message || 'Không thể xuất danh sách người dùng.');
    } finally {
      setExportingUsers(false);
    }
  };

  const handleUpdateRole = useCallback(async (userId, newRole) => {
    try {
      const res = await authFetch(`/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể cập nhật role người dùng'));
        throw new Error('Role update failed');
      }
      message.success(`Đã cập nhật role thành ${newRole} thành công! ✅`);
      loadUsers();
    } catch (error) {
      if (error.message === 'Role update failed') throw error;
      message.error('Không thể cập nhật role người dùng. Vui lòng thử lại.');
      throw error;
    }
  }, [loadUsers]);

  const handleRevokeSessions = useCallback(async (userId) => {
    try {
      const res = await authFetch(`/admin/users/${userId}/sessions`, { method: 'DELETE' });
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể hủy phiên đăng nhập'));
        throw new Error('Session revocation failed');
      }
      message.success('Đã hủy tất cả phiên đăng nhập của người dùng! ⚡');
      loadUsers();
    } catch (error) {
      if (error.message === 'Session revocation failed') throw error;
      message.error('Không thể hủy phiên đăng nhập. Vui lòng thử lại.');
      throw error;
    }
  }, [loadUsers]);

  const handleBatchRevokeSessions = useCallback(async (userIds) => {
    if (!userIds || userIds.length === 0) return;
    try {
      const res = await authFetch('/admin/users/batch-revoke-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds }),
      });
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể hủy phiên hàng loạt'));
        return;
      }
      const data = await res.json();
      message.success(data.message || `Đã hủy phiên của ${userIds.length} người dùng! ⚡`);
      setClearUserSelected((prev) => !prev);
      setSelectedUserRows([]);
      loadUsers();
    } catch {
      message.error('Không thể hủy phiên hàng loạt. Vui lòng thử lại.');
    }
  }, [loadUsers]);

  const userColumns = useMemo(() => [
    {
      name: 'User Info',
      selector: (r) => (r.fullName || r.displayName || r.email || '').toLowerCase(),
      sortable: true,
      minWidth: '220px',
      grow: 2,
      cell: (r) => (
        <div style={{ padding: '6px 0' }}>
          <strong>{r.fullName || r.displayName || 'User'}</strong>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{r.email}</div>
        </div>
      ),
    },
    {
      name: 'Role',
      selector: (r) => r.role || '',
      sortable: true,
      width: '100px',
      cell: (r) => <Tag color={r.role === 'admin' ? 'purple' : 'default'}>{r.role}</Tag>,
    },
    {
      name: 'Gói Dịch Vụ',
      selector: (r) => r.planName || 'free',
      sortable: true,
      width: '130px',
      cell: (r) => (
        <Tag color={r.planName === 'premium' ? 'gold' : r.planName === 'lite' ? 'blue' : 'default'}>
          {r.planName || 'free'}
        </Tag>
      ),
    },
    {
      name: 'Email Verified',
      selector: (r) => ((r.isVerified ?? r.isEmailVerified) ? 1 : 0),
      sortable: true,
      width: '160px',
      cell: (r) => (r.isVerified ?? r.isEmailVerified) ? (
        <Tag icon={<CheckCircleOutlined />} color="success">Đã xác thực</Tag>
      ) : (
        <Tag icon={<CloseCircleOutlined />} color="error">Chưa xác thực</Tag>
      ),
    },
    {
      name: 'Lượt AI',
      selector: (r) => Number(r.aiQuestionsCount) || 0,
      sortable: true,
      width: '110px',
      cell: (r) => <strong>{r.aiQuestionsCount || 0}</strong>,
    },
    {
      name: 'Thao Tác',
      minWidth: '280px',
      cell: (r) => (
        <Space wrap>
          <ConfirmActionButton
            title="Xác nhận thay đổi role?"
            description={`Đổi role của người dùng thành ${r.role === 'admin' ? 'user' : 'admin'}?`}
            confirmText="Đổi role"
            onConfirm={() => handleUpdateRole(r.id, r.role === 'admin' ? 'user' : 'admin')}
            buttonProps={{ size: 'small' }}
          >
            Role: {r.role === 'admin' ? 'User' : 'Admin'}
          </ConfirmActionButton>
          <Button size="small" type="primary" icon={<GiftOutlined />} onClick={() => setGrantModalUser(r)}>
            Tặng Gói
          </Button>
          <ConfirmActionButton
            title="Hủy tất cả phiên của người dùng này?"
            description="Phiên đăng nhập hiện tại trên tất cả thiết bị sẽ bị chấm dứt."
            onConfirm={() => handleRevokeSessions(r.id)}
            confirmText="Hủy phiên"
            cancelText="Đóng"
            buttonProps={{ size: 'small', danger: true }}
          >
            Hủy Session
          </ConfirmActionButton>
        </Space>
      ),
    },
  ], [handleRevokeSessions, handleUpdateRole]);

  const userContextActions = useMemo(() => {
    const userIds = selectedUserRows.map((r) => r.id);
    const count = userIds.length;
    return (
      <ConfirmActionButton
        title={`Hủy tất cả phiên đăng nhập của ${count} người dùng đã chọn?`}
        description="Người dùng đã chọn sẽ cần đăng nhập lại trên mọi thiết bị."
        onConfirm={() => handleBatchRevokeSessions(userIds)}
        confirmText="Hủy phiên"
        cancelText="Đóng"
        buttonProps={{ danger: true, icon: <PoweroffOutlined />, size: 'small' }}
        disabled={!count}
      >
        Hủy phiên ({count} đã chọn)
      </ConfirmActionButton>
    );
  }, [selectedUserRows, handleBatchRevokeSessions]);

  return (
    <>
      <Card
        title={
          <Space align="center">
            <span>👥 Danh Sách Người Dùng</span>
            <Tag color="blue">{usersTotal} người dùng</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            <Input.Search
              placeholder="Tìm email, tên..."
              allowClear
              onSearch={(value) => { setUsersPage(1); setUserSearch(value); }}
              onChange={(e) => { setUsersPage(1); setUserSearch(e.target.value); }}
              style={{ width: 220 }}
            />
            <Select placeholder="Role" allowClear onChange={(value) => { setUsersPage(1); setRoleFilter(value || ''); }} style={{ width: 120 }}>
              <Option value="user">User</Option>
              <Option value="admin">Admin</Option>
              <Option value="vip">VIP</Option>
            </Select>
            <RangePicker
              allowClear
              value={userDateRange}
              onChange={(value) => { setUsersPage(1); setUserDateRange(value); }}
              placeholder={['Tạo từ ngày', 'Đến ngày']}
            />
            <Button
              disabled={!usersTotal}
              loading={exportingUsers}
              onClick={exportUsers}
            >Xuất CSV kết quả lọc</Button>
            <Button icon={<ReloadOutlined />} onClick={loadUsers}>Làm mới</Button>
          </Space>
        }
      >
        <ModernDataTable
          columns={userColumns}
          data={users}
          loading={usersLoading}
          isDarkMode={isDarkMode}
          keyField="id"
          selectableRows
          onSelectedRowsChange={({ selectedRows }) => setSelectedUserRows(selectedRows)}
          clearSelectedRows={clearUserSelected}
          contextActions={userContextActions}
          paginationPerPage={usersLimit}
          paginationServer
          paginationTotalRows={usersTotal}
          paginationPage={usersPage}
          onChangePage={setUsersPage}
        />
      </Card>

      <GrantPlanModal
        user={grantModalUser}
        open={!!grantModalUser}
        onCancel={() => setGrantModalUser(null)}
        onSaveSuccess={loadUsers}
      />
    </>
  );
}
