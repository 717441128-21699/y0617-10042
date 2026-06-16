import { create } from 'zustand';
import { fileApi } from '../api';

const useStore = create((set, get) => ({
  currentPath: '/',
  files: [],
  breadcrumbs: [],
  tree: [],
  selectedFiles: [],
  loading: false,

  setCurrentPath: (path) => set({ currentPath: path }),

  fetchFiles: async (path = '/') => {
    set({ loading: true });
    try {
      const res = await fileApi.getList(path);
      set({
        files: res.data.files,
        breadcrumbs: res.data.breadcrumbs,
        currentPath: res.data.currentPath
      });
    } finally {
      set({ loading: false });
    }
  },

  fetchTree: async () => {
    try {
      const res = await fileApi.getTree();
      set({ tree: res.data });
    } catch (e) {
      console.error('Fetch tree error:', e);
    }
  },

  setSelectedFiles: (files) => set({ selectedFiles: files }),

  refresh: () => {
    const { currentPath } = get();
    get().fetchFiles(currentPath);
    get().fetchTree();
  }
}));

export default useStore;
