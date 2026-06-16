import React, { useState } from 'react';
import { Breadcrumb, Button, Input, Modal, message, Space } from 'antd';
import {
  UploadOutlined,
  FolderAddOutlined,
  RefreshOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ShareAltOutlined,
  HomeOutlined
} from '@ant-design/icons';
import useStore from '../store';
import FileList from './FileList';
import Uploader from './Uploader';
import FilePreview from './FilePreview';
import ShareModal from './ShareModal';
import MoveDialog from './MoveDialog';
import { fileApi, previewApi } from '../api';
import { joinPath } from '../utils/path';

function FileManager() {
  const { 
    breadcrumbs, 
    currentPath, 
    files, 
    selectedFiles, 
    setSelectedFiles,
    fetchFiles, 
    refresh 
  } = useStore();
  
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [shareFile, setShareFile] = useState(null);
  const [moveFile, setMoveFile] = useState(null);
  const [newFolderModal, setNewFolderModal] = useState({ open: false, name: '' });
  const [loading, setLoading] = useState(false);

  const handleBreadcrumbClick = (path) => {
    fetchFiles(path);
    setSelectedFiles([]);
  };

  const handleCreateFolder = async () => {
    if (!newFolderModal.name.trim()) {
      message.error('请输入文件夹名称');
      return;
    }

    try {
      setLoading(true);
      await fileApi.createFolder(newFolderModal.name.trim(), currentPath);
      message.success('创建成功');
      setNewFolderModal({ open: false, name: '' });
      refresh();
    } catch (e) {
      message.error(e.response?.data?.error || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedFiles.length === 0) {
      message.info('请先选择要删除的文件');
      return;
    }

    Modal.confirm({
      title: '确认删除',
      content: `确定要删除选中的 ${selectedFiles.length} 个项目吗？`,
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          setLoading(true);
          for (const id of selectedFiles) {
            await fileApi.deleteFile(id);
          }
          message.success(`成功删除 ${selectedFiles.length} 个项目`);
          setSelectedFiles([]);
          refresh();
        } catch (e) {
          message.error(e.response?.data?.error || '删除失败');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleBatchDownload = () => {
    const selectedFileObjs = files.filter(f => selectedFiles.includes(f.id) && f.type !== 'folder');
    if (selectedFileObjs.length === 0) {
      message.info('请选择要下载的文件');
      return;
    }

    selectedFileObjs.forEach(file => {
      window.open(previewApi.downloadFile(file.id), '_blank');
    });
  };

  return (
    <>
      <div className="toolbar">
        <Space>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => setUploaderOpen(true)}
          >
            上传文件
          </Button>
          <Button
            icon={<FolderAddOutlined />}
            onClick={() => setNewFolderModal({ open: true, name: '' })}
          >
            新建文件夹
          </Button>
          <Button
            icon={<RefreshOutlined />}
            onClick={refresh}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
        
        <Space style={{ marginLeft: 'auto' }}>
          <Button
            icon={<DownloadOutlined />}
            onClick={handleBatchDownload}
            disabled={selectedFiles.length === 0}
          >
            下载选中
          </Button>
          <Button
            icon={<ShareAltOutlined />}
            disabled={selectedFiles.length !== 1}
            onClick={() => {
              const file = files.find(f => f.id === selectedFiles[0]);
              if (file) setShareFile(file);
            }}
          >
            分享
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={handleBatchDelete}
            disabled={selectedFiles.length === 0}
          >
            删除选中
          </Button>
        </Space>
      </div>

      <div className="breadcrumbs">
        <Breadcrumb>
          {breadcrumbs.map((item, index) => (
            <Breadcrumb.Item key={index}>
              {index === 0 ? <HomeOutlined /> : null}
              <a onClick={() => handleBreadcrumbClick(item.path)}>
                {item.name}
              </a>
            </Breadcrumb.Item>
          ))}
        </Breadcrumb>
      </div>

      <div className="file-list-container">
        <FileList
          onPreview={setPreviewFile}
          onShare={setShareFile}
          onMove={setMoveFile}
        />
      </div>

      <Uploader
        open={uploaderOpen}
        onClose={() => setUploaderOpen(false)}
      />

      {previewFile && (
        <FilePreview
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {shareFile && (
        <ShareModal
          file={shareFile}
          onClose={() => setShareFile(null)}
        />
      )}

      {moveFile && (
        <MoveDialog
          file={moveFile}
          onClose={() => setMoveFile(null)}
          onSuccess={refresh}
        />
      )}

      <Modal
        title="新建文件夹"
        open={newFolderModal.open}
        onOk={handleCreateFolder}
        onCancel={() => setNewFolderModal({ open: false, name: '' })}
        confirmLoading={loading}
      >
        <Input
          value={newFolderModal.name}
          onChange={(e) => setNewFolderModal(prev => ({ ...prev, name: e.target.value }))}
          placeholder="请输入文件夹名称"
          onPressEnter={handleCreateFolder}
          autoFocus
        />
      </Modal>
    </>
  );
}

export default FileManager;
