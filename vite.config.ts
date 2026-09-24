import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// 模型体积较大，放在项目根目录的 /models 下。开发时 Vite 直接从根目录提供，
// 构建时复制到 dist/models。
function copyModels(): Plugin {
  return {
    name: 'copy-models',
    apply: 'build',
    closeBundle() {
      const src = path.resolve(__dirname, 'models');
      const dst = path.resolve(__dirname, 'dist/models');
      fs.cpSync(src, dst, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), copyModels()],
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 4000 },
});
