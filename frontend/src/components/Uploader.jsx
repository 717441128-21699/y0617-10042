import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Modal, Progress, Button, List, message } from 'antd';
import { 
  UploadOutlined, 
  CheckCircleOutlined, 
  CloseCircleOutlined,
  LoadingOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { uploadFiles } from '../utils/uploader';
import useStore from '../store';
import { formatFileSize } from '../utils/path';

const STAGE_TEXTS = {
  md5: '计算MD5',
  checking: '检查文件',
  init: '初始化上传',
  uploading: '上传中',
  merging: '合并文件',
  done: '完成',
  error: '失败'
};

function Uploader({ open, onClose }) {
  const { currentPath, refresh } = useStore();
  const [uploading, setUploading] = useState(false);
  const [fileList, setFileList] = useState([]);
  const [overallProgress, setOverallProgress] = useState(0);

  const onDrop = useCallback((acceptedFiles) => {
    const newFiles = acceptedFiles.map((file, idx) => ({
      file,
      id: `${Date.now()}-${idx}`,
      name: file.name,
      size: file.size,
      progress: 0,
      stage: 'pending',
      status: 'pending',
      error: null,
      quickUpload: false
    }));
    setFileList(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    noClick: uploading,
    disabled: uploading
  });

  const startUpload = async () => {
    if (fileList.length === 0) return;
    
    setUploading(true);
    
    const files = fileList
      .filter(f => f.status === 'pending')
      .map(f => f.file);
    
    const results = await uploadFiles(
      files, 
      currentPath,
      (idx, file, progress) => {
        setFileList(prev => prev.map((item, i) => {
          if (item.file === file) {
            return {
              ...item,
              progress: progress.progress,
              stage: progress.stage,
              status: progress.stage === 'error' ? 'error' : 
                      progress.stage === 'done' ? 'success' : 'uploading',
              error: progress.error,
              quickUpload: progress.quickUpload || false
            };
          }
          return item;
        }));
      },
      (overall) => {
        setOverallProgress(overall.progress);
      }
    );

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    if (successCount > 0) {
      message.success(`成功上传 ${successCount} 个文件`);
    }
    if (failCount > 0) {
      message.error(`${failCount} 个文件上传失败`);
    }
    
    setUploading(false);
    refresh();
  };

  const removeFile = (id) => {
    if (uploading) return;
    setFileList(prev => prev.filter(f => f.id !== id));
  };

  const clearCompleted = () => {
    setFileList(prev => prev.filter(f => f.status !== 'success' && f.status !== 'error'));
  };

  const handleClose = () => {
    if (uploading) {
      Modal.confirm({
        title: '确认关闭',
        content: '上传正在进行中，关闭后已上传的分片可以在下次续传。确定要关闭吗？',
        onOk: () => {
          onClose();
          setFileList([]);
          setOverallProgress(0);
        }
      });
    } else {
      onClose();
      setFileList([]);
      setOverallProgress(0);
    }
  };

  return (
    <Modal
      title="上传文件"
      open={open}
      onCancel={handleClose}
      width={600}
      footer={[
        <Button key="clear" onClick={clearCompleted} disabled={uploading}>
          清除已完成
        </Button>,
        <Button key="cancel" onClick={handleClose}>
          {uploading ? '后台运行' : '关闭'}
        </Button>,
        <Button 
          key="upload" 
          type="primary" 
          onClick={startUpload}
          loading={uploading}
          disabled={fileList.length === 0 || uploading}
          icon={<UploadOutlined />}
        >
          开始上传
        </Button>
      ]}
    >
      <div
        {...getRootProps()}
        className={`upload-zone ${isDragActive ? 'dragover' : ''}`}
      >
        <input {...getInputProps()} />
        <UploadOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
        <p style={{ fontSize: 16, marginBottom: 8 }}>
          {isDragActive ? '松开鼠标上传文件' : '拖拽文件到此处，或点击选择文件'}
        </p>
        <p style={{ color: '#999', fontSize: 13 }}>
          支持大文件分片上传、MD5秒传、断点续传
        </p>
      </div>

      {fileList.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {uploading && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>总体进度</span>
                <span>{overallProgress}%</span>
              </div>
              <Progress percent={overallProgress} size="small" />
            </div>
          )}

          <List
            size="small"
            dataSource={fileList}
            renderItem={(item) => (
              <List.Item
                actions={[
                  item.status === 'success' ? (
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  ) : item.status === 'error' ? (
                    <CloseCircleOutlined style={{ color: '#f5222d' }} />
                  ) : item.status === 'uploading' ? (
                    <LoadingOutlined style={{ color: '#1890ff' }} />
                  ) : null,
                  <Button 
                    type="text" 
                    size="small" 
                    danger
                    onClick={() => removeFile(item.id)}
                    disabled={uploading}
                  >
                    移除
                  </Button>
                ]}
              >
                <List.Item.Meta
                  title={
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {item.quickUpload && (
                        <ThunderboltOutlined style={{ color: '#faad14' }} title="秒传" />
                      )}
                      {item.name}
                      {item.error && (
                        <span style={{ color: '#f5222d', fontSize: 12 }}>
                          - {item.error}
                        </span>
                      )}
                    </span>
                  }
                  description={
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ color: '#999', fontSize: 12 }}>
                          {formatFileSize(item.size)}
                          {item.stage && ` · ${STAGE_TEXTS[item.stage] || item.stage}`}
                        </span>
                        <span style={{ color: '#999', fontSize: 12 }}>
                          {item.progress}%
                        </span>
                      </div>
                      {(item.status === 'uploading' || item.stage === 'uploading') && (
                        <Progress percent={item.progress} size="small" showInfo={false} />
                      )}
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        </div>
      )}
    </Modal>
  );
}

export default Uploader;
