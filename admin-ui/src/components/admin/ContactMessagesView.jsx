import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Space, Tag, Input, Select, Button, DatePicker, message
} from 'antd';
import {
  ReloadOutlined, CheckOutlined, EyeOutlined, DeleteOutlined, PictureOutlined
} from '@ant-design/icons';
import ModernDataTable from '../ModernDataTable';
import MessageDetailModal from './modals/MessageDetailModal';
import ConfirmActionButton from './ConfirmActionButton';
import { authFetch, getResponseErrorMessage } from '../../utils/api';
import { formatTimeWithZone } from '../../utils/dateUtils';
import { downloadCsv } from '../../utils/csv';

const { Option } = Select;
const { RangePicker } = DatePicker;
const CONTACT_PAGE_SIZE = 25;

export default function ContactMessagesView({
  isDarkMode,
  timezone,
  unreadCount = 0,
  onUnreadCountChange,
}) {
  const [messages, setMessages] = useState([]);
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [messagesPage, setMessagesPage] = useState(1);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [contactFilterStatus, setContactFilterStatus] = useState('all');
  const [contactSearchText, setContactSearchText] = useState('');
  const [contactDateRange, setContactDateRange] = useState(null);

  const [selectedContactRows, setSelectedContactRows] = useState([]);
  const [clearContactSelected, setClearContactSelected] = useState(false);

  const [selectedMessage, setSelectedMessage] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadContactMessages = useCallback(async () => {
    setMessagesLoading(true);
    try {
      const [resList, resCount] = await Promise.all([
        (() => {
          const query = new URLSearchParams({
            page: String(messagesPage),
            limit: String(CONTACT_PAGE_SIZE),
          });
          if (contactSearchText) query.set('search', contactSearchText);
          if (contactFilterStatus !== 'all') query.set('status', contactFilterStatus);
          if (contactDateRange?.[0]) query.set('dateFrom', contactDateRange[0].startOf('day').toISOString());
          if (contactDateRange?.[1]) query.set('dateTo', contactDateRange[1].add(1, 'day').startOf('day').toISOString());
          return authFetch(`/contact/admin/messages?${query.toString()}`);
        })(),
        authFetch('/contact/admin/unread-count'),
      ]);
      if (resList?.ok) {
        const data = await resList.json();
        setMessages(data.messages || []);
        setMessagesTotal(data.total || 0);
      } else if (resList) {
        message.error(await getResponseErrorMessage(resList, 'Không thể tải tin nhắn liên hệ'));
      }
      if (resCount?.ok) {
        const countData = await resCount.json();
        onUnreadCountChange?.(countData.count || 0);
      } else if (resCount) {
        message.error(await getResponseErrorMessage(resCount, 'Không thể tải số tin nhắn chưa đọc'));
      }
    } catch {
      message.error('Không thể tải tin nhắn liên hệ. Vui lòng thử lại.');
    } finally {
      setMessagesLoading(false);
    }
  }, [onUnreadCountChange, messagesPage, contactFilterStatus, contactSearchText, contactDateRange]);

  useEffect(() => {
    loadContactMessages();
  }, [loadContactMessages]);

  const handleViewMessage = useCallback(async (msgSummary) => {
    setDetailModalOpen(true);
    setDetailLoading(true);
    setSelectedMessage(null);
    try {
      const res = await authFetch(`/contact/admin/messages/${msgSummary.id}`);
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể tải tin nhắn'));
        return;
      }
      const data = await res.json();
      setSelectedMessage(data.message);
      if (!msgSummary.isRead) {
        const readRes = await authFetch(`/contact/admin/messages/${msgSummary.id}/read`, { method: 'PATCH' });
        if (readRes?.ok) {
          setMessages((prev) => prev.map((m) => (m.id === msgSummary.id ? { ...m, isRead: true } : m)));
          onUnreadCountChange?.(Math.max(0, unreadCount - 1));
          loadContactMessages();
        } else if (readRes) {
          message.error(await getResponseErrorMessage(readRes, 'Không thể đánh dấu tin nhắn đã đọc'));
        }
      }
    } catch {
      message.error('Không thể tải tin nhắn. Vui lòng thử lại.');
    } finally {
      setDetailLoading(false);
    }
  }, [unreadCount, onUnreadCountChange, loadContactMessages]);

  const handleMarkAllRead = async () => {
    try {
      const res = await authFetch('/contact/admin/read-all', { method: 'PATCH' });
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể đánh dấu tất cả tin nhắn đã đọc'));
        return;
      }
      message.success('Đã đánh dấu tất cả là đã đọc! ✅');
      setMessages((prev) => prev.map((m) => ({ ...m, isRead: true })));
      onUnreadCountChange?.(0);
    } catch {
      message.error('Không thể đánh dấu tất cả tin nhắn đã đọc. Vui lòng thử lại.');
    }
  };

  const handleDeleteMessage = useCallback(async (id) => {
    try {
      const res = await authFetch(`/contact/admin/messages/${id}`, { method: 'DELETE' });
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể xóa tin nhắn'));
        return;
      }
      message.success('Đã xóa tin nhắn! 🗑️');
      const target = messages.find((m) => m.id === id);
      setMessages((prev) => prev.filter((m) => m.id !== id));
      setMessagesTotal((total) => Math.max(0, total - 1));
      if (target && !target.isRead) {
        onUnreadCountChange?.(Math.max(0, unreadCount - 1));
      }
      if (selectedMessage?.id === id) {
        setDetailModalOpen(false);
        setSelectedMessage(null);
      }
    } catch {
      message.error('Không thể xóa tin nhắn. Vui lòng thử lại.');
    }
  }, [messages, selectedMessage, unreadCount, onUnreadCountChange]);

  const handleBatchDeleteMessages = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return;
    try {
      const res = await authFetch('/contact/admin/messages/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể xóa tin nhắn hàng loạt'));
        return;
      }
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
    } catch {
      message.error('Không thể xóa tin nhắn hàng loạt. Vui lòng thử lại.');
    }
  }, [selectedMessage, loadContactMessages]);

  const handleBatchMarkReadMessages = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return;
    try {
      const res = await authFetch('/contact/admin/messages/batch-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res) return;
      if (!res.ok) {
        message.error(await getResponseErrorMessage(res, 'Không thể đánh dấu tin nhắn đã đọc'));
        return;
      }
      const data = await res.json();
      message.success(`Đã đánh dấu ${data.count || ids.length} tin nhắn đã đọc! ✅`);
      setMessages((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, isRead: true } : m)));
      setClearContactSelected((prev) => !prev);
      setSelectedContactRows([]);
      loadContactMessages();
    } catch {
      message.error('Không thể đánh dấu tin nhắn đã đọc. Vui lòng thử lại.');
    }
  }, [loadContactMessages]);

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
          <ConfirmActionButton
            title="Xóa tin nhắn này?"
            description="Tin nhắn và ảnh đính kèm sẽ bị xóa vĩnh viễn."
            onConfirm={() => handleDeleteMessage(r.id)}
            confirmText="Xóa"
            buttonProps={{ size: 'small', danger: true, icon: <DeleteOutlined /> }}
          />
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
        <ConfirmActionButton
          title={`Xóa vĩnh viễn ${count} tin nhắn đã chọn?`}
          description="Tin nhắn và ảnh đính kèm đã chọn sẽ bị xóa vĩnh viễn."
          onConfirm={() => handleBatchDeleteMessages(ids)}
          confirmText="Xóa"
          cancelText="Hủy"
          buttonProps={{ size: 'small', danger: true, icon: <DeleteOutlined /> }}
          disabled={!count}
        >
          Xóa {count} đã chọn
        </ConfirmActionButton>
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
            <Tag color="default">Tổng {messagesTotal}</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            <Input.Search
              placeholder="Tìm người gửi, email, tin nhắn..."
              allowClear
              onChange={(e) => { setMessagesPage(1); setContactSearchText(e.target.value); }}
              style={{ width: 240 }}
            />
            <Select
              value={contactFilterStatus}
              onChange={(value) => { setMessagesPage(1); setContactFilterStatus(value); }}
              style={{ width: 130 }}
            >
              <Option value="all">Tất cả</Option>
              <Option value="unread">Chưa đọc ({unreadCount})</Option>
              <Option value="read">Đã đọc</Option>
            </Select>
            <RangePicker
              allowClear
              value={contactDateRange}
              onChange={(value) => { setMessagesPage(1); setContactDateRange(value); }}
              placeholder={['Từ ngày', 'Đến ngày']}
            />
            <Button
              disabled={!messages.length}
              onClick={() => downloadCsv(messages, [
                { label: 'Thời gian', value: (item) => item.createdAt },
                { label: 'Người gửi', value: (item) => item.name },
                { label: 'Email', value: (item) => item.email },
                { label: 'Tiêu đề', value: (item) => item.title },
                { label: 'Tin nhắn', value: (item) => item.message },
                { label: 'Trạng thái', value: (item) => item.isRead ? 'Đã đọc' : 'Chưa đọc' },
              ], `contact-messages-page-${messagesPage}`)}
            >Xuất CSV trang này</Button>
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
          data={messages}
          loading={messagesLoading}
          isDarkMode={isDarkMode}
          keyField="id"
          selectableRows
          onSelectedRowsChange={({ selectedRows }) => setSelectedContactRows(selectedRows)}
          clearSelectedRows={clearContactSelected}
          contextActions={contactContextActions}
          paginationPerPage={CONTACT_PAGE_SIZE}
          paginationServer
          paginationTotalRows={messagesTotal}
          paginationPage={messagesPage}
          onChangePage={setMessagesPage}
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
