import SparkMD5 from 'spark-md5';
import { uploadApi } from '../api';

const CHUNK_SIZE = 5 * 1024 * 1024;
const CONCURRENCY = 3;

export async function calculateMD5(file, onProgress) {
  return new Promise((resolve, reject) => {
    const chunkSize = 2 * 1024 * 1024;
    const chunks = Math.ceil(file.size / chunkSize);
    let currentChunk = 0;
    const spark = new SparkMD5.ArrayBuffer();
    const fileReader = new FileReader();

    fileReader.onload = (e) => {
      spark.append(e.target.result);
      currentChunk++;
      
      if (onProgress) {
        onProgress(Math.round((currentChunk / chunks) * 100));
      }

      if (currentChunk < chunks) {
        loadNext();
      } else {
        resolve(spark.end());
      }
    };

    fileReader.onerror = () => {
      reject(new Error('MD5 calculation failed'));
    };

    function loadNext() {
      const start = currentChunk * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      fileReader.readAsArrayBuffer(file.slice(start, end));
    }

    loadNext();
  });
}

export function createChunks(file, chunkSize = CHUNK_SIZE) {
  const chunks = [];
  const totalChunks = Math.ceil(file.size / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    chunks.push({
      index: i,
      start,
      end,
      size: end - start,
      blob: file.slice(start, end)
    });
  }

  return chunks;
}

export async function uploadFile(file, filePath, onProgress) {
  const result = {
    success: false,
    fileId: null,
    error: null,
    quickUpload: false
  };

  try {
    if (onProgress) {
      onProgress({ stage: 'md5', progress: 0 });
    }

    const md5 = await calculateMD5(file, (progress) => {
      if (onProgress) {
        onProgress({ stage: 'md5', progress });
      }
    });

    if (onProgress) {
      onProgress({ stage: 'checking', progress: 0 });
    }

    const checkRes = await uploadApi.checkMd5(md5, file.name, file.size, filePath);
    
    if (checkRes.data.exists && checkRes.data.quickUpload) {
      result.success = true;
      result.fileId = checkRes.data.fileId;
      result.quickUpload = true;
      if (onProgress) {
        onProgress({ stage: 'done', progress: 100, quickUpload: true });
      }
      return result;
    }

    if (checkRes.data.exists && !checkRes.data.quickUpload) {
      result.success = true;
      result.fileId = checkRes.data.file?.id;
      result.quickUpload = true;
      if (onProgress) {
        onProgress({ stage: 'done', progress: 100, quickUpload: true, message: '文件已存在' });
      }
      return result;
    }

    if (onProgress) {
      onProgress({ stage: 'init', progress: 0 });
    }

    const initRes = await uploadApi.initUpload(md5, file.name, file.size, CHUNK_SIZE, filePath);
    const { uploadedChunks = [], totalChunks } = initRes.data;

    const chunks = createChunks(file, CHUNK_SIZE);
    const pendingChunks = chunks.filter(c => !uploadedChunks.includes(c.index));
    
    if (pendingChunks.length === 0) {
      if (onProgress) {
        onProgress({ stage: 'merging', progress: 95 });
      }
      
      const completeRes = await uploadApi.completeUpload(md5, filePath);
      result.success = true;
      result.fileId = completeRes.data.fileId;
      if (onProgress) {
        onProgress({ stage: 'done', progress: 100 });
      }
      return result;
    }

    if (onProgress) {
      onProgress({ 
        stage: 'uploading', 
        progress: Math.round((uploadedChunks.length / totalChunks) * 100),
        uploaded: uploadedChunks.length,
        total: totalChunks
      });
    }

    const uploaded = new Set(uploadedChunks);
    const failed = new Set();
    const chunkProgress = new Map();
    
    uploadedChunks.forEach(i => chunkProgress.set(i, 100));

    await uploadChunksConcurrent(
      md5,
      file.name,
      pendingChunks,
      totalChunks,
      CONCURRENCY,
      uploaded,
      failed,
      chunkProgress,
      (currentProgress) => {
        if (onProgress) {
          const avgProgress = Array.from(chunkProgress.values()).reduce((a, b) => a + b, 0) / totalChunks;
          onProgress({
            stage: 'uploading',
            progress: Math.round(avgProgress),
            uploaded: uploaded.size,
            total: totalChunks,
            failed: failed.size
          });
        }
      }
    );

    if (failed.size > 0) {
      result.error = `上传失败，${failed.size} 个分片未完成`;
      return result;
    }

    if (onProgress) {
      onProgress({ stage: 'merging', progress: 95 });
    }

    const completeRes = await uploadApi.completeUpload(md5, filePath);
    result.success = true;
    result.fileId = completeRes.data.fileId;
    
    if (onProgress) {
      onProgress({ stage: 'done', progress: 100 });
    }

    return result;

  } catch (error) {
    result.error = error.message || '上传失败';
    if (onProgress) {
      onProgress({ stage: 'error', progress: 0, error: result.error });
    }
    return result;
  }
}

async function uploadChunksConcurrent(
  md5,
  fileName,
  chunks,
  totalChunks,
  concurrency,
  uploaded,
  failed,
  chunkProgress,
  onProgress
) {
  let index = 0;
  const results = [];

  async function uploadNext() {
    while (index < chunks.length && !failed.size > 0) {
      const currentIndex = index++;
      const chunk = chunks[currentIndex];
      
      try {
        const formData = new FormData();
        formData.append('chunk', chunk.blob, `${md5}_${chunk.index}`);
        formData.append('md5', md5);
        formData.append('chunkIndex', chunk.index);
        formData.append('totalChunks', totalChunks);
        formData.append('fileName', fileName);

        const res = await uploadApi.uploadChunk(formData, (progressEvent) => {
          if (progressEvent.lengthComputable) {
            const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
            chunkProgress.set(chunk.index, percent);
            onProgress();
          }
        });

        if (res.data.success) {
          uploaded.add(chunk.index);
          chunkProgress.set(chunk.index, 100);
          results[currentIndex] = true;
        } else {
          failed.add(chunk.index);
          results[currentIndex] = false;
        }
        onProgress();
      } catch (e) {
        failed.add(chunk.index);
        results[currentIndex] = false;
        console.error(`Chunk ${chunk.index} upload failed:`, e);
        onProgress();
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => uploadNext());
  await Promise.all(workers);

  return results;
}

export async function uploadFiles(files, filePath, onFileProgress, onOverallProgress) {
  const results = [];
  let completed = 0;
  let totalSize = files.reduce((sum, f) => sum + f.size, 0);
  let uploadedSize = 0;
  const fileProgress = new Map();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    const result = await uploadFile(file, filePath, (progress) => {
      fileProgress.set(i, { file, ...progress });
      
      if (onFileProgress) {
        onFileProgress(i, file, progress);
      }

      if (onOverallProgress) {
        const currentProgress = progress.progress / 100;
        uploadedSize = Array.from(fileProgress.values()).reduce((sum, p) => {
          const f = p.file;
          const prog = p.progress / 100;
          return sum + (f.size * prog);
        }, 0);
        
        onOverallProgress({
          completed,
          total: files.length,
          progress: totalSize > 0 ? Math.round((uploadedSize / totalSize) * 100) : 0,
          currentFile: file.name
        });
      }
    });

    results.push({ file, ...result });
    completed++;

    if (onOverallProgress) {
      onOverallProgress({
        completed,
        total: files.length,
        progress: Math.round((completed / files.length) * 100),
        currentFile: file.name
      });
    }
  }

  return results;
}
