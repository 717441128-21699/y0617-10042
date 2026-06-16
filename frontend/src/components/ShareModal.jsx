import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Select, message, Space, Tag, Tooltip } from 'antd';
import { ShareAltOutlined, CopyOutlined, CheckOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { shareApi } from '../api';

const EXPIRE_OPTIONS = [
  { label: '1小时', value: 1 },
  { label: '24小时', value: 24 },
  { label: '7天', value: 24 * 7 },
  { label: '30天', value: 24 * 30 },
  { label: '永久', value: 0 }
];

function ShareModal({ file, onClose }) {
  const [expireHours, setExpireHours] = useState(24);
  const [shareInfo, setShareInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchShares = async () => {
      try {
        const res = await shareApi.getFileShares(file.id);
        if (res.data.length > 0) {
          setShareInfo(res.data[0]);
          setExpireHours(res.data[0].expire_at ? 24 : 0);
        }
      } catch (e) {
        console.error('Get shares error:', e);
      }
    };

    if (file?.id) {
      fetchShares();
    }
  }, [file?.id]);

  const handleCreateShare = async () => {
    try {
      setLoading(true);
      const res = await shareApi.createShare(file.id, expireHours);
      setShareInfo(res.data);
      message.success('分享链接已生成');
    } catch (e) {
      message.error(e.response?.data?.error || '生成分享链接失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async () => {
    Modal.confirm({
      title: '确认撤销',
      content: '确定要撤销此分享链接吗？',
      onOk: async () => {
        try {
          setLoading(true);
          await shareApi.revokeShare(shareInfo.share_token);
          setShareInfo(null);
          message.success('已撤销分享');
        } catch (e) {
          message.error(e.response?.data?.error || '撤销失败');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleCopy = async () => {
    const fullUrl = `${window.location.origin}/s/${shareInfo.share_token}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      message.success('链接已复制到剪贴板');
    } catch (e) {
      message.error('复制失败，请手动复制');
    }
  };

  const shareUrl = shareInfo ? `${window.location.origin}/s/${shareInfo.share_token}` : '';

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShareAltOutlined style={{ color: '#722ed1' }} />
          <span>分享文件</span>
        </div>
      }
      open={true}
      onCancel={onClose}
      footer={null}
      width={500}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: '#666' }}>文件名称：</span>
          <strong>{file.name}</strong>
        </div>

        {!shareInfo ? (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8, color: '#666' }}>有效期：</div>
              <Select
                value={expireHours}
                onChange={setExpireHours}
                style={{ width: '100%' }}
                options={EXPIRE_OPTIONS}
              />
            </div>

            <Button
              type="primary"
              block
              icon={<ShareAltOutlined />}
              onClick={handleCreateShare}
              loading={loading}
            >
              生成分享链接
            </Button>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <Space>
                <Tag color="green">分享链接已生成</Tag>
                {shareInfo.expire_at ? (
                  <Tag color="orange">
                    有效期至 {dayjs(shareInfo.expire_at).format('YYYY-MM-DD HH:mm')}
                  </Tag>
                ) : (
                  <Tag color="blue">永久有效</Tag>
                )}
              </Space>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 8, color: '#666' }}>分享链接：</div>
              <Space.Compact style={{ width: '100%' }}>
                <Input value={shareUrl} readOnly />
                <Tooltip title={copied ? '已复制' : '复制链接'}>
                  <Button
                    icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                    onClick={handleCopy}
                    type={copied ? 'primary' : 'default'}
                  />
                </Tooltip>
              </Space.Compact>
            </div>

            <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
              <Space>
                <span>👁️ 浏览 {shareInfo.views} 次</span>
                <span>⬇️ 下载 {shareInfo.downloads} 次</span>
              </Space>
            </div>

            <Space style={{ width: '100%' }}>
              <Button
                onClick={handleRevoke}
                danger
                loading={loading}
              >
                撤销分享
              </Button>
              <Button
                onClick={handleCreateShare}
                loading={loading}
              >
                重新生成
              </Button>
            </Space>
          </>
        )}
      </div>
    </Modal>
  );
}

export default ShareModal;
