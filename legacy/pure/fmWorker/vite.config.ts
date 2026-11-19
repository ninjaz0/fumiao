/// <reference types="vitest" />
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// 演示数据只在 `--mode demo`（npm run demo / build:demo）中编入。
// 生产构建 __FM_DEMO__=false，演示模块被整体剔除，URL 参数也无法开启。
export default defineConfig(({mode})=>({
  plugins:[react()],
  base:mode==='demo'?'./':'/',
  clearScreen:false,
  define:{__FM_DEMO__:JSON.stringify(mode==='demo')},
  server:{port:1420,strictPort:true},
  build:{target:'es2021',sourcemap:false},
  test:{environment:'node',include:['src/**/*.test.ts']}
}));
