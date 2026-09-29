import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Space, Tag, Input, Select, Button, Popconfirm, Modal, message
} from 'antd';
import {
  ReloadOutlined, PoweroffOutlined, CheckCircleOutlined,
  CloseCircleOutlined, GiftOutlined
} from '@ant-design/icons';
import ModernDataTable from '../ModernDataTable';
import GrantPlanModal from './modals/GrantPlanModal';
import { authFetch } from '../../utils/api';

const { Option } = Select;

export default function UsersView({ isDarkMode }) {
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const [selectedUserRows, setSelectedUserRows] = useState([]);
  const [clearUserSelected, setClearUserSelected] = useState(false);
  const [grantModalUser, setGrantModalUser] = useState(null);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    const query = new URLSearchParams();
    if (userSearch) query.set('search', userSearch);
    if (roleFilter) query.set('role', roleFilter);
    const res = await authFetch(`/admin/users?${query.toString()}`);
    if (res) {
      const data = await res.json();
      setUsers(data.users || data.data || []);
    }
    setUsersLoading(false);
  }, [userSearch, roleFilter]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleUpdateRole = useCallback(async (userId, newRole) => {
    Modal.confirm({
      title: `Xác nhận đổi role?`,
      content: `Đổi role của người dùng thành ${newRole}?`,
      onOk: async () => {
        const res = await authFetch(`/admin/users/${userId}/role`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole }),
        });
        if (res && res.ok) {
          message.success(`Đã cập nhật role thành ${newRole} thành công! ✅`);
          loadUsers();
        }
      },
    });
  }, [loadUsers]);

  const handleRevokeSessions = useCallback(async (userId) => {
    Modal.confirm({
      title: `Hủy phiên đăng nhập?`,
      content: `Tất cả phiên đăng nhập của người dùng sẽ bị chấm dứt lập tức.`,
      onOk: async () => {
        const res = await authFetch(`/admin/users/${userId}/sessions`, { method: 'DELETE' });
        if (res && res.ok) {
          message.info('Đã hủy tất cả phiên đăng nhập của người dùng! ⚡');
          loadUsers();
        }
      },
    });
  }, [loadUsers]);

  const handleBatchRevokeSessions = useCallback(async (userIds) => {
    if (!userIds || userIds.length === 0) return;
    const res = await authFetch('/admin/users/batch-revoke-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds }),
    });
    if (res && res.ok) {
      const data = await res.json();
      message.info(data.message || `Đã hủy phiên của ${userIds.length} người dùng! ⚡`);
      setClearUserSelected((prev) => !prev);
      setSelectedUserRows([]);
      loadUsers();
    } else {
      message.error('Lỗi khi hủy phiên hàng loạt');
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
          <Button size="small" onClick={() => handleUpdateRole(r.id, r.role === 'admin' ? 'user' : 'admin')}>
            Role: {r.role === 'admin' ? 'User' : 'Admin'}
          </Button>
          <Button size="small" type="primary" icon={<GiftOutlined />} onClick={() => setGrantModalUser(r)}>
            Tặng Gói
          </Button>
          <Popconfirm
            title="Hủy tất cả phiên của người dùng này?"
            onConfirm={() => handleRevokeSessions(r.id)}
            okText="Hủy phiên"
            cancelText="Đóng"
          >
            <Button size="small" danger>Hủy Session</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [handleRevokeSessions, handleUpdateRole]);

  const userContextActions = useMemo(() => {
    const userIds = selectedUserRows.map((r) => r.id);
    const count = userIds.length;
    return (
      <Popconfirm
        title={`Hủy tất cả phiên đăng nhập của ${count} người dùng đã chọn?`}
        onConfirm={() => handleBatchRevokeSessions(userIds)}
        okText="Hủy phiên"
        cancelText="Đóng"
      >
        <Button danger icon={<PoweroffOutlined />} size="small">
          Hủy phiên ({count} đã chọn)
        </Button>
      </Popconfirm>
    );
  }, [selectedUserRows, handleBatchRevokeSessions]);

  return (
    <>
      <Card
        title={
          <Space align="center">
            <span>👥 Danh Sách Người Dùng</span>
            <Tag color="blue">{users.length} người dùng</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            <Input.Search
              placeholder="Tìm email, tên..."
              allowClear
              onSearch={setUserSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              style={{ width: 220 }}
            />
            <Select placeholder="Role" allowClear onChange={setRoleFilter} style={{ width: 120 }}>
              <Option value="user">User</Option>
              <Option value="admin">Admin</Option>
              <Option value="vip">VIP</Option>
            </Select>
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
          paginationPerPage={15}
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
