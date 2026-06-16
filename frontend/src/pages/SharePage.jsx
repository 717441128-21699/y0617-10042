import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Button, Card, message, Spin, Tag, Space } from 'antd';
import {
  DownloadOutlined,
  FileOutlined,
  FileImageOutlined,
  FileVideoOutlined,
  FilePdfOutlined,
  FileAudioOutlined,
  HomeOutlined,
  CloudOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { shareApi, previewApi } from '../api';
import { formatFileSize } from '../utils/path';

const getPreviewIcon = (name, type) => {
  const ext = name.split('.').pop().toLowerCase();
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'm4v', 'avi'];
  const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];
  
  if (imageExts.includes(ext)) return <FileImageOutlined style={{ fontSize: 64, color: '#1890ff' }} />;
  if (videoExts.includes(ext)) return <FileVideoOutlined style={{ fontSize: 64, color: '#722ed1' }} />;
  if (audioExts.includes(ext)) return <FileAudioOutlined style={{ fontSize: 64, color: '#52c41a' }} />;
  if (ext === 'pdf') return <FilePdfOutlined style={{ fontSize: 64, color: '#f5222d' }} />;
  return <FileOutlined style={{ fontSize: 64, color: '#8c8c8c' }} />;
};

function SharePage() {
  const { token } = useParams();
  const [shareInfo, setShareInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    const fetchShare = async () => {
      try {
        setLoading(true);
        const res = await shareApi.getShare(token);
        setShareInfo(res.data);
        
        if (res.data.type !== 'folder') {
          setPreviewUrl(previewApi.getContentUrl(res.data.fileId));
        }
      } catch (e) {
        if (e.response?.status === 410) {
          setError('分享链接已过期');
        } else if (e.response?.status === 404) {
          setError('分享链接不存在或已被撤销');
        } else {
          setError(e.response?.data?.error || '加载失败');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchShare();
  }, [token]);

  const handleDownload = () => {
    window.open(shareApi.downloadShare(token));
  };

  const getPreviewType = (name) => {
    const ext = name.split('.').pop().toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'm4v', 'avi'];
    const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];
    const pdfExts = ['pdf'];
    
    if (imageExts.includes(ext)) return 'image';
    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    if (pdfExts.includes(ext)) return 'pdf';
    return null;
  };

  const renderPreview = () => {
    if (!shareInfo || !previewUrl) return null;
    
    const previewType = getPreviewType(shareInfo.name);
    
    if (!previewType) {
      return (
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
          {getPreviewIcon(shareInfo.name)}
          <p style={{ marginTop: 16 }}>该文件类型暂不支持在线预览</p>
        </div>
      );
    }

    if (!showPreview) {
      return (
        <div 
          style={{ 
            textAlign: 'center', 
            padding: 40, 
            cursor: 'pointer',
            background: '#fafafa',
            borderRadius: 8,
            marginBottom: 16
          }}
          onClick={() => setShowPreview(true)}
        >
          {getPreviewIcon(shareInfo.name)}
          <p style={{ marginTop: 16, color: '#1890ff' }}>点击预览</p>
        </div>
      );
    }

    switch (previewType) {
      case 'image':
        return (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <img 
              src={previewUrl} 
              alt={shareInfo.name} 
              style={{ maxWidth: '100%', maxHeight: 500, borderRadius: 8 }} 
            />
          </div>
        );
      case 'video':
        return (
          <div style={{ marginBottom: 16 }}>
            <video 
              src={previewUrl} 
              controls 
              style={{ width: '100%', maxHeight: 500, borderRadius: 8, background: '#000' }} 
            />
          </div>
        );
      case 'audio':
        return (
          <div style={{ textAlign: 'center', marginBottom: 16, padding: 40, background: '#fafafa', borderRadius: 8 }}>
            {getPreviewIcon(shareInfo.name)}
            <p style={{ marginTop: 16 }}>{shareInfo.name}</p>
            <audio src={previewUrl} controls style={{ width: '100%', marginTop: 16 }} />
          </div>
        );
      case 'pdf':
        return (
          <div style={{ marginBottom: 16 }}>
            <iframe 
              src={previewUrl} 
              style={{ width: '100%', height: 600, border: 'none', borderRadius: 8 }} 
              title={shareInfo.name}
            />
          </div>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div style={{ 
        height: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <Spin size="large" style={{ color: '#fff' }} tip="加载中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        height: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <Card style={{ width: 400, textAlign: 'center' }}>
          <FileOutlined style={{ fontSize: 64, color: '#ff4d4f', marginBottom: 16 }} />
          <h2 style={{ marginBottom: 8 }}>分享链接无效</h2>
          <p style={{ color: '#999', marginBottom: 24 }}>{error}</p>
          <Link to="/">
            <Button type="primary" icon={<HomeOutlined />}>
              返回首页
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: 40
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 8, 
          color: '#fff', 
          marginBottom: 24,
          fontSize: 20,
          fontWeight: 600
        }}>
          <CloudOutlined style={{ fontSize: 28 }} />
          <span>私有云存储 - 文件分享</span>
          <Link to="/" style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>
            <HomeOutlined /> 管理后台
          </Link>
        </div>

        <Card>
          <div style={{ marginBottom: 16 }}>
            <Space>
              {shareInfo.expireAt ? (
                dayjs(shareInfo.expireAt) < dayjs() ? (
                  <Tag color="red">已过期</Tag>
                ) : (
                  <Tag color="orange">
                    有效期至 {dayjs(shareInfo.expireAt).format('YYYY-MM-DD HH:mm')}
                  </Tag>
                )
              ) : (
                <Tag color="blue">永久有效</Tag>
              )}
              <Tag>
                👁️ {shareInfo.views} 次浏览
              </Tag>
              <Tag>
                ⬇️ {shareInfo.downloads} 次下载
              </Tag>
            </Space>
          </div>

          {renderPreview()}

          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 16, 
            padding: 16, 
            background: '#fafafa', 
            borderRadius: 8,
            marginBottom: 16
          }}>
            {getPreviewIcon(shareInfo.name, shareInfo.type)}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>
                {shareInfo.name}
              </div>
              <div style={{ color: '#999', fontSize: 13 }}>
                {formatFileSize(shareInfo.size)} · {dayjs(shareInfo.expireAt || shareInfo.createdAt).format('YYYY-MM-DD')}
              </div>
            </div>
            <Button 
              type="primary" 
              size="large"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
            >
              下载文件
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default SharePage;
