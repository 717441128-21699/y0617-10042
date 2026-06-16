import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 300000
});

export const uploadApi = {
  checkMd5: (md5, name, size, filePath) =>
    api.post('/upload/check-md5', { md5, name, size, filePath }),

  initUpload: (md5, name, size, chunkSize, filePath) =>
    api.post('/upload/init', { md5, name, size, chunkSize, filePath }),

  uploadChunk: (formData, onProgress) =>
    api.post('/upload/chunk', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress
    }),

  completeUpload: (md5, filePath) =>
    api.post('/upload/complete', { md5, filePath })
};

export const fileApi = {
  getTree: () => api.get('/files/tree'),

  getList: (path = '/') => api.get('/files/list', { params: { path } }),

  getFile: (id) => api.get(`/files/${id}`),

  createFolder: (name, path = '/') =>
    api.post('/files/folder', { name, path }),

  moveFile: (id, targetPath) =>
    api.put(`/files/${id}/move`, { targetPath }),

  renameFile: (id, name) =>
    api.put(`/files/${id}/rename`, { name }),

  deleteFile: (id) => api.delete(`/files/${id}`)
};

export const shareApi = {
  createShare: (fileId, expireHours = 24) =>
    api.post('/shares/create', { fileId, expireHours }),

  getShare: (token) => api.get(`/shares/${token}`),

  downloadShare: (token) => `/api/shares/${token}/download`,

  revokeShare: (token) => api.delete(`/shares/${token}`),

  getFileShares: (fileId) => api.get(`/shares/file/${fileId}`)
};

export const previewApi = {
  getPreviewInfo: (id) => api.get(`/preview/${id}`),

  getContentUrl: (id, download = false) =>
    `/api/preview/${id}/content${download ? '?download=1' : ''}`,

  getThumbnailUrl: (id) => `/api/preview/${id}/thumbnail`,

  downloadFile: (id) => `/api/preview/${id}/download`
};

export const logApi = {
  getLogs: (params) => api.get('/logs', { params }),

  getStats: (params) => api.get('/logs/stats', { params }),

  getRecent: (limit = 10) => api.get('/logs/recent', { params: { limit } })
};

export default api;
