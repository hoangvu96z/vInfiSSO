import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Space, Tag, Input, Select, Button, Popconfirm, message
} from 'antd';
import {
  ReloadOutlined, CheckOutlined, EyeOutlined, DeleteOutlined, PictureOutlined
} from '@ant-design/icons';
import ModernDataTable from '../ModernDataTable';
import MessageDetailModal from './modals/MessageDetailModal';
import { authFetch, safeArr } from '../../utils/api';
import { formatTimeWithZone } from '../../utils/dateUtils';

const { Option } = Select;

export default function ContactMessagesView({
  isDarkMode,
  timezone,
  unreadCount = 0,
  onUnreadCountChange,
}) {
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [contactFilterStatus, setContactFilterStatus] = useState('all');
  const [contactSearchText, setContactSearchText] = useState('');

  const [selectedContactRows, setSelectedContactRows] = useState([]);
  const [clearContactSelected, setClearContactSelected] = useState(false);

  const [selectedMessage, setSelectedMessage] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadContactMessages = useCallback(async () => {
    setMessagesLoading(true);
    const [resList, resCount] = await Promise.all([
      authFetch('/contact/admin/messages?limit=100'),
      authFetch('/contact/admin/unread-count'),
    ]);
    if (resList) {
      const data = await resList.json();
      setMessages(data.messages || []);
    }
    if (resCount) {
      const countData = await resCount.json();
      onUnreadCountChange?.(countData.count || 0);
    }
    setMessagesLoading(false);
  }, [onUnreadCountChange]);

  useEffect(() => {
    loadContactMessages();
  }, [loadContactMessages]);

  const handleViewMessage = useCallback(async (msgSummary) => {
    setDetailModalOpen(true);
    setDetailLoading(true);
    const res = await authFetch(`/contact/admin/messages/${msgSummary.id}`);
    if (res) {
      const data = await res.json();
      setSelectedMessage(data.message);
      if (!msgSummary.isRead) {
        await authFetch(`/contact/admin/messages/${msgSummary.id}/read`, { method: 'PATCH' });
        setMessages((prev) => prev.map((m) => (m.id === msgSummary.id ? { ...m, isRead: true } : m)));
        onUnreadCountChange?.(Math.max(0, unreadCount - 1));
      }
    }
    setDetailLoading(false);
  }, [unreadCount, onUnreadCountChange]);

  const handleMarkAllRead = async () => {
    const res = await authFetch('/contact/admin/read-all', { method: 'PATCH' });
    if (res) {
      message.success('Đã đánh dấu tất cả là đã đọc! ✅');
      setMessages((prev) => prev.map((m) => ({ ...m, isRead: true })));
      onUnreadCountChange?.(0);
    }
  };

  const handleDeleteMessage = useCallback(async (id) => {
    const res = await authFetch(`/contact/admin/messages/${id}`, { method: 'DELETE' });
    if (res) {
      message.success('Đã xóa tin nhắn! 🗑️');
      const target = messages.find((m) => m.id === id);
      setMessages((prev) => prev.filter((m) => m.id !== id));
      if (target && !target.isRead) {
        onUnreadCountChange?.(Math.max(0, unreadCount - 1));
      }
      if (selectedMessage?.id === id) {
        setDetailModalOpen(false);
        setSelectedMessage(null);
      }
    }
  }, [messages, selectedMessage, unreadCount, onUnreadCountChange]);

  const handleBatchDeleteMessages = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return;
    const res = await authFetch('/contact/admin/messages/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res && res.ok) {
      const data = await res.json();
      message.success(`Đã xóa ${data.count || ids.length} tin nhắn đã chọn! 🗑️`);
      setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
      setClearContactSelected((prev) => !prev);
      setSelectedContactRows([]);
      if (selectedMessage && ids.includes(selectedMessage.id)) {
        setDetailModalOpen(false);
        setSelectedMessage(null);
      }
      loadContactMessages();
    } else {
      message.error('Lỗi khi xóa tin nhắn hàng loạt');
    }
  }, [selectedMessage, loadContactMessages]);

  const handleBatchMarkReadMessages = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return;
    const res = await authFetch('/contact/admin/messages/batch-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res && res.ok) {
      const data = await res.json();
      message.success(`Đã đánh dấu ${data.count || ids.length} tin nhắn đã đọc! ✅`);
      setMessages((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, isRead: true } : m)));
      setClearContactSelected((prev) => !prev);
      setSelectedContactRows([]);
      loadContactMessages();
    } else {
      message.error('Lỗi khi đánh dấu đã đọc');
    }
  }, [loadContactMessages]);

  const filteredMessages = useMemo(() => {
    return safeArr(messages).filter((m) => {
      if (contactFilterStatus === 'unread' && m.isRead) return false;
      if (contactFilterStatus === 'read' && !m.isRead) return false;
      if (contactSearchText) {
        const q = contactSearchText.toLowerCase();
        const match =
          (m.name && m.name.toLowerCase().includes(q)) ||
          (m.email && m.email.toLowerCase().includes(q)) ||
          (m.title && m.title.toLowerCase().includes(q)) ||
          (m.message && m.message.toLowerCase().includes(q)) ||
          (m.device && m.device.toLowerCase().includes(q)) ||
          (m.location && m.location.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [messages, contactFilterStatus, contactSearchText]);

  const contactColumns = useMemo(() => [
    {
      name: 'Trạng thái',
      selector: (r) => (r.isRead ? 1 : 0),
      sortable: true,
      width: '120px',
      cell: (r) => (r.isRead ? (
        <Tag color="default">Đã đọc</Tag>
      ) : (
        <Tag color="cyan" style={{ fontWeight: 600 }}>MỚI</Tag>
      )),
    },
    {
      name: 'Người gửi',
      selector: (r) => (r.name || '').toLowerCase(),
      sortable: true,
      minWidth: '180px',
      cell: (r) => (
        <div style={{ padding: '6px 0' }}>
          <div style={{ fontWeight: 600, color: r.isRead ? undefined : '#06b6d4' }}>{r.name}</div>
          {r.email && <div style={{ fontSize: '0.78rem', opacity: 0.65 }}>{r.email}</div>}
        </div>
      ),
    },
    {
      name: 'Tiêu đề / Tin nhắn',
      selector: (r) => (r.title || r.message || '').toLowerCase(),
      sortable: true,
      minWidth: '240px',
      grow: 2,
      cell: (r) => (
        <div style={{ maxWidth: 360, padding: '6px 0' }}>
          {r.title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{r.title}</div>}
          <div style={{ fontSize: '0.85rem', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.message}
          </div>
        </div>
      ),
    },
    {
      name: 'Ảnh',
      selector: (r) => Number(r.imageCount) || (r.hasImage ? 1 : 0),
      sortable: true,
      width: '100px',
      cell: (r) => {
        const count = r.imageCount || (r.hasImage ? 1 : 0);
        if (count > 1) return <Tag icon={<PictureOutlined />} color="cyan">{count} ảnh</Tag>;
        if (count === 1) return <Tag icon={<PictureOutlined />} color="purple">1 ảnh</Tag>;
        return <span style={{ opacity: 0.4 }}>-</span>;
      },
    },
    {
      name: 'Thiết bị & Vị trí',
      selector: (r) => `${r.device || ''} ${r.location || ''}`.toLowerCase(),
      sortable: true,
      minWidth: '170px',
      cell: (r) => (
        <div style={{ fontSize: '0.82rem', padding: '6px 0' }}>
          <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>📱</span>
            <span>{r.device || r.browser || 'Không rõ'}</span>
          </div>
          {r.location && (
            <div style={{ opacity: 0.75, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <span>📍</span>
              <span>{r.location}</span>
            </div>
          )}
        </div>
      ),
    },
    {
      name: 'Thời gian',
      selector: (r) => new Date(r.createdAt).getTime(),
      sortable: true,
      width: '150px',
      cell: (r) => formatTimeWithZone(r.createdAt, timezone, 'short'),
    },
    {
      name: 'Thao tác',
      width: '130px',
      cell: (r) => (
        <Space>
          <Button size="small" type="primary" icon={<EyeOutlined />} onClick={() => handleViewMessage(r)}>
            Xem
          </Button>
          <Popconfirm title="Xóa tin nhắn này?" onConfirm={() => handleDeleteMessage(r.id)} okText="Xóa" cancelText="Hủy">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ], [timezone, handleViewMessage, handleDeleteMessage]);

  const contactContextActions = useMemo(() => {
    const ids = selectedContactRows.map((r) => r.id);
    const count = ids.length;
    return (
      <Space>
        <Button
          size="small"
          icon={<CheckOutlined />}
          onClick={() => handleBatchMarkReadMessages(ids)}
        >
          Đánh dấu {count} đã đọc
        </Button>
        <Popconfirm
          title={`Xóa vĩnh viễn ${count} tin nhắn đã chọn?`}
          onConfirm={() => handleBatchDeleteMessages(ids)}
          okText="Xóa"
          cancelText="Hủy"
        >
          <Button size="small" danger icon={<DeleteOutlined />}>
            Xóa {count} đã chọn
          </Button>
        </Popconfirm>
      </Space>
    );
  }, [selectedContactRows, handleBatchMarkReadMessages, handleBatchDeleteMessages]);

  return (
    <>
      <Card
        title={
          <Space align="center">
            <span>💬 Hộp Thư TalkWithMe</span>
            {unreadCount > 0 && <Tag color="cyan">{unreadCount} chưa đọc</Tag>}
            <Tag color="default">Tổng {messages.length}</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            <Input.Search
              placeholder="Tìm người gửi, email, tin nhắn..."
              allowClear
              onChange={(e) => setContactSearchText(e.target.value)}
              style={{ width: 240 }}
            />
            <Select
              value={contactFilterStatus}
              onChange={setContactFilterStatus}
              style={{ width: 130 }}
            >
              <Option value="all">Tất cả ({messages.length})</Option>
              <Option value="unread">Chưa đọc ({unreadCount})</Option>
              <Option value="read">Đã đọc ({Math.max(0, messages.length - unreadCount)})</Option>
            </Select>
            <Button icon={<ReloadOutlined />} onClick={loadContactMessages} loading={messagesLoading}>
              Làm mới
            </Button>
            {unreadCount > 0 && (
              <Button icon={<CheckOutlined />} onClick={handleMarkAllRead}>
                Đánh dấu tất cả đã đọc
              </Button>
            )}
          </Space>
        }
      >
        <ModernDataTable
          columns={contactColumns}
          data={filteredMessages}
          loading={messagesLoading}
          isDarkMode={isDarkMode}
          keyField="id"
          selectableRows
          onSelectedRowsChange={({ selectedRows }) => setSelectedContactRows(selectedRows)}
          clearSelectedRows={clearContactSelected}
          contextActions={contactContextActions}
          paginationPerPage={15}
        />
      </Card>

      <MessageDetailModal
        message={selectedMessage}
        open={detailModalOpen}
        loading={detailLoading}
        timezone={timezone}
        isDarkMode={isDarkMode}
        onClose={() => {
          setDetailModalOpen(false);
          setSelectedMessage(null);
        }}
        onDelete={handleDeleteMessage}
      />
    </>
  );
}
