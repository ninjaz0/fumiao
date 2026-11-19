import {defineConfig} from 'vite';
export default defineConfig({define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'../static',emptyOutDir:false,lib:{entry:'src/chat-entry.tsx',name:'FumiaoChat',formats:['iife'],fileName:()=> 'chat.js',cssFileName:'chat'},sourcemap:false}});
