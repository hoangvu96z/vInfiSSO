import React from 'react';
import { Modal, Button, Row, Col, Typography, Tag, Image } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { formatTimeWithZone } from '../../../utils/dateUtils';

const { Text } = Typography;

export default function MessageDetailModal({
  message: selectedMessage,
  open,
  loading,
  timezone,
  isDarkMode,
  onClose,
  onDelete,
}) {
  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>💬 Chi Tiết Tin Nhắn</span>
          {selectedMessage && !selectedMessage.isRead && <Tag color="cyan">Mới</Tag>}
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={[
        <Button
          key="delete"
          danger
          icon={<DeleteOutlined />}
          onClick={() => {
            if (selectedMessage) onDelete?.(selectedMessage.id);
          }}
        >
          Xóa tin nhắn
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          Đóng
        </Button>,
      ]}
      width={640}
      destroyOnClose
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>Đang tải...</div>
      ) : selectedMessage ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
          <div
            style={{
              background: isDarkMode ? '#1e293b' : '#f8fafc',
              padding: 16,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <Row gutter={[12, 10]}>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: '0.8rem' }}>Người gửi:</Text>
                <div style={{ fontWeight: 600, fontSize: '1rem' }}>{selectedMessage.name}</div>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: '0.8rem' }}>Email:</Text>
                <div>
                  {selectedMessage.email ? (
                    <a href={`mailto:${selectedMessage.email}`}>{selectedMessage.email}</a>
                  ) : (
                    <Text italic type="secondary">Không có</Text>
                  )}
                </div>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: '0.8rem' }}>Thời gian:</Text>
                <div>{formatTimeWithZone(selectedMessage.createdAt, timezone)}</div>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: '0.8rem' }}>IP / Session:</Text>
                <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                  {selectedMessage.senderIp || 'N/A'} · {selectedMessage.sessionId?.slice(0, 10)}...
                </div>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: '0.8rem' }}>📱 Thiết bị:</Text>
                <div style={{ fontWeight: 500 }}>{selectedMessage.device || selectedMessage.os || 'N/A'}</div>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: '0.8rem' }}>🌐 Trình duyệt:</Text>
                <div>{selectedMessage.browser || 'N/A'}</div>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: '0.8rem' }}>📍 Vị trí (IP):</Text>
                <div style={{ color: '#06b6d4', fontWeight: 600 }}>{selectedMessage.location || 'Chưa xác định'}</div>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: '0.8rem' }}>📡 Nhà mạng (ISP):</Text>
                <div>{selectedMessage.isp || 'N/A'}</div>
              </Col>
              {selectedMessage.metadata?.timezone && (
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: '0.8rem' }}>⏰ Múi giờ / Ngôn ngữ:</Text>
                  <div style={{ fontSize: '0.8rem' }}>
                    {selectedMessage.metadata.timezone} · {selectedMessage.metadata.language || 'N/A'}
                  </div>
                </Col>
              )}
              {selectedMessage.metadata?.screen && (
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: '0.8rem' }}>🖥️ Màn hình:</Text>
                  <div style={{ fontSize: '0.8rem' }}>{selectedMessage.metadata.screen}</div>
                </Col>
              )}
            </Row>
          </div>

          {selectedMessage.title && (
            <div>
              <Text type="secondary" style={{ fontSize: '0.8rem' }}>Tiêu đề:</Text>
              <div style={{ fontSize: '1.05rem', fontWeight: 600, marginTop: 4 }}>{selectedMessage.title}</div>
            </div>
          )}

          <div>
            <Text type="secondary" style={{ fontSize: '0.8rem' }}>Nội dung:</Text>
            <div
              style={{
                background: isDarkMode ? '#0f172a' : '#f1f5f9',
                padding: 16,
                borderRadius: 10,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
                fontSize: '0.95rem',
                marginTop: 6,
                borderLeft: '4px solid #06b6d4',
              }}
            >
              {selectedMessage.message}
            </div>
          </div>

          {((selectedMessage.images && selectedMessage.images.length > 0) || selectedMessage.imageData) && (
            <div>
              <Text type="secondary" style={{ fontSize: '0.8rem', display: 'block', marginBottom: 8 }}>
                Hình ảnh đính kèm ({selectedMessage.images?.length || 1}/3 ảnh · chuẩn 720p):
              </Text>
              <Image.PreviewGroup>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {(selectedMessage.images && selectedMessage.images.length > 0
                    ? selectedMessage.images
                    : [{ data: selectedMessage.imageData, mime: selectedMessage.imageMime }]
                  ).map((img, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: isDarkMode ? 'rgba(255,255,255,0.04)' : '#f8fafc',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        padding: 6,
                        textAlign: 'center',
                      }}
                    >
                      <Image
                        src={`data:${img.mime || 'image/jpeg'};base64,${img.data}`}
                        alt={`Ảnh ${idx + 1}`}
                        style={{ height: 160, maxWidth: 220, borderRadius: 6, objectFit: 'cover' }}
                      />
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 4 }}>
                        {img.width && img.height ? `${img.width}×${img.height}` : '720p'}
                        {img.size ? ` · ${Math.round(img.size / 1024)} KB` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </Image.PreviewGroup>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
