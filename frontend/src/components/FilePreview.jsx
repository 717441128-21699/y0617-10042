import React, { useState, useEffect } from 'react';
import { Modal, Button, message, Spin } from 'antd';
import {
  DownloadOutlined,
  ShareAltOutlined,
  CloseOutlined,
  FileOutlined,
  FileImageOutlined,
  FileVideoOutlined,
  FilePdfOutlined,
  FileAudioOutlined
} from '@ant-design/icons';
import { previewApi } from '../api';
import { formatFileSize } from '../utils/path';

const getPreviewIcon = (previewType) => {
  switch (previewType) {
    case 'image': return <FileImageOutlined style={{ fontSize: 64, color: '#1890ff' }} />;
    case 'video': return <FileVideoOutlined style={{ fontSize: 64, color: '#722ed1' }} />;
    case 'pdf': return <FilePdfOutlined style={{ fontSize: 64, color: '#f5222d' }} />;
    case 'audio': return <FileAudioOutlined style={{ fontSize: 64, color: '#52c41a' }} />;
    default: return <FileOutlined style={{ fontSize: 64, color: '#8c8c8c' }} />;
  }
};

function FilePreview({ file, onClose, onShare }) {
  const [previewInfo, setPreviewInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        setLoading(true);
        const res = await previewApi.getPreviewInfo(file.id);
        setPreviewInfo(res.data);
      } catch (e) {
        message.error('获取预览信息失败');
      } finally {
        setLoading(false);
      }
    };

    fetchInfo();
  }, [file.id]);

  const handleDownload = () => {
    window.open(previewApi.downloadFile(file.id));
  };

  const renderPreviewContent = () => {
    if (loading) {
      return (
        <div className="preview-content">
          <Spin size="large" tip="加载中..." />
        </div>
      );
    }

    if (!previewInfo) {
      return (
        <div className="preview-content">
          <div style={{ textAlign: 'center', color: '#999' }}>
            <FileOutlined style={{ fontSize: 64, marginBottom: 16 }} />
            <p>无法加载预览信息</p>
          </div>
        </div>
      );
    }

    if (!previewInfo.canPreview) {
      return (
        <div className="preview-content">
          <div style={{ textAlign: 'center', color: '#999' }}>
            {getPreviewIcon(previewInfo.previewType)}
            <p style={{ marginTop: 16, fontSize: 16 }}>该文件类型暂不支持预览</p>
            <p style={{ color: '#666' }}>
              {file.name} · {formatFileSize(file.size)}
            </p>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
              style={{ marginTop: 16 }}
            >
              下载文件
            </Button>
          </div>
        </div>
      );
    }

    const contentUrl = previewApi.getContentUrl(file.id);

    switch (previewInfo.previewType) {
      case 'image':
        return (
          <div className="preview-content">
            <img src={contentUrl} alt={file.name} style={{ maxWidth: '100%', maxHeight: '70vh' }} />
          </div>
        );

      case 'video':
        return (
          <div className="preview-content">
            <video
              src={contentUrl}
              controls
              autoPlay
              style={{ maxWidth: '100%', maxHeight: '70vh' }}
            />
          </div>
        );

      case 'pdf':
        return (
          <div className="preview-content" style={{ padding: 0 }}>
            <iframe
              src={contentUrl}
              className="preview-pdf"
              style={{ width: '100%', height: '70vh', border: 'none' }}
              title={file.name}
            />
          </div>
        );

      case 'audio':
        return (
          <div className="preview-content">
            <div style={{ textAlign: 'center' }}>
              {getPreviewIcon('audio')}
              <p style={{ marginTop: 16, fontSize: 16 }}>{file.name}</p>
              <p style={{ color: '#999', marginBottom: 16 }}>{formatFileSize(file.size)}</p>
              <audio src={contentUrl} controls autoPlay style={{ width: 400 }} />
            </div>
          </div>
        );

      default:
        return (
          <div className="preview-content">
            <div style={{ textAlign: 'center', color: '#999' }}>
              {getPreviewIcon(null)}
              <p style={{ marginTop: 16 }}>未知文件类型</p>
            </div>
          </div>
        );
    }
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {getPreviewIcon(previewInfo?.previewType)}
          <span style={{ fontSize: 16, fontWeight: 500 }}>{file.name}</span>
        </div>
      }
      open={true}
      onCancel={onClose}
      width={previewInfo?.previewType === 'pdf' ? '90%' : 700}
      footer={[
        <Button key="download" icon={<DownloadOutlined />} onClick={handleDownload}>
          下载
        </Button>,
        onShare && (
          <Button key="share" icon={<ShareAltOutlined />} onClick={onShare}>
            分享
          </Button>
        ),
        <Button key="close" icon={<CloseOutlined />} onClick={onClose}>
          关闭
        </Button>
      ]}
      bodyStyle={{ padding: 0, minHeight: 500 }}
      destroyOnClose
    >
      <div className="preview-container">
        {renderPreviewContent()}
      </div>
    </Modal>
  );
}

export default FilePreview;
