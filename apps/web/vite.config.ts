import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function e2ePresentationAssetPlugin(): Plugin {
  return {
    name: 'e2e-presentation-asset',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.originalUrl?.startsWith('/__e2e__/card-art.svg')) {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'image/svg+xml');
          response.end('<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024"><rect width="768" height="1024" fill="#284b63"/><circle cx="270" cy="300" r="170" fill="#84a9ac"/></svg>');
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'e2e' ? [e2ePresentationAssetPlugin()] : [])],
  publicDir: '../../public-assets',
}));
